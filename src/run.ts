import type { OsvVulnerability } from './osv-client.js';
import { parseInput } from './input.js';
import type { RegistryClient } from './registry.js';
import { resolveInput } from './resolve.js';
import { scanTargets } from './scanner.js';
import { sortDatasetItems } from './score.js';
import { buildStatusMessage } from './status.js';
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
        sourcesText: error.sources.join(', '),
        errorCode: error.code,
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
    const unresolvedWithoutErrorRow = Math.max(0, resolution.stats.unresolved - resolution.errors.length);
    const summary = buildStatusMessage(items, resolution.stats.capped, total, unresolvedWithoutErrorRow, notes);
    await actor.setStatusMessage(summary);

    const explicitMissing = items.find((item) => item.status === 'error'
        && item.error.code === 'PACKAGE_NOT_FOUND'
        && item.sources.includes('explicit'));
    if (explicitMissing) {
        await actor.fail(`Explicit package not found: ${explicitMissing.package}. ${summary}`);
        return;
    }
    const allErrorsAreNonExplicitMissingPackages = items.every((item) => item.status === 'error'
        && item.error.code === 'PACKAGE_NOT_FOUND'
        && !item.sources.includes('explicit'));
    if (items.every(({ status }) => status === 'error') && !allErrorsAreNonExplicitMissingPackages) {
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
