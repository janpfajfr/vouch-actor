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

## Scenario 2: self-hosted pull-request gate

The `.github/workflows/supply-chain.yml` workflow scans the proposed `package.json` from the pull request head repository and head SHA. It must not scan `github.sha`, which identifies GitHub's ephemeral merge commit for `pull_request` events.

Verification status: verified on 2026-07-20 with same-repository pull request #3.

### Positive path

- [GitHub Actions run 29734723111](https://github.com/janpfajfr/vouch-actor/actions/runs/29734723111) completed successfully after a real Actor scan.
- [Actor run rJ3aW0rsnDIMlyGG1](https://console.apify.com/actors/runs/rJ3aW0rsnDIMlyGG1) finished as `SUCCEEDED`.
- Observed status message: `Scanned 10 of 12 packages: 10 low, 2 errors`.

Fork pull requests do not receive `APIFY_TOKEN`. The token guard must print `skipped: fork PRs don't receive secrets`, skip the Actor call, and leave the job successful instead of producing an authentication failure.

A same-repository pull request without `APIFY_TOKEN` is a configuration error and must fail with `configuration error: APIFY_TOKEN is unavailable for a same-repository PR`. Automated tests cover both missing-token paths.

### Negative path

- [GitHub Actions run 29734805993](https://github.com/janpfajfr/vouch-actor/actions/runs/29734805993) produced the expected red supply-chain check with a temporary `failThreshold` of 1.
- [Actor run eTCDTdu0Rrhg8FMIS](https://console.apify.com/actors/runs/eTCDTdu0Rrhg8FMIS) finished as `FAILED`.
- Observed status message: `Risk threshold 1 breached by @eslint/js@9.29.0 (5). Scanned 10 of 12 packages: 10 low, 2 errors`.

The threshold variant is deterministic and avoids fake manifest or lockfile churn. The production workflow was restored to `failThreshold: 70` after this test.
