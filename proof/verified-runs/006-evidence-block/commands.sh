#!/usr/bin/env bash
set -euo pipefail
mkdir -p .omk/runs/proof-006-evidence-block-20260531t080818z
cp proof/verified-runs/006-evidence-block/state.json .omk/runs/proof-006-evidence-block-20260531t080818z/state.json
node dist/cli.js verify --run proof-006-evidence-block-20260531t080818z --json > proof/verified-runs/006-evidence-block/omk-verify.json 2> proof/verified-runs/006-evidence-block/omk-verify.stderr || true
