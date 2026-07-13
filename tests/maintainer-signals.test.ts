import { describe, expect, it } from 'vitest';

import { checkMaintainerSignals } from '../src/checks/maintainer-signals.js';
import type { Packument, RegistryVersion } from '../src/registry.js';

const now = new Date('2026-07-13T00:00:00.000Z');

function run(version: RegistryVersion, packument: Packument) {
    return checkMaintainerSignals(version, { packument, version: version.version ?? '1.0.0', now });
}

describe('checkMaintainerSignals', () => {
    it('reports a package younger than 30 days as medium', () => {
        const version = { version: '1.0.0' };
        expect(run(version, { name: 'new-package', versions: { '1.0.0': version }, time: { created: '2026-07-01T00:00:00.000Z', '1.0.0': '2026-07-01T00:00:00.000Z' } }))
            .toContainEqual(expect.objectContaining({ severity: 'medium', summary: expect.stringContaining('30 days') }));
    });

    it('reports a new maintainer releasing after an 18 month gap as high', () => {
        const oldVersion = { version: '1.0.0', maintainers: [{ name: 'alice' }] };
        const newVersion = { version: '2.0.0', maintainers: [{ name: 'mallory' }] };
        const packument = {
            name: 'dormant',
            versions: { '1.0.0': oldVersion, '2.0.0': newVersion },
            time: { '1.0.0': '2023-01-01T00:00:00.000Z', '2.0.0': '2026-01-01T00:00:00.000Z' },
        };
        expect(run(newVersion, packument)).toContainEqual(expect.objectContaining({ severity: 'high', summary: expect.stringContaining('maintainer') }));
    });

    it('reports deprecation as informational', () => {
        const version = { version: '1.0.0', deprecated: 'Use another package' };
        expect(run(version, { name: 'old', versions: { '1.0.0': version }, time: { '1.0.0': '2020-01-01T00:00:00.000Z' } }))
            .toContainEqual(expect.objectContaining({ severity: 'info', detail: expect.stringContaining('Use another package') }));
    });

    it('does not invent maintainer changes when version history lacks maintainers', () => {
        const oldVersion = { version: '1.0.0' };
        const newVersion = { version: '2.0.0', maintainers: [{ name: 'alice' }] };
        const findings = run(newVersion, {
            name: 'incomplete', versions: { '1.0.0': oldVersion, '2.0.0': newVersion },
            time: { '1.0.0': '2023-01-01T00:00:00.000Z', '2.0.0': '2026-01-01T00:00:00.000Z' },
        });
        expect(findings.some(({ summary }) => summary.includes('maintainer'))).toBe(false);
    });
});
