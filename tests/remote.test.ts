import { describe, expect, it, vi } from 'vitest';

import { fetchPublicUrl, lookupForAddress, requestOptionsFor } from '../src/remote.js';

const noSleep = async () => undefined;

describe('fetchPublicUrl', () => {
    it('returns an address array when Node requests all lookup results', async () => {
        const lookup = lookupForAddress({ address: '93.184.216.34', family: 4 });
        await new Promise<void>((resolve, reject) => {
            lookup('public.example', { all: true }, (error, addresses) => {
                if (error) reject(error);
                expect(addresses).toEqual([{ address: '93.184.216.34', family: 4 }]);
                resolve();
            });
        });
    });

    it('keeps the original hostname for TLS while overriding address lookup', () => {
        const options = requestOptionsFor(
            new URL('https://public.example/package.json'),
            { address: '93.184.216.34', family: 4 },
            {},
        );
        expect(options.servername).toBe('public.example');
        expect(options.lookup).toBeTypeOf('function');
    });

    it('pins the request to the public address returned by validation', async () => {
        const request = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
        await fetchPublicUrl('https://public.example/package.json', {
            request,
            lookup: async () => [{ address: '93.184.216.34', family: 4 }],
            sleep: noSleep,
        });
        expect(request).toHaveBeenCalledWith(
            new URL('https://public.example/package.json'),
            { address: '93.184.216.34', family: 4 },
            expect.objectContaining({ redirect: 'manual' }),
        );
    });

    it('validates and pins each redirect destination separately', async () => {
        const request = vi.fn()
            .mockResolvedValueOnce(new Response('', {
                status: 302,
                headers: { location: 'https://redirected.example/package.json' },
            }))
            .mockResolvedValueOnce(new Response('{}', { status: 200 }));
        await fetchPublicUrl('https://public.example/package.json', {
            request,
            lookup: async (hostname) => [{
                address: hostname === 'public.example' ? '93.184.216.34' : '93.184.216.35',
                family: 4,
            }],
            sleep: noSleep,
        });
        expect(request.mock.calls.map((call) => call[1])).toEqual([
            { address: '93.184.216.34', family: 4 },
            { address: '93.184.216.35', family: 4 },
        ]);
    });

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
