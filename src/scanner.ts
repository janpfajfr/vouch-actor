import { checkInstallScripts } from './checks/install-scripts.js';
import { checkMaintainerSignals } from './checks/maintainer-signals.js';
import { checkOsv } from './checks/osv.js';
import { checkProvenance } from './checks/provenance.js';
import type { OsvVulnerability } from './osv-client.js';
import { HttpError, type RegistryClient } from './registry.js';
import { calculateRiskScore, riskLevelFor } from './score.js';
import type {
    CheckName,
    DatasetItem,
    Finding,
    ResolvedTarget,
} from './types.js';

interface ScanOptions {
    registry: RegistryClient;
    checks: CheckName[];
    now?: () => Date;
    score?: (findings: Finding[], attested: boolean) => number;
    concurrency?: number;
    osvVulnerabilities?: Map<string, OsvVulnerability[]>;
}

function errorCode(error: unknown): string {
    if (error instanceof HttpError && error.status === 404) return 'PACKAGE_NOT_FOUND';
    if (error instanceof Error && error.message.startsWith('VERSION_NOT_FOUND')) return 'VERSION_NOT_FOUND';
    return 'REGISTRY_ERROR';
}

async function scanTarget(target: ResolvedTarget, options: ScanOptions, scannedAt: string): Promise<DatasetItem> {
    try {
        const packument = await options.registry.getPackument(target.name);
        const versionMeta = packument.versions[target.version];
        if (!versionMeta) throw new Error(`VERSION_NOT_FOUND: ${target.name}@${target.version}`);
        const weeklyDownloads = await options.registry.getWeeklyDownloads(target.name);
        const attestation = await options.registry.getAttestations(target.name, target.version);
        const findings = options.checks.flatMap((check): Finding[] => {
            switch (check) {
                case 'installScripts':
                    return checkInstallScripts(versionMeta, {});
                case 'provenance':
                    return checkProvenance(versionMeta, { attested: attestation.attested });
                case 'maintainerSignals':
                    return checkMaintainerSignals(versionMeta, {
                        packument,
                        version: target.version,
                        now: new Date(scannedAt),
                    });
                case 'osvVulns':
                    return checkOsv(versionMeta, {
                        vulnerabilities: options.osvVulnerabilities?.get(`${target.name}@${target.version}`) ?? [],
                    });
            }
        });
        const riskScore = (options.score ?? calculateRiskScore)(findings, attestation.attested);
        const maintainers = versionMeta.maintainers ?? packument.maintainers ?? [];
        return {
            status: 'scanned',
            package: target.name,
            version: target.version,
            sources: target.sources,
            resolvedFrom: target.resolvedFrom,
            riskScore,
            riskLevel: riskLevelFor(riskScore),
            findings,
            findingCount: findings.length,
            provenance: { attested: attestation.attested },
            meta: {
                ...(packument.time?.[target.version] ? { publishedAt: packument.time[target.version] } : {}),
                maintainers: maintainers.length,
                ...(weeklyDownloads === undefined ? {} : { weeklyDownloads }),
                deprecated: Boolean(versionMeta.deprecated),
            },
            scannedAt,
        };
    } catch (error) {
        return {
            status: 'error',
            package: target.name,
            version: target.version,
            sources: target.sources,
            resolvedFrom: target.resolvedFrom,
            error: {
                code: errorCode(error),
                message: error instanceof Error ? error.message : 'Unknown package scan error',
            },
            scannedAt,
        };
    }
}

export async function scanTargets(targets: ResolvedTarget[], options: ScanOptions): Promise<DatasetItem[]> {
    const results = new Array<DatasetItem>(targets.length);
    const scannedAt = (options.now ?? (() => new Date()))().toISOString();
    const workerCount = Math.min(options.concurrency ?? 5, targets.length);
    let nextIndex = 0;
    const workers = Array.from({ length: workerCount }, async () => {
        while (nextIndex < targets.length) {
            const index = nextIndex;
            nextIndex += 1;
            const current = targets[index];
            if (current) results[index] = await scanTarget(current, options, scannedAt);
        }
    });
    await Promise.all(workers);
    return results;
}
