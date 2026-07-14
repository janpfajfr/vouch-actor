import { describe, expect, it } from 'vitest';

import { githubManifestUrls, resolveInput } from '../src/resolve.js';
import { HttpError, type Packument, type RegistryClient } from '../src/registry.js';
import type { ScannerInput } from '../src/types.js';

const allChecks = ['installScripts', 'provenance', 'maintainerSignals', 'osvVulns'] as const;
const input = (overrides: Partial<ScannerInput>): ScannerInput => ({
    includeTransitive: false,
    maxPackages: 100,
    checks: [...allChecks],
    ...overrides,
});

const packument = (name: string, versions: string[]): Packument => ({
    name,
    versions: Object.fromEntries(versions.map((version) => [version, { name, version }])),
    'dist-tags': { latest: versions.at(-1) ?? '' },
});

function dependencies(files: Record<string, unknown>, packages: Record<string, string[]>) {
    const registry = {
        getPackument: async (name: string) => packument(name, packages[name] ?? []),
    } as RegistryClient;
    return {
        registry,
        fetchRemote: async (url: string) => url in files
            ? new Response(JSON.stringify(files[url]), { status: 200 })
            : new Response('', { status: 404 }),
    };
}

describe('githubManifestUrls', () => {
    it('uses HEAD for a repository root', () => {
        expect(githubManifestUrls(new URL('https://github.com/acme/app'))?.packageJson).toBe(
            'https://raw.githubusercontent.com/acme/app/HEAD/package.json',
        );
    });

    it('preserves an explicit blob branch and directory', () => {
        expect(githubManifestUrls(new URL('https://github.com/acme/app/blob/main/packages/web/package.json'))?.packageLock).toBe(
            'https://raw.githubusercontent.com/acme/app/main/packages/web/package-lock.json',
        );
    });
});

