import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentTool } from "omk-agent-core";
import { type Context, fauxAssistantMessage, fauxToolCall } from "omk-ai";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";
import finishCheck from "../src/core/extensions/builtin/finish-check.ts";
import { HARNESS_FACTORIES } from "../src/core/extensions/builtin/harness-factories.ts";
import type { ExtensionUIContext } from "../src/core/extensions/types.ts";
import {
	FINISH_CHECK_MAX_TOOL_CALLS,
	FINISH_CHECK_MESSAGE,
	FINISH_CHECK_SAVE_NOW_MESSAGE,
	FINISH_CHECK_WRAP_UP_MESSAGE,
	finishCheckSkipReason,
	finishDisciplinePrompt,
	isWorkspaceMutatingTool,
	resolveFinishCheckMode,
	shouldAddFinishDiscipline,
	shouldRunFinishCheck,
} from "../src/core/finish-check.ts";
import {
	DEFAULT_SNAPSHOT_TIMEOUT_MS,
	requestPreCheckSnapshot,
	resolveSnapshotHandshake,
} from "../src/core/finish-check-snapshot.ts";
import { resolveTimeBudgetMs } from "../src/core/remaining-budget.ts";
import { createHarness, type Harness } from "./suite/harness.ts";

function writeToolFor(runs: string[]): AgentTool {
	return {
		name: "write",
		label: "Write",
		description: "Write a file",
		parameters: Type.Object({ path: Type.String() }),
		execute: async (_toolCallId, params) => {
			runs.push(String((params as { path: string }).path));
			return { content: [{ type: "text", text: "ok" }], details: {} };
		},
	};
}

const base = {
	mode: "headless" as const,
	hasUI: false,
	alreadyChecked: false,
	mutatedWorkspace: true,
	hasPendingMessages: false,
	aborted: false,
	elapsedFraction: undefined,
};

describe("finish-check policy", () => {
	it("parses OMK_FINISH_CHECK and OMK_TIME_BUDGET_SEC", () => {
		expect(resolveFinishCheckMode(undefined)).toBe("headless");
		expect(resolveFinishCheckMode("0")).toBe("off");
		expect(resolveFinishCheckMode("always")).toBe("always");
		expect(resolveFinishCheckMode("1")).toBe("always");
		expect(resolveTimeBudgetMs("900")).toBe(900_000);
		expect(resolveTimeBudgetMs("-1")).toBeUndefined();
		expect(resolveTimeBudgetMs("soon")).toBeUndefined();
	});

	it("treats only observing tools as read-only", () => {
		expect(isWorkspaceMutatingTool("read")).toBe(false);
		expect(isWorkspaceMutatingTool("update_todo")).toBe(false);
		expect(isWorkspaceMutatingTool("bash")).toBe(true);
		expect(isWorkspaceMutatingTool("write")).toBe(true);
	});

	it("runs once, only after a headless run that changed the workspace", () => {
		expect(shouldRunFinishCheck(base)).toBe(true);
		expect(shouldRunFinishCheck({ ...base, hasUI: true })).toBe(false);
		expect(shouldRunFinishCheck({ ...base, mode: "always", hasUI: true })).toBe(true);
		expect(shouldRunFinishCheck({ ...base, mode: "off" })).toBe(false);
		expect(shouldRunFinishCheck({ ...base, alreadyChecked: true })).toBe(false);
		expect(shouldRunFinishCheck({ ...base, mutatedWorkspace: false })).toBe(false);
		expect(shouldRunFinishCheck({ ...base, hasPendingMessages: true })).toBe(false);
		expect(shouldRunFinishCheck({ ...base, aborted: true })).toBe(false);
		expect(shouldRunFinishCheck({ ...base, elapsedFraction: 0.5 })).toBe(true);
		expect(shouldRunFinishCheck({ ...base, elapsedFraction: 0.95 })).toBe(false);
	});

	it("names the first reason a settled run gets no verification turn (spec 032 run log)", () => {
		expect(finishCheckSkipReason(base)).toBeUndefined();
		expect(finishCheckSkipReason({ ...base, mode: "off", hasUI: true })).toBe("off");
		expect(finishCheckSkipReason({ ...base, hasUI: true, mutatedWorkspace: false })).toBe("ui");
		expect(finishCheckSkipReason({ ...base, alreadyChecked: true, aborted: true })).toBe("already-checked");
		expect(finishCheckSkipReason({ ...base, mutatedWorkspace: false, aborted: true })).toBe("workspace-unchanged");
		expect(finishCheckSkipReason({ ...base, hasPendingMessages: true, aborted: true })).toBe("pending-input");
		expect(finishCheckSkipReason({ ...base, aborted: true, elapsedFraction: 0.95 })).toBe("aborted");
		expect(finishCheckSkipReason({ ...base, elapsedFraction: 0.95 })).toBe("late");
	});

	it("adds the discipline prompt only to headless sessions unless the mode is always", () => {
		expect(shouldAddFinishDiscipline("headless", false)).toBe(true);
		expect(shouldAddFinishDiscipline("headless", true)).toBe(false);
		expect(shouldAddFinishDiscipline("always", true)).toBe(true);
		expect(shouldAddFinishDiscipline("always", false)).toBe(true);
		expect(shouldAddFinishDiscipline("off", false)).toBe(false);
	});

	it("names scope, early save, edge cases and environment in the prompt block", () => {
		const block = finishDisciplinePrompt(600_000);
		expect(block).toContain("rewrite or squash git history");
		expect(block).toContain("restarting services) are in scope");
		expect(block).toContain("Save a working result early");
		expect(block).toContain("edge cases");
		expect(block).toContain("accounts and passwords");
		expect(block).toContain("about 600 seconds");
		expect(finishDisciplinePrompt(undefined)).not.toContain("wall-clock budget");
	});

	it("tells the verification turn to keep saved outputs valid", () => {
		expect(FINISH_CHECK_MESSAGE).toContain("Change a file only when a check actually fails");
		expect(FINISH_CHECK_MESSAGE).toContain("Do not search other directories");
		expect(FINISH_CHECK_MESSAGE).toContain(`at most ${FINISH_CHECK_MAX_TOOL_CALLS} tool calls`);
	});

	it("is registered as a built-in harness extension behind OMK_FINISH_CHECK", () => {
		expect(HARNESS_FACTORIES.map((entry) => entry.envVar)).toContain("OMK_FINISH_CHECK");
	});
});

