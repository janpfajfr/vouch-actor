import { describe, expect, it } from 'vitest';

import { checkProvenance } from '../src/checks/provenance.js';

describe('checkProvenance', () => {
    it('reports missing attestation as a low-signal finding', () => {
        expect(checkProvenance({}, { attested: false })).toEqual([
            expect.objectContaining({
                check: 'provenance',
                severity: 'low',
                detail: expect.stringContaining('common'),
            }),
        ]);
    });

    it('returns no negative finding for an attested version', () => {
        expect(checkProvenance({}, { attested: true })).toEqual([]);
    });
});
