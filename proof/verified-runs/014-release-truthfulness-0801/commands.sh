#!/usr/bin/env bash
set -euo pipefail
npm run version:check
node scripts/proof-check.mjs proof/verified-runs/014-release-truthfulness-0801/proof-bundle.json --json
