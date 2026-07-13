import { describe, expect, it } from 'vitest';

import { calculateRiskScore, riskLevelFor, SCORING, sortDatasetItems } from '../src/score.js';
import type { DatasetItem, Finding, PackageSource, Severity } from '../src/types.js';

const findings = (...severities: Severity[]): Finding[] => severities.map((severity) => ({
    check: 'installScripts', severity, summary: severity, detail: severity,
}));

describe('risk scoring', () => {
    it('keeps all weights in one public configuration', () => {
        expect(SCORING).toEqual({ critical: 50, high: 35, medium: 15, low: 5, info: 0, attestation: -10 });
    });

    it('adds findings, subtracts attestation, and clamps to 0..100', () => {
        expect(calculateRiskScore(findings('high', 'medium', 'low'), false)).toBe(55);
        expect(calculateRiskScore(findings('low'), true)).toBe(0);
        expect(calculateRiskScore(findings('high', 'high', 'high', 'high'), false)).toBe(100);
    });

    it('uses documented risk boundaries', () => {
        expect([19, 20, 49, 50].map(riskLevelFor)).toEqual(['low', 'medium', 'medium', 'high']);
    });
});

describe('sortDatasetItems', () => {
    it('orders scanned rows worst first and errors last', () => {
        const base = { sources: ['explicit'] as PackageSource[], resolvedFrom: 'exact' as const, scannedAt: '2026-01-01T00:00:00.000Z' };
        const scanned = (name: string, riskScore: number): DatasetItem => ({
            ...base, status: 'scanned', package: name, version: '1.0.0', riskScore,
            riskLevel: riskLevelFor(riskScore), findings: [], findingCount: 0,
            provenance: { attested: false }, meta: { maintainers: 0, deprecated: false },
        });
        const error: DatasetItem = { ...base, status: 'error', package: 'broken', version: '1.0.0', error: { code: 'REGISTRY_ERROR', message: 'failed' } };
        expect(sortDatasetItems([scanned('alpha', 10), error, scanned('zeta', 80), scanned('beta', 80)]).map((item) => item.package))
            .toEqual(['beta', 'zeta', 'alpha', 'broken']);
    });
});
