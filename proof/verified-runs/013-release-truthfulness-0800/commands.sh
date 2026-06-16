#!/usr/bin/env bash
set -euo pipefail
npm run version:check
node scripts/proof-check.mjs proof/verified-runs/013-release-truthfulness-0800/proof-bundle.json --json
