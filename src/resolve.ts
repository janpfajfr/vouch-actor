import { maxSatisfying, valid } from 'semver';

import { HttpError, type RegistryClient } from './registry.js';
import type {
    LockfileKind,
    PackageSource,
    ResolvedFrom,
    ResolvedTarget,
    ResolutionStats,
    ScannerInput,
} from './types.js';

type RemoteFetch = (url: string) => Promise<Response>;

interface ResolveDependencies {
    registry: RegistryClient;
    fetchRemote: RemoteFetch;
}

interface LockfileState {
    detected: LockfileKind;
    parsed: boolean;
}

export interface ResolutionResult {
    targets: ResolvedTarget[];
    errors: ResolutionError[];
    lockfile: LockfileState;
    statusNotes: string[];
    stats: ResolutionStats;
}

export interface ResolutionError {
    package: string;
    requested?: string;
    sources: PackageSource[];
    code: 'PACKAGE_NOT_FOUND' | 'VERSION_NOT_FOUND' | 'UNSUPPORTED_SPEC' | 'REGISTRY_ERROR';
    message: string;
}

function isUnsupportedRegistrySpec(spec: string): boolean {
    return /^(?:workspace:|file:|link:|npm:|git(?:\+[^:]+)?:|https?:|github:|gitlab:|bitbucket:)/i.test(spec);
}

interface Manifest {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
}

interface PackageLock {
    packages?: Record<string, { version?: string }>;
}

interface ManifestUrls {
    packageJson: string;
    packageLock: string;
    pnpmLock: string;
    yarnLock: string;
}

function urlsFromPackageJson(packageJson: string): ManifestUrls {
    const base = new URL('.', packageJson).toString();
    return {
        packageJson,
        packageLock: new URL('package-lock.json', base).toString(),
        pnpmLock: new URL('pnpm-lock.yaml', base).toString(),
        yarnLock: new URL('yarn.lock', base).toString(),
    };
}

export function githubManifestUrls(url: URL): ManifestUrls | undefined {
    if (url.hostname !== 'github.com') return undefined;
    const parts = url.pathname.split('/').filter(Boolean);
    const [owner, repo] = parts;
    if (!owner || !repo) return undefined;
    if (parts[2] === 'blob') {
        const branch = parts[3];
        const path = parts.slice(4).join('/');
        if (!branch || !path.endsWith('package.json')) return undefined;
        return urlsFromPackageJson(`https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`);
    }
    return urlsFromPackageJson(`https://raw.githubusercontent.com/${owner}/${repo}/HEAD/package.json`);
}

function manifestUrls(value: string): ManifestUrls {
    const url = new URL(value);
    return githubManifestUrls(url) ?? urlsFromPackageJson(url.toString());
}

async function optionalRemote(fetchRemote: RemoteFetch, url: string): Promise<Response | undefined> {
    const response = await fetchRemote(url);
    if (response.status === 404) return undefined;
    if (!response.ok) throw new HttpError(response.status, url);
    return response;
}

async function jsonFrom<T>(response: Response, label: string): Promise<T> {
    try {
        return await response.json() as T;
    } catch {
        throw new Error(`${label} returned invalid JSON`);
    }
}

function parseSpec(spec: string): { name: string; requested: string } {
    if (spec.startsWith('@')) {
        const separator = spec.indexOf('@', 1);
        return separator < 0
            ? { name: spec, requested: 'latest' }
            : { name: spec.slice(0, separator), requested: spec.slice(separator + 1) || 'latest' };
    }
    const separator = spec.lastIndexOf('@');
    return separator <= 0
        ? { name: spec, requested: 'latest' }
        : { name: spec.slice(0, separator), requested: spec.slice(separator + 1) || 'latest' };
}

async function resolveVersion(
    name: string,
    requested: string,
    registry: RegistryClient,
): Promise<{ version: string; resolvedFrom: Exclude<ResolvedFrom, 'lockfile'> }> {
    const packument = await registry.getPackument(name);
    if (valid(requested) && packument.versions[requested]) return { version: requested, resolvedFrom: 'exact' };
    const tagged = packument['dist-tags']?.[requested];
    if (tagged) return { version: tagged, resolvedFrom: 'tag' };
    const matched = maxSatisfying(Object.keys(packument.versions), requested);
    if (!matched) throw new Error(`VERSION_NOT_FOUND: ${name}@${requested}`);
    return { version: matched, resolvedFrom: 'range' };
}

function packageNameFromLockPath(path: string): string | undefined {
    const marker = 'node_modules/';
    const index = path.lastIndexOf(marker);
    return index < 0 ? undefined : path.slice(index + marker.length);
}

