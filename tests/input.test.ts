import { describe, expect, it } from 'vitest';

import { parseInput } from '../src/input.js';

describe('parseInput', () => {
    it('requires at least one input source', () => {
        expect(() => parseInput({})).toThrow('Provide at least one package or packageJsonUrl');
    });

    it('accepts combined sources and applies defaults', () => {
        expect(parseInput({
            packages: [' left-pad '],
            packageJsonUrl: 'https://example.com/package.json',
        })).toEqual({
            packages: ['left-pad'],
            packageJsonUrl: 'https://example.com/package.json',
            includeTransitive: false,
            maxPackages: 100,
            checks: ['installScripts', 'provenance', 'maintainerSignals', 'osvVulns'],
        });
    });

    it.each([0, 501, 1.5])('rejects maxPackages %s', (maxPackages) => {
        expect(() => parseInput({ packages: ['left-pad'], maxPackages })).toThrow('maxPackages');
    });

    it.each([-1, 101, 1.5])('rejects failThreshold %s', (failThreshold) => {
        expect(() => parseInput({ packages: ['left-pad'], failThreshold })).toThrow('failThreshold');
    });

    it('rejects unknown checks', () => {
        expect(() => parseInput({ packages: ['left-pad'], checks: ['licenses'] })).toThrow('checks');
    });

    it('rejects non-http manifest URLs', () => {
        expect(() => parseInput({ packageJsonUrl: 'file:///tmp/package.json' })).toThrow('packageJsonUrl');
    });

    it('rejects unencrypted HTTP manifest URLs', () => {
        expect(() => parseInput({ packageJsonUrl: 'http://example.com/package.json' })).toThrow('HTTPS');
    });

    it('drops empty package entries but requires a usable source', () => {
        expect(() => parseInput({ packages: [' ', ''] })).toThrow('Provide at least one package or packageJsonUrl');
    });
});
