import { mkdtempSync, rmSync } from "node:fs";
import net, { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEventBus } from "../src/core/event-bus.ts";
import {
	createHerdrAgentStateExtension,
	wrapHerdrBlockedUI,
} from "../src/core/extensions/builtin/herdr-agent-state.ts";
import { createExtensionRuntime, loadExtensionFromFactory } from "../src/core/extensions/loader.ts";
import type { Extension, ExtensionContext, ExtensionUIContext } from "../src/core/extensions/types.ts";
import { buildHerdrResumeArgv, resolveHerdrConfig } from "../src/core/herdr-client.ts";

interface RecordedRequest {
	id: string;
	method: string;
	params: Record<string, unknown>;
}

async function startMockSocketServer(
	socketPath: string,
	options: { failFirst?: boolean; delayMs?: number } = {},
): Promise<{ server: Server; requests: RecordedRequest[]; close: () => Promise<void>; connections: () => number }> {
	const requests: RecordedRequest[] = [];
	let connectionCount = 0;

	const server = createServer((socket) => {
		connectionCount += 1;
		const attempt = connectionCount;
		let buffer = "";
		socket.on("data", (chunk) => {
			buffer += chunk.toString("utf8");
			const lines = buffer.split("\n");
			buffer = lines.pop() ?? "";
			for (const line of lines) {
				if (!line.trim()) continue;
				const parsed = JSON.parse(line) as RecordedRequest;
				requests.push(parsed);
				if (options.failFirst && attempt === 1) {
					socket.destroy();
					return;
				}
				const reply = () => {
					if (!socket.destroyed) socket.end('{"ok":true}\n');
				};
				if (options.delayMs && options.delayMs > 0) {
					setTimeout(reply, options.delayMs);
				} else {
					reply();
				}
			}
		});
	});

	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(socketPath, resolve);
	});

	return {
		server,
		requests,
		connections: () => connectionCount,
		close: () =>
			new Promise<void>((resolve, reject) => {
				server.close((error) => (error ? reject(error) : resolve()));
			}),
	};
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (predicate()) return;
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	expect(predicate()).toBe(true);
}

function makeContext(
	overrides: { mode?: "tui" | "rpc" | "print"; isIdle?: () => boolean; sessionFile?: string; sessionId?: string } = {},
): ExtensionContext {
	return {
		mode: overrides.mode ?? "tui",
		hasUI: (overrides.mode ?? "tui") === "tui",
		isIdle: overrides.isIdle ?? (() => true),
		sessionManager: {
			getSessionFile: () => overrides.sessionFile,
			getSessionId: () => overrides.sessionId ?? "sess-default",
		},
	} as unknown as ExtensionContext;
}

async function emit(extension: Extension, eventType: string, event: Record<string, unknown>, ctx: ExtensionContext) {
	const handlers = extension.handlers.get(eventType) ?? [];
	for (const handler of handlers) {
		await handler(event as never, ctx);
	}
}

describe("herdr client boundary rules", () => {
	it("returns undefined unless HERDR_ENV=1, HERDR_PANE_ID, and HERDR_SOCKET_PATH are all set", () => {
		expect(resolveHerdrConfig({})).toBeUndefined();
		expect(
			resolveHerdrConfig({ HERDR_ENV: "0", HERDR_PANE_ID: "w1:p1", HERDR_SOCKET_PATH: "/tmp/h.sock" }),
		).toBeUndefined();
		expect(resolveHerdrConfig({ HERDR_ENV: "1", HERDR_PANE_ID: "w1:p1" })).toBeUndefined();
		expect(resolveHerdrConfig({ HERDR_ENV: "1", HERDR_SOCKET_PATH: "/tmp/h.sock" })).toBeUndefined();
		expect(
			resolveHerdrConfig({ HERDR_ENV: "1", HERDR_PANE_ID: "w1:p1", HERDR_SOCKET_PATH: "herdr-pipe" }, "win32"),
		).toEqual({
			paneId: "w1:p1",
			socketEndpoint: "\\\\.\\pipe\\herdr-pipe",
		});
	});

	it("builds resume_argv only for safe persistent session paths", () => {
		expect(buildHerdrResumeArgv({ agent_session_path: "/tmp/omk/s1.jsonl" })).toEqual([
			"omk",
			"--session",
			"/tmp/omk/s1.jsonl",
		]);
		expect(buildHerdrResumeArgv({ agent_session_id: "mem-only" })).toBeUndefined();
		expect(buildHerdrResumeArgv({ agent_session_path: "/tmp/it's-quoted/s1.jsonl" })).toBeUndefined();
		expect(buildHerdrResumeArgv({ agent_session_path: "/tmp/bad\npath/s1.jsonl" })).toBeUndefined();
	});
});

