// Artillery processor - proxy rotation & logging
// Reads proxies from ARTILLERY_PROXY env or proxies.txt

const fs = require('fs');
const path = require('path');

let proxies = [];
let proxyIndex = 0;

function loadProxies(context, events, done) {
  if (proxies.length === 0) {
    const proxyFile = process.env.PROXY_FILE || path.join(__dirname, 'proxies.txt');
    const proxyEnv = process.env.ARTILLERY_PROXY;
    
    if (proxyEnv) {
      proxies = proxyEnv.split(',').map(p => p.trim()).filter(Boolean);
      console.log(`[processor] Loaded ${proxies.length} proxies from env`);
    } else if (fs.existsSync(proxyFile)) {
      const content = fs.readFileSync(proxyFile, 'utf-8');
      proxies = content.split('\n')
        .map(l => l.trim())
        .filter(l => l && !l.startsWith('#') && l.startsWith('http'));
      console.log(`[processor] Loaded ${proxies.length} proxies from ${proxyFile}`);
    }
    
    if (proxies.length === 0) {
      console.log('[processor] No proxies configured, using direct connection');
    }
  }
  
  // Round-robin proxy rotation
  if (proxies.length > 0) {
    const proxy = proxies[proxyIndex % proxies.length];
    proxyIndex++;
    // Set proxy for this virtual user
    if (context.vars) {
      context.vars._proxy = proxy;
    }
    console.log(`[processor] VU ${context.vars?.$uuid || '?'} -> proxy[${proxyIndex % proxies.length}]: ${proxy}`);
  }
  
  return done();
}

// Track stats
let stats = {
  total: 0,
  ok: 0,
  fail: 0,
  startTime: Date.now(),
};

function beforeRequest(req, context, ee, next) {
  stats.total++;
  req._startTime = Date.now();
  return next();
}

function afterResponse(req, res, context, ee, next) {
  const elapsed = Date.now() - (req._startTime || 0);
  const ok = res.statusCode >= 200 && res.statusCode < 400;
  
  if (ok) {
    stats.ok++;
  } else {
    stats.fail++;
    console.error(`[FAIL] ${req.method || 'GET'} ${req.url} -> ${res.statusCode} (${elapsed}ms)`);
  }
  
  // Log every 100 requests
  if (stats.total % 100 === 0) {
    const elapsed = (Date.now() - stats.startTime) / 1000;
    console.log(`[stats] ${stats.total} reqs | ${stats.ok} OK | ${stats.fail} FAIL | ${elapsed.toFixed(0)}s`);
  }
  
  return next();
}

// Print final stats
function doneHandler(context, ee, next) {
  const elapsed = (Date.now() - stats.startTime) / 1000;
  console.log(`\n═══════════════════════════════════════════════`);
  console.log(` Artillery Processor Final Stats`);
  console.log(` Total: ${stats.total} | OK: ${stats.ok} | FAIL: ${stats.fail}`);
  console.log(` Duration: ${elapsed.toFixed(1)}s`);
  console.log(` Rate: ${(stats.total / elapsed).toFixed(1)} req/s`);
  console.log(`═══════════════════════════════════════════════\n`);
  return next();
}

module.exports = {
  loadProxies,
  beforeRequest,
  afterResponse,
  doneHandler,
};
