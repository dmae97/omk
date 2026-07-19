// k6 high-load stress test for isens-erp.vercel.app
// Pushes to 500+ VUs to find breaking point
import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';

const ttfb = new Trend('ttfb', true);
const failRate = new Rate('fail_rate');
const bytesRcvd = new Counter('bytes_received');
const successCount = new Counter('success_count');
const errorCount = new Counter('error_count');

const TARGET = __ENV.TARGET || 'https://isens-erp.vercel.app';
const LOG_LEVEL = __ENV.LOG_LEVEL || 'info';

const PATHS = [
  { method: 'GET', path: '/', tag: 'home' },
  { method: 'GET', path: '/login', tag: 'login' },
  { method: 'GET', path: '/api', tag: 'api' },
  { method: 'GET', path: '/api/v1', tag: 'api_v1' },
  { method: 'GET', path: '/api/auth', tag: 'api_auth' },
  { method: 'GET', path: '/api/health', tag: 'health' },
  { method: 'GET', path: '/favicon.svg', tag: 'asset' },
];

export const options = {
  scenarios: {
    stress: {
      executor: 'ramping-vus',
      startVUs: 50,
      stages: [
        { duration: '30s', target: 200 },
        { duration: '30s', target: 500 },
        { duration: '60s', target: 500 },
        { duration: '30s', target: 1000 },
        { duration: '60s', target: 1000 },
        { duration: '30s', target: 0 },
      ],
      gracefulRampDown: '10s',
    },
  },
  thresholds: {
    'fail_rate': ['rate<0.80'],
  },
};

function makeRequest(method, path, tag) {
  const url = `${TARGET}${path}`;
  const params = {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      'Cache-Control': 'no-cache',
    },
    tags: { name: tag },
    timeout: '15s',
  };

  try {
    const response = http.request(method, url, null, params);
    const ok = response.status === 200 || response.status === 304;
    if (ok) {
      successCount.add(1);
    } else {
      errorCount.add(1);
    }
    failRate.add(!ok);
    bytesRcvd.add(response.body ? response.body.length : 0);
    if (response.timings && response.timings.waiting) {
      ttfb.add(response.timings.waiting);
    }
    if (LOG_LEVEL === 'debug' || (!ok && LOG_LEVEL !== 'silent')) {
      console.log(`[${ok ? 'OK' : 'FAIL'}] ${tag} ${path} -> ${response.status} ${response.timings ? response.timings.duration + 'ms' : ''}`);
    }
    check(response, { [`${tag} status ok`]: (r) => ok });
    return { ok, status: response.status };
  } catch (e) {
    errorCount.add(1);
    failRate.add(1);
    console.error(`[ERR] ${tag} ${path} -> ${e.message}`);
    return { ok: false, status: 0, error: e.message };
  }
}

export function setup() {
  console.log(`\n╔══════════════════════════════════════════════════════════╗`);
  console.log(`║  k6 HIGH-LOAD STRESS TEST: ${TARGET}`);
  console.log(`║  Target: 50 -> 1000 VUs, ~240s total`);
  console.log(`║  Start: ${new Date().toISOString()}`);
  console.log(`╚══════════════════════════════════════════════════════════╝\n`);
}

export default function () {
  const path = PATHS[Math.floor(Math.random() * PATHS.length)];
  group(path.tag, () => {
    makeRequest(path.method, path.path, path.tag);
  });
  sleep(Math.random() * 1.5 + 0.2);
}

export function teardown() {
  console.log(`\nHigh-load test ended at ${new Date().toISOString()}`);
}
