// Local demo: starts a tiny mock upstream and the gateway against it (no real key, no network).
// Usage: npm run dev:mock   then issue a token (stop this first, or use another data dir) and curl it.
import { createServer } from "node:http";
import { serve } from "@hono/node-server";
import { issueKey } from "../src/admin.js";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { openDb } from "../src/db.js";
import { createLogger } from "../src/logger.js";
import { configDir } from "./_cli.js";

const mock = createServer((req, res) => {
	req.resume();
	req.on("end", () => {
		res.writeHead(200, { "content-type": "application/json" });
		res.end(JSON.stringify({ id: "x", model: "up", choices: [{ index: 0, message: { role: "assistant", content: "mock reply" }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 10, completion_tokens_details: { reasoning_tokens: 0 } } }));
	});
});
await new Promise<void>((r) => mock.listen(0, "127.0.0.1", r));
const upstream = `http://127.0.0.1:${(mock.address() as { port: number }).port}`;
const db = await openDb();
const first = await issueKey(db, { label: "dev", plan: "A", now: new Date() });
const app = createApp({ config: loadConfig(configDir()), db, upstreamApiKey: "mock-key-not-real", upstreamBaseUrl: upstream, log: createLogger((l) => console.log(l)) });
serve({ fetch: app.fetch, port: 8787, hostname: "127.0.0.1" });
console.log("gateway: http://127.0.0.1:8787/v1  (in-memory DB, mock upstream)");
console.log(`dev token (shown once, in-memory only): ${first.token}`);
