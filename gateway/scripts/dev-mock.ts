// Local demo: starts a tiny mock upstream and the gateway against it (no real key, no network).
// Usage: npm run dev:mock   then curl the printed token. Modes are documented in README.md ("Dev mock modes").
import { serve } from "@hono/node-server";
import { issueKey } from "../src/admin.js";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { openDb } from "../src/db.js";
import { createLogger } from "../src/logger.js";
import { configDir } from "./_cli.js";
import { DEV_MOCK_UPSTREAM_KEY, createDevMockUpstream } from "./dev-mock-upstream.js";

const mock = createDevMockUpstream();
await mock.start();
const db = await openDb();
const first = await issueKey(db, { label: "dev", plan: "A", now: new Date() });
const app = createApp({ config: loadConfig(configDir()), db, upstreamApiKey: DEV_MOCK_UPSTREAM_KEY, upstreamBaseUrl: mock.url, log: createLogger((l) => console.log(l)) });
serve({ fetch: app.fetch, port: 8787, hostname: "127.0.0.1" });
console.log("gateway: http://127.0.0.1:8787/v1  (in-memory DB, mock upstream)");
console.log(`dev token (shown once, in-memory only): ${first.token}`);