describe("finish-check extension in a headless session", () => {
	const harnesses: Harness[] = [];
	afterEach(() => {
		while (harnesses.length > 0) harnesses.pop()?.cleanup();
	});

	function writeTool(runs: string[]): AgentTool {
		return {
			name: "write",
			label: "Write",
			description: "Write a file",
			parameters: Type.Object({ path: Type.String() }),
			execute: async (_toolCallId, params) => {
				runs.push(String((params as { path: string }).path));
				return { content: [{ type: "text", text: "ok" }], details: {} };
			},
		};
	}

	function userTexts(context: Context): string[] {
		return context.messages
			.filter((message) => message.role === "user")
			.map((message) =>
				typeof message.content === "string"
					? message.content
					: message.content.map((part) => (part.type === "text" ? part.text : "")).join(""),
			);
	}

	it("adds one verification turn before prompt() resolves, then stops", async () => {
		const runs: string[] = [];
		let systemPrompt = "";
		let verifyTurnUsers: string[] = [];
		const harness = await createHarness({
			tools: [writeTool(runs)],
			extensionFactories: [(omk) => finishCheck(omk, { env: {} })],
		});
		harnesses.push(harness);
		harness.setResponses([
			(context) => {
				systemPrompt = context.systemPrompt ?? "";
				return fauxAssistantMessage([fauxToolCall("write", { path: "out.txt" })], { stopReason: "toolUse" });
			},
			fauxAssistantMessage("done"),
			(context) => {
				verifyTurnUsers = userTexts(context);
				return fauxAssistantMessage("verified: out.txt exists");
			},
		]);

		await harness.session.prompt("write the deliverable");

		expect(runs).toEqual(["out.txt"]);
		expect(systemPrompt).toContain("<finish_discipline>");
		expect(harness.faux.state.callCount).toBe(3);
		expect(verifyTurnUsers.at(-1)).toBe(FINISH_CHECK_MESSAGE);
		expect(harness.session.isStreaming).toBe(false);
	});

	it.each([
		{ env: {}, expected: false },
		{ env: { OMK_FINISH_CHECK: "always" }, expected: true },
	])("keeps benchmark discipline out of sessions with a UI (env $env)", async ({ env, expected }) => {
		let systemPrompt = "";
		const harness = await createHarness({ extensionFactories: [(omk) => finishCheck(omk, { env })] });
		harnesses.push(harness);
		harness.session.extensionRunner.setUIContext({} as ExtensionUIContext, "tui");
		harness.setResponses([
			(context) => {
				systemPrompt = context.systemPrompt ?? "";
				return fauxAssistantMessage("just an answer");
			},
		]);
		await harness.session.prompt("what is 2+2?");
		expect(systemPrompt.includes("<finish_discipline>")).toBe(expected);
		expect(systemPrompt.includes("editing /etc")).toBe(expected);
	});

	it("skips the verification turn when nothing changed", async () => {
		const harness = await createHarness({ extensionFactories: [(omk) => finishCheck(omk, { env: {} })] });
		harnesses.push(harness);
		harness.setResponses([fauxAssistantMessage("just an answer")]);
		await harness.session.prompt("what is 2+2?");
		expect(harness.faux.state.callCount).toBe(1);
	});

	it("steers the run to save outputs once 75% of the time budget is used", async () => {
		const runs: string[] = [];
		let clock = 0;
		let steeredUsers: string[] = [];
		const harness = await createHarness({
			tools: [writeTool(runs)],
			extensionFactories: [
				(omk) => finishCheck(omk, { env: { OMK_TIME_BUDGET_SEC: "100", OMK_FINISH_CHECK: "0" }, now: () => clock }),
				(omk) => finishCheck(omk, { env: { OMK_TIME_BUDGET_SEC: "100" }, now: () => clock }),
			],
		});
		harnesses.push(harness);
		harness.setResponses([
			() => {
				clock = 80_000;
				return fauxAssistantMessage([fauxToolCall("write", { path: "a" })], { stopReason: "toolUse" });
			},
			(context) => {
				steeredUsers = userTexts(context);
				clock = 95_000;
				return fauxAssistantMessage("saved");
			},
		]);
		await harness.session.prompt("long task");
		expect(steeredUsers).toContain(FINISH_CHECK_SAVE_NOW_MESSAGE);
		expect(steeredUsers.filter((text) => text === FINISH_CHECK_SAVE_NOW_MESSAGE)).toHaveLength(1);
		// Past 90% of the budget there is no time for the extra verification turn.
		expect(harness.faux.state.callCount).toBe(2);
	});

	it("steers at 75% after a long answer even when no tool runs", async () => {
		let clock = 0;
		let secondTurnUsers: string[] = [];
		const harness = await createHarness({
			extensionFactories: [(omk) => finishCheck(omk, { env: { OMK_TIME_BUDGET_SEC: "100" }, now: () => clock })],
		});
		harnesses.push(harness);
		harness.setResponses([
			() => {
				clock = 80_000;
				return fauxAssistantMessage("long reasoning, no tools yet");
			},
			(context) => {
				secondTurnUsers = userTexts(context);
				return fauxAssistantMessage("saved");
			},
		]);
		await harness.session.prompt("long task");
		expect(secondTurnUsers.at(-1)).toBe(FINISH_CHECK_SAVE_NOW_MESSAGE);
		expect(harness.faux.state.callCount).toBe(2);
	});

	it("tells a long verification turn to wrap up after the tool-call cap", async () => {
		const runs: string[] = [];
		let wrapUpSeenAt = -1;
		const harness = await createHarness({
			tools: [writeTool(runs)],
			extensionFactories: [(omk) => finishCheck(omk, { env: {} })],
		});
		harnesses.push(harness);
		const checkCalls = Array.from({ length: FINISH_CHECK_MAX_TOOL_CALLS + 2 }, (_, index) => (context: Context) => {
			if (wrapUpSeenAt < 0 && userTexts(context).includes(FINISH_CHECK_WRAP_UP_MESSAGE)) wrapUpSeenAt = index;
			return wrapUpSeenAt >= 0
				? fauxAssistantMessage("verified")
				: fauxAssistantMessage([fauxToolCall("write", { path: `check-${index}` })], { stopReason: "toolUse" });
		});
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("write", { path: "out.txt" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
			...checkCalls,
		]);
		await harness.session.prompt("write the deliverable");
		expect(wrapUpSeenAt).toBe(FINISH_CHECK_MAX_TOOL_CALLS);
		expect(runs).toHaveLength(1 + FINISH_CHECK_MAX_TOOL_CALLS);
		expect(harness.session.isStreaming).toBe(false);
	});
});