function mergeTargets(targets: ResolvedTarget[]): ResolvedTarget[] {
    const merged = new Map<string, ResolvedTarget>();
    for (const target of targets) {
        const key = `${target.name}@${target.version}`;
        const existing = merged.get(key);
        if (!existing) {
            merged.set(key, { ...target, sources: [...target.sources] });
        } else {
            existing.sources = [...new Set([...existing.sources, ...target.sources])];
        }
    }
    return [...merged.values()].sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`));
}

function toResolutionError(
    name: string,
    requested: string,
    source: PackageSource,
    error: unknown,
): ResolutionError {
    const code = error instanceof HttpError && error.status === 404
        ? 'PACKAGE_NOT_FOUND'
        : error instanceof Error && error.message.startsWith('VERSION_NOT_FOUND')
            ? 'VERSION_NOT_FOUND'
            : 'REGISTRY_ERROR';
    return {
        package: name,
        ...(requested ? { requested } : {}),
        sources: [source],
        code,
        message: error instanceof Error ? error.message : `Unable to resolve ${name}`,
    };
}

export async function resolveInput(input: ScannerInput, dependencies: ResolveDependencies): Promise<ResolutionResult> {
    const targets: ResolvedTarget[] = [];
    const statusNotes: string[] = [];
    const errors: ResolutionError[] = [];
    let lockfile: LockfileState = { detected: 'none', parsed: false };
    let discovered = 0;
    let unresolved = 0;

    for (const spec of input.packages ?? []) {
        discovered += 1;
        const { name, requested } = parseSpec(spec);
        try {
            const resolved = await resolveVersion(name, requested, dependencies.registry);
            targets.push({ name, ...resolved, sources: ['explicit'] });
        } catch (error) {
            unresolved += 1;
            errors.push(toResolutionError(name, requested, 'explicit', error));
        }
    }

    if (input.packageJsonUrl) {
        const urls = manifestUrls(input.packageJsonUrl);
        const manifestResponse = await optionalRemote(dependencies.fetchRemote, urls.packageJson);
        if (!manifestResponse) throw new Error(`package.json not found at ${urls.packageJson}`);
        const manifest = await jsonFrom<Manifest>(manifestResponse, 'package.json');
        const constraints = { ...manifest.dependencies, ...manifest.devDependencies };

        let packageLock: PackageLock | undefined;
        const npmResponse = await optionalRemote(dependencies.fetchRemote, urls.packageLock);
        if (npmResponse) {
            packageLock = await jsonFrom<PackageLock>(npmResponse, 'package-lock.json');
            lockfile = { detected: 'package-lock.json', parsed: true };
        } else if (await optionalRemote(dependencies.fetchRemote, urls.pnpmLock)) {
            lockfile = { detected: 'pnpm-lock.yaml', parsed: false };
        } else if (await optionalRemote(dependencies.fetchRemote, urls.yarnLock)) {
            lockfile = { detected: 'yarn.lock', parsed: false };
        }

        const lockEntries = packageLock?.packages ?? {};
        let lockfileRangeFallbacks = 0;
        for (const [name, constraint] of Object.entries(constraints)) {
            discovered += 1;
            const exact = lockEntries[`node_modules/${name}`]?.version;
            if (exact) {
                targets.push({ name, version: exact, sources: ['manifest'], resolvedFrom: 'lockfile' });
                continue;
            }
            if (isUnsupportedRegistrySpec(constraint)) {
                unresolved += 1;
                errors.push({
                    package: name,
                    requested: constraint,
                    sources: ['manifest'],
                    code: 'UNSUPPORTED_SPEC',
                    message: `Unsupported non-registry dependency spec: ${name}@${constraint}`,
                });
                continue;
            }
            try {
                const resolved = await resolveVersion(name, constraint, dependencies.registry);
                targets.push({ name, version: resolved.version, sources: ['manifest'], resolvedFrom: 'range' });
                if (packageLock) lockfileRangeFallbacks += 1;
            } catch (error) {
                unresolved += 1;
                errors.push(toResolutionError(name, constraint, 'manifest', error));
            }
        }
        if (lockfileRangeFallbacks > 0) {
            statusNotes.push(`package-lock.json lacked exact root entries for ${lockfileRangeFallbacks} direct ${lockfileRangeFallbacks === 1 ? 'dependency' : 'dependencies'}; resolved as latest-matching`);
        }

        if (input.includeTransitive && packageLock) {
            const direct = new Set(Object.keys(constraints));
            for (const [path, entry] of Object.entries(lockEntries)) {
                const name = packageNameFromLockPath(path);
                if (!name || !entry.version || direct.has(name)) continue;
                discovered += 1;
                targets.push({ name, version: entry.version, sources: ['transitive'], resolvedFrom: 'lockfile' });
            }
        } else if (input.includeTransitive) {
            statusNotes.push(lockfile.detected === 'none'
                ? 'No lockfile detected; direct deps resolved as latest-matching, transitive scan unavailable'
                : `${lockfile.detected} detected but not parsed in v1; direct deps resolved as latest-matching, transitive scan unavailable`);
        }
    }

    const deduplicated = mergeTargets(targets);
    const selected = deduplicated.slice(0, input.maxPackages);
    return {
        targets: selected,
        errors,
        lockfile,
        statusNotes,
        stats: {
            discovered,
            resolved: targets.length,
            deduplicated: deduplicated.length,
            selected: selected.length,
            capped: Math.max(0, deduplicated.length - selected.length),
            unresolved,
        },
    };
}