describe('resolveInput lockfile policy', () => {
    const base = 'https://raw.githubusercontent.com/acme/app/HEAD/';

    it('uses exact direct and transitive versions from package-lock.json', async () => {
        const files = {
            [`${base}package.json`]: { dependencies: { lodash: '^4.17.0' } },
            [`${base}package-lock.json`]: { packages: {
                '': {},
                'node_modules/lodash': { version: '4.17.20' },
                'node_modules/left-pad': { version: '1.3.0' },
            } },
        };
        const result = await resolveInput(input({ packageJsonUrl: 'https://github.com/acme/app', includeTransitive: true }), dependencies(files, {
            lodash: ['4.17.20', '4.17.21'], 'left-pad': ['1.3.0'],
        }));
        expect(result.lockfile).toEqual({ detected: 'package-lock.json', parsed: true });
        expect(result.targets).toEqual([
            { name: 'left-pad', version: '1.3.0', sources: ['transitive'], resolvedFrom: 'lockfile' },
            { name: 'lodash', version: '4.17.20', sources: ['manifest'], resolvedFrom: 'lockfile' },
        ]);
    });

    it('keeps nested alternate versions of a direct dependency', async () => {
        const files = {
            [`${base}package.json`]: { dependencies: { shared: '^2.0.0' } },
            [`${base}package-lock.json`]: { packages: {
                '': {},
                'node_modules/shared': { version: '2.0.0' },
                'node_modules/consumer/node_modules/shared': { version: '1.0.0' },
            } },
        };
        const result = await resolveInput(input({ packageJsonUrl: 'https://github.com/acme/app', includeTransitive: true }), dependencies(files, {}));
        expect(result.targets).toEqual([
            { name: 'shared', version: '1.0.0', sources: ['transitive'], resolvedFrom: 'lockfile' },
            { name: 'shared', version: '2.0.0', sources: ['manifest'], resolvedFrom: 'lockfile' },
        ]);
    });

    it('discloses package-lock formats without a packages map', async () => {
        const files = {
            [`${base}package.json`]: { dependencies: { lodash: '^4.17.0' } },
            [`${base}package-lock.json`]: { lockfileVersion: 1, dependencies: { lodash: { version: '4.17.20' } } },
        };
        const result = await resolveInput(input({ packageJsonUrl: 'https://github.com/acme/app', includeTransitive: true }), dependencies(files, {
            lodash: ['4.17.20', '4.17.21'],
        }));
        expect(result.lockfile).toEqual({ detected: 'package-lock.json', parsed: false });
        expect(result.targets[0]).toMatchObject({ version: '4.17.21', resolvedFrom: 'range' });
        expect(result.statusNotes).toContain('package-lock.json detected but its format is not parsed in v1; direct deps resolved as latest-matching, transitive scan unavailable');
    });

    it('reports direct dependencies missing exact root lockfile entries', async () => {
        const files = {
            [`${base}package.json`]: { dependencies: { lodash: '^4.17.0' } },
            [`${base}package-lock.json`]: { packages: {
                '': {},
                'node_modules/.pnpm/lodash@4.17.20/node_modules/lodash': { version: '4.17.20' },
            } },
        };
        const result = await resolveInput(input({ packageJsonUrl: 'https://github.com/acme/app' }), dependencies(files, {
            lodash: ['4.17.20', '4.17.21'],
        }));
        expect(result.targets[0]).toMatchObject({ version: '4.17.21', resolvedFrom: 'range' });
        expect(result.statusNotes).toContain('package-lock.json lacked exact root entries for 1 direct dependency; resolved as latest-matching');
    });

    it('detects pnpm and uses range mode without transitives', async () => {
        const files = {
            [`${base}package.json`]: { dependencies: { lodash: '^4.17.0' } },
            [`${base}pnpm-lock.yaml`]: 'lockfileVersion: 9',
        };
        const result = await resolveInput(input({ packageJsonUrl: 'https://github.com/acme/app', includeTransitive: true }), dependencies(files, {
            lodash: ['4.17.20', '4.17.21'],
        }));
        expect(result.lockfile).toEqual({ detected: 'pnpm-lock.yaml', parsed: false });
        expect(result.targets[0]).toMatchObject({ version: '4.17.21', resolvedFrom: 'range' });
        expect(result.statusNotes).toContain('pnpm-lock.yaml detected but not parsed in v1; direct deps resolved as latest-matching, transitive scan unavailable');
    });

    it('uses range mode and reports unavailable transitives without a lockfile', async () => {
        const files = { [`${base}package.json`]: { devDependencies: { lodash: '^4.17.0' } } };
        const result = await resolveInput(input({ packageJsonUrl: 'https://github.com/acme/app', includeTransitive: true }), dependencies(files, {
            lodash: ['4.17.21'],
        }));
        expect(result.lockfile).toEqual({ detected: 'none', parsed: false });
        expect(result.targets[0]).toMatchObject({ resolvedFrom: 'range' });
        expect(result.statusNotes).toContain('No lockfile detected; direct deps resolved as latest-matching, transitive scan unavailable');
    });

    it('labels non-registry manifest dependency specs as unsupported', async () => {
        const files = { [`${base}package.json`]: { dependencies: { local: 'workspace:*' } } };
        const result = await resolveInput(input({ packageJsonUrl: 'https://github.com/acme/app' }), dependencies(files, {}));
        expect(result.errors).toContainEqual(expect.objectContaining({
            package: 'local',
            requested: 'workspace:*',
            sources: ['manifest'],
            code: 'UNSUPPORTED_SPEC',
        }));
    });

    it('resolves before deduplicating and caps exact targets deterministically', async () => {
        const result = await resolveInput(input({ packages: ['lodash@4.17.20', 'lodash@4.17.21', 'lodash@4.17.20'], maxPackages: 1 }), dependencies({}, {
            lodash: ['4.17.20', '4.17.21'],
        }));
        expect(result.targets).toEqual([{ name: 'lodash', version: '4.17.20', sources: ['explicit'], resolvedFrom: 'exact' }]);
        expect(result.stats).toMatchObject({ deduplicated: 2, selected: 1, capped: 1 });
    });

    it('retains an explicit registry 404 as an error target', async () => {
        const registry = {
            ...dependencies({}, {}).registry,
            getPackument: async () => { throw new HttpError(404, 'https://registry.npmjs.org/lodahs'); },
        };
        const result = await resolveInput(input({ packages: ['lodahs'] }), { registry, fetchRemote: dependencies({}, {}).fetchRemote });
        expect(result.errors).toEqual([expect.objectContaining({
            package: 'lodahs', sources: ['explicit'], code: 'PACKAGE_NOT_FOUND',
        })]);
    });

    it('retains a manifest registry 404 as a non-explicit error target', async () => {
        const files = { [`${base}package.json`]: { dependencies: { private: '^1.0.0' } } };
        const registry = {
            ...dependencies(files, {}).registry,
            getPackument: async () => { throw new HttpError(404, 'https://registry.npmjs.org/private'); },
        };
        const result = await resolveInput(input({ packageJsonUrl: 'https://github.com/acme/app' }), {
            registry, fetchRemote: dependencies(files, {}).fetchRemote,
        });
        expect(result.errors).toEqual([expect.objectContaining({
            package: 'private', sources: ['manifest'], code: 'PACKAGE_NOT_FOUND',
        })]);
    });
});
