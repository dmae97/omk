#!/usr/bin/env bash
set -euo pipefail
npm run version:check
node scripts/proof-check.mjs proof/verified-runs/012-release-truthfulness/proof-bundle.json --json
node scripts/release-gate.mjs
