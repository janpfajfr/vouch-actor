import type { RegistryVersion } from '../registry.js';
import type { Finding } from '../types.js';

interface ProvenanceContext {
    attested: boolean;
}

export function checkProvenance(pkgMeta: RegistryVersion, context: ProvenanceContext): Finding[] {
    void pkgMeta;
    if (context.attested) return [];
    return [{
        check: 'provenance',
        severity: 'low',
        summary: 'No npm provenance attestation found',
        detail: 'Missing provenance is common for npm packages and is a low-signal finding on its own.',
    }];
}
