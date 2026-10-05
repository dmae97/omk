/**
 * N09 follow-up: a spent mutating-command budget must not make a running prompt unabortable.
 *
 * The delivered bundle reproduced this boundary as an open defect: after 1024 accepted
 * prompt commands the control server refused abort as well. These tests pin the repaired
 * semantics — a bounded abort ledger handled before the mutating cap, exact binding through
 * an explicit prompt generation, the bounded legacy outstanding-prompt rule, and the known
 * eviction limit of that ledger. Client/token holders stay inside the existing trust boundary.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { requestSessionControl } from "../src/core/session-control-client.ts";
import { readControlEndpoint } from "../src/core/session-control-endpoint.ts";
import { parseControlRequest } from "../src/core/session-control-protocol.ts";
import { CONTROL_ABORT_LEDGER_LIMIT, startSessionControl } from "../src/core/session-control-server.ts";
import { acquireSessionOwnerLeaseSync, type SessionOwnerLease } from "../src/core/session-owner-lease.ts";

interface Fixture {
	readonly root: string;
	readonly file: string;
	readonly counters: { aborts: number };
	readonly lease: SessionOwnerLease;
}

function createFixture(): Fixture {
	const root = mkdtempSync(join(tmpdir(), "omk-abort-window-"));
	const file = join(root, "session.jsonl");
	writeFileSync(file, "");
	// The real owner lease, not a stub: the server verifies ownership on every frame.
	const lease = acquireSessionOwnerLeaseSync(file);
	return { root, file, counters: { aborts: 0 }, lease };
}

function fixtureSession(fixture: Fixture) {
	return {
		sessionFile: fixture.file,
		sessionId: "abort-window-fixture",
		sessionManager: { getOwnerLease: () => fixture.lease },
		isStreaming: false,
		isRetrying: false,
		pendingMessageCount: 0,
		prompt: async (
			_text: string,
			options: {
				expandPromptTemplates: boolean;
				source: "rpc";
				streamingBehavior?: "steer" | "followUp";
				preflightResult: (accepted: boolean) => void;
			},
		) => {
			options.preflightResult(true);
		},
		abort: async () => {
			fixture.counters.aborts += 1;
		},
		abortBash() {},
		abortCompaction() {},
		abortBranchSummary() {},
	};
}

/** Raw frame writer so the test can pin exact request ids and generation payloads. */
async function sendRaw(socketPath: string, frame: Record<string, unknown>): Promise<Record<string, unknown>> {
	return new Promise((resolve, reject) => {
		const socket = createConnection(socketPath);
		let output = "";
		socket.setEncoding("utf8");
		socket.on("error", reject);
		socket.on("data", (data: string) => {
			output += data;
		});
		socket.on("end", () => {
			socket.destroy();
			try {
				resolve(JSON.parse(output.trim()) as Record<string, unknown>);
			} catch {
				reject(new Error(`invalid control reply: ${output}`));
			}
		});
		socket.on("connect", () => socket.write(`${JSON.stringify(frame)}\n`));
	});
}

