import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StreamFn } from "omk-agent-core";
import { type AssistantMessage, createAssistantMessageEventStream, type Model, type Usage } from "omk-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createResponseReasoningCapStreamFn,
	type ResponseReasoningCapConfig,
	resolveResponseReasoningCapConfig,
} from "../src/core/response-reasoning-cap.ts";
import { logReasoningCapRetry } from "../src/core/response-reasoning-cap-run-log.ts";
import { RUN_LOG_DIR_ENV } from "../src/core/run-log.ts";

// spec 033 → spec 042: the cap's events in <OMK_RUN_LOG_DIR>/reasoning-cap.jsonl.
const SECRET = "SENTINEL_9f3c";
const model = { id: "grok-4.7", api: "openai-completions", provider: "xai" } as unknown as Model<"openai-completions">;
const chunk = `${SECRET} ${"x".repeat(200)}`; // > 50 estimated tokens
const config: ResponseReasoningCapConfig = { maxReasoningTokens: 100, maxWallMs: 10_000 };

function usage(input: number, cacheRead: number, output: number): Usage {
	return {
		input,
		output,
		cacheRead,
		cacheWrite: 0,
		totalTokens: input + cacheRead + output,
		cost: { input: 0.01, output: 0.02, cacheRead: 0, cacheWrite: 0, total: 0.03 },
	};
}

function message(u: Usage, stopReason: AssistantMessage["stopReason"] = "stop"): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text: `answer ${SECRET}` }],
		api: "openai-completions",
		provider: "xai",
		model: "grok-4.7",
		usage: u,
		stopReason,
		timestamp: 0,
	};
}

interface Script {
	readonly thinking: number; // chunks
	readonly usage: Usage;
	readonly delayMs?: number;
	readonly throws?: boolean;
}

function fakeInner(scripts: readonly Script[]): { fn: StreamFn; calls: number } {
	const state = { fn: undefined as unknown as StreamFn, calls: 0 };
	state.fn = (_model, _context, options) => {
		const script = scripts[state.calls] ?? scripts[scripts.length - 1];
		state.calls += 1;
		if (script.throws) throw new Error(`provider failed ${SECRET}`);
		const stream = createAssistantMessageEventStream();
		const signal = options?.signal;
		void (async () => {
			const partial = message(script.usage);
			stream.push({ type: "start", partial });
			stream.push({ type: "thinking_start", contentIndex: 0, partial });
			for (let i = 0; i < script.thinking; i++) {
				if (script.delayMs) await new Promise((resolve) => setTimeout(resolve, script.delayMs));
				if (signal?.aborted) {
					const final = { ...message(script.usage, "aborted"), errorMessage: `aborted ${SECRET}` };
					stream.push({ type: "error", reason: "aborted", error: final });
					return stream.end(final);
				}
				stream.push({ type: "thinking_delta", contentIndex: 0, delta: chunk, partial });
			}
			const final = message(script.usage);
			stream.push({ type: "text_start", contentIndex: 1, partial: final });
			stream.push({ type: "done", reason: "stop", message: final });
			stream.end(final);
		})();
		return stream;
	};
	return state;
}

async function run(fn: StreamFn, signal?: AbortSignal) {
	const response = await fn(model, { messages: [] }, { reasoning: "xhigh", signal });
	for await (const _event of response) {
		// drain
	}
	return response.result();
}

const roots: string[] = [];
function logDir(): string {
	const root = mkdtempSync(join(tmpdir(), "omk-reasoning-cap-log-"));
	roots.push(root);
	vi.stubEnv(RUN_LOG_DIR_ENV, root);
	return root;
}
const linesOf = (dir: string) =>
	readFileSync(join(dir, "reasoning-cap.jsonl"), "utf8")
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line) as Record<string, unknown>);

afterEach(() => {
	vi.unstubAllEnvs();
	while (roots.length > 0) rmSync(roots.pop() as string, { recursive: true, force: true });
});

const cut: Script = { thinking: 4, usage: usage(1000, 200, 120) };
const retryOk: Script = { thinking: 1, usage: usage(1100, 900, 40) };