describe("builtin herdr-agent-state extension", () => {
	let tempDir: string;
	let socketPath: string;
	let closeServer: (() => Promise<void>) | undefined;

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "omk-herdr-"));
		socketPath = join(tempDir, "herdr.sock");
	});

	afterEach(async () => {
		vi.unstubAllEnvs();
		if (closeServer) {
			await closeServer();
			closeServer = undefined;
		}
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("registers no handlers and makes no socket connections outside Herdr", async () => {
		vi.stubEnv("HERDR_ENV", "");
		vi.stubEnv("HERDR_PANE_ID", "");
		vi.stubEnv("HERDR_SOCKET_PATH", "");
		const connectSpy = vi.spyOn(net, "createConnection");
		const extension = await loadExtensionFromFactory(
			createHerdrAgentStateExtension(),
			tempDir,
			createEventBus(),
			createExtensionRuntime(),
			"<builtin:herdr-agent-state>",
		);
		expect(extension.handlers.size).toBe(0);
		expect(connectSpy).not.toHaveBeenCalled();
		connectSpy.mockRestore();
	});

	it("reports lifecycle states, resume_argv, blocked labels, and quit-only release over a real socket", async () => {
		const mock = await startMockSocketServer(socketPath);
		closeServer = mock.close;
		vi.stubEnv("HERDR_ENV", "1");
		vi.stubEnv("HERDR_PANE_ID", "w1:p2");
		vi.stubEnv("HERDR_SOCKET_PATH", socketPath);

		const bus = createEventBus();
		const extension = await loadExtensionFromFactory(
			createHerdrAgentStateExtension(),
			tempDir,
			bus,
			createExtensionRuntime(),
			"<builtin:herdr-agent-state>",
		);

		// Non-TUI modes stay silent.
		await emit(
			extension,
			"session_start",
			{ type: "session_start", reason: "startup" },
			makeContext({ mode: "rpc" }),
		);
		expect(mock.requests).toEqual([]);

		let idle = true;
		const sessionFile = join(tempDir, "session-1.jsonl");
		const ctx = makeContext({ mode: "tui", isIdle: () => idle, sessionFile, sessionId: "sess-1" });

		await emit(extension, "session_start", { type: "session_start", reason: "startup" }, ctx);
		await waitFor(() => mock.requests.some((r) => r.method === "pane.report_agent_session"));

		const firstState = mock.requests.find((r) => r.method === "pane.report_agent");
		expect(firstState?.params).toMatchObject({
			pane_id: "w1:p2",
			source: "omk",
			agent: "omk",
			state: "idle",
			agent_session_path: sessionFile,
			resume_argv: ["omk", "--session", sessionFile],
		});
		const sessionReport = mock.requests.find((r) => r.method === "pane.report_agent_session");
		expect(sessionReport?.params).toMatchObject({
			pane_id: "w1:p2",
			source: "omk",
			agent: "omk",
			session_start_source: "startup",
			agent_session_path: sessionFile,
			resume_argv: ["omk", "--session", sessionFile],
		});

		idle = false;
		await emit(extension, "agent_start", { type: "agent_start" }, ctx);
		await waitFor(() => mock.requests.some((r) => r.method === "pane.report_agent" && r.params.state === "working"));

		bus.emit("herdr:blocked", { active: true, label: "Approve command?" });
		await waitFor(() => mock.requests.some((r) => r.method === "pane.report_agent" && r.params.state === "blocked"));
		const blockedReq = mock.requests.find((r) => r.method === "pane.report_agent" && r.params.state === "blocked");
		expect(blockedReq?.params.message).toBe("Approve command?");

		bus.emit("herdr:blocked", { active: false });
		await waitFor(() => {
			const states = mock.requests.filter((r) => r.method === "pane.report_agent").map((r) => r.params.state);
			return states.at(-1) === "working";
		});

		idle = true;
		await emit(extension, "agent_settled", { type: "agent_settled", messages: [], aborted: false }, ctx);
		await waitFor(() => {
			const states = mock.requests.filter((r) => r.method === "pane.report_agent").map((r) => r.params.state);
			return states.at(-1) === "idle";
		});

		// Reload or session replacement must NOT release the pane.
		await emit(extension, "session_shutdown", { type: "session_shutdown", reason: "reload" }, ctx);
		expect(mock.requests.some((r) => r.method === "pane.release_agent")).toBe(false);

		// Quit MUST release the pane.
		await emit(extension, "session_shutdown", { type: "session_shutdown", reason: "quit" }, ctx);
		await waitFor(() => mock.requests.some((r) => r.method === "pane.release_agent"));
		const releaseReq = mock.requests.find((r) => r.method === "pane.release_agent");
		expect(releaseReq?.params).toMatchObject({
			pane_id: "w1:p2",
			source: "omk",
			agent: "omk",
		});

		// Sequence numbers are strictly increasing across all reports.
		const seqs = mock.requests.map((r) => Number(r.params.seq));
		for (let i = 1; i < seqs.length; i += 1) {
			expect(seqs[i]).toBeGreaterThan(seqs[i - 1]);
		}
	});

	it("retries once on socket failure and coalesces superseded states while in flight", async () => {
		const mock = await startMockSocketServer(socketPath, { failFirst: true, delayMs: 40 });
		closeServer = mock.close;
		vi.stubEnv("HERDR_ENV", "1");
		vi.stubEnv("HERDR_PANE_ID", "w1:p3");
		vi.stubEnv("HERDR_SOCKET_PATH", socketPath);

		const bus = createEventBus();
		const extension = await loadExtensionFromFactory(
			createHerdrAgentStateExtension(),
			tempDir,
			bus,
			createExtensionRuntime(),
			"<builtin:herdr-agent-state>",
		);

		let idle = true;
		const ctx = makeContext({ mode: "tui", isIdle: () => idle });
		await emit(extension, "session_start", { type: "session_start", reason: "startup" }, ctx);

		// Burst transitions while the first request is in flight.
		idle = false;
		await emit(extension, "agent_start", { type: "agent_start" }, ctx);
		bus.emit("herdr:blocked", { active: true, label: "first" });
		bus.emit("herdr:blocked", { active: false });
		idle = true;
		await emit(extension, "agent_settled", { type: "agent_settled", messages: [], aborted: false }, ctx);

		await waitFor(() => {
			const states = mock.requests.filter((r) => r.method === "pane.report_agent").map((r) => r.params.state);
			return mock.connections() >= 2 && states.at(-1) === "idle";
		}, 3000);

		const states = mock.requests.filter((r) => r.method === "pane.report_agent").map((r) => r.params.state);
		expect(states.at(-1)).toBe("idle");
		expect(states).not.toContain("blocked");
	});

	it("wrapHerdrBlockedUI emits paired herdr:blocked events and skips aborted calls", async () => {
		const bus = createEventBus();
		const events: unknown[] = [];
		bus.on("herdr:blocked", (payload) => events.push(payload));

		const baseUI = {
			select: async () => "Yes",
			confirm: async () => true,
			input: async () => "ok",
			editor: async () => "edited",
			custom: async () => {
				throw new Error("boom");
			},
		} as unknown as ExtensionUIContext;

		const wrapped = wrapHerdrBlockedUI(baseUI, bus, "tui")!;
		expect(await wrapped.select("Pick one\nDetails", ["Yes"])).toBe("Yes");
		const aborted = new AbortController();
		aborted.abort();
		await wrapped.confirm("Ignored", "msg", { signal: aborted.signal });
		await expect(wrapped.custom((() => ({})) as never)).rejects.toThrow("boom");

		expect(events).toEqual([
			{ active: true, label: "Pick one" },
			{ active: false },
			{ active: true, label: undefined },
			{ active: false },
		]);
	});
});
