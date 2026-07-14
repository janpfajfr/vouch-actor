import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { ACTOR_NAME } from '../src/types.js';

describe('actor scaffold', () => {
    it('exports the technical Actor name', () => {
        expect(ACTOR_NAME).toBe('npm-supply-chain-scanner');
    });

    it('loads the OSV check through the Node ESM loader', () => {
        const result = spawnSync(process.execPath, [
            '--import',
            'tsx',
            '--input-type=module',
            '--eval',
            "await import('./src/checks/osv.ts')",
        ], {
            cwd: fileURLToPath(new URL('..', import.meta.url)),
            encoding: 'utf8',
        });
        expect(result.status, result.stderr).toBe(0);
    });
});
