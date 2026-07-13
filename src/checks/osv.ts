import type { OsvVulnerability } from '../osv-client.js';
import type { RegistryVersion } from '../registry.js';
import type { Finding, Severity } from '../types.js';

interface OsvContext {
    vulnerabilities: OsvVulnerability[];
}

function severityFor(vulnerability: OsvVulnerability): Severity {
    const numeric = vulnerability.severity
        ?.map(({ score }) => Number(score))
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
