import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

async function readJson(path: string): Promise<Record<string, unknown>> {
    return JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), 'utf8')) as Record<string, unknown>;
}

describe('Actor schemas', () => {
    it('links the input and default dataset schemas from actor.json', async () => {
        const actor = await readJson('.actor/actor.json');
        expect(actor.defaultMemoryMbytes).toBe(512);
        expect(actor.input).toBe('./input_schema.json');
        expect(actor.output).toBe('./output_schema.json');
        expect(actor.storages).toEqual({ dataset: './dataset_schema.json' });
    });

    it('exposes the default dataset overview to API and MCP consumers', async () => {
        const output = await readJson('.actor/output_schema.json');
        expect(output).toMatchObject({
            actorOutputSchemaVersion: 1,
            title: 'npm Supply Chain Risk Scanner output',
            properties: {
                results: {
                    type: 'string',
                    title: 'Scan results',
                    template: '{{links.apiDefaultDatasetUrl}}/items?view=overview',
                },
            },
        });
    });

    it('defines every public input with safe bounds and defaults', async () => {
        const schema = await readJson('.actor/input_schema.json');
        const properties = schema.properties as Record<string, Record<string, unknown>>;
        expect(properties.packages).toMatchObject({ type: 'array', editor: 'stringList' });
        expect(properties.packageJsonUrl).toMatchObject({ type: 'string', editor: 'textfield' });
        expect(properties.includeTransitive).toMatchObject({ type: 'boolean', default: false });
        expect(properties.maxPackages).toMatchObject({ type: 'integer', default: 100, minimum: 1, maximum: 500 });
        expect(properties.checks).toMatchObject({
            type: 'array',
            editor: 'select',
            default: ['installScripts', 'provenance', 'maintainerSignals', 'osvVulns'],
        });
        expect(properties.failThreshold).toMatchObject({ type: 'integer', minimum: 0, maximum: 100 });
    });

    it('defines a concise dataset overview view', async () => {
        const schema = await readJson('.actor/dataset_schema.json');
        const fields = schema.fields as Record<string, unknown>;
        const properties = fields.properties as Record<string, Record<string, unknown>>;
        const views = schema.views as Record<string, Record<string, unknown>>;
        expect(fields.$schema).toBe('http://json-schema.org/draft-07/schema#');
        expect(properties.sourcesText).toEqual({ type: 'string' });
        expect(properties.errorCode).toEqual({ type: 'string' });
        expect(properties.resolvedFrom?.enum).toEqual(['exact', 'tag', 'range', 'lockfile']);
        expect(properties.findings).toMatchObject({
            type: 'array',
            items: {
                type: 'object',
                required: ['check', 'severity', 'summary', 'detail'],
            },
        });
        expect(properties.provenance).toMatchObject({ type: 'object', required: ['attested'] });
        expect(properties.meta).toMatchObject({ type: 'object', required: ['maintainers', 'deprecated'] });
        expect(views.overview).toMatchObject({
            transformation: { fields: ['package', 'version', 'status', 'riskScore', 'riskLevel', 'findingCount', 'errorCode', 'sourcesText', 'resolvedFrom'] },
            display: {
                component: 'table',
                properties: {
                    errorCode: { label: 'Error code', format: 'text' },
                    sourcesText: { label: 'Sources', format: 'text' },
                },
            },
        });
    });
});
