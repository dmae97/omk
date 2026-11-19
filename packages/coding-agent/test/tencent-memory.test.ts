import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Extension, ExtensionContext } from "../src/core/extensions/types.ts";
import { DefaultResourceLoader } from "../src/core/resource-loader.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";

let root: string;
let extension: Extension;
const config = {
	endpoint: "https://memory.example.com",
	serviceId: "service-test",
	teamId: "team-test",
	agentId: "agent-test",
	userId: "user-test",
	apiKeyEnv: "OMK_TEST_MEMORY_KEY",
};
const context = { sessionManager: { getSessionId: () => "session-test" } } as unknown as ExtensionContext;

beforeEach(async () => {
	root = mkdtempSync(join(tmpdir(), "omk-tencent-memory-"));
	vi.stubEnv("OMK_OFFLINE", "0");
	vi.stubEnv("OMK_TENCENT_MEMORY", "1");
	vi.stubEnv("OMK_TEST_MEMORY_KEY", "test-secret-not-real");
	const loader = new DefaultResourceLoader({
		cwd: root,
		agentDir: root,
		settingsManager: SettingsManager.inMemory(),
		noSkills: true,
		noContextFiles: true,
	});
	await loader.reload();
	const found = loader.getExtensions().extensions.find((entry) => entry.path === "<builtin:tencent-memory>");
	expect(found, "TencentDB memory must be a built-in, not a user plugin").toBeDefined();
	extension = found!;
});

afterEach(() => {
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
	rmSync(root, { recursive: true, force: true });
});

function configure(overrides = {}) {
	writeFileSync(join(root, "tencent-memory.json"), JSON.stringify({ ...config, ...overrides }));
}
function execute(args: Record<string, unknown>, signal?: AbortSignal) {
	return extension.tools.get("tencent_memory")!.definition.execute("test", args, signal, undefined, context);
}
function envelope(data: unknown, code = 0) {
	return new Response(JSON.stringify({ code, message: "ok", request_id: "req-test", data }));
}

it("is inert until configured and has no automatic capture hooks", async () => {
	const fetch = vi.fn();
	vi.stubGlobal("fetch", fetch);
	expect(extension.handlers.size).toBe(0);
	expect(extension.tools.size).toBe(1);
	const result = await execute({ action: "status" });
	expect(result.details).toMatchObject({ configured: false, automaticCapture: false });
	await expect(execute({ action: "search", query: "topic" })).rejects.toThrow("tencent-memory.json");
	expect(fetch).not.toHaveBeenCalled();
});

it("reports local setup without reading secrets into the result or testing a remote connection", async () => {
	configure();
	const fetch = vi.fn();
	vi.stubGlobal("fetch", fetch);
	const result = await execute({ action: "status" });
	expect(result.details).toMatchObject({ configured: true, credentialAvailable: true, allowWrites: false });
	expect(JSON.stringify(result)).not.toContain("test-secret-not-real");
	expect(fetch).not.toHaveBeenCalled();
});

it("uses fixed operator identity and the documented v3 search envelope", async () => {
	configure();
	const fetch = vi.fn().mockResolvedValue(envelope({ items: [{ id: "fact1", content: "fixture memory" }] }));
	vi.stubGlobal("fetch", fetch);
	const result = await execute({ action: "search", query: "topic" });
	const [url, init] = fetch.mock.calls[0];
	expect(url).toBe("https://memory.example.com/v3/atomic/search");
	expect(init).toMatchObject({ method: "POST", redirect: "error" });
	expect(init.headers).toMatchObject({
		Authorization: "Bearer test-secret-not-real",
		"x-tdai-service-id": "service-test",
	});
	expect(JSON.parse(init.body)).toEqual({
		query: "topic",
		limit: 5,
		team_id: "team-test",
		user_id: "user-test",
		agent_id: "agent-test",
	});
	expect(result.details).toMatchObject({ untrusted: true, data: { items: [{ id: "fact1" }] } });
	await expect(execute({ action: "search", query: "topic", team_id: "another-team" })).rejects.toThrow();
	expect(fetch).toHaveBeenCalledTimes(1);
});

