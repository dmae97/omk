import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "../../src/app.ts";
import { issueKey } from "../../src/admin.ts";
import { loadConfig, type GatewayConfig } from "../../src/config.ts";
import { openDb, openPostgres, type Db } from "../../src/db.ts";
import { createLogger } from "../../src/logger.ts";
import { MockUpstream, UPSTREAM_SENTINEL_KEY } from "./mock-upstream.ts";

export const gatewayRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const realConfigDir = join(gatewayRoot, "config");

export type Res = Omit<Response, "json"> & { json(): Promise<any> };

export interface Harness {
	app: ReturnType<typeof createApp>;
	db: Db;
	mock: MockUpstream;
	config: GatewayConfig;
	logs: string[];
	clock: { now: Date };
	mono: { ms: number };
	users: Record<string, { token: string; keyId: string; userId: string }>;
	configDir: string;
	close(): Promise<void>;
	call(path: string, init: { method?: string; token?: string | null; body?: unknown; headers?: Record<string, string> }): Promise<Res>;
	chat(token: string | null, body: unknown): Promise<Res>;
}

/** Copies the real config to a temp dir so a test can edit the files the way an operator would. */
export function tempConfig(edit?: (dir: string) => void): string {
	const dir = mkdtempSync(join(tmpdir(), "omk-gw-cfg-"));
	cpSync(realConfigDir, dir, { recursive: true });
	edit?.(dir);
	return dir;
}

export function editJson(dir: string, name: string, fn: (o: any) => void): void {
	const p = join(dir, name);
	const o = JSON.parse(readFileSync(p, "utf8"));
	fn(o);
	writeFileSync(p, JSON.stringify(o, null, 2));
}

export async function makeHarness(opts: { configDir?: string; start?: string; upstreamKey?: string | null; databaseUrl?: string } = {}): Promise<Harness> {
	const configDir = opts.configDir ?? realConfigDir;
	const config = loadConfig(configDir);
	const mock = new MockUpstream();
	await mock.start();
	const db = opts.databaseUrl ? await openPostgres(opts.databaseUrl) : await openDb();
	const logs: string[] = [];
	const clock = { now: new Date(opts.start ?? "2026-11-11T14:00:00+09:00") };
	const mono = { ms: 1_000_000 };
	const app = createApp({
		config,
		db,
		upstreamApiKey: opts.upstreamKey === undefined ? UPSTREAM_SENTINEL_KEY : opts.upstreamKey,
		upstreamBaseUrl: mock.url,
		now: () => new Date(clock.now),
		monotonic: () => mono.ms,
		log: createLogger((l) => logs.push(l)),
	});
	const users: Harness["users"] = {};
	users.plain = await issueKey(db, { label: "plain", plan: "A", now: clock.now });
	users.maxeffort = await issueKey(db, { label: "maxeffort", plan: "B", allowMaxEffort: true, now: clock.now });
	const call: Harness["call"] = (path, init) => {
		const headers: Record<string, string> = { ...(init.headers ?? {}) };
		if (init.token) headers.authorization = `Bearer ${init.token}`;
		if (init.body !== undefined) headers["content-type"] = "application/json";
		return Promise.resolve<Res>(app.request(path, { method: init.method ?? "GET", headers, body: init.body === undefined ? undefined : typeof init.body === "string" ? init.body : JSON.stringify(init.body) }));
	};
	return {
		app,
		db,
		mock,
		config,
		logs,
		clock,
		mono,
		users,
		configDir,
		close: async () => {
			await mock.stop();
			await db.close();
		},
		call,
		chat: (token, body) => call("/v1/chat/completions", { method: "POST", token, body }),
	};
}

export function okJson(model: string, usage: unknown, extra: Record<string, unknown> = {}) {
	return {
		kind: "json" as const,
		body: {
			id: "chatcmpl-x",
			object: "chat.completion",
			model,
			choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
			usage,
			...extra,
		},
	};
}

export const U = (hit: number, miss: number, comp: number, reasoning = 0) => ({
	prompt_tokens: hit + miss,
	completion_tokens: comp,
	total_tokens: hit + miss + comp,
	prompt_cache_hit_tokens: hit,
	prompt_cache_miss_tokens: miss,
	prompt_tokens_details: { cached_tokens: hit },
	completion_tokens_details: { reasoning_tokens: reasoning },
});

export const msg = (t = "hi") => [{ role: "user", content: t }];
