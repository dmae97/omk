#!/usr/bin/env bash
set -euo pipefail
node dist/cli.js graph audit --input proof/verified-runs/008-graph-audit/graph-state.json --run-manifest proof/verified-runs/008-graph-audit/run-manifest.json --evidence proof/verified-runs/008-graph-audit/evidence.jsonl --decisions proof/verified-runs/008-graph-audit/decisions.jsonl --json > proof/verified-runs/008-graph-audit/graph-audit.json
node dist/cli.js graph view --input proof/verified-runs/008-graph-audit/graph-state.json --output proof/verified-runs/008-graph-audit/graph-view.html --limit 50 --type Run,Evidence,Decision,ProviderRoute,AuditLink > proof/verified-runs/008-graph-audit/graph-view.out
