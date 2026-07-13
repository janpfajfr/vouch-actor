import { describe, expect, it, vi } from 'vitest';

import { createRegistryClient, fetchWithRetry, HttpError } from '../src/registry.js';

const jsonResponse = (value: unknown, status = 200): Response => new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
});

describe('fetchWithRetry', () => {
    it('retries 429 and 5xx up to two times', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(new Response('', { status: 429 }))
            .mockResolvedValueOnce(new Response('', { status: 503 }))
            .mockResolvedValueOnce(jsonResponse({ ok: true }));
        const response = await fetchWithRetry('https://example.test', {}, {
            fetch: fetchMock,
            sleep: async () => undefined,
            random: () => 0,
        });
        expect(response.status).toBe(200);
        expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('does not retry 404', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 404 }));
        await expect(fetchWithRetry('https://example.test', {}, {
            fetch: fetchMock,
            sleep: async () => undefined,
            random: () => 0,
        })).rejects.toBeInstanceOf(HttpError);
        expect(fetchMock).toHaveBeenCalledOnce();
    });

    it('retries network errors', async () => {
        const fetchMock = vi.fn()
            .mockRejectedValueOnce(new TypeError('network down'))
            .mockResolvedValueOnce(jsonResponse({ ok: true }));
        await fetchWithRetry('https://example.test', {}, {
            fetch: fetchMock,
            sleep: async () => undefined,
            random: () => 0,
        });
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });
});

describe('registry client', () => {
    it('encodes scoped package names', async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ name: '@scope/pkg', versions: {} }));
        const client = createRegistryClient({ fetch: fetchMock, sleep: async () => undefined });
        await client.getPackument('@scope/pkg');
        expect(fetchMock.mock.calls[0]?.[0]).toBe('https://registry.npmjs.org/%40scope%2Fpkg');
    });

    it('returns undefined and warns when downloads are unavailable', async () => {
        const warn = vi.fn();
        const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 503 }));
        const client = createRegistryClient({ fetch: fetchMock, sleep: async () => undefined, warn });
        await expect(client.getWeeklyDownloads('left-pad')).resolves.toBeUndefined();
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('downloads'));
    });

    it('treats a missing attestation endpoint as unattested', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 404 }));
        const client = createRegistryClient({ fetch: fetchMock, sleep: async () => undefined });
        await expect(client.getAttestations('left-pad', '1.3.0')).resolves.toEqual({ attested: false });
    });

    it('requires an actual attestation entry in a successful response', async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ attestations: [] }));
        const client = createRegistryClient({ fetch: fetchMock, sleep: async () => undefined });
        await expect(client.getAttestations('left-pad', '1.3.0')).resolves.toMatchObject({ attested: false });
    });
});
