# npm Supply Chain Risk Scanner

## What it does

This Actor scans npm packages for supply chain risk beyond known CVEs, including install-time scripts, npm provenance, and maintainer changes. It accepts package specs, a public `package.json` or GitHub repository URL, or both, then writes one auditable dataset row per package version. Recent npm worm campaigns used compromised maintainer accounts and malicious postinstall payloads, behavior that `npm audit` cannot report before an advisory exists.

## Quick start

1. Open **npm Supply Chain Risk Scanner** in Apify Console.
2. Add a package spec such as `tiktok-signature@1.9.1` under **Packages**.
3. Select the checks and click **Start**.
4. Review the dataset ordered by risk score, with the highest-risk packages first.

This checks a package before installation and requires no local setup.

<!-- Screenshot placeholder: Apify Console input form and Overview dataset table. -->

## Example output

```json
{
  "status": "scanned",
  "package": "left-pad",
  "version": "1.3.0",
  "sources": ["explicit"],
  "sourcesText": "explicit",
  "resolvedFrom": "exact",
  "riskScore": 5,
  "riskLevel": "low",
  "findings": [
    {
      "check": "provenance",
      "severity": "low",
      "summary": "No npm provenance attestation found",
      "detail": "Missing provenance is common for npm packages and is a low-signal finding on its own."
    },
    {
      "check": "maintainerSignals",
      "severity": "info",
      "summary": "Package version is deprecated",
      "detail": "use String.prototype.padStart()"
    }
  ],
  "findingCount": 2,
  "provenance": { "attested": false },
  "meta": {
    "publishedAt": "2018-04-09T01:10:45.796Z",
    "maintainers": 3,
    "weeklyDownloads": 743795,
    "deprecated": true
  },
  "scannedAt": "2026-07-13T16:14:02.633Z"
}
```

The score is the sum of documented finding weights, capped at 100. This real `left-pad@1.3.0` run has one low-severity missing-provenance finding and one informational deprecation finding, so its score is 5. Download counts and scan timestamps vary by run.

`resolvedFrom` explains how the exact scanned version was selected. `exact` means the input named that version directly, `tag` means a bare package name or npm dist-tag selected it, `range` means it was the newest version satisfying a semver range, and `lockfile` means the version came from a parsed `package-lock.json` entry.

## Use it from CI

Store an Apify API token as the `APIFY_TOKEN` GitHub Actions secret, then add this step. The pinned CLI starts the Actor, waits for it to finish, and returns a nonzero exit code when the run fails.

```yaml
- name: Scan npm supply chain risk
  env:
    APIFY_TOKEN: ${{ secrets.APIFY_TOKEN }}
  run: >-
    npx --yes apify-cli@1.7.1 actors call jan-pfajfr/npm-supply-chain-scanner
    --input '{"packageJsonUrl":"https://github.com/OWNER/REPO/blob/main/package.json","failThreshold":70}'
```

The Actor resolves the manifest and supported lockfile, scans the selected dependencies, and finishes as `FAILED` if a scanned package meets `failThreshold`. Runs that breach `failThreshold` finish as `FAILED` by design; the run status message distinguishes threshold breaches from actual errors. An explicit `packages` entry that does not exist also fails the run as typo and typosquat protection. A manifest dependency that returns 404 remains visible as an error row because it may be a private package.

This repository gates its own pull requests with the deployed Actor using the proposed branch's SHA-pinned `package.json`.

With `package-lock.json`, rows use exact installed versions and answer "is what I have installed safe?" Without a parsed lockfile, direct dependency ranges resolve to the newest currently matching public version and answer "is what I would install now safe?" The `resolvedFrom` field records the mode for each row.