describe.skipIf(process.platform === "win32")("control abort window", () => {
	const servers: Array<{ close(): Promise<void> }> = [];
	const fixtures: Fixture[] = [];
	afterEach(async () => {
		while (servers.length > 0) await servers.pop()?.close();
		while (fixtures.length > 0) {
			const fixture = fixtures.pop();
			if (!fixture) continue;
			try {
				fixture.lease.release();
			} finally {
				rmSync(fixture.root, { recursive: true, force: true });
			}
		}
	});

	async function start() {
		const fixture = createFixture();
		fixtures.push(fixture);
		const server = await startSessionControl(fixtureSession(fixture));
		servers.push(server);
		return fixture;
	}

	it("still honors abort after the mutating-command budget is exhausted", async () => {
		const fixture = await start();
		for (let index = 0; index < 1024; index += 1)
			expect(
				(await requestSessionControl(fixture.file, "abort-window-fixture", "prompt", "fixture only")).status,
			).toBe("accepted");
		const status = await requestSessionControl(fixture.file, "abort-window-fixture", "status");
		expect(status.state?.generation).toBe(1024);
		const abort = await requestSessionControl(fixture.file, "abort-window-fixture", "abort");
		expect(abort.status).toBe("accepted");
		expect(fixture.counters.aborts).toBe(1);
		// The mutating bound itself is unchanged: only cancellation bypasses it.
		expect((await requestSessionControl(fixture.file, "abort-window-fixture", "prompt", "fixture only")).status).toBe(
			"refused",
		);
	});

	it("binds an explicit generation and refuses a stale one", async () => {
		const fixture = await start();
		await requestSessionControl(fixture.file, "abort-window-fixture", "prompt", "fixture only");
		const generation = (await requestSessionControl(fixture.file, "abort-window-fixture", "status")).state
			?.generation;
		expect(generation).toBe(1);
		const stale = await requestSessionControl(fixture.file, "abort-window-fixture", "abort", undefined, {
			generation: 0,
		});
		expect(stale.status).toBe("refused");
		expect(fixture.counters.aborts).toBe(0);
		const current = await requestSessionControl(fixture.file, "abort-window-fixture", "abort", undefined, {
			generation: 1,
		});
		expect(current.status).toBe("accepted");
		expect(fixture.counters.aborts).toBe(1);
	});

	it("refuses a duplicate abort frame and a legacy abort with no outstanding prompt", async () => {
		const fixture = await start();
		await requestSessionControl(fixture.file, "abort-window-fixture", "prompt", "fixture only");
		const endpoint = readControlEndpoint(fixture.file);
		const frame = {
			version: 1,
			sessionId: endpoint.sessionId,
			token: endpoint.token,
			requestId: "dup-abort-1",
			action: "abort",
		};
		expect((await sendRaw(endpoint.socketPath, frame)).status).toBe("accepted");
		expect((await sendRaw(endpoint.socketPath, frame)).status).toBe("refused");
		expect(fixture.counters.aborts).toBe(1);
		// A fresh frame cannot silently re-abort the prompt the first abort already consumed.
		const legacy = await sendRaw(endpoint.socketPath, { ...frame, requestId: "dup-abort-2" });
		expect(legacy.status).toBe("refused");
		expect(fixture.counters.aborts).toBe(1);
		// A newly admitted prompt is an outstanding target again.
		await requestSessionControl(fixture.file, "abort-window-fixture", "prompt", "fixture only");
		expect((await sendRaw(endpoint.socketPath, { ...frame, requestId: "dup-abort-3" })).status).toBe("accepted");
		expect(fixture.counters.aborts).toBe(2);
	});

	it("honors a legacy abort while work is still streaming, idle-only refusal", async () => {
		const fixture = createFixture();
		fixtures.push(fixture);
		const state = { streaming: true };
		const session = {
			...fixtureSession(fixture),
			get isStreaming() {
				return state.streaming;
			},
		};
		servers.push(await startSessionControl(session));
		const endpoint = readControlEndpoint(fixture.file);
		const frame = (requestId: string) => ({
			version: 1,
			sessionId: endpoint.sessionId,
			token: endpoint.token,
			requestId,
			action: "abort",
		});
		// The first abort consumes generation 0, but the prompt is still draining:
		// a fresh cancellation frame must reach it instead of trusting the ledger.
		expect((await sendRaw(endpoint.socketPath, frame("stream-abort-1"))).status).toBe("accepted");
		expect((await sendRaw(endpoint.socketPath, frame("stream-abort-2"))).status).toBe("accepted");
		expect(fixture.counters.aborts).toBe(2);
		// Once the session is truly idle the same-generation refusal returns.
		state.streaming = false;
		expect((await sendRaw(endpoint.socketPath, frame("stream-abort-3"))).status).toBe("refused");
		expect(fixture.counters.aborts).toBe(2);
		// A locally-started prompt never bumps generation yet stays abortable.
		state.streaming = true;
		expect((await sendRaw(endpoint.socketPath, frame("stream-abort-4"))).status).toBe("accepted");
		expect(fixture.counters.aborts).toBe(3);
	});

	it("documents the bounded ledger: an evicted frame is indistinguishable from a fresh intent", async () => {
		const fixture = await start();
		await requestSessionControl(fixture.file, "abort-window-fixture", "prompt", "fixture only");
		const endpoint = readControlEndpoint(fixture.file);
		const frame = {
			version: 1,
			sessionId: endpoint.sessionId,
			token: endpoint.token,
			requestId: "ledger-first",
			action: "abort",
			generation: 1,
		};
		expect((await sendRaw(endpoint.socketPath, frame)).status).toBe("accepted");
		for (let index = 0; index < CONTROL_ABORT_LEDGER_LIMIT; index += 1) {
			const reply = await sendRaw(endpoint.socketPath, { ...frame, requestId: `ledger-fill-${index}` });
			expect(reply.status).toBe("accepted");
		}
		// The first frame was evicted, so replaying it looks like a new cancellation intent.
		expect((await sendRaw(endpoint.socketPath, frame)).status).toBe("accepted");
	});

	it("parses a generation only on abort frames", () => {
		const base = {
			version: 1,
			sessionId: "abort-window-fixture",
			token: "a".repeat(64),
			requestId: "parse-1",
			action: "abort",
		};
		expect(parseControlRequest({ ...base, generation: 0 }).generation).toBe(0);
		for (const generation of [1.5, -1, "1", null])
			expect(() => parseControlRequest({ ...base, generation })).toThrow("invalid control generation");
		expect(() => parseControlRequest({ ...base, action: "prompt", text: "x", generation: 0 })).toThrow();
		expect(() => parseControlRequest({ ...base, action: "status", generation: 0 })).toThrow();
	});
});
