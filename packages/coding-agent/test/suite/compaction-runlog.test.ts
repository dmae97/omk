import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type AssistantMessage, createAssistantMessageEventStream, fauxAssistantMessage, fauxToolCall } from "omk-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	COMPACTION_SEQ_SESSION_CAP,
	compactionSeqSessionCount,
	logCompaction,
} from "../../src/core/compaction/compaction-observe.ts";
import type { CompactionPreparation } from "../../src/core/compaction/index.ts";
import { createHarness, type Harness } from "./harness.ts";

const SECRET = "SECRET_CONTENT_do_not_log_7f3a";
/** ~25k tokens, so the default keepRecentTokens (20k) cuts it off. */
const TOOL_BYTES = 100_000;
const SUMMARY = `## Goal\nsummary mentions ${SECRET}`;

/** Realistic provider usage for the fake summarizer (team rule: no zero usage). */
function usage(input: number, output: number) {
	return {
		input,
		output,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: input + output,
		cost: {
			input: input * 3e-6,
			output: output * 15e-6,
			cacheRead: 0,
			cacheWrite: 0,
			total: input * 3e-6 + output * 15e-6,
		},
	};
}

function useSummaryStream(harness: Harness): void {
	harness.session.agent.streamFn = (model) => {
		const stream = createAssistantMessageEventStream();
		queueMicrotask(() => {
			const message: AssistantMessage = {
				...fauxAssistantMessage(SUMMARY),
				api: model.api,
				provider: model.provider,
				model: model.id,
				usage: usage(1840, 212),
			};
			stream.push({ type: "done", reason: "stop", message });
		});
		return stream;
	};
}

function seed(harness: Harness): void {
	const model = harness.getModel();
	const now = Date.now();
	const assistant = (t: number, input: number): AssistantMessage => ({
		...fauxAssistantMessage(`assistant ${SECRET}`, { stopReason: "stop", timestamp: t }),
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: usage(input, 120),
	});
	harness.sessionManager.appendMessage({
		role: "user",
		content: [{ type: "text", text: `task ${SECRET}` }],
		timestamp: now - 4000,
	});
	harness.sessionManager.appendMessage({
		...fauxAssistantMessage([fauxToolCall("bash", { command: `cat ${SECRET}` }, { id: "call-1" })], {
			stopReason: "toolUse",
			timestamp: now - 3800,
		}),
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: usage(1500, 40),
	});
	harness.sessionManager.appendMessage({
		role: "toolResult",
		toolCallId: "call-1",
		toolName: "bash",
		content: [{ type: "text", text: `${SECRET}\n${"x".repeat(TOOL_BYTES - SECRET.length - 1)}` }],
		isError: false,
		timestamp: now - 3600,
	});
	harness.sessionManager.appendMessage(assistant(now - 2500, 27000));
	harness.sessionManager.appendMessage({
		role: "user",
		content: [{ type: "text", text: `follow-up ${SECRET}` }],
		timestamp: now - 2000,
	});
	harness.sessionManager.appendMessage(assistant(now - 1000, 1900));
	harness.session.agent.state.messages = harness.sessionManager.buildSessionContext().messages;
}

function readLines(dir: string): Record<string, unknown>[] {
	const file = join(dir, "compaction.jsonl");
	if (!existsSync(file)) return [];
	return readFileSync(file, "utf8")
		.trim()
		.split("\n")
		.filter(Boolean)
		.map((l) => JSON.parse(l));
}

