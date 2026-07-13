import type { Packument, RegistryVersion } from '../registry.js';
import type { Finding } from '../types.js';

interface MaintainerContext {
    packument: Packument;
    version: string;
    now: Date;
}

const DAY_MS = 24 * 60 * 60 * 1_000;

function identity(maintainer: { name?: string; email?: string }): string {
    return `${maintainer.name ?? ''}<${maintainer.email ?? ''}>`.toLowerCase();
}

function comparableMaintainerChange(
    current: RegistryVersion,
    previous: RegistryVersion,
): { changed: boolean; newMaintainer: boolean } | undefined {
    if (!current.maintainers?.length || !previous.maintainers?.length) return undefined;
    const before = new Set(previous.maintainers.map(identity));
    const after = new Set(current.maintainers.map(identity));
    return {
        changed: before.size !== after.size || [...before].some((item) => !after.has(item)),
        newMaintainer: [...after].some((item) => !before.has(item)),
    };
}

export function checkMaintainerSignals(pkgMeta: RegistryVersion, context: MaintainerContext): Finding[] {
    const findings: Finding[] = [];
    const times = context.packument.time ?? {};
    const releases = Object.entries(times)
        .filter(([version, timestamp]) => context.packument.versions[version] && !Number.isNaN(Date.parse(timestamp)))
        .map(([version, timestamp]) => ({ version, date: new Date(timestamp) }))
        .sort((a, b) => a.date.getTime() - b.date.getTime());

    const created = times.created
        ? new Date(times.created)
        : releases[0]?.date;
    if (created && context.now.getTime() - created.getTime() < 30 * DAY_MS) {
        findings.push({
            check: 'maintainerSignals',
            severity: 'medium',
            summary: 'Package is less than 30 days old',
            detail: `First publication was ${created.toISOString()}. New packages have limited history to assess.`,
        });
    }

    const currentIndex = releases.findIndex(({ version }) => version === context.version);
    const currentRelease = releases[currentIndex];
    const previousRelease = currentIndex > 0 ? releases[currentIndex - 1] : undefined;
    if (currentRelease && previousRelease) {
        const previousMeta = context.packument.versions[previousRelease.version];
        const change = previousMeta ? comparableMaintainerChange(pkgMeta, previousMeta) : undefined;
        if (change?.changed) {
            const dormantUntil = new Date(previousRelease.date);
            dormantUntil.setUTCMonth(dormantUntil.getUTCMonth() + 18);
            const dormantTakeover = change.newMaintainer && currentRelease.date > dormantUntil;
            findings.push({
                check: 'maintainerSignals',
                severity: dormantTakeover ? 'high' : 'medium',
                summary: dormantTakeover
                    ? 'New maintainer published after more than 18 months of inactivity'
                    : 'Maintainer list changed between releases',
                detail: `Compared ${previousRelease.version} with ${currentRelease.version} using available registry metadata. This is a risk signal, not proof of compromise.`,
            });
        }
    }

    if (pkgMeta.deprecated) {
        findings.push({
            check: 'maintainerSignals',
            severity: 'info',
            summary: 'Package version is deprecated',
            detail: pkgMeta.deprecated,
        });
    }
    return findings;
}
