import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { openDb } from "./db.ts";
import { createLogger } from "./logger.ts";

const here = dirname(fileURLToPath(import.meta.url));
const configDir = resolve(process.env.OMK_GATEWAY_CONFIG_DIR ?? join(here, "..", "config"));
const dataDir = resolve(process.env.OMK_GATEWAY_DATA_DIR ?? join(here, "..", ".data", "pglite"));
const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "127.0.0.1";

const config = loadConfig(configDir);
if (process.env.UPSTREAM_BASE_URL) config.gateway.upstreamBaseUrl = process.env.UPSTREAM_BASE_URL.replace(/\/+$/, "");
const log = createLogger((l) => process.stdout.write(`${l}\n`));

// PGlite data dirs are single-process: a pid lock keeps the CLI scripts from opening a live dir.
const lock = `${dataDir}.lock`;
if (existsSync(lock)) {
	const pid = Number(readFileSync(lock, "utf8"));
	let alive = false;
	try {
		process.kill(pid, 0);
		alive = true;
	} catch {}
	if (alive) throw new Error(`data dir is in use by pid ${pid}`);
}
writeFileSync(lock, String(process.pid));
const cleanup = () => {
	try {
		unlinkSync(lock);
	} catch {}
};
process.on("exit", cleanup);
for (const s of ["SIGINT", "SIGTERM"] as const) process.on(s, () => process.exit(0));

const db = await openDb(dataDir);
const upstreamApiKey = process.env.DEEPSEEK_API_KEY ?? null;
if (!upstreamApiKey) log.warn("upstream_key_missing", { msg: "DEEPSEEK_API_KEY not set: chat requests will return 503" });
const app = createApp({ config, db, upstreamApiKey, log });
serve({ fetch: app.fetch, port, hostname: host }, (i) => log.info("listening", { msg: `http://${host}:${i.port}/v1` }));
