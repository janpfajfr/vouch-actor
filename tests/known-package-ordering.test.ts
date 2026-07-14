import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import type { RegistryClient, RegistryVersion } from '../src/registry.js';
import { scanTargets } from '../src/scanner.js';
import type { ResolvedTarget, ScannedItem } from '../src/types.js';

type FixtureVersion = RegistryVersion & { name: string; version: string };

const fixtures = JSON.parse(
    await readFile(new URL('./fixtures/known-packages.json', import.meta.url), 'utf8'),
) as Record<string, FixtureVersion>;

const targets: ResolvedTarget[] = Object.values(fixtures).map(({ name, version }) => ({
    name,
    version,
    sources: ['explicit'],
    resolvedFrom: 'exact',
}));

const registry: RegistryClient = {
    getPackument: async (name) => {
        const fixture = fixtures[name];
        if (!fixture) throw new Error(`Missing fixture for ${name}`);
        return {
            name,
            versions: { [fixture.version]: fixture },
            time: { [fixture.version]: '2025-01-01T00:00:00.000Z' },
            maintainers: [],
        };
    },
    getWeeklyDownloads: async () => 0,
    getAttestations: async () => ({ attested: false }),
};

describe('known package install-script behavior', () => {
    it('orders binary installer, harmless lifecycle script, and no lifecycle script by score', async () => {
        const items = await scanTargets(targets, {
            registry,
            checks: ['installScripts'],
            now: () => new Date('2026-07-14T00:00:00.000Z'),
        });
        expect(items.every((item) => item.status === 'scanned')).toBe(true);
        const scannedItems = items.filter((item): item is ScannedItem => item.status === 'scanned');
        const byName = Object.fromEntries(scannedItems.map((item) => [item.package, item]));
        const esbuild = byName.esbuild;
        const coreJs = byName['core-js'];
        const husky = byName.husky;

        expect(esbuild?.findings).toContainEqual(expect.objectContaining({ check: 'installScripts', severity: 'high' }));
        expect(coreJs?.findings).toContainEqual(expect.objectContaining({ check: 'installScripts', severity: 'medium' }));
        expect(husky?.findings.filter(({ check }) => check === 'installScripts')).toEqual([]);
        expect(esbuild?.riskScore).toBeGreaterThan(coreJs?.riskScore ?? Number.POSITIVE_INFINITY);
        expect(coreJs?.riskScore).toBeGreaterThan(husky?.riskScore ?? Number.POSITIVE_INFINITY);
    });
});
