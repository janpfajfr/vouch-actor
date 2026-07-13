import type { RegistryVersion } from '../registry.js';
import type { Finding } from '../types.js';

const lifecycleNames = ['preinstall', 'install', 'postinstall'] as const;

const suspiciousPatterns: Array<{ pattern: RegExp; label: string }> = [
    { pattern: /\bcurl\b/i, label: 'uses curl to fetch remote content' },
    { pattern: /\bwget\b/i, label: 'uses wget to fetch remote content' },
    { pattern: /https?:\/\//i, label: 'references a remote URL' },
    { pattern: /\bnode\s+-e\b/i, label: 'executes inline Node.js code' },
    { pattern: /\beval\s*\(/i, label: 'evaluates dynamic code' },
    { pattern: /\bbase64\b/i, label: 'processes base64-encoded content' },
];

export function checkInstallScripts(pkgMeta: RegistryVersion, context: Record<string, never>): Finding[] {
    void context;
    return lifecycleNames.flatMap((lifecycle): Finding[] => {
        const script = pkgMeta.scripts?.[lifecycle];
        if (!script) return [];
        const suspicious = suspiciousPatterns.find(({ pattern }) => pattern.test(script));
        return [{
            check: 'installScripts',
            severity: suspicious ? 'high' : 'medium',
            summary: suspicious
                ? `${lifecycle} ${suspicious.label}`
                : `${lifecycle} lifecycle script runs during installation`,
            detail: `${lifecycle}: ${script}`,
        }];
    });
}
