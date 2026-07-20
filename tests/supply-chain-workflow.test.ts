import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const workflowPath = fileURLToPath(new URL('../.github/workflows/supply-chain.yml', import.meta.url));
const scriptPath = fileURLToPath(new URL('../.github/scripts/supply-chain-gate.sh', import.meta.url));

describe('self-hosted supply chain workflow', () => {
    const workflow = readFileSync(workflowPath, 'utf8');
    const script = readFileSync(scriptPath, 'utf8');

    it('runs the tracked gate script against the pull request head manifest', () => {
        expect(workflow).toContain('pull_request:');
        expect(workflow).toContain('actions/checkout@v4');
        expect(workflow).toContain('github.event.pull_request.head.repo.full_name');
        expect(workflow).toContain('github.event.pull_request.head.sha');
        expect(workflow).not.toContain('${{ github.sha }}');
        expect(workflow).toContain('.github/scripts/supply-chain-gate.sh');
        expect(workflow).not.toContain('api_call()');
    });

    it('sends the complete scan configuration', () => {
        expect(script).toContain('failThreshold: 70');
        expect(script).toContain('installScripts');
        expect(script).toContain('provenance');
        expect(script).toContain('maintainerSignals');
        expect(script).toContain('osvVulns');
    });

    it('neutral-skips pull requests without the token', () => {
        expect(script).toContain("skipped: fork PRs don't receive secrets");
        expect(script).toContain('[[ -z "${APIFY_TOKEN:-}" ]]');
    });

    it('waits for every terminal status with a bounded loop', () => {
        expect(script).toContain('janpfajfr~npm-supply-chain-scanner/runs?waitForFinish=60');
        expect(script).toContain('actor-runs/${run_id}?waitForFinish=60');
        expect(script).toContain('SUCCEEDED|FAILED|ABORTED|TIMED-OUT');
        expect(script).toContain('polls >= 20');
    });

    it('distinguishes API failures and prints Actor diagnostics', () => {
        expect(script).toContain('Apify API call failed');
        expect(script).toContain('Actor status:');
        expect(script).toContain('Status message:');
        expect(script).toContain('https://console.apify.com/actors/runs/${run_id}');
        expect(script).toContain('"$status" != "SUCCEEDED"');
    });
});
