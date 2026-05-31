#!/usr/bin/env bash
set -euo pipefail
mkdir -p .omk/runs/proof-007-replay-inspect-20260531t080818z
cp -R proof/verified-runs/007-replay-inspect/run-fixture/. .omk/runs/proof-007-replay-inspect-20260531t080818z/
node dist/cli.js replay proof-007-replay-inspect-20260531t080818z --json --context --evidence --decisions > proof/verified-runs/007-replay-inspect/replay.json
node dist/cli.js inspect proof-007-replay-inspect-20260531t080818z --json --context --evidence --decisions > proof/verified-runs/007-replay-inspect/inspect.json
