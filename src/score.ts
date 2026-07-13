import type { DatasetItem, Finding, RiskLevel, Severity } from './types.js';

export const SCORING = {
    critical: 50,
    high: 35,
    medium: 15,
    low: 5,
    info: 0,
    attestation: -10,
} as const satisfies Record<Severity | 'attestation', number>;

export function calculateRiskScore(findings: Finding[], attested: boolean): number {
    const findingsScore = findings.reduce((sum, finding) => sum + SCORING[finding.severity], 0);
    return Math.max(0, Math.min(100, findingsScore + (attested ? SCORING.attestation : 0)));
}

export function riskLevelFor(score: number): RiskLevel {
    if (score >= 50) return 'high';
    if (score >= 20) return 'medium';
    return 'low';
}

export function sortDatasetItems(items: DatasetItem[]): DatasetItem[] {
    return [...items].sort((left, right) => {
        if (left.status !== right.status) return left.status === 'scanned' ? -1 : 1;
        if (left.status === 'scanned' && right.status === 'scanned' && left.riskScore !== right.riskScore) {
            return right.riskScore - left.riskScore;
        }
        return `${left.package}@${left.version ?? ''}`.localeCompare(`${right.package}@${right.version ?? ''}`);
    });
}
