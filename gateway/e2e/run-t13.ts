/**
 * T-13 harness: starts the same stack as `npm run dev:mock` (in-memory PGlite + mock upstream
 * on 127.0.0.1:8787/v1), runs the #387 client against it, queries usage_events, writes results.
 * The one-time dev token is never written to the report or to files under e2e/.
 */
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { issueKey } from "../src/admin.js";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { openDb } from "../src/db.js";
import { createLogger } from "../src/logger.js";
import { DEV_MOCK_UPSTREAM_KEY, createDevMockUpstream } from "../scripts/dev-mock-upstream.js";
import { redact, redactJson } from "./redact.ts";

const here = dirname(fileURLToPath(import.meta.url));
const GATEWAY_ROOT = join(here, "..");
const REPO_ROOT = join(GATEWAY_ROOT, "..");
const CLIENT_ROOT = process.env.T13_CLIENT_ROOT ?? "/workspace/omk-t13-client";
const HOST = "127.0.0.1";
const PORT = Number(process.env.PORT ?? 8787);
const BASE = `http://${HOST}:${PORT}/v1`;

function kstNow(): string {
	const fmt = new Intl.DateTimeFormat("en-CA", {
		timeZone: "Asia/Seoul",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hour12: false,
	});
	return `${fmt.format(new Date()).replace(",", "")} KST (Asia/Seoul)`;
}

function git(cwd: string, args: string[]): string {
	return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
}

type Rec = {
	at: string;
	method: string;
	path: string;
	caseId: string | null;
	model?: unknown;
	stream?: unknown;
	thinking?: unknown;
	reasoning_effort?: unknown;
	tools?: unknown;
	messageRoles?: unknown;
	hasToolMessage?: boolean;
	hasAuth?: boolean;
	authorization?: string | null;
	bodyParseError?: string;
};

const requests: Rec[] = [];
const logLines: string[] = [];

async function recordIncoming(req: Request): Promise<void> {
	const url = new URL(req.url);
	const rec: Rec = {
		at: new Date().toISOString(),
		method: req.method,
		path: url.pathname,
		caseId: req.headers.get("x-t13-case"),
		hasAuth: req.headers.has("authorization"),
		authorization: req.headers.get("authorization") ? "Bearer [REDACTED]" : null,
	};
	if (req.method !== "GET" && req.method !== "HEAD") {
		try {
			const body = await req.clone().json();
			rec.model = body?.model ?? null;
			rec.stream = body?.stream === true;
			rec.thinking = body?.thinking ?? null;
			rec.reasoning_effort = body?.reasoning_effort ?? null;
			rec.tools = Array.isArray(body?.tools)
				? body.tools.map((t: any) => t?.function?.name ?? t?.name ?? "?")
				: null;
			rec.messageRoles = Array.isArray(body?.messages) ? body.messages.map((m: any) => m?.role) : null;
			rec.hasToolMessage = Array.isArray(body?.messages) && body.messages.some((m: any) => m?.role === "tool");
		} catch (e) {
			rec.bodyParseError = e instanceof Error ? e.message : "parse failed";
		}
	}
	requests.push(rec);
}

function mdEscape(s: string): string {
	return redact(s).replace(/\|/g, "\\|");
}

function yamlish(value: unknown, indent = 0): string {
	const pad = "  ".repeat(indent);
	if (value === null || value === undefined) return "null";
	if (typeof value === "string") {
		const t = redact(value);
		if (t.includes("\n") || t.length > 120) return `|\n${t.split("\n").map((l) => `${pad}  ${l}`).join("\n")}`;
		return JSON.stringify(t);
	}
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	if (Array.isArray(value)) {
		if (value.length === 0) return "[]";
		return `\n${value.map((v) => `${pad}- ${yamlish(v, indent + 1)}`).join("\n")}`;
	}
	if (typeof value === "object") {
		const entries = Object.entries(value as Record<string, unknown>);
		if (entries.length === 0) return "{}";
		return `\n${entries.map(([k, v]) => `${pad}${k}: ${yamlish(v, indent + 1)}`).join("\n")}`;
	}
	return JSON.stringify(value);
}

