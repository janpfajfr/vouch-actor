import type { OsvVulnerability } from '../osv-client.js';
import type { RegistryVersion } from '../registry.js';
import type { Finding, Severity } from '../types.js';

interface OsvContext {
    vulnerabilities: OsvVulnerability[];
}

function cvssV3BaseScore(vector: string): number | undefined {
    if (!/^CVSS:3\.[01]\//.test(vector)) return undefined;
    const metrics = new Map(vector.split('/').slice(1).flatMap((part) => {
        const separator = part.indexOf(':');
        return separator > 0 ? [[part.slice(0, separator), part.slice(separator + 1)] as const] : [];
    }));
    const scope = metrics.get('S');
    const value = (metric: string, weights: Record<string, number>): number | undefined => {
        const selected = metrics.get(metric);
        return selected ? weights[selected] : undefined;
    };
    const attackVector = value('AV', { N: 0.85, A: 0.62, L: 0.55, P: 0.2 });
    const attackComplexity = value('AC', { L: 0.77, H: 0.44 });
    const privilegesRequired = value('PR', scope === 'C'
        ? { N: 0.85, L: 0.68, H: 0.5 }
        : { N: 0.85, L: 0.62, H: 0.27 });
    const userInteraction = value('UI', { N: 0.85, R: 0.62 });
    const confidentiality = value('C', { H: 0.56, L: 0.22, N: 0 });
    const integrity = value('I', { H: 0.56, L: 0.22, N: 0 });
    const availability = value('A', { H: 0.56, L: 0.22, N: 0 });
    if ((scope !== 'U' && scope !== 'C')
        || attackVector === undefined
        || attackComplexity === undefined
        || privilegesRequired === undefined
        || userInteraction === undefined
        || confidentiality === undefined
        || integrity === undefined
        || availability === undefined) return undefined;

    const impactBase = 1 - ((1 - confidentiality) * (1 - integrity) * (1 - availability));
    const impact = scope === 'U'
        ? 6.42 * impactBase
        : (7.52 * (impactBase - 0.029)) - (3.25 * ((impactBase - 0.02) ** 15));
    if (impact <= 0) return 0;
    const exploitability = 8.22 * attackVector * attackComplexity * privilegesRequired * userInteraction;
    const raw = scope === 'U'
        ? Math.min(impact + exploitability, 10)
        : Math.min(1.08 * (impact + exploitability), 10);
    return Math.ceil(raw * 10) / 10;
}

function severityFor(vulnerability: OsvVulnerability): Severity {
    const numeric = vulnerability.severity
        ?.map(({ score }) => {
            const direct = Number(score);
            return Number.isFinite(direct) ? direct : cvssV3BaseScore(score);
        })
        .find((score) => Number.isFinite(score));
    if (numeric !== undefined) {
        if (numeric >= 9) return 'critical';
        if (numeric >= 7) return 'high';
        if (numeric >= 4) return 'medium';
        if (numeric > 0) return 'low';
    }
    const named = vulnerability.database_specific?.severity?.toLowerCase();
    return named === 'critical' || named === 'high' || named === 'medium' || named === 'low'
        ? named
        : 'info';
}

export function checkOsv(pkgMeta: RegistryVersion, context: OsvContext): Finding[] {
    void pkgMeta;
    return context.vulnerabilities.map((vulnerability) => {
        const reference = vulnerability.references?.find(({ type }) => type === 'ADVISORY')?.url;
        return {
            check: 'osvVulns',
            severity: severityFor(vulnerability),
            summary: `${vulnerability.id}: ${vulnerability.summary ?? 'Known vulnerability'}`,
            detail: [
                vulnerability.details,
                vulnerability.aliases?.length ? `Aliases: ${vulnerability.aliases.join(', ')}` : undefined,
            ].filter((part): part is string => Boolean(part)).join('\n') || 'OSV reported this exact npm package version.',
            ...(reference ? { reference } : {}),
        };
    });
}
