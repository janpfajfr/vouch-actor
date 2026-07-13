# Parse yarn.lock classic v1 and Berry formats

Priority: later

## Problem

v1 detects `yarn.lock` but does not parse it. Yarn classic v1 and modern Yarn Berry lockfiles use incompatible structures and need separate fixture coverage and parsing decisions.

## Scope

- Define supported Yarn classic v1 and Berry lockfile versions explicitly.
- Evaluate whether one maintained parser can safely cover both formats or whether separate focused parsers are clearer.
- Resolve direct dependencies to exact locked public npm versions.
- Include exact transitive versions when `includeTransitive` is true.
- Preserve source tracking, `resolvedFrom: "lockfile"`, exact `name@version` deduplication, deterministic capping, and clear format errors.
- Add fixtures for scoped packages, aliases, resolutions, workspaces, virtual packages, peer variants, and multiple locked versions.
- Treat non-registry protocols and internal workspace edges explicitly rather than sending them to npm.

## Out of scope

- pnpm lockfile parsing.
- Running Yarn or installing the target repository.
- Assuming classic and Berry can share a parser without evidence from fixtures.

## Acceptance criteria

- Both supported format families are detected and tested independently.
- Exact direct and transitive public npm versions are emitted up to `maxPackages`.
- Unknown or malformed Yarn formats remain visible and never silently produce misleading exact-version rows.
