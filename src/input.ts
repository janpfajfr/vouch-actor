import { CHECK_NAMES, type CheckName, type ScannerInput } from './types.js';

const checkNames = new Set<string>(CHECK_NAMES);

function recordFrom(value: unknown): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error('Actor input must be a JSON object');
    }
    return value as Record<string, unknown>;
}

function optionalInteger(value: unknown, field: string, minimum: number, maximum: number): number | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum || value > maximum) {
        throw new Error(`${field} must be an integer between ${minimum} and ${maximum}`);
    }
    return value;
}

export function parseInput(value: unknown): ScannerInput {
    const input = recordFrom(value);
    let packages: string[] | undefined;
    if (input.packages !== undefined) {
        if (!Array.isArray(input.packages) || input.packages.some((item) => typeof item !== 'string')) {
            throw new Error('packages must be an array of strings');
        }
        packages = input.packages.map((item) => (item as string).trim()).filter(Boolean);
        if (packages.length === 0) packages = undefined;
    }

    let packageJsonUrl: string | undefined;
    if (input.packageJsonUrl !== undefined) {
        if (typeof input.packageJsonUrl !== 'string') throw new Error('packageJsonUrl must be an HTTPS URL');
        try {
            const url = new URL(input.packageJsonUrl);
            if (url.protocol !== 'https:') throw new Error();
            packageJsonUrl = url.toString();
        } catch {
            throw new Error('packageJsonUrl must be an HTTPS URL');
        }
    }
    if (!packages && !packageJsonUrl) throw new Error('Provide at least one package or packageJsonUrl');

    if (input.includeTransitive !== undefined && typeof input.includeTransitive !== 'boolean') {
        throw new Error('includeTransitive must be a boolean');
    }
    const maxPackages = optionalInteger(input.maxPackages, 'maxPackages', 1, 500) ?? 100;
    const failThreshold = optionalInteger(input.failThreshold, 'failThreshold', 0, 100);

    let checks: CheckName[] = [...CHECK_NAMES];
    if (input.checks !== undefined) {
        if (!Array.isArray(input.checks) || input.checks.some((check) => typeof check !== 'string' || !checkNames.has(check))) {
            throw new Error(`checks must contain only: ${CHECK_NAMES.join(', ')}`);
        }
        checks = [...new Set(input.checks as CheckName[])];
    }

    return {
        ...(packages ? { packages } : {}),
        ...(packageJsonUrl ? { packageJsonUrl } : {}),
        includeTransitive: input.includeTransitive ?? false,
        maxPackages,
        checks,
        ...(failThreshold === undefined ? {} : { failThreshold }),
    };
}
