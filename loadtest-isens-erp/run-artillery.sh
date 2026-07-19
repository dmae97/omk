#!/usr/bin/env bash
set -euo pipefail

TARGET_URL="${TARGET_URL:-https://isens-erp.vercel.app}"
REPORT="${REPORT:-artillery-report.json}"

echo "[artillery] target: $TARGET_URL"

TARGET_URL="$TARGET_URL" artillery run \
  --output "$REPORT" \
  artillery-loadtest.yml

artillery report "$REPORT"

echo "[artillery] saved: $REPORT, ${REPORT%.json}.html"