it("guards explicit writes and sends only the supplied memory, never the transcript", async () => {
	configure();
	const fetch = vi.fn().mockResolvedValue(envelope({ accepted_ids: ["one"], total_count: 1 }));
	vi.stubGlobal("fetch", fetch);
	await expect(execute({ action: "remember", text: "Use pnpm" })).rejects.toThrow("allowWrites");
	expect(fetch).not.toHaveBeenCalled();
	configure({ allowWrites: true });
	const result = await execute({ action: "remember", text: "Use pnpm" });
	expect(fetch.mock.calls[0][0]).toBe("https://memory.example.com/v3/conversation/add");
	expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({
		session_id: "session-test",
		messages: [{ role: "user", content: "Use pnpm" }],
	});
	expect(result.details).toMatchObject({ extraction: "asynchronous; acceptance is not extraction completion" });
});

it.each([
	"http://remote.example",
	"https://user:pass@memory.example",
	"https://memory.example?key=x",
	"https://memory.example/#x",
])("rejects unsafe endpoint %s", async (endpoint) => {
	configure({ endpoint });
	vi.stubGlobal("fetch", vi.fn());
	await expect(execute({ action: "search", query: "x" })).rejects.toThrow();
	expect(fetch).not.toHaveBeenCalled();
});

it("blocks offline calls and aborts before sending", async () => {
	configure();
	const fetch = vi.fn();
	vi.stubGlobal("fetch", fetch);
	vi.stubEnv("OMK_OFFLINE", "1");
	await expect(execute({ action: "search", query: "x" })).rejects.toThrow("offline");
	vi.stubEnv("OMK_OFFLINE", "0");
	await expect(execute({ action: "search", query: "x" }, AbortSignal.abort())).rejects.toThrow();
	expect(fetch).not.toHaveBeenCalled();
});

it("handles core and scenario reads without exposing a write or delete API", async () => {
	configure();
	const fetch = vi.fn().mockImplementation(async () => envelope({ content: null }));
	vi.stubGlobal("fetch", fetch);
	await execute({ action: "read" });
	await execute({ action: "read", layer: "scenario", path: "project/context.md" });
	expect(fetch.mock.calls.map((call) => call[0])).toEqual([
		"https://memory.example.com/v3/core/read",
		"https://memory.example.com/v3/scenario/read",
	]);
	await expect(execute({ action: "read", layer: "scenario", path: "../secret" })).rejects.toThrow();
	await expect(execute({ action: "delete" })).rejects.toThrow();
	expect(fetch).toHaveBeenCalledTimes(2);
});

it("does not retry or echo server errors, invalid envelopes, or credentials", async () => {
	configure();
	const fetch = vi.fn().mockResolvedValue(new Response("test-secret-not-real", { status: 401 }));
	vi.stubGlobal("fetch", fetch);
	await expect(execute({ action: "search", query: "x" })).rejects.toThrow("HTTP 401");
	fetch.mockResolvedValue(envelope(null, 503));
	await expect(execute({ action: "search", query: "x" })).rejects.toThrow("code 503");
	fetch.mockResolvedValue(new Response("{}"));
	await expect(execute({ action: "search", query: "x" })).rejects.toThrow("envelope");
	fetch.mockResolvedValue(envelope({ content: "test-secret-not-real" }));
	expect(JSON.stringify(await execute({ action: "search", query: "x" }))).not.toContain("test-secret-not-real");
	expect(fetch).toHaveBeenCalledTimes(4);
});

it("caps response bodies and rejects missing identity", async () => {
	configure();
	const fetch = vi.fn().mockResolvedValue(new Response("x".repeat(65_537)));
	vi.stubGlobal("fetch", fetch);
	await expect(execute({ action: "search", query: "x" })).rejects.toThrow("64 KiB");
	configure({ userId: "" });
	await expect(execute({ action: "search", query: "x" })).rejects.toThrow("userId");
	expect(fetch).toHaveBeenCalledTimes(1);
});
