# Load test kit — k6 / Artillery / Locust

## Requirements

- k6: `brew install k6` or `sudo apt install k6` or `docker loadimpact/k6`
- Artillery: `npm install -g artillery`
- Locust: `pip install locust`

## Fetch free proxies

```bash
node fetch-proxies.mjs
```

Output: `proxies.txt` (up to 50 proxies by default). Set `MAX_PROXIES` and `OUT_FILE` to override.

## Run k6

```bash
chmod +x run-k6.sh
TARGET_URL=https://isens-erp.vercel.app ./run-k6.sh
# with proxy
TARGET_URL=https://isens-erp.vercel.app PROXY_URL=http://1.2.3.4:8080 ./run-k6.sh
```

Outputs: `k6-report.json`, `k6-metrics.csv`, `k6-summary.json`

Tune: `TARGET_LOW`, `TARGET_HIGH`, `DURATION_RAMP`, `DURATION_STEADY`, `DURATION_RAMP_DOWN`

## Run Artillery

```bash
chmod +x run-artillery.sh
TARGET_URL=https://isens-erp.vercel.app ./run-artillery.sh
```

Outputs: `artillery-report.json`, `artillery-report.html`

## Run Locust

```bash
chmod +x run-locust.sh
TARGET_URL=https://isens-erp.vercel.app ./run-locust.sh
# with proxy
TARGET_URL=https://isens-erp.vercel.app PROXY_URL=http://1.2.3.4:8080 ./run-locust.sh
```

Outputs: `locust-results_*.csv`, `locust-report.html`

## Proxy rotation

For k6, pick one proxy per run via `PROXY_URL`. For proxy rotation across many workers, wrap the runner in a shell loop that cycles through `proxies.txt` and starts k6/Locust per process per proxy, or use a local proxy rotator like `proxyrotator`.

## Logging

- k6: JSON + CSV + summary JSON
- Artillery: JSON + HTML report
- Locust: CSV stats + HTML report

All logs are written to the project directory.
