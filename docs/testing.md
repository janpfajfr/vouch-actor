# Console QA

Run the local checks before deployment:

```sh
apify validate-schema
npm run lint
npm run typecheck
npm test
npm run build
```

## Resource defaults

`.actor/actor.json` sets `defaultMemoryMbytes` to 512. The Actor definition format does not provide a timeout field, so set the default timeout to 300 seconds in the Actor's Apify Console default run options.

After `apify push`, start a run without overriding Memory or Timeout. Open the run details and confirm:

- Memory: 512 MB
- Timeout: 300 seconds

## Dataset contract

Run `left-pad@1.3.0`, open the default dataset, and switch from Overview to All fields. A scanned row must contain:

- `status`, `package`, `version`, `sources`, `sourcesText`, and `resolvedFrom`
- `riskScore`, `riskLevel`, `findingCount`, and `findings`
- `provenance`, `meta`, and `scannedAt`
- Each finding contains `check`, `severity`, `summary`, and `detail`
- `meta` always contains `maintainers` and `deprecated`; `publishedAt` and `weeklyDownloads` are present when the upstream APIs provide them

The Overview Sources column uses `sourcesText`, while `sources` remains the canonical array in All fields and API results.

## Known package behavior

Use exact package versions so the checks match the committed fixtures:

| Input | Expected install-script result |
| --- | --- |
| `esbuild@0.25.6` | High finding for a platform-specific binary installer |
| `core-js@3.44.0` | Medium lifecycle-script finding |
| `husky@9.1.7` | No install-script finding |

The expected score ordering with only `installScripts` selected is esbuild above core-js above Husky.

## Package-not-found behavior

An explicit input such as `lodahs-xyz-123` must push an error row with `PACKAGE_NOT_FOUND` and finish the run as FAILED. This protects CI from green results caused by package-name typos.

A dependency discovered through `packageJsonUrl` that returns 404 from the public registry must push the same error code but must not fail the run solely for that reason. It may be a private package. The status message still reports the unresolved and error counts.
