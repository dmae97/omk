"""
Locust load test for isens-erp.vercel.app
Run: locust -f locustfile.py --host=https://isens-erp.vercel.app --headless -u 200 -r 20 -t 8m
Direct mode: LOCUST_DIRECT=1 locust -f locustfile.py ...
With proxy: PROXY_FILE=proxies.txt locust -f locustfile.py ...
"""
import os
import sys
import time
import logging
from pathlib import Path

from locust import HttpUser, task, between, events

# ── Logging ──────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[
        logging.FileHandler('logs/locust.log'),
        logging.StreamHandler(sys.stdout)
    ]
)
logger = logging.getLogger('locust-loadtest')

# ── Proxy loading ───────────────────────────────────────────
PROXIES = []
PROXY_INDEX = 0

PROXY_FILE = os.environ.get('PROXY_FILE', 'proxies.txt')
USE_DIRECT = os.environ.get('LOCUST_DIRECT', '').lower() in ('1', 'true', 'yes')

def load_proxies():
    global PROXIES
    if USE_DIRECT:
        PROXIES = []
        logger.info("Direct mode enabled (no proxies)")
        return

    proxy_env = os.environ.get('LOCUST_PROXY', '')

    if proxy_env:
        PROXIES = [p.strip() for p in proxy_env.split(',') if p.strip()]
        logger.info(f"Loaded {len(PROXIES)} proxies from env")
    elif Path(PROXY_FILE).exists():
        with open(PROXY_FILE) as f:
            PROXIES = [
                line.strip() for line in f
                if line.strip() and not line.startswith('#') and line.strip().startswith('http')
            ]
        logger.info(f"Loaded {len(PROXIES)} proxies from {PROXY_FILE}")

    if not PROXIES:
        logger.warning("No proxies found - using direct connection")

def get_next_proxy():
    global PROXY_INDEX
    if not PROXIES:
        return None
    proxy = PROXIES[PROXY_INDEX % len(PROXIES)]
    PROXY_INDEX += 1
    return proxy

# ── Stats tracking ──────────────────────────────────────────
STATS = {
    "total_requests": 0,
    "success": 0,
    "failures": 0,
    "start_time": time.time(),
    "endpoint_stats": {},
}

class SensERPUser(HttpUser):
    wait_time = between(0.5, 3.0)

    # Default headers
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
        "Accept-Encoding": "gzip, deflate, br",
        "Cache-Control": "no-cache",
    }

    def on_start(self):
        self.proxy = get_next_proxy()
        if self.proxy:
            self.client.proxies = {"http": self.proxy, "https": self.proxy}
            logger.debug(f"User {id(self):x}: proxy={self.proxy}")

    @task(25)
    def browse_home(self):
        self._do_request("GET", "/", "home")

    @task(15)
    def browse_login(self):
        self._do_request("GET", "/login", "login")

    @task(15)
    def api_root(self):
        self._do_request("GET", "/api", "api")

    @task(10)
    def api_v1(self):
        self._do_request("GET", "/api/v1", "api_v1")

    @task(10)
    def api_auth(self):
        self._do_request("GET", "/api/auth", "api_auth")

    @task(10)
    def health_check(self):
        self._do_request("GET", "/api/health", "health")

    @task(5)
    def api_users(self):
        self._do_request("GET", "/api/users", "api_users")

    @task(5)
    def favicon(self):
        self._do_request("GET", "/favicon.svg", "asset_svg")

    @task(3)
    def manifest(self):
        self._do_request("GET", "/manifest.webmanifest", "manifest")

    @task(2)
    def robots(self):
        self._do_request("GET", "/robots.txt", "robots")

    def _do_request(self, method, path, name):
        STATS["total_requests"] += 1
        start = time.time()
        try:
            with self.client.request(
                method, path,
                headers=self.headers,
                catch_response=True,
                name=name,
                timeout=15
            ) as resp:
                elapsed = (time.time() - start) * 1000

                if resp.status_code in (200, 304):
                    resp.success()
                    STATS["success"] += 1
                else:
                    resp.failure(f"HTTP {resp.status_code}")
                    STATS["failures"] += 1

                # Track per-endpoint
                if name not in STATS["endpoint_stats"]:
                    STATS["endpoint_stats"][name] = {"count": 0, "ok": 0, "fail": 0, "total_ms": 0}
                STATS["endpoint_stats"][name]["count"] += 1
                STATS["endpoint_stats"][name]["total_ms"] += elapsed
                if resp.status_code in (200, 304):
                    STATS["endpoint_stats"][name]["ok"] += 1
                else:
                    STATS["endpoint_stats"][name]["fail"] += 1

        except Exception as e:
            STATS["failures"] += 1
            elapsed = (time.time() - start) * 1000
            logger.error(f"[FAIL] {method} {path} -> {e} ({elapsed:.0f}ms)")


@events.test_start.add_listener
def on_test_start(environment, **kwargs):
    load_proxies()
    logger.info(f"\n{'='*60}")
    logger.info(f" Locust Load Test: https://isens-erp.vercel.app")
    logger.info(f" Proxies: {len(PROXIES)} loaded")
    logger.info(f" Start: {time.strftime('%Y-%m-%d %H:%M:%S')}")
    logger.info(f"{'='*60}\n")


@events.test_stop.add_listener
def on_test_stop(environment, **kwargs):
    elapsed = time.time() - STATS["start_time"]
    rps = STATS["total_requests"] / elapsed if elapsed > 0 else 0

    logger.info(f"\n{'='*60}")
    logger.info(f" Locust Load Test Complete")
    logger.info(f" Duration: {elapsed:.1f}s")
    logger.info(f" Total Requests: {STATS['total_requests']}")
    logger.info(f" Success: {STATS['success']} ({STATS['success']/max(STATS['total_requests'],1)*100:.1f}%)")
    logger.info(f" Failures: {STATS['failures']} ({STATS['failures']/max(STATS['total_requests'],1)*100:.1f}%)")
    logger.info(f" Avg RPS: {rps:.1f}")
    logger.info(f"")
    logger.info(f" Per-Endpoint Stats:")
    for name, s in sorted(STATS["endpoint_stats"].items()):
        avg_ms = s["total_ms"] / max(s["count"], 1)
        logger.info(f"  {name:20s}: {s['count']:5d} reqs | {s['ok']:5d} OK | {s['fail']:5d} FAIL | avg {avg_ms:.0f}ms")
    logger.info(f"{'='*60}\n")

    # Write final JSON results
    import json
    results = {
        "target": "https://isens-erp.vercel.app",
        "duration_s": elapsed,
        "total_requests": STATS["total_requests"],
        "success": STATS["success"],
        "failures": STATS["failures"],
        "avg_rps": rps,
        "proxies_used": len(PROXIES),
        "endpoints": STATS["endpoint_stats"],
        "timestamp": time.strftime('%Y-%m-%dT%H:%M:%S'),
    }

    with open("results/locust-results.json", "w") as f:
        json.dump(results, f, indent=2)
    logger.info(f"Results written to results/locust-results.json")
