import type { OsvVulnerability } from './osv-client.js';
import { parseInput } from './input.js';
import type { RegistryClient } from './registry.js';
import { resolveInput } from './resolve.js';
import { scanTargets } from './scanner.js';
import { sortDatasetItems } from './score.js';
import type { DatasetItem, ResolvedTarget, ScannerInput } from './types.js';

export interface ActorAdapter {
    init: () => Promise<void>;
    getInput: () => Promise<unknown>;
    pushData: (items: DatasetItem[]) => Promise<void>;
    setStatusMessage: (message: string) => Promise<void>;
    exit: (message: string) => Promise<void>;
    fail: (message: string) => Promise<void>;
}

interface RunDependencies {
    registry: RegistryClient;
    fetchRemote: (url: string) => Promise<Response>;
    queryOsv: (targets: ResolvedTarget[]) => Promise<Map<string, OsvVulnerability[]>>;
    now?: () => Date;
}

function summaryFor(items: DatasetItem[], capped: number, total: number, unresolved: number, notes: string[]): string {
    const counts = { high: 0, medium: 0, low: 0, error: 0 };
    items.forEach((item) => {
        if (item.status === 'error') counts.error += 1;
        else counts[item.riskLevel] += 1;
    });
    const prefix = capped > 0
        ? `Scanned ${items.length} of ${total} packages, capped by maxPackages`
        : `Scanned ${items.length} packages`;
    const parts = (['high', 'medium', 'low'] as const)
        .filter((level) => counts[level] > 0)
        .map((level) => `${counts[level]} ${level}`);
    if (unresolved > 0) parts.push(`${unresolved} unresolved`);
    if (counts.error > 0) parts.push(`${counts.error} error${counts.error === 1 ? '' : 's'}`);
    return [`${prefix}: ${parts.join(', ') || 'no results'}`, ...notes].join('. ');
}

export async function runActor(actor: ActorAdapter, dependencies: RunDependencies): Promise<void> {
    await actor.init();
    let input;
    try {
        input = parseInput(await actor.getInput());
    } catch (error) {
        await actor.fail(error instanceof Error ? error.message : 'Invalid Actor input');
        return;
    }

    let resolution;
    try {
        resolution = await resolveInput(input, {
            registry: dependencies.registry,
            fetchRemote: dependencies.fetchRemote,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'unknown error';
        if (input.packages?.length && input.packageJsonUrl) {
            const explicitInput: ScannerInput = { ...input };
            delete explicitInput.packageJsonUrl;
            resolution = await resolveInput(explicitInput, {
                registry: dependencies.registry,
                fetchRemote: dependencies.fetchRemote,
            });
            resolution.statusNotes.push(`Manifest resolution failed: ${message}`);
        } else {
            await actor.fail(`Unable to resolve input: ${message}`);
            return;
        }
    }
    const notes = [...resolution.statusNotes];
    let osvVulnerabilities = new Map<string, OsvVulnerability[]>();
    if (input.checks.includes('osvVulns') && resolution.targets.length > 0) {
        try {
            osvVulnerabilities = await dependencies.queryOsv(resolution.targets);
        } catch (error) {
            notes.push(`OSV check unavailable: ${error instanceof Error ? error.message : 'unknown error'}`);
        }
    }

    const scanned = await scanTargets(resolution.targets, {
        registry: dependencies.registry,
        checks: input.checks,
        osvVulnerabilities,
        ...(dependencies.now ? { now: dependencies.now } : {}),
    });
    const scannedAt = (dependencies.now ?? (() => new Date()))().toISOString();
    const resolutionErrors: DatasetItem[] = resolution.errors.map((error) => ({
        status: 'error',
        package: error.package,
        sources: error.sources,
        error: { code: error.code, message: error.message },
        scannedAt,
    }));
    const items = sortDatasetItems([...scanned, ...resolutionErrors]);
    if (items.length === 0) {
        await actor.fail('No npm packages could be resolved for scanning');
        return;
    }
    await actor.pushData(items);
    const total = resolution.stats.deduplicated + resolution.errors.length;
    const summary = summaryFor(items, resolution.stats.capped, total, resolution.stats.unresolved, notes);
    await actor.setStatusMessage(summary);

    const explicitMissing = items.find((item) => item.status === 'error'
        && item.error.code === 'PACKAGE_NOT_FOUND'
        && item.sources.includes('explicit'));
    if (explicitMissing) {
        await actor.fail(`Explicit package not found: ${explicitMissing.package}. ${summary}`);
        return;
    }
    if (items.every(({ status }) => status === 'error')) {
        await actor.fail(`All selected packages failed to scan. ${summary}`);
        return;
    }
    const threshold = input.failThreshold;
    if (threshold !== undefined) {
        const breach = items.find((item) => item.status === 'scanned' && item.riskScore >= threshold);
        if (breach?.status === 'scanned') {
            await actor.fail(`Risk threshold ${threshold} breached by ${breach.package}@${breach.version} (${breach.riskScore}). ${summary}`);
            return;
        }
    }
    await actor.exit(summary);
}
