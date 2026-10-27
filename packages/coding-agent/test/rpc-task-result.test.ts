import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent } from "omk-agent-core";
import { type AssistantMessage, type AssistantMessageEvent, EventStream, getModel } from "omk-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentSession, type AgentSessionEvent } from "../src/core/agent-session.ts";
import type { AgentSessionRuntime } from "../src/core/agent-session-runtime.ts";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { ModelRegistry } from "../src/core/model-registry.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import type { TaskResultEvent } from "../src/core/task-result.ts";
import { formatTaskResultLine } from "../src/core/task-result-format.ts";
import { taskResultStatusLine } from "../src/modes/interactive/task-result-status.ts";
import { runRpcMode } from "../src/modes/rpc/rpc-mode.ts";
import { createTestResourceLoader } from "./utilities.ts";

/**
 * Spec 096 B1 over the wire: runRpcMode end to end with a mock model (no real key).
 * The task_result the session emits is the one RPC writes, and the TUI and print-text
 * line rendered from the wire copy is the same line rendered from the session copy.
 */
const rpcIo = vi.hoisted(() => ({
	outputLines: [] as string[],
	lineHandler: undefined as ((line: string) => void) | undefined,
}));

vi.mock("../src/core/output-guard.js", () => ({
	flushRawStdout: vi.fn(async () => {}),
	takeOverStdout: vi.fn(),
	waitForRawStdoutBackpressure: vi.fn(async () => {}),
	writeRawStdout: (line: string) => {
		rpcIo.outputLines.push(line);
	},
}));
vi.mock("../src/modes/interactive/theme/theme.js", () => ({ theme: { fg: (_c: string, t: string) => t } }));
vi.mock("../src/modes/rpc/jsonl.js", async (importOriginal) => {
	const real = await importOriginal<typeof import("../src/modes/rpc/jsonl.ts")>();
	return {
		...real,
		attachJsonlLineReader: vi.fn((_stream: NodeJS.ReadableStream, onLine: (line: string) => void) => {
			rpcIo.lineHandler = onLine;
			return () => {};
		}),
	};
});

class MockAssistantStream extends EventStream<AssistantMessageEvent, AssistantMessage> {
	constructor() {
		super(
			(event) => event.type === "done" || event.type === "error",
			(event) => {
				if (event.type === "done") return event.message;
				if (event.type === "error") return event.error;
				throw new Error("Unexpected event type");
			},
		);
	}
}

function reply(text: string): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "anthropic-messages",
		provider: "anthropic",
		model: "claude-sonnet-4-5",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

const keep = process.env.OMK_TASK_RESULT;
const cleanups: Array<() => void> = [];
afterEach(() => {
	for (const cleanup of cleanups.splice(0)) cleanup();
	rpcIo.outputLines = [];
	rpcIo.lineHandler = undefined;
	if (keep === undefined) delete process.env.OMK_TASK_RESULT;
	else process.env.OMK_TASK_RESULT = keep;
});

async function rpcRun(flag: string | undefined) {
	if (flag === undefined) delete process.env.OMK_TASK_RESULT;
	else process.env.OMK_TASK_RESULT = flag;
	const tempDir = join(tmpdir(), `omk-rpc-task-result-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(tempDir, { recursive: true });
	const model = getModel("anthropic", "claude-sonnet-4-5");
	if (!model) throw new Error("Test model not found");
	const agent = new Agent({
		getApiKey: () => "fake-test-key",
		initialState: { model, systemPrompt: "Test", tools: [] },
		streamFn: () => {
			const stream = new MockAssistantStream();
			queueMicrotask(() => {
				stream.push({ type: "start", partial: reply("") });
				stream.push({ type: "done", reason: "stop", message: reply("All tests passed.") });
			});
			return stream;
		},
	});
	const authStorage = AuthStorage.create(join(tempDir, "auth.json"));
	authStorage.setRuntimeApiKey("anthropic", "fake-test-key");
	const session = new AgentSession({
		agent,
		sessionManager: SessionManager.inMemory(),
		settingsManager: SettingsManager.create(tempDir, tempDir),
		cwd: tempDir,
		modelRegistry: ModelRegistry.create(authStorage, tempDir),
		resourceLoader: createTestResourceLoader(),
	});
	cleanups.push(() => {
		session.dispose();
		rmSync(tempDir, { recursive: true, force: true });
	});
	const sessionEvents: AgentSessionEvent[] = [];
	session.subscribe((event) => sessionEvents.push(event));
	const runtimeHost = {
		session,
		newSession: vi.fn(async () => ({ cancelled: true })),
		switchSession: vi.fn(async () => ({ cancelled: true })),
		fork: vi.fn(async () => ({ cancelled: true, selectedText: "" })),
		dispose: vi.fn(async () => {}),
		setRebindSession: vi.fn(),
	} as unknown as AgentSessionRuntime;
	rpcIo.outputLines = [];
	rpcIo.lineHandler = undefined;
	void runRpcMode(runtimeHost);
	await vi.waitFor(() => expect(rpcIo.lineHandler).toBeDefined());
	const send = rpcIo.lineHandler as ((line: string) => void) | undefined;
	send?.(JSON.stringify({ id: "t1", type: "prompt", message: "run the tests" }));
	await vi.waitFor(() => expect(sessionEvents.some((e) => e.type === "prompt_settled")).toBe(true));
	await new Promise((resolve) => setTimeout(resolve, 0));
	const wire = rpcIo.outputLines
		.flatMap((line) => line.split("\n"))
		.filter((line) => line.trim().length > 0)
		.map((line) => JSON.parse(line) as { type: string });
	return { wire, sessionEvents };
}

describe("RPC mode end to end (spec 096 B1)", () => {
	it("flag off: no task_result goes out over the wire", async () => {
		const { wire } = await rpcRun(undefined);
		expect(wire.some((r) => r.type === "prompt_settled")).toBe(true);
		expect(wire.some((r) => r.type === "task_result")).toBe(false);
	});

	it("flag on: the wire carries the session's task_result right after prompt_settled", async () => {
		const { wire, sessionEvents } = await rpcRun("1");
		const types = wire.map((r) => r.type);
		expect(types.filter((t) => t === "task_result")).toHaveLength(1);
		expect(types[types.indexOf("prompt_settled") + 1]).toBe("task_result");
		const onWire = wire.find((r) => r.type === "task_result") as TaskResultEvent;
		const inSession = sessionEvents.find((e) => e.type === "task_result") as TaskResultEvent;
		expect(onWire).toEqual(inSession);
		expect(onWire.projection.check).toBe("none");
		expect(onWire.projection.modelClaims).toEqual([
			{ source: "model_text", says: "passed", text: "All tests passed." },
		]);
		// TUI (task-result-status) and print text render the same line from the wire copy.
		expect(taskResultStatusLine(onWire)).toBe(formatTaskResultLine(inSession.projection));
	});

	it("flag on vs off: the wire differs only by the task_result line", async () => {
		const off = (await rpcRun(undefined)).wire.map((r) => r.type);
		const on = (await rpcRun("1")).wire.map((r) => r.type);
		expect(on.filter((t) => t !== "task_result")).toEqual(off);
	});
});
