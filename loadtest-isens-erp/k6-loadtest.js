import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

const TARGET_URL = __ENV.TARGET_URL || 'https://isens-erp.vercel.app';
const PROXY_URL = __ENV.PROXY_URL || '';
const DURATION_RAMP = __ENV.DURATION_RAMP || '1m';
const DURATION_STEADY = __ENV.DURATION_STEADY || '3m';
const DURATION_RAMP_DOWN = __ENV.DURATION_RAMP_DOWN || '1m';
const TARGET_LOW = parseInt(__ENV.TARGET_LOW || '50', 10);
const TARGET_HIGH = parseInt(__ENV.TARGET_HIGH || '300', 10);

const errors = new Counter('http_errors');
const errorRate = new Rate('error_rate');
const responseTime = new Trend('response_time');

export const options = {
  stages: [
    { duration: DURATION_RAMP, target: TARGET_LOW },
    { duration: DURATION_STEADY, target: TARGET_HIGH },
    { duration: DURATION_RAMP_DOWN, target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(50)<500', 'p(95)<2000', 'p(99)<5000'],
    http_req_failed: ['rate<0.10'],
    error_rate: ['rate<0.10'],
  },
};

export default function () {
  const params = {
    tags: { name: 'home' },
    timeout: '10s',
  };
  if (PROXY_URL) {
    params.proxy = PROXY_URL;
  }

  const res = http.get(TARGET_URL, params);

  const ok = check(res, {
    'status is 200': (r) => r.status === 200,
    'response time < 2s': (r) => r.timings.duration < 2000,
    'body not empty': (r) => r.body && r.body.length > 0,
  });

  if (!ok) {
    errors.add(1);
    errorRate.add(1);
  } else {
    errorRate.add(0);
  }

  responseTime.add(res.timings.duration);

  sleep(Math.random() * 2 + 1);
}

export function handleSummary(data) {
  return {
    'k6-summary.json': JSON.stringify(data, null, 2),
  };
}
