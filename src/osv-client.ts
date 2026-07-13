import { fetchWithRetry, type FetchLike } from './registry.js';
import type { ResolvedTarget } from './types.js';

export interface OsvVulnerability {
    id: string;
    summary?: string;
    details?: string;
    aliases?: string[];
    severity?: Array<{ type: string; score: string }>;
    references?: Array<{ type: string; url: string }>;
    database_specific?: { severity?: string };
}

interface OsvDependencies {
    fetch?: FetchLike;
    sleep?: (milliseconds: number) => Promise<void>;
    random?: () => number;
}

interface OsvResponse {
    results?: Array<{ vulns?: OsvVulnerability[] }>;
}

const keyFor = ({ name, version }: ResolvedTarget): string => `${name}@${version}`;

export async function queryOsvBatch(
    targets: ResolvedTarget[],
    dependencies: OsvDependencies = {},
): Promise<Map<string, OsvVulnerability[]>> {
    const output = new Map<string, OsvVulnerability[]>();
    targets.forEach((target) => output.set(keyFor(target), []));

    for (let offset = 0; offset < targets.length; offset += 100) {
        const chunk = targets.slice(offset, offset + 100);
        const response = await fetchWithRetry('https://api.osv.dev/v1/querybatch', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ queries: chunk.map(({ name, version }) => ({
                package: { ecosystem: 'npm', name },
                version,
            })) }),
        }, {
            ...(dependencies.fetch ? { fetch: dependencies.fetch } : {}),
            ...(dependencies.sleep ? { sleep: dependencies.sleep } : {}),
            ...(dependencies.random ? { random: dependencies.random } : {}),
        });
        const payload = await response.json() as OsvResponse;
        if (!Array.isArray(payload.results) || payload.results.length !== chunk.length) {
            throw new Error('OSV querybatch returned an invalid result count');
        }
        chunk.forEach((target, index) => output.set(keyFor(target), payload.results?.[index]?.vulns ?? []));
    }
    return output;
}
