import fs from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const SOURCES = [
  {
    name: 'proxyscrape-http',
    url: 'https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=10000&country=all&ssl=all&anonymity=all',
  },
  {
    name: 'proxy-list-download',
    url: 'https://www.proxy-list.download/api/v1/get?type=http',
  },
  {
    name: 'speedx-http',
    url: 'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt',
  },
  {
    name: 'speedx-socks4',
    url: 'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/socks4.txt',
  },
  {
    name: 'speedx-socks5',
    url: 'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/socks5.txt',
  },
];

const MAX_PROXIES = parseInt(process.env.MAX_PROXIES || '50', 10);
const OUT_FILE = process.env.OUT_FILE || 'proxies.txt';

function parseProxyList(text) {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .filter((l) => /^[\d.]+:\d+$/.test(l) || l.includes('://'));
}

async function fetchProxies() {
  const proxies = new Set();
  for (const src of SOURCES) {
    try {
      const controller = new AbortController();
      const timer = globalThis.setTimeout(() => controller.abort(), 15000);
      const res = await fetch(src.url, { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) {
        console.error(`[${src.name}] HTTP ${res.status}`);
        continue;
      }
      const text = await res.text();
      const list = parseProxyList(text);
      list.forEach((p) => proxies.add(p));
      console.log(`[${src.name}] fetched ${list.length} proxies`);
    } catch (err) {
      console.error(`[${src.name}] failed: ${err.message}`);
    }
    await sleep(500);
  }

  const final = Array.from(proxies).slice(0, MAX_PROXIES);
  fs.writeFileSync(OUT_FILE, final.join('\n'));
  console.log(`\nSaved ${final.length} proxies to ${OUT_FILE}`);
}

fetchProxies().catch((e) => {
  console.error(e);
  process.exit(1);
});
