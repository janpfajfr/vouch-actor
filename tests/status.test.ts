import { describe, expect, it } from 'vitest';

import { buildStatusMessage } from '../src/status.js';
import type { DatasetItem, PackageSource, RiskLevel } from '../src/types.js';

const base = {
    sources: ['explicit'] as PackageSource[],
    sourcesText: 'explicit',
    resolvedFrom: 'exact' as const,
    scannedAt: '2026-07-14T00:00:00.000Z',
};

function scanned(packageName: string, riskLevel: RiskLevel): DatasetItem {
    return {
        ...base,
        status: 'scanned',
        package: packageName,
        version: '1.0.0',
        riskScore: riskLevel === 'high' ? 50 : riskLevel === 'medium' ? 20 : 0,
        riskLevel,
        findings: [],
        findingCount: 0,
        provenance: { attested: false },
        meta: { maintainers: 1, deprecated: false },
    };
}

const errorItem: DatasetItem = {
    ...base,
    status: 'error',
    package: 'missing',
    errorCode: 'PACKAGE_NOT_FOUND',
    error: { code: 'PACKAGE_NOT_FOUND', message: 'not found' },
};

describe('buildStatusMessage', () => {
    it('uses singular package grammar', () => {
        expect(buildStatusMessage([scanned('safe', 'low')], 0, 1, 0, []))
            .toBe('Scanned 1 package: 1 low');
    });

    it('includes every present risk and unresolved category while omitting zeros', () => {
        const items = [
            scanned('high-a', 'high'),
            scanned('high-b', 'high'),
            scanned('medium', 'medium'),
            scanned('low', 'low'),
        ];
        expect(buildStatusMessage(items, 0, 6, 2, []))
            .toBe('Scanned 4 of 6 packages: 2 high, 1 medium, 1 low, 2 unresolved');
    });

    it('includes errors and resolution notes', () => {
        expect(buildStatusMessage([scanned('safe', 'low'), errorItem], 0, 2, 0, ['Registry note']))
            .toBe('Scanned 1 of 2 packages: 1 low, 1 error. Registry note');
    });

    it('partitions an explicit not-found alongside medium and low scanned packages', () => {
        expect(buildStatusMessage([
            scanned('esbuild', 'medium'),
            scanned('typescript', 'low'),
            errorItem,
        ], 0, 3, 0, []))
            .toBe('Scanned 2 of 3 packages: 1 medium, 1 low, 1 error');
    });

    it('reports deterministic truncation when the cap is hit', () => {
        expect(buildStatusMessage([scanned('safe', 'low')], 2, 3, 0, []))
            .toBe('Scanned 1 of 3 packages, capped by maxPackages: 1 low');
    });
});
