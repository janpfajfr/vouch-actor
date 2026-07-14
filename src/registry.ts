export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

type Sleep = (milliseconds: number) => Promise<void>;

export interface RetryDependencies {
    fetch?: FetchLike;
    sleep?: Sleep;
    random?: () => number;
    timeoutMs?: number;
    acceptStatus?: (status: number) => boolean;
}

export class HttpError extends Error {
    public constructor(public readonly status: number, url: string) {
        super(`HTTP ${status} from ${url}`);
        this.name = 'HttpError';
    }
}

const defaultSleep: Sleep = async (milliseconds) => new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
});

function retryableStatus(status: number): boolean {
    return status === 429 || status >= 500;
}

export async function fetchWithRetry(
    url: string,
    init: RequestInit = {},
    dependencies: RetryDependencies = {},
): Promise<Response> {
    const fetcher = dependencies.fetch ?? fetch;
    const sleep = dependencies.sleep ?? defaultSleep;
    const random = dependencies.random ?? Math.random;
    const timeoutMs = dependencies.timeoutMs ?? 10_000;

    for (let attempt = 0; attempt < 3; attempt += 1) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        let lastError: unknown;
        try {
            const response = await fetcher(url, { ...init, signal: controller.signal });
            if (response.ok || dependencies.acceptStatus?.(response.status)) return response;
            lastError = new HttpError(response.status, url);
        } catch (error) {
            lastError = error;
        } finally {
            clearTimeout(timeout);
        }
        if (lastError instanceof HttpError && !retryableStatus(lastError.status)) throw lastError;
        if (attempt === 2) throw lastError;
        const backoff = 200 * (2 ** attempt) + Math.floor(random() * 100);
        await sleep(backoff);
    }
    throw new Error('Retry loop exhausted');
}

export interface RegistryVersion {
    name?: string;
    version?: string;
    scripts?: Record<string, string>;
    maintainers?: Array<{ name?: string; email?: string }>;
    deprecated?: string;
    dist?: { attestations?: unknown; signatures?: unknown[] };
}

export interface Packument {
    name: string;
    versions: Record<string, RegistryVersion>;
    'dist-tags'?: Record<string, string>;
    time?: Record<string, string>;
    maintainers?: Array<{ name?: string; email?: string }>;
}

export interface AttestationResult {
    attested: boolean;
    payload?: unknown;
}

interface RegistryDependencies extends RetryDependencies {
    now?: () => Date;
    warn?: (message: string) => void;
}

async function jsonObject(response: Response, label: string): Promise<Record<string, unknown>> {
    const value: unknown = await response.json();
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error(`${label} returned invalid JSON`);
    }
    return value as Record<string, unknown>;
}

export function createRegistryClient(dependencies: RegistryDependencies = {}) {
    const retryDependencies: RetryDependencies = {
        ...(dependencies.fetch ? { fetch: dependencies.fetch } : {}),
        ...(dependencies.sleep ? { sleep: dependencies.sleep } : {}),
        ...(dependencies.random ? { random: dependencies.random } : {}),
        ...(dependencies.timeoutMs ? { timeoutMs: dependencies.timeoutMs } : {}),
    };
    const warn = dependencies.warn ?? (() => undefined);
    const now = dependencies.now ?? (() => new Date());

    return {
        async getPackument(name: string): Promise<Packument> {
            const url = `https://registry.npmjs.org/${encodeURIComponent(name)}`;
            const data = await jsonObject(await fetchWithRetry(url, {}, retryDependencies), 'npm registry');
            if (typeof data.name !== 'string' || typeof data.versions !== 'object' || data.versions === null) {
                throw new Error('npm registry returned an invalid packument');
            }
            return data as unknown as Packument;
        },

        async getWeeklyDownloads(name: string): Promise<number | undefined> {
            const end = now();
            const start = new Date(end);
            start.setUTCDate(start.getUTCDate() - 6);
            const period = `${start.toISOString().slice(0, 10)}:${end.toISOString().slice(0, 10)}`;
            const url = `https://api.npmjs.org/downloads/point/${period}/${encodeURIComponent(name)}`;
            try {
                const data = await jsonObject(await fetchWithRetry(url, {}, retryDependencies), 'npm downloads API');
                return typeof data.downloads === 'number' ? data.downloads : undefined;
            } catch (error) {
                warn(`Unable to fetch weekly downloads for ${name}: ${error instanceof Error ? error.message : 'unknown error'}`);
                return undefined;
            }
        },

        async getAttestations(name: string, version: string): Promise<AttestationResult> {
            const spec = encodeURIComponent(`${name}@${version}`);
            const url = `https://registry.npmjs.org/-/npm/v1/attestations/${spec}`;
            try {
                const payload = await jsonObject(await fetchWithRetry(url, {}, retryDependencies), 'npm attestations API');
                const attestations = payload.attestations;
                return { attested: Array.isArray(attestations) && attestations.length > 0, payload };
            } catch (error) {
                if (error instanceof HttpError && error.status === 404) return { attested: false };
                throw error;
            }
        },
    };
}

export type RegistryClient = ReturnType<typeof createRegistryClient>;
