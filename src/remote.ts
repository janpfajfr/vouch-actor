import { lookup as dnsLookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import type { RequestOptions } from 'node:https';
import { BlockList, isIP } from 'node:net';
import type { LookupFunction } from 'node:net';
import { Readable } from 'node:stream';

import { fetchWithRetry, type RetryDependencies } from './registry.js';

type Address = { address: string; family: 4 | 6 };
type Lookup = (hostname: string) => Promise<Address[]>;
type PinnedRequest = (url: URL, address: Address, init: RequestInit) => Promise<Response>;

interface PublicFetchDependencies extends RetryDependencies {
    lookup?: Lookup;
    maxRedirects?: number;
    request?: PinnedRequest;
}

const blocked = new BlockList();
[
    ['0.0.0.0', 8],
    ['10.0.0.0', 8],
    ['100.64.0.0', 10],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16],
    ['172.16.0.0', 12],
    ['192.0.0.0', 24],
    ['192.0.2.0', 24],
    ['192.168.0.0', 16],
    ['198.18.0.0', 15],
    ['198.51.100.0', 24],
    ['203.0.113.0', 24],
    ['224.0.0.0', 4],
    ['240.0.0.0', 4],
].forEach(([network, prefix]) => blocked.addSubnet(network as string, prefix as number, 'ipv4'));
[
    ['::', 128],
    ['::1', 128],
    ['2001:db8::', 32],
    ['fc00::', 7],
    ['fe80::', 10],
    ['ff00::', 8],
].forEach(([network, prefix]) => blocked.addSubnet(network as string, prefix as number, 'ipv6'));

const defaultLookup: Lookup = async (hostname) => {
    const addresses = await dnsLookup(hostname, { all: true, verbatim: true });
    return addresses.flatMap(({ address, family }) => family === 4 || family === 6 ? [{ address, family }] : []);
};
const isRedirect = (status: number): boolean => [301, 302, 303, 307, 308].includes(status);

export function lookupForAddress(address: Address): LookupFunction {
    return (_hostname, options, callback) => {
        if (options.all) callback(null, [address]);
        else callback(null, address.address, address.family);
    };
}

export function requestOptionsFor(url: URL, address: Address, init: RequestInit): RequestOptions {
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    const headers = new Headers(init.headers);
    if (!headers.has('accept-encoding')) headers.set('accept-encoding', 'identity');
    return {
        method: init.method ?? 'GET',
        headers: Object.fromEntries(headers.entries()),
        signal: init.signal ?? undefined,
        ...(isIP(hostname) === 0 ? { servername: hostname } : {}),
        lookup: lookupForAddress(address),
    };
}

const defaultPinnedRequest: PinnedRequest = async (url, address, init) => new Promise((resolve, reject) => {
    const request = httpsRequest(url, requestOptionsFor(url, address, init), (incoming) => {
        const status = incoming.statusCode ?? 500;
        const responseHeaders = new Headers();
        for (let index = 0; index < incoming.rawHeaders.length; index += 2) {
            const name = incoming.rawHeaders[index];
            const value = incoming.rawHeaders[index + 1];
            if (name && value) responseHeaders.append(name, value);
        }
        const hasBody = status !== 204 && status !== 205 && status !== 304;
        resolve(new Response(hasBody ? Readable.toWeb(incoming) as ReadableStream<Uint8Array> : null, {
            status,
            ...(incoming.statusMessage ? { statusText: incoming.statusMessage } : {}),
            headers: responseHeaders,
        }));
    });
    request.on('error', reject);
    request.end();
});

async function publicAddresses(url: URL, lookup: Lookup): Promise<Address[]> {
    if (url.protocol !== 'https:' || url.username || url.password) {
        throw new Error(`Remote manifest URL must be public HTTPS: ${url.toString()}`);
    }
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    const addresses = await lookup(hostname);
    if (addresses.length === 0 || addresses.some(({ address, family }) => blocked.check(address, family === 4 ? 'ipv4' : 'ipv6'))) {
        throw new Error(`Remote manifest URL must resolve only to public addresses: ${url.toString()}`);
    }
    return addresses;
}

export async function fetchPublicUrl(input: string, dependencies: PublicFetchDependencies = {}): Promise<Response> {
    const lookup = dependencies.lookup ?? defaultLookup;
    const request = dependencies.request ?? defaultPinnedRequest;
    const maxRedirects = dependencies.maxRedirects ?? 5;
    let current = new URL(input);

    for (let redirect = 0; redirect <= maxRedirects; redirect += 1) {
        const addresses = await publicAddresses(current, lookup);
        let nextAddress = 0;
        const pinnedFetch: RetryDependencies['fetch'] = async (url, init = {}) => {
            const address = addresses[nextAddress % addresses.length];
            nextAddress += 1;
            if (!address) throw new Error(`No validated address available for ${current.toString()}`);
            return request(new URL(url instanceof Request ? url.url : url), address, init);
        };
        const retry: RetryDependencies = {
            fetch: dependencies.fetch ?? pinnedFetch,
            ...(dependencies.sleep ? { sleep: dependencies.sleep } : {}),
            ...(dependencies.random ? { random: dependencies.random } : {}),
            ...(dependencies.timeoutMs ? { timeoutMs: dependencies.timeoutMs } : {}),
            acceptStatus: isRedirect,
        };
        const response = await fetchWithRetry(current.toString(), { redirect: 'manual' }, retry);
        if (!isRedirect(response.status)) return response;
        const location = response.headers.get('location');
        if (!location) throw new Error(`Redirect response omitted Location: ${current.toString()}`);
        if (redirect === maxRedirects) throw new Error(`Too many redirects from ${input}`);
        current = new URL(location, current);
    }
    throw new Error(`Too many redirects from ${input}`);
}