describe("finish-check pre-check snapshot handshake", () => {
	const harnesses: Harness[] = [];
	const dirs: string[] = [];
	afterEach(() => {
		while (harnesses.length > 0) harnesses.pop()?.cleanup();
		while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true });
	});

	function tempDir(): string {
		const dir = mkdtempSync(join(tmpdir(), "omk-finish-snap-"));
		dirs.push(dir);
		return dir;
	}

	it("is off unless OMK_FINISH_CHECK_SNAPSHOT_DIR is set", () => {
		expect(resolveSnapshotHandshake({})).toBeUndefined();
		expect(resolveSnapshotHandshake({ OMK_FINISH_CHECK_SNAPSHOT_DIR: "/x" })).toEqual({
			dir: "/x",
			timeoutMs: DEFAULT_SNAPSHOT_TIMEOUT_MS,
		});
		expect(
			resolveSnapshotHandshake({ OMK_FINISH_CHECK_SNAPSHOT_DIR: "/x", OMK_FINISH_CHECK_SNAPSHOT_TIMEOUT_SEC: "5" }),
		).toEqual({ dir: "/x", timeoutMs: 5000 });
	});

	it("gives up after the timeout and records the outcome", async () => {
		const dir = tempDir();
		let clock = 0;
		const result = await requestPreCheckSnapshot({ dir, timeoutMs: 1000 }, 1, {
			now: () => clock,
			sleep: async (ms) => {
				clock += ms;
			},
		});
		expect(result.status).toBe("timeout");
		expect(result.waitedMs).toBe(1000);
		expect(existsSync(join(dir, "pre-check-1.request"))).toBe(true);
		// The request time stays an epoch even though the wait is measured on an injected or monotonic clock.
		const requestedAt = JSON.parse(readFileSync(join(dir, "pre-check-1.request"), "utf8")).requestedAt;
		expect(requestedAt).toBeGreaterThan(Date.parse("2020-01-01"));
		expect(JSON.parse(readFileSync(join(dir, "pre-check-1.result"), "utf8")).status).toBe("timeout");
	});

	it("waits for the harness before the verification turn and excludes the wait from the budget", async () => {
		const dir = tempDir();
		const runs: string[] = [];
		let clock = 0;
		let requestSeenBeforeCheck = false;
		const harness = await createHarness({
			tools: [writeToolFor(runs)],
			extensionFactories: [
				(omk) =>
					finishCheck(omk, {
						env: { OMK_FINISH_CHECK_SNAPSHOT_DIR: dir, OMK_TIME_BUDGET_SEC: "100" },
						now: () => clock,
						sleep: async (ms) => {
							clock += ms;
							// The harness snapshots the container, then acknowledges after 50s.
							if (clock >= 50_000) writeFileSync(join(dir, "pre-check-1.done"), "");
						},
					}),
			],
		});
		harnesses.push(harness);
		harness.setResponses([
			() => {
				clock = 40_000;
				return fauxAssistantMessage([fauxToolCall("write", { path: "out.txt" })], { stopReason: "toolUse" });
			},
			fauxAssistantMessage("done"),
			() => {
				requestSeenBeforeCheck = existsSync(join(dir, "pre-check-1.done"));
				return fauxAssistantMessage("verified");
			},
		]);
		await harness.session.prompt("write the deliverable");
		expect(requestSeenBeforeCheck).toBe(true);
		expect(harness.faux.state.callCount).toBe(3);
		// 90s on the clock, but 50s of it was the snapshot wait, so the run is at 40% and no save-now steer fired.
		expect(JSON.parse(readFileSync(join(dir, "pre-check-1.result"), "utf8")).status).toBe("done");
	});
});