describe("reasoning cap run log (spec 033/042)", () => {
	it("flag off: no reasoning-cap.jsonl even with OMK_RUN_LOG_DIR set", async () => {
		const dir = logDir();
		const inner = fakeInner([cut, retryOk]);
		const off = resolveResponseReasoningCapConfig({ [RUN_LOG_DIR_ENV]: dir });
		expect(createResponseReasoningCapStreamFn(inner.fn, off)).toBe(inner.fn);
		await run(createResponseReasoningCapStreamFn(inner.fn, off));
		expect(readdirSync(dir)).toEqual([]);
	});

	it("flag on, no OMK_RUN_LOG_DIR: no file and no error", async () => {
		vi.stubEnv(RUN_LOG_DIR_ENV, "");
		const cwdBefore = readdirSync(process.cwd());
		const inner = fakeInner([cut, retryOk]);
		const result = await run(createResponseReasoningCapStreamFn(inner.fn, config));
		expect(inner.calls).toBe(2);
		expect(result.stopReason).toBe("stop");
		expect(readdirSync(process.cwd())).toEqual(cwdBefore);
		expect(existsSync(join(process.cwd(), "reasoning-cap.jsonl"))).toBe(false);
	});

	it("one cut: exactly one retry line and one retry_end with the same attempt and the retry's numbers", async () => {
		const dir = logDir();
		const inner = fakeInner([cut, retryOk]);
		const result = await run(createResponseReasoningCapStreamFn(inner.fn, config));
		const lines = linesOf(dir);
		expect(lines.map((l) => l.event)).toEqual(["retry", "retry_end"]);
		const [retry, end] = lines;
		expect(retry).toMatchObject({
			reason: "reasoning_tokens",
			fromEffort: "xhigh",
			toEffort: "high",
			capTokens: 100,
			capMs: 10_000,
			input: 1000,
			cacheRead: 200,
			cacheWrite: 0,
			output: 120,
			totalTokens: 1320,
			role: "lead",
			pid: process.pid,
		});
		expect(retry.reasoningTokens).toBeGreaterThan(100);
		expect(typeof retry.elapsedMs).toBe("number");
		expect(retry.attempt).toEqual(expect.any(Number));
		expect(end).toMatchObject({
			attempt: retry.attempt,
			input: 1100,
			cacheRead: 900,
			cacheWrite: 0,
			output: 40,
			totalTokens: 2040,
			stopReason: "stop",
		});
		// Same fields as the diagnostic; the stream result is unchanged by logging.
		const diag = result.diagnostics?.[0]?.details ?? {};
		for (const key of ["reason", "fromEffort", "toEffort", "reasoningTokens", "elapsedMs", "capTokens", "capMs"]) {
			expect(retry[key]).toEqual(diag[key]);
		}
		expect(result.usage).toMatchObject({ input: 1100, cacheRead: 900, output: 40, totalTokens: 2040 });
	});

	it("retry overruns: retry + overrun_after_retry, no retry_end", async () => {
		const dir = logDir();
		const inner = fakeInner([cut, { thinking: 3, usage: usage(1100, 0, 300) }]);
		const result = await run(createResponseReasoningCapStreamFn(inner.fn, config));
		const lines = linesOf(dir);
		expect(lines.map((l) => l.event)).toEqual(["retry", "overrun_after_retry"]);
		expect(lines[1]).toMatchObject({
			attempt: lines[0].attempt,
			reason: "reasoning_tokens",
			fromEffort: "xhigh",
			toEffort: "high",
			capTokens: 100,
			input: 1100,
			cacheRead: 0,
			output: 300,
			stopReason: "stop",
		});
		expect(lines[1].reasoningTokens).toEqual(result.diagnostics?.[1]?.details?.reasoningTokens);
	});

	it("two cuts in one session: two pairs with distinct attempt ids", async () => {
		const dir = logDir();
		const inner = fakeInner([cut, retryOk, cut, retryOk]);
		const fn = createResponseReasoningCapStreamFn(inner.fn, config);
		await run(fn);
		await run(fn);
		const lines = linesOf(dir);
		expect(lines.map((l) => l.event)).toEqual(["retry", "retry_end", "retry", "retry_end"]);
		expect(lines[1].attempt).toBe(lines[0].attempt);
		expect(lines[3].attempt).toBe(lines[2].attempt);
		expect(lines[2].attempt).not.toBe(lines[0].attempt);
	});

	it("a retry that throws still gets exactly one retry_end with stopReason error", async () => {
		const dir = logDir();
		const inner = fakeInner([cut, { ...retryOk, throws: true }]);
		const result = await run(createResponseReasoningCapStreamFn(inner.fn, config));
		expect(result.stopReason).toBe("error");
		const lines = linesOf(dir);
		expect(lines.map((l) => l.event)).toEqual(["retry", "retry_end"]);
		expect(lines[1]).toMatchObject({ attempt: lines[0].attempt, input: 0, output: 0, stopReason: "error" });
	});

	it("caller abort during the retry still gets exactly one retry_end with stopReason aborted", async () => {
		const dir = logDir();
		const controller = new AbortController();
		const inner = fakeInner([cut, { thinking: 3, delayMs: 30, usage: usage(1100, 0, 7) }]);
		setTimeout(() => controller.abort(), 40);
		const result = await run(createResponseReasoningCapStreamFn(inner.fn, config), controller.signal);
		expect(result.stopReason).toBe("aborted");
		const lines = linesOf(dir);
		expect(lines.map((l) => l.event)).toEqual(["retry", "retry_end"]);
		expect(lines[1]).toMatchObject({ attempt: lines[0].attempt, stopReason: "aborted" });
	});

	it("privacy: no thinking, answer or error text in the file", async () => {
		const dir = logDir();
		await run(createResponseReasoningCapStreamFn(fakeInner([cut, retryOk]).fn, config));
		await run(createResponseReasoningCapStreamFn(fakeInner([cut, { ...retryOk, throws: true }]).fn, config));
		const text = readFileSync(join(dir, "reasoning-cap.jsonl"), "utf8");
		expect(text).not.toContain(SECRET);
		expect(text).not.toContain("errorMessage");
		expect(text).not.toContain(dir);
	});

	it("a throwing sink never reaches the caller and the terminal line is written at most once", () => {
		const records: unknown[] = [];
		const log = logReasoningCapRetry(
			{
				reason: "wall_time",
				fromEffort: "high",
				toEffort: "medium",
				reasoningTokens: 0,
				elapsedMs: 5,
				capTokens: 1,
				capMs: 2,
			},
			undefined,
			(record) => {
				records.push(record);
				throw new Error("disk full");
			},
		);
		log.end(undefined, "stop");
		log.end(undefined, "error");
		expect(records.map((r) => (r as { event: string }).event)).toEqual(["retry", "retry_end"]);
	});
});
