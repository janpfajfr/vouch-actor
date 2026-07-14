import { describe, expect, it, vi } from 'vitest';

import { fetchPublicUrl } from '../src/remote.js';

const noSleep = async () => undefined;

describe('fetchPublicUrl', () => {
    it('rejects private destinations before sending a request', async () => {
        const fetch = vi.fn();
        await expect(fetchPublicUrl('https://internal.example/package.json', {
            fetch,
            lookup: async () => [{ address: '127.0.0.1', family: 4 }],
            sleep: noSleep,
        })).rejects.toThrow('public');
        expect(fetch).not.toHaveBeenCalled();
    });

    it('revalidates redirect destinations before following them', async () => {
        const fetch = vi.fn().mockResolvedValue(new Response('', {
            status: 302,
            headers: { location: 'https://private.example/package.json' },
        }));
        await expect(fetchPublicUrl('https://public.example/package.json', {
            fetch,
            lookup: async (hostname) => [{ address: hostname === 'public.example' ? '93.184.216.34' : '10.0.0.1', family: 4 }],
            sleep: noSleep,
        })).rejects.toThrow('public');
        expect(fetch).toHaveBeenCalledOnce();
    });

    it('fetches an HTTPS resource on a public address', async () => {
        const fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
        await expect(fetchPublicUrl('https://public.example/package.json', {
            fetch,
            lookup: async () => [{ address: '93.184.216.34', family: 4 }],
            sleep: noSleep,
        })).resolves.toMatchObject({ status: 200 });
    });
});
