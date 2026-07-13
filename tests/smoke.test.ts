import { describe, expect, it } from 'vitest';

import { ACTOR_NAME } from '../src/types.js';

describe('actor scaffold', () => {
    it('exports the technical Actor name', () => {
        expect(ACTOR_NAME).toBe('npm-supply-chain-scanner');
    });
});
