export const ACTOR_NAME = 'npm-supply-chain-scanner' as const;

export const CHECK_NAMES = [
    'installScripts',
    'provenance',
    'maintainerSignals',
    'osvVulns',
] as const;

export type CheckName = (typeof CHECK_NAMES)[number];
export type PackageSource = 'explicit' | 'manifest' | 'transitive';
export type ResolvedFrom = 'exact' | 'tag' | 'range' | 'lockfile';
export type Severity = 'info' | 'low' | 'medium' | 'high' | 'critical';
export type LockfileKind = 'package-lock.json' | 'pnpm-lock.yaml' | 'yarn.lock' | 'none';

export interface ScannerInput {
    packages?: string[];
    packageJsonUrl?: string;
    includeTransitive: boolean;
    maxPackages: number;
    checks: CheckName[];
    failThreshold?: number;
}

export interface Finding {
    check: CheckName;
    severity: Severity;
    summary: string;
    detail: string;
    reference?: string;
}

export interface ResolvedTarget {
    name: string;
    version: string;
    sources: PackageSource[];
    resolvedFrom: ResolvedFrom;
}
