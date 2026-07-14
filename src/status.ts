import type { DatasetItem } from './types.js';

export function buildStatusMessage(
    items: DatasetItem[],
    capped: number,
    total: number,
    unresolved: number,
    notes: string[],
): string {
    const counts = { high: 0, medium: 0, low: 0, error: 0 };
    items.forEach((item) => {
        if (item.status === 'error') counts.error += 1;
        else counts[item.riskLevel] += 1;
    });

    const prefix = capped > 0
        ? `Scanned ${items.length} of ${total} packages, capped by maxPackages`
        : `Scanned ${items.length} ${items.length === 1 ? 'package' : 'packages'}`;
    const parts = (['high', 'medium', 'low'] as const)
        .filter((level) => counts[level] > 0)
        .map((level) => `${counts[level]} ${level}`);
    if (unresolved > 0) parts.push(`${unresolved} unresolved`);
    if (counts.error > 0) parts.push(`${counts.error} error${counts.error === 1 ? '' : 's'}`);

    return [`${prefix}: ${parts.join(', ') || 'no results'}`, ...notes].join('. ');
}