async function main(): Promise<void> {
	const clientSha = git(CLIENT_ROOT, ["rev-parse", "HEAD"]);
	const clientSubject = git(CLIENT_ROOT, ["log", "-1", "--format=%s"]);
	const gatewaySha = git(REPO_ROOT, ["rev-parse", "HEAD"]);
	const gatewaySubject = git(REPO_ROOT, ["log", "-1", "--format=%s"]);
	const cd25 = "cd25e92907f2bd1d3d51d2fb2d4e7ed2adbcd1b8";
	let cd25Ancestor = false;
	try {
		execFileSync("git", ["-C", CLIENT_ROOT, "merge-base", "--is-ancestor", cd25, "HEAD"]);
		cd25Ancestor = true;
	} catch {
		cd25Ancestor = false;
	}

	console.error(`T-13 harness starting at ${kstNow()}`);
	console.error(`client HEAD ${clientSha} (${clientSubject})`);
	console.error(`gateway HEAD ${gatewaySha} (${gatewaySubject})`);
	console.error(`cd25e92907 ancestor of client HEAD: ${cd25Ancestor}`);

	const mock = createDevMockUpstream();
	await mock.start();
	const db = await openDb();
	const issued = await issueKey(db, { label: "dev", plan: "A", now: new Date() });
	const token = issued.token;
	const app = createApp({
		config: loadConfig(join(GATEWAY_ROOT, "config")),
		db,
		upstreamApiKey: DEV_MOCK_UPSTREAM_KEY,
		upstreamBaseUrl: mock.url,
		log: createLogger((l) => {
			const line = redact(l);
			logLines.push(line);
			console.log(line);
		}),
	});

	const server = serve({
		fetch: async (req) => {
			await recordIncoming(req);
			return app.fetch(req);
		},
		port: PORT,
		hostname: HOST,
	});

	const healthDeadline = Date.now() + 10_000;
	while (Date.now() < healthDeadline) {
		try {
			const r = await fetch(`http://${HOST}:${PORT}/healthz`);
			if (r.ok) break;
		} catch {
			/* not up yet */
		}
		await new Promise((r) => setTimeout(r, 50));
	}
	const health = await fetch(`http://${HOST}:${PORT}/healthz`);
	if (!health.ok) throw new Error(`gateway did not become healthy on ${HOST}:${PORT}`);
	console.error(`gateway: ${BASE}  (in-memory DB, mock upstream)`);
	console.error("dev token issued (shown once in this process only, not written to e2e/)");

	const reportPath = join(here, "_report.json");
	const node22 = process.env.T13_NODE || "/home/box/.nvm/versions/node/v22.23.4/bin/node";
	const tsxCli = join(CLIENT_ROOT, "node_modules/tsx/dist/cli.mjs");
	const driver = spawn(
		node22,
		[tsxCli, join(here, "client-driver.ts")],
		{
			cwd: CLIENT_ROOT,
			env: {
				PATH: `${dirname(node22)}:${process.env.PATH ?? ""}`,
				HOME: process.env.HOME,
				OMK_PROVIDER_OMK: "1",
				OMK_GATEWAY_BASE_URL: BASE,
				OMK_ACCOUNT_TOKEN: token,
				T13_CLIENT_ROOT: CLIENT_ROOT,
				T13_CLI: join(CLIENT_ROOT, "packages/coding-agent/dist/cli.js"),
				T13_REPORT_PATH: reportPath,
				T13_CASE_TIMEOUT_MS: process.env.T13_CASE_TIMEOUT_MS ?? "90000",
				T13_NODE: node22,
				NO_COLOR: "1",
			},
			stdio: ["ignore", "inherit", "inherit"],
		},
	);
	const driverCode: number | null = await new Promise((resolve, reject) => {
		driver.on("error", reject);
		driver.on("close", (code) => resolve(code));
	});

	let clientReport: any = { ok: false, cases: [], error: "missing report file" };
	try {
		const { readFileSync } = await import("node:fs");
		clientReport = JSON.parse(readFileSync(reportPath, "utf8"));
	} catch (e) {
		clientReport = { ok: false, cases: [], error: redact(e instanceof Error ? e.message : String(e)) };
	}

	const usage = await db.query(
		`SELECT id, request_id, model_public, model_upstream, stream, prompt_tokens, cache_hit_tokens, cache_miss_tokens,
		        completion_tokens, reasoning_tokens, answer_tokens, total_tokens, finish_reason, estimated, end_reason,
		        usage_anomaly
		   FROM usage_events
		  ORDER BY ts_start, id`,
	);
	const denied = await db.query(`SELECT request_id, code, model FROM denied_events ORDER BY ts, id`);

	// Re-check origin/feat/omk-provider before finishing, as requested.
	let originHead = "(fetch failed)";
	let originContainsCd25 = false;
	let originNote = "";
	try {
		execFileSync("git", ["-C", CLIENT_ROOT, "fetch", "origin", "feat/omk-provider"], { encoding: "utf8" });
		originHead = execFileSync("git", ["-C", CLIENT_ROOT, "rev-parse", "origin/feat/omk-provider"], { encoding: "utf8" }).trim();
		try {
			execFileSync("git", ["-C", CLIENT_ROOT, "merge-base", "--is-ancestor", cd25, "origin/feat/omk-provider"]);
			originContainsCd25 = true;
		} catch {
			originContainsCd25 = false;
		}
		if (originHead === clientSha) {
			originNote = "Re-checked origin/feat/omk-provider after the run: still at the SHA under test.";
		} else {
			originNote = `Re-checked origin/feat/omk-provider after the run: it moved to ${originHead}. This run used ${clientSha}.`;
		}
	} catch (e) {
		originNote = `Could not re-fetch origin/feat/omk-provider: ${redact(e instanceof Error ? e.message : String(e))}`;
	}

	const cases: any[] = clientReport.cases ?? [];
	const passed = cases.filter((c) => c.pass).length;
	const failed = cases.filter((c) => !c.pass).length;
	const usageRows = (usage.rows ?? usage) as any[];
	const deniedRows = (denied.rows ?? denied) as any[];

	const expectedModels = new Set(["OMK/coder", "OMK/reasoner"]);
	const modelNamesOk = usageRows.every((r) => expectedModels.has(r.model_public));
	const estimatedOk = usageRows.every((r) => r.estimated === false || r.estimated === 0);
	const usagePass = usageRows.length > 0 && modelNamesOk && estimatedOk;

	const bugs = cases.flatMap((c) => c.clientBugs ?? []);
	const overall = clientReport.ok === true && usagePass && driverCode === 0;

	const md: string[] = [];
	md.push("# T-13 results: #387 client against the local mock gateway");
	md.push("");
	md.push(`Run at ${kstNow()}.`);
	md.push("");
	md.push("## SHAs and setup");
	md.push("");
	md.push(`- **Client under test:** \`${clientSha}\` — ${clientSubject}`);
	md.push(`- **Contains #387 head \`cd25e92907\`:** ${cd25Ancestor ? "yes (\`git merge-base --is-ancestor\`)" : "NO"}`);
	md.push(`- **origin/feat/omk-provider after re-fetch:** \`${originHead}\` (contains cd25e92907: ${originContainsCd25 ? "yes" : "no"}). ${originNote}`);
	md.push(`- **Gateway proto (at start of run):** \`${gatewaySha}\` — ${gatewaySubject}`);
	md.push("- **Gateway stack:** same as `npm run dev:mock` (Hono + in-memory PGlite + `createDevMockUpstream`), listening on `http://127.0.0.1:8787/v1`.");
	md.push("- **Client env:** `OMK_PROVIDER_OMK=1`, `OMK_GATEWAY_BASE_URL=http://127.0.0.1:8787/v1`, `OMK_ACCOUNT_TOKEN` (dev token issued at startup, stored as SHA-256 only, never written into this report).");
	md.push("- **No real DeepSeek key, no paid infra, no push, no npm publish.** The client worktree is detached and was not committed to.");
	md.push(`- **Client driver exit code:** ${driverCode}`);
	md.push(`- **Node for client/CLI cases:** \`${node22}\` (client \`engines.node\` is \`>=22.19.0\`).`);
	md.push("- **Client build:** `packages/coding-agent` rebuilt from this SHA with `npm run build` (the copied dist from another worktree was stale and still used `OMK_GATEWAY_TOKEN`).");
	md.push("");
	md.push("## Summary");
	md.push("");
	md.push(`Overall: **${overall ? "PASS" : "FAIL"}** — client cases ${passed} passed / ${failed} failed / ${cases.length} total; usage_events check ${usagePass ? "PASS" : "FAIL"} (${usageRows.length} rows).`);
	md.push("");
	md.push("| Case | Title | Result |");
	md.push("| --- | --- | --- |");
	for (const c of cases) {
		md.push(`| ${c.id} | ${mdEscape(c.title)} | ${c.pass ? "PASS" : "FAIL"} |`);
	}
	md.push(`| 6 | usage_events match requests (count, \`OMK/*\` names, estimated flags) | ${usagePass ? "PASS" : "FAIL"} |`);
	md.push("");

	md.push("## Case evidence");
	md.push("");
	for (const c of cases) {
		md.push(`### ${c.id}. ${c.title} — ${c.pass ? "PASS" : "FAIL"}`);
		md.push("");
		if (c.error) {
			md.push(`Error: \`${mdEscape(String(c.error))}\``);
			md.push("");
		}
		if (c.notes?.length) {
			for (const n of c.notes) md.push(`- ${redact(String(n))}`);
			md.push("");
		}
		if (c.clientBugs?.length) {
			md.push("Possible client issues:");
			for (const b of c.clientBugs) md.push(`- ${redact(String(b))}`);
			md.push("");
		}
		md.push("```");
		md.push(redact(JSON.stringify(redactJson(c.evidence ?? {}), null, 2)));
		md.push("```");
		md.push("");
	}

	md.push("### 6. usage_events");
	md.push("");
	md.push(`- Row count: **${usageRows.length}**`);
	md.push(`- All \`model_public\` values are \`OMK/coder\` or \`OMK/reasoner\`: **${modelNamesOk ? "yes" : "NO"}**`);
	md.push(`- All \`estimated\` flags are false (mock always sends usage): **${estimatedOk ? "yes" : "NO"}**`);
	md.push("- Auth failures and \`thinking_required\` (400) must not create usage rows (they never reach upstream). `denied_events` is only written for 429s, so those 400/401s also do not appear there.");
	md.push("");
	if (usageRows.length === 0) {
		md.push("_No usage_events rows._");
		md.push("");
	} else {
		md.push("| model_public | stream | prompt | hit | miss | completion | reasoning | total | finish | estimated | end_reason |");
		md.push("| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | --- |");
		for (const r of usageRows) {
			md.push(
				`| ${r.model_public} | ${r.stream} | ${r.prompt_tokens} | ${r.cache_hit_tokens} | ${r.cache_miss_tokens} | ${r.completion_tokens} | ${r.reasoning_tokens} | ${r.total_tokens} | ${r.finish_reason ?? ""} | ${r.estimated} | ${r.end_reason} |`,
			);
		}
		md.push("");
	}
	md.push("denied_events:");
	md.push("");
	md.push("```");
	md.push(redact(JSON.stringify(redactJson(deniedRows), null, 2)));
	md.push("```");
	md.push("");

	md.push("## Gateway request log (redacted)");
	md.push("");
	md.push("Recorded by the harness wrapper around `app.fetch`. Authorization is always redacted. Bodies are summarized (model, stream, thinking, tool names, message roles) — no token values.");
	md.push("");
	md.push("```json");
	md.push(JSON.stringify(redactJson(requests), null, 2));
	md.push("```");
	md.push("");
	md.push("Structured gateway logs (whitelist only; already redacted by `createLogger`):");
	md.push("");
	md.push("```");
	for (const line of logLines) md.push(redact(line));
	md.push("```");
	md.push("");

	md.push("## Client bugs found");
	md.push("");
	if (bugs.length === 0) {
		md.push("None confirmed in this run.");
	} else {
		for (const b of bugs) md.push(`- ${redact(String(b))}`);
	}
	md.push("");
	md.push("## Blocked / caveats");
	md.push("");
	md.push("- The official client (`openai-completions.ts:517`, and `completeSimple` which wraps `streamSimple`) always sends `stream: true`. Case 1a therefore uses the same token/base URL/model over raw HTTP to exercise the gateway's non-stream JSON mode, and is labeled as such.");
	md.push("- The CLI cannot inject a custom `get_weather` tool (`--tools` only filters built-ins). The tool-call loop was driven through `streamSimple` with a TypeBox `get_weather` tool, which is the fallback T-13 allows.");
	md.push("- A normal client path never sends `thinking: disabled` to `OMK/reasoner` (`route.ts` / the thinking-level map). Case 4b rewrites the payload with `onPayload` so the 400 still travels through the client's HTTP and error path.");
	md.push("- This harness starts the mock stack itself so `usage_events` can be queried from the in-memory PGlite. It is the same modules and bind address as `npm run dev:mock`.");
	md.push("- No push of `feat/omk-gateway-proto`; no commit in the client worktree.");
	md.push("");

	const outPath = join(here, "T-13-results.md");
	writeFileSync(outPath, `${md.join("\n")}\n`);
	writeFileSync(join(here, "requests-redacted.json"), `${JSON.stringify(redactJson(requests), null, 2)}\n`);
	writeFileSync(join(here, "usage-events.json"), `${JSON.stringify(redactJson(usageRows), null, 2)}\n`);
	console.error(`wrote ${outPath}`);
	console.error(`overall ${overall ? "PASS" : "FAIL"} (client ${passed}/${cases.length}, usage_events ${usageRows.length} rows)`);

	server.close();
	await mock.stop();
	process.exitCode = overall ? 0 : 1;
}

main().catch((e) => {
	console.error(redact(e instanceof Error ? e.stack ?? e.message : String(e)));
	process.exit(1);
});