See the current [Apify CLI command reference](https://docs.apify.com/cli/docs/next/reference) for authentication and invocation options.

## Scheduled monitoring

1. Run the Actor once with the repository's `packageJsonUrl`, then save the configuration as an Actor task.
2. In Apify Console, open **Schedules**, create a schedule, and add the task.
3. Set the timezone and a weekly cron expression, for example Monday at 08:00.
4. On the task's **Integrations** tab, add completion notifications for both `ACTOR.RUN.SUCCEEDED` and `ACTOR.RUN.FAILED`. Send the webhook to a Slack workflow URL, or route it through an Apify integration Actor that posts to Slack.
5. Test both the schedule and webhook with a completed run before enabling them.

Dependencies can change or gain new advisories between deployments. A weekly lockfile scan checks the versions currently installed. A weekly range scan checks the newest matching versions before the next install adopts them, which can surface a newly hijacked release earlier. See [Apify Schedules](https://docs.apify.com/actors/running/schedules) and [webhook events](https://docs.apify.com/integrations/webhooks/events).

## Use it from an AI agent through MCP

Connect the [Apify MCP server](https://docs.apify.com/integrations/ai) to the agent and make the Actor available as a tool. The agent can call the scanner before it runs a package-manager command, inspect the dataset preview, and ask for confirmation when behavioral findings are present. Example prompt: `Check tiktok-signature before installing it. Use jan-pfajfr/npm-supply-chain-scanner, summarize the findings, and do not install it without my approval.`

## What the checks actually do

### Install scripts

The check reads `preinstall`, `install`, and `postinstall` from the exact version's registry metadata. Any lifecycle script is medium severity. Script text containing network fetch, binary download, inline evaluation, base64, or HTTP patterns is high severity, and the full script text is retained in the finding. Pattern matching can identify code that deserves review, but it does not execute or prove that the script is malicious.

### Provenance

When selected, the check looks for exact-version npm attestations in version metadata and the public npm attestation endpoint. A present attestation subtracts 10 points. Missing provenance is common and produces only a low-severity finding because absence alone is weak evidence. This Actor detects presence; it is not a substitute for cryptographic verification with the current npm CLI.

### Maintainer signals

The check uses public registry maintainers and publication timestamps. It reports packages younger than 30 days, maintainer changes visible across recent version metadata, and a release after more than 18 months of inactivity when it coincides with a maintainer change. Deprecation is informational. npm metadata is incomplete for some historical versions, so the absence of a finding is not proof that maintainers never changed.

### OSV vulnerabilities

The Actor queries OSV in batches for exact npm name and version pairs and maps numeric, named, CVSS v3, and CVSS v4 severity data into findings. CVSS v4 calculation uses the pinned, zero-dependency `ae-cvss-calculator` package and is covered by a published FIRST example vector. This provides known-vulnerability context, but it is not the Actor's differentiator and does not replace package-manager audit tooling or a full software composition analysis product.

## Scoring

| Signal | Points |
| --- | ---: |
| Critical finding | 50 |
| High finding | 35 |
| Medium finding | 15 |
| Low finding | 5 |
| Informational finding | 0 |
| Provenance attestation present | -10 |

Scores are clamped to 0 through 100. Risk levels are low for 0 through 19, medium for 20 through 49, and high for 50 or above. The score is a review heuristic, not a verdict that a package is safe or malicious.

## Relationship to vouch

This Actor is the hosted analysis companion to the open-source [vouch CLI](https://github.com/janpfajfr/vouch). `vouch` keeps dependency decisions recorded, explained, and reviewable in a repository; this Actor supplies remote behavioral scan results for Console checks, CI, schedules, and agents. Local-first teams should use the CLI for the committed decision ledger and use this Actor when a cloud run or structured dataset is useful.

## Limitations

- Only public npm registry packages are scanned. Private manifest dependencies produce error rows and are not sent to a private registry.
- Manifest URLs must use HTTPS and resolve only to public network addresses. Redirect destinations are checked under the same policy.
- `package-lock.json` files with a `packages` map are parsed for exact versions and optional transitives. Older or unsupported structures are disclosed and use range mode. A direct dependency without a conventional exact root entry also falls back to range mode and is disclosed in the status message. `pnpm-lock.yaml` and `yarn.lock` are detected but not parsed in v1, so direct dependencies use range mode and transitive scanning is unavailable.
- With no supported lockfile, ranges resolve to the newest version matching the current registry state. That may differ from a version installed previously.
- `includeTransitive` is capped by `maxPackages`. The status message reports truncation instead of silently dropping it.
- Git, file, link, workspace, URL, and npm-alias dependency specs are retained as `UNSUPPORTED_SPEC` error rows.
- Registry, downloads, attestation, and OSV data can be incomplete or temporarily unavailable. Required metadata failures remain visible as error rows.
- This is static metadata analysis, not a malware sandbox. It does not download tarballs, execute package code, inspect bundled files, or prove intent.
