#!/usr/bin/env bash
set -euo pipefail

TARGET_URL="${TARGET_URL:-https://isens-erp.vercel.app}"
PROXY_URL="${PROXY_URL:-}"
USERS="${USERS:-100}"
RATE="${RATE:-50}"
CSV="${CSV:-locust-results}"
HTML="${HTML:-locust-report.html}"

echo "[locust] target: $TARGET_URL"
echo "[locust] proxy:  ${PROXY_URL:-(none)}"
echo "[locust] users: $USERS, spawn: $RATE"

TARGET_URL="$TARGET_URL" \
PROXY_URL="$PROXY_URL" \
locust \
  --headless \
  --users "$USERS" \
  --spawn-rate "$RATE" \
  --run-time 5m \
  --csv "$CSV" \
  --html "$HTML" \
  --only-summary

echo "[locust] saved: $CSV.*, $HTML"
