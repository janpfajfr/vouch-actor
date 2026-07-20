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

Positive-path status: pending verification on the workflow's first same-repository pull request. Mark this scenario verified only after the check is green and its log contains the Actor status message and Console run URL.

Fork pull requests do not receive `APIFY_TOKEN`. The token guard must print `skipped: fork PRs don't receive secrets`, skip the Actor call, and leave the job successful instead of producing an authentication failure.

### Negative test after merge

1. Create a same-repository branch and temporarily change `failThreshold` in `.github/workflows/supply-chain.yml` from `70` to `1`.
2. Open a pull request and wait for the supply chain gate.
3. Confirm the check is red.
4. Confirm the log prints a status message that names the threshold breach and a clickable `https://console.apify.com/actors/runs/<run-id>` URL. Record both in the QA screenshot or notes.
5. Restore `failThreshold` to `70` and confirm the check returns to green before merging or closing the test pull request.

The threshold variant is preferred to adding a deliberately risky dependency because it is deterministic and does not create fake manifest or lockfile churn. Do not mark the negative path verified until both the red result and its self-explanatory output have been observed.
