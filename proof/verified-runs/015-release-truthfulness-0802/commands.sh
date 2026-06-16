#!/usr/bin/env bash
set -euo pipefail
npm run version:check
node scripts/proof-check.mjs proof/verified-runs/015-release-truthfulness-0802/proof-bundle.json --json
