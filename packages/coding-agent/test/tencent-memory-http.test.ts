import { once } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createEventBus } from "../src/core/event-bus.ts";
import { createTencentMemoryExtension } from "../src/core/extensions/builtin/tencent-memory.ts";
import { createExtensionRuntime, loadExtensionFromFactory } from "../src/core/extensions/loader.ts";
import type { ExtensionContext } from "../src/core/extensions/types.ts";

let root: string;
let server: Server;
let mode: "normal" | "redirect" | "hang" | "body-hang" | "invalid" = "normal";
let calls: {
	url: string;
	authorization: string | undefined;
	service: string | string[] | undefined;
	body: Record<string, unknown>;
}[];
let memories: string[];
let execute: (args: Record<string, unknown>, signal?: AbortSignal) => Promise<unknown>;

beforeEach(async () => {
	vi.stubEnv("OMK_OFFLINE", "0");
	vi.stubEnv("TENCENTDB_MEMORY_API_KEY", "loopback-key-not-real");
	root = mkdtempSync(join(tmpdir(), "omk-tencent-http-"));
	mode = "normal";
	calls = [];
	memories = [];
	server = createServer(async (req, res) => {
		const chunks: Buffer[] = [];
		for await (const chunk of req) chunks.push(Buffer.from(chunk));
		const body = JSON.parse(Buffer.concat(chunks).toString());
		calls.push({
			url: req.url!,
			authorization: req.headers.authorization,
			service: req.headers["x-tdai-service-id"],
			body,
		});
		if (mode === "hang") return;
		if (mode === "body-hang") {
			res.writeHead(200);
			res.write('{"code":0,');
			return;
		}
		if (mode === "redirect") {
			res.writeHead(307, { Location: "/redirect-target" });
			res.end();
			return;
		}
		if (mode === "invalid") {
			res.end("not JSON loopback-key-not-real");
			return;
		}
		let data: unknown;
		if (req.url === "/v3/conversation/add") {
			const messages = body.messages as { content: string }[];
			memories.push(messages[0].content);
			data = { accepted_ids: ["fixture-1"], total_count: 1 };
		} else {
			data = { items: memories.map((content) => ({ id: "fixture-1", content })) };
		}
		res.setHeader("Content-Type", "application/json");
		res.end(JSON.stringify({ code: 0, message: "ok", request_id: "fixture", data }));
	});
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	writeFileSync(
		join(root, "tencent-memory.json"),
		JSON.stringify({
			endpoint: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
			serviceId: "svc",
			teamId: "team",
			userId: "user",
			agentId: "agent",
			allowWrites: true,
			timeoutMs: 200,
		}),
	);
	const loaded = await loadExtensionFromFactory(
		createTencentMemoryExtension(root),
		root,
		createEventBus(),
		createExtensionRuntime(),
	);
	const ctx = { sessionManager: { getSessionId: () => "omk-session" } } as unknown as ExtensionContext;
	execute = (args, signal) =>
		loaded.tools.get("tencent_memory")!.definition.execute("call", args, signal, undefined, ctx);
});

afterEach(async () => {
	server.closeAllConnections();
	await new Promise<void>((resolve) => server.close(() => resolve()));
	rmSync(root, { recursive: true, force: true });
	vi.unstubAllEnvs();
});

it("round-trips explicit memory through real HTTP without sending session history", async () => {
	await execute({ action: "remember", text: "The fixture uses pnpm" });
	const result = await execute({ action: "search", query: "pnpm" });
	expect(result).toMatchObject({ details: { data: { items: [{ content: "The fixture uses pnpm" }] } } });
	expect(calls).toHaveLength(2);
	expect(calls[0]).toMatchObject({
		url: "/v3/conversation/add",
		authorization: "Bearer loopback-key-not-real",
		service: "svc",
		body: {
			team_id: "team",
			agent_id: "agent",
			user_id: "user",
			session_id: "omk-session",
			messages: [{ role: "user", content: "The fixture uses pnpm" }],
		},
	});
	expect(calls[1].url).toBe("/v3/atomic/search");
});

it("refuses redirects without sending credentials to a second URL", async () => {
	mode = "redirect";
	await expect(execute({ action: "search", query: "q" })).rejects.toThrow("request failed");
	expect(calls).toHaveLength(1);
});

it.each(["hang", "body-hang"] as const)("times out %s without a retry", async (value) => {
	mode = value;
	await expect(execute({ action: "remember", text: "fixture" })).rejects.toThrow("timed out");
	expect(calls).toHaveLength(1);
});

it("honors cancellation during an HTTP request", async () => {
	mode = "hang";
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 50);
	try {
		await expect(execute({ action: "search", query: "q" }, controller.signal)).rejects.toThrow("cancelled");
	} finally {
		clearTimeout(timer);
	}
	expect(calls).toHaveLength(1);
});

it("does not reflect response bodies on parse failure", async () => {
	mode = "invalid";
	await expect(execute({ action: "search", query: "q" })).rejects.toThrow("invalid JSON envelope");
});

it.each(["normal", "invalid"] as const)("releases the caller abort listener after %s completion", async (value) => {
	mode = value;
	const controller = new AbortController();
	const add = vi.spyOn(controller.signal, "addEventListener");
	const remove = vi.spyOn(controller.signal, "removeEventListener");
	try {
		const result = execute({ action: "search", query: "q" }, controller.signal);
		if (value === "invalid") await expect(result).rejects.toThrow("invalid JSON envelope");
		else await result;
		expect(add).toHaveBeenCalledWith("abort", expect.any(Function), { once: true });
		const listener = add.mock.calls.find(([event]) => event === "abort")?.[1];
		expect(remove).toHaveBeenCalledWith("abort", listener);
	} finally {
		add.mockRestore();
		remove.mockRestore();
	}
});
