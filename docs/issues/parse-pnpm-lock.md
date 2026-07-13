# Parse pnpm-lock.yaml for exact versions and transitive scan

Priority: next

## Problem

v1 detects `pnpm-lock.yaml` but does not parse it. Direct dependencies therefore resolve from `package.json` ranges against the current npm registry, and `includeTransitive` is unavailable.

## Scope

- Add one maintained YAML parsing dependency and document why it is acceptable in this security-sensitive project.
- Add a pnpm lockfile parser in the `resolve.ts` orbit, preferably as a focused module rather than package-manager branches throughout the resolver.
- Support current pnpm lockfile versions used by maintained pnpm releases.
- Resolve direct dependencies to exact locked versions.
- Include exact transitive package versions when `includeTransitive` is true.
- Preserve source tracking, `resolvedFrom: "lockfile"`, exact `name@version` deduplication, deterministic capping, and clear parse errors.
- Add fixtures for scoped packages, aliases, peer variants, workspaces, and multiple locked versions of the same package.
- Keep unsupported non-registry workspace edges out of public npm lookups.

## Out of scope

- Yarn lockfile parsing.
- Reimplementing YAML parsing by hand.
- Executing pnpm or installing the target repository.

## Acceptance criteria

- pnpm lockfile mode answers which exact public npm versions are installed.
- `includeTransitive` produces exact transitive targets up to `maxPackages`.
- Malformed or unsupported lockfiles produce an explicit status note or error rather than silently switching modes.
