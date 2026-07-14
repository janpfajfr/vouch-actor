import { describe, expect, it, vi } from 'vitest';

import { queryOsvBatch } from '../src/osv-client.js';
import type { ResolvedTarget } from '../src/types.js';

const targets: ResolvedTarget[] = Array.from({ length: 205 }, (_, index) => ({
    name: `pkg-${index}`,
    version: '1.0.0',
    sources: ['explicit'],
    resolvedFrom: 'exact',
}));

describe('queryOsvBatch', () => {
    it('chunks queries at 100 and aligns results with exact targets', async () => {
        const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
            const body = JSON.parse(String(init?.body)) as { queries: unknown[] };
            return new Response(JSON.stringify({ results: body.queries.map(() => ({ vulns: [] })) }), { status: 200 });
        });
        const result = await queryOsvBatch(targets, { fetch: fetchMock, sleep: async () => undefined });
        expect(fetchMock).toHaveBeenCalledTimes(3);
        expect(fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)).queries.length)).toEqual([100, 100, 5]);
        expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)).queries[0]).toEqual({
            package: { ecosystem: 'npm', name: 'pkg-0' },
            version: '1.0.0',
        });
        expect(result.get('pkg-204@1.0.0')).toEqual([]);
    });
});
