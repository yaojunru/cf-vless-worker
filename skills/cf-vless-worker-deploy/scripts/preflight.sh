#!/usr/bin/env bash
set -euo pipefail

repo_dir="${1:-.}"
cd "$repo_dir"

for required in package.json wrangler.toml src/worker.js; do
  if [[ ! -f "$required" ]]; then
    printf 'Missing required file: %s\n' "$required" >&2
    exit 1
  fi
done

for command in node npm; do
  if ! command -v "$command" >/dev/null 2>&1; then
    printf 'Required command is unavailable: %s\n' "$command" >&2
    exit 1
  fi
done

npm run check
npm test
printf 'Preflight passed for %s\n' "$(pwd)"
