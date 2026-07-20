#!/usr/bin/env bash

set -euo pipefail

if [[ -z "${APIFY_TOKEN:-}" ]]; then
  if [[ "${PR_HEAD_REPOSITORY:-}" != "${BASE_REPOSITORY:-}" ]]; then
    echo "skipped: fork PRs don't receive secrets"
    exit 0
  fi

  echo "configuration error: APIFY_TOKEN is unavailable for a same-repository PR" >&2
  exit 1
fi

: "${PACKAGE_JSON_URL:?PACKAGE_JSON_URL is required}"

response_file=$(mktemp)
trap 'rm -f "$response_file"' EXIT

api_call() {
  local method=$1
  local url=$2
  shift 2
  curl --silent --show-error \
    --request "$method" \
    --header "Authorization: Bearer $APIFY_TOKEN" \
    --header "Content-Type: application/json" \
    --output "$response_file" \
    --write-out '%{http_code}' \
    "$@" \
    "$url"
}

require_success_response() {
  local http_status=$1
  if [[ ! "$http_status" =~ ^2[0-9][0-9]$ ]]; then
    local api_message
    api_message=$(jq -r '.error.message // .error // "unknown error"' "$response_file" 2>/dev/null || true)
    echo "Apify API call failed (HTTP $http_status): ${api_message:-unparseable response}" >&2
    return 1
  fi
}

load_run() {
  if ! run_id=$(jq -er '.data.id' "$response_file") \
    || ! status=$(jq -er '.data.status' "$response_file") \
    || ! status_message=$(jq -r '.data.statusMessage // "No status message"' "$response_file"); then
    echo "Apify API returned a malformed run response" >&2
    return 1
  fi
}

print_run() {
  echo "Actor status: ${status:-unknown}"
  echo "Status message: ${status_message:-Unavailable}"
  echo "Run: https://console.apify.com/actors/runs/${run_id}"
}

input=$(jq -nc --arg package_json_url "$PACKAGE_JSON_URL" '{
  packageJsonUrl: $package_json_url,
  failThreshold: 70,
  checks: ["installScripts", "provenance", "maintainerSignals", "osvVulns"]
}')

start_url='https://api.apify.com/v2/actors/janpfajfr~npm-supply-chain-scanner/runs?waitForFinish=60'
if ! http_status=$(api_call POST "$start_url" --data "$input"); then
  echo "Apify API request failed before receiving an HTTP response" >&2
  exit 1
fi
require_success_response "$http_status" || exit 1
load_run || exit 1

terminal_statuses='^(SUCCEEDED|FAILED|ABORTED|TIMED-OUT)$'
polls=0
while [[ ! "$status" =~ $terminal_statuses ]]; do
  if (( polls >= 20 )); then
    echo "Apify run did not reach a terminal status after 20 follow-up polls" >&2
    print_run
    exit 1
  fi
  polls=$((polls + 1))

  run_url="https://api.apify.com/v2/actor-runs/${run_id}?waitForFinish=60"
  if ! http_status=$(api_call GET "$run_url"); then
    echo "Apify API polling failed before receiving an HTTP response" >&2
    print_run
    exit 1
  fi
  if ! require_success_response "$http_status"; then
    print_run
    exit 1
  fi
  if ! load_run; then
    print_run
    exit 1
  fi
done

print_run
if [[ "$status" != "SUCCEEDED" ]]; then
  exit 1
fi
