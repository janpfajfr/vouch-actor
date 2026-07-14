import { describe, expect, it } from 'vitest';

import { checkOsv } from '../src/checks/osv.js';

describe('checkOsv', () => {
    it.each([
        ['9.8', 'critical'],
        ['7.5', 'high'],
        ['5.0', 'medium'],
        ['2.1', 'low'],
    ] as const)('maps numeric CVSS %s to %s', (score, severity) => {
        const [finding] = checkOsv({}, { vulnerabilities: [{
            id: 'OSV-1',
            summary: 'Fixture vulnerability',
            severity: [{ type: 'CVSS_V3', score }],
            references: [{ type: 'ADVISORY', url: 'https://osv.dev/vulnerability/OSV-1' }],
        }] });
        expect(finding).toMatchObject({ check: 'osvVulns', severity, reference: 'https://osv.dev/vulnerability/OSV-1' });
    });

    it('maps a real CVSS v3 vector to its risk severity', () => {
        const [finding] = checkOsv({}, { vulnerabilities: [{
            id: 'OSV-VECTOR',
            severity: [{ type: 'CVSS_V3', score: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H' }],
        }] });
        expect(finding).toMatchObject({ severity: 'critical' });
    });

    it('keeps unavailable severity informational', () => {
        expect(checkOsv({}, { vulnerabilities: [{ id: 'OSV-2', aliases: ['CVE-2026-1'] }] })[0]).toMatchObject({
            severity: 'info',
            summary: expect.stringContaining('OSV-2'),
            detail: expect.stringContaining('CVE-2026-1'),
        });
    });
});
