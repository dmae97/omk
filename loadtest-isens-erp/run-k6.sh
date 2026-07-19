#!/usr/bin/env bash
set -euo pipefail

TARGET_URL="${TARGET_URL:-https://isens-erp.vercel.app}"
PROXY_URL="${PROXY_URL:-}"
REPORT="${REPORT:-k6-report.json}"
CSV="${CSV:-k6-metrics.csv}"

echo "[k6] target: $TARGET_URL"
echo "[k6] proxy:  ${PROXY_URL:-(none)}"

k6 run \
  --env TARGET_URL="$TARGET_URL" \
  --env PROXY_URL="$PROXY_URL" \
  --out json="$REPORT" \
  --out csv="$CSV" \
  k6-loadtest.js

echo "[k6] saved: $REPORT, $CSV"
