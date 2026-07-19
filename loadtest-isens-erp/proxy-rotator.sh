#!/usr/bin/env bash
set -euo pipefail

# Launch multiple k6 instances, one per proxy, for distributed authorized load testing.
# Each k6 process uses a different proxy from proxies.txt and writes its own log.

TARGET_URL="${TARGET_URL:-https://isens-erp.vercel.app}"
PROXY_FILE="${PROXY_FILE:-proxies.txt}"
VUS_PER_PROXY="${VUS_PER_PROXY:-10}"
DURATION="${DURATION:-2m}"
PAUSE_BETWEEN="${PAUSE_BETWEEN:-2}"

cd "$(dirname "$0")"

if [[ ! -f "$PROXY_FILE" ]]; then
  echo "proxy file not found: $PROXY_FILE"
  echo "run: node fetch-proxies.mjs"
  exit 1
fi

mkdir -p logs
pids=()
idx=0

while IFS= read -r proxy; do
  [[ -z "$proxy" ]] && continue
  proxy="${proxy#http://}"
  proxy="${proxy#https://}"
  proxy="${proxy#socks4://}"
  proxy="${proxy#socks5://}"

  log="logs/k6-proxy-${idx}.log"
  json="logs/k6-report-${idx}.json"

  echo "starting k6 instance $idx via proxy $proxy -> $log"

  (
    docker run --rm --network host \
      -v "$(pwd):/k6" -w /k6 \
      grafana/k6:latest run \
      --env TARGET_URL="$TARGET_URL" \
      --env PROXY_URL="http://$proxy" \
      --env DURATION_RAMP=10s \
      --env DURATION_STEADY="$DURATION" \
      --env DURATION_RAMP_DOWN=10s \
      --env TARGET_LOW="$VUS_PER_PROXY" \
      --env TARGET_HIGH="$VUS_PER_PROXY" \
      --out json="/tmp/report.json" \
      k6-loadtest.js 2>&1
  ) > "$log" 2>&1 &

  pids+=("$!")
  ((idx++)) || true
  sleep "$PAUSE_BETWEEN"
done < "$PROXY_FILE"

wait "${pids[@]}"

python3 -m json.tool --compact logs/k6-report-*.json > /dev/null 2>&1 || true

echo "all $idx k6 instances finished"
echo "logs: logs/*.log"