describe("compaction run log (spec 116 step 1)", () => {
	const harnesses: Harness[] = [];
	const dirs: string[] = [];
	const tmp = () => {
		const d = mkdtempSync(join(tmpdir(), "omk-compaction-log-"));
		dirs.push(d);
		return d;
	};

	afterEach(() => {
		vi.unstubAllEnvs();
		while (harnesses.length) harnesses.pop()?.cleanup();
		while (dirs.length) rmSync(dirs.pop() as string, { recursive: true, force: true });
	});

	async function run(dir: string | undefined) {
		if (dir) vi.stubEnv("OMK_RUN_LOG_DIR", dir);
		else vi.stubEnv("OMK_RUN_LOG_DIR", "");
		const harness = await createHarness({ withConfiguredAuth: false });
		harnesses.push(harness);
		seed(harness);
		useSummaryStream(harness);
		const result = await harness.session.compact();
		return { harness, result };
	}

	it("writes nothing when OMK_RUN_LOG_DIR is unset", async () => {
		const dir = tmp();
		await run(undefined);
		expect(existsSync(join(dir, "compaction.jsonl"))).toBe(false);
	});

	it("writes one line with counts and hash only, no content text", async () => {
		const dir = tmp();
		const { harness, result } = await run(dir);
		const lines = readLines(dir);
		expect(lines).toHaveLength(1);
		const line = lines[0];
		expect(line).toMatchObject({
			event: "compaction",
			seq: 1,
			sessionId: harness.sessionManager.getSessionId(),
			parentSessionId: null,
			reason: "manual",
			fromExtension: false,
			tokensBefore: result.tokensBefore,
			droppedToolResults: 1,
			droppedToolResultBytes: TOOL_BYTES,
			staleToolResultBytesAtTrigger: 0,
			userMessagesBeforeCut: 1,
			flags: { c1: false, c2: false, c3: false },
		});
		expect(line.summarySha256).toMatch(/^[0-9a-f]{64}$/);
		expect(typeof line.tokensAfter).toBe("number");
		expect(line.tokensAfter as number).toBeGreaterThan(0);
		expect(line.summaryTokens).toBe(Math.ceil(result.summary.length / 4));
		expect(typeof line.isSplitTurn).toBe("boolean");
		expect(line.droppedEntries as number).toBeGreaterThanOrEqual(3);
		expect(line.keptEntries as number).toBeGreaterThanOrEqual(1);
		expect(line.tokensAfter as number).toBeLessThan(result.tokensBefore);
		const raw = readFileSync(join(dir, "compaction.jsonl"), "utf8");
		expect(raw).not.toContain(SECRET);
		for (const [key, value] of Object.entries(line)) {
			if (key === "summarySha256" || key === "ts" || key === "sessionId") continue;
			if (typeof value === "string") expect(value.length).toBeLessThanOrEqual(64);
		}
	});

	it("leaves the compaction result identical with and without the log dir", async () => {
		const off = await run(undefined);
		const dir = tmp();
		const on = await run(dir);
		expect(on.result.summary).toBe(off.result.summary);
		expect(on.result.tokensBefore).toBe(off.result.tokensBefore);
		expect(on.result.details).toEqual(off.result.details);
		expect(on.harness.session.messages.length).toBe(off.harness.session.messages.length);
		expect(readLines(dir)).toHaveLength(1);
	});

	it("caps per-session seq counters at 1000 (LRU)", () => {
		const dir = tmp();
		const env = { OMK_RUN_LOG_DIR: dir } as NodeJS.ProcessEnv;
		const preparation = {
			firstKeptEntryId: "x",
			messagesToSummarize: [],
			turnPrefixMessages: [],
			isSplitTurn: false,
			tokensBefore: 1000,
		} as unknown as CompactionPreparation;
		const obs = (sessionId: string) => ({
			reason: "threshold" as const,
			sessionId,
			fromExtension: false,
			pathEntries: [],
			preparation,
			result: { summary: "s", firstKeptEntryId: "x", tokensBefore: 1000 },
			messagesAfter: [],
		});
		logCompaction(obs("keep"), env);
		for (let i = 0; i < COMPACTION_SEQ_SESSION_CAP + 50; i++) {
			logCompaction(obs(`s${i}`), env);
			if (i % 100 === 0) logCompaction(obs("keep"), env);
		}
		expect(compactionSeqSessionCount()).toBeLessThanOrEqual(COMPACTION_SEQ_SESSION_CAP);
		logCompaction(obs("keep"), env);
		logCompaction(obs("s0"), env);
		const lines = readLines(dir);
		const keep = lines.filter((l) => l.sessionId === "keep").map((l) => l.seq);
		expect(keep).toEqual(keep.map((_, i) => i + 1));
		expect(lines.filter((l) => l.sessionId === "s0").map((l) => l.seq)).toEqual([1, 1]);
	});

	it("counts tool-result bytes older than the newest 5 as staleToolResultBytesAtTrigger", () => {
		const dir = tmp();
		const pathEntries = Array.from({ length: 7 }, (_, i) => ({
			type: "message",
			id: `e${i}`,
			message: {
				role: "toolResult",
				toolCallId: `c${i}`,
				toolName: "bash",
				content: [{ type: "text", text: "0123456789" }],
			},
		}));
		logCompaction(
			{
				reason: "threshold",
				sessionId: "stale",
				fromExtension: false,
				pathEntries: pathEntries as never,
				preparation: {
					messagesToSummarize: [],
					turnPrefixMessages: [],
					isSplitTurn: true,
				} as unknown as CompactionPreparation,
				result: { summary: "s", firstKeptEntryId: "e5", tokensBefore: 3000 },
				messagesAfter: [],
			},
			{ OMK_RUN_LOG_DIR: dir } as NodeJS.ProcessEnv,
		);
		expect(readLines(dir)[0]).toMatchObject({ staleToolResultBytesAtTrigger: 20, keptEntries: 2, isSplitTurn: true });
	});
});
