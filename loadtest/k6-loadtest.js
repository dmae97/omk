// k6 load test for isens-erp.vercel.app
// Run: k6 run --out json=results/k6-results.json k6-loadtest.js
// With proxy: PROXY=http://proxy:port k6 run k6-loadtest.js

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';

// ── Custom metrics ──────────────────────────────────────────
const ttfb          = new Trend('ttfb', true);
const pageLoad      = new Trend('page_load', true);
const apiLatency    = new Trend('api_latency', true);
const assetLatency  = new Trend('asset_latency', true);
const failRate      = new Rate('fail_rate');
const successCount  = new Counter('success_count');
const errorCount    = new Counter('error_count');
const bytesRcvd     = new Counter('bytes_received');

// ── Config ──────────────────────────────────────────────────
const TARGET    = __ENV.TARGET   || 'https://isens-erp.vercel.app';
const PROXY     = __ENV.PROXY    || '';
const LOG_LEVEL = __ENV.LOG_LEVEL || 'info'; // debug | info | error

// ── Paths to hit ────────────────────────────────────────────
const PATHS = [
  { method: 'GET', path: '/',              tag: 'home' },
  { method: 'GET', path: '/login',         tag: 'login' },
  { method: 'GET', path: '/api',           tag: 'api' },
  { method: 'GET', path: '/api/v1',        tag: 'api_v1' },
  { method: 'GET', path: '/api/auth',      tag: 'api_auth' },
  { method: 'GET', path: '/api/users',     tag: 'api_users' },
  { method: 'GET', path: '/api/health',    tag: 'health' },
  { method: 'GET', path: '/favicon.svg',   tag: 'asset_svg' },
  { method: 'GET', path: '/robots.txt',    tag: 'misc' },
  { method: 'GET', path: '/manifest.webmanifest', tag: 'manifest' },
];

// ── k6 options ──────────────────────────────────────────────
export const options = {
  scenarios: {
    // Phase 1: Ramp up
    ramp_up: {
      executor: 'ramping-vus',
      startVUs: 1,
      stages: [
        { duration: '30s', target: 20 },   // ramp to 20 VUs
        { duration: '1m',  target: 50 },   // ramp to 50 VUs
        { duration: '2m',  target: 100 },  // ramp to 100 VUs
        { duration: '2m',  target: 100 },  // sustain at 100
        { duration: '1m',  target: 200 },  // spike to 200
        { duration: '1m',  target: 200 },  // sustain spike
        { duration: '30s', target: 0 },    // ramp down
      ],
      gracefulRampDown: '10s',
    },
  },
  thresholds: {
    'fail_rate':        ['rate<0.50'],    // allow up to 50% fail (free proxies unreliable)
    'http_req_duration':['p(95)<10000'],  // 95th percentile under 10s
    'ttfb':             ['p(95)<5000'],   // TTFB under 5s
  },
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
};

// ── Request builder ─────────────────────────────────────────
function makeRequest(method, path, tag) {
  const url = `${TARGET}${path}`;
  const params = {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
      'Accept-Encoding': 'gzip, deflate, br',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
    },
    tags: { name: tag },
    timeout: '15s',
  };

  const start = Date.now();
  let response;
  try {
    response = http.request(method, url, null, params);
    const elapsed = Date.now() - start;

    // Track per-endpoint latency
    if (tag.startsWith('api') || tag === 'health') {
      apiLatency.add(elapsed);
    } else if (tag.startsWith('asset') || tag === 'manifest') {
      assetLatency.add(elapsed);
    } else {
      pageLoad.add(elapsed);
    }

    // TTFB from timings
    if (response.timings && response.timings.waiting) {
      ttfb.add(response.timings.waiting);
    }

    // Track bytes
    bytesRcvd.add(response.body ? response.body.length : 0);

    // Check success
    const ok = response.status === 200 || response.status === 304;
    if (ok) {
      successCount.add(1);
    } else {
      errorCount.add(1);
    }
    failRate.add(!ok);

    if (LOG_LEVEL === 'debug') {
      console.log(`[OK] ${method} ${path} -> ${response.status} (${elapsed}ms, ${response.body?.length || 0}B)`);
    }

    check(response, {
      [`${tag} status 2xx/3xx`]: (r) => r.status >= 200 && r.status < 400,
    });

    return { ok, elapsed, status: response.status };
  } catch (e) {
    const elapsed = Date.now() - start;
    errorCount.add(1);
    failRate.add(1);
    if (LOG_LEVEL !== 'error') {
      console.error(`[ERR] ${method} ${path} -> ${e.message} (${elapsed}ms)`);
    }
    return { ok: false, elapsed, status: 0, error: e.message };
  }
}

// ── VU setup ────────────────────────────────────────────────
export function setup() {
  console.log(`\n╔══════════════════════════════════════════════════════════╗`);
  console.log(`║  k6 Load Test: ${TARGET}`);
  console.log(`║  Proxy: ${PROXY || 'DIRECT (no proxy)'}`);
  console.log(`║  Scenario: ramping-vus 1→200→0`);
  console.log(`║  Start: ${new Date().toISOString()}`);
  console.log(`╚══════════════════════════════════════════════════════════╝\n`);
  return { startTime: Date.now() };
}

// ── VU main ─────────────────────────────────────────────────
export default function (data) {
  // Each VU picks a random path set each iteration
  const pathIndex = Math.floor(Math.random() * PATHS.length);
  const { method, path, tag } = PATHS[pathIndex];

  group(`${tag}`, () => {
    makeRequest(method, path, tag);
  });

  // Random sleep between requests (mimics real browsing)
  sleep(Math.random() * 2 + 0.5);
}

// ── Teardown ────────────────────────────────────────────────
export function teardown(data) {
  const duration = (Date.now() - data.startTime) / 1000;
  console.log(`\n╔══════════════════════════════════════════════════════════╗`);
  console.log(`║  k6 Load Test Complete`);
  console.log(`║  Duration: ${duration.toFixed(1)}s`);
  console.log(`║  End: ${new Date().toISOString()}`);
  console.log(`╚══════════════════════════════════════════════════════════╝\n`);
}
