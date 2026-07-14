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

export interface ResolutionStats {
    discovered: number;
    resolved: number;
    deduplicated: number;
    selected: number;
    capped: number;
    unresolved: number;
}

export type RiskLevel = 'low' | 'medium' | 'high';

export interface ScannedItem {
    status: 'scanned';
    package: string;
    version: string;
    sources: PackageSource[];
    sourcesText: string;
    resolvedFrom: ResolvedFrom;
    riskScore: number;
    riskLevel: RiskLevel;
    findings: Finding[];
    findingCount: number;
    provenance: { attested: boolean };
    meta: {
        publishedAt?: string;
        maintainers: number;
        weeklyDownloads?: number;
        deprecated: boolean;
    };
    scannedAt: string;
}

export interface ErrorItem {
    status: 'error';
    package: string;
    version?: string;
    sources: PackageSource[];
    sourcesText: string;
    resolvedFrom?: ResolvedFrom;
    errorCode: string;
    error: { code: string; message: string };
    scannedAt: string;
}

export type DatasetItem = ScannedItem | ErrorItem;
