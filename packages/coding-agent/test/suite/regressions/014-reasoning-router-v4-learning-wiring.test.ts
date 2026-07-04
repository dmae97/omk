/**
 * Goal 010 Lane T — regression tests for default-off and opt-in auto-v4
 * learning-bias wiring.
 *
 * ============================================================================
 * INVESTIGATION TIMELINE (why this file is a full real-behavior suite, not
 * an `it.todo`-deferred one)
 * ============================================================================
 * This lane's task explicitly allowed for production wiring not being ready
 * yet ("If production wiring not ready, write expected tests and note
 * deferred; otherwise run targeted 014"), so the real state was checked
 * before writing anything -- twice, mirroring Goal 009 Lane V2's own
 * documented precedent for this exact multi-session repo (see
 * `012-reasoning-router-learning-adaptorch-activation.test.ts`'s own header).
 *
 * 1. FIRST CHECK: a repo-wide grep for `compileBiasSnapshot`,
 *    `getBiasStepsForCell`, `appendRouterFeedbackRecord`, `RouterBiasSnapshot`,
 *    or any plausible settings-key name, outside the Wave 1 modules
 *    (`router-feedback-collector.ts`, `reasoning-router-bias.ts`) and their
 *    own 010 test, matched nothing. `_applyAutoThinkingLevelV4`
 *    (agent-session.ts) still called `resolveThinkingLevelV4WithUncertainty(
 *    verdict, availableLevels, undefined, 0, null)` -- bias/hint hardcoded --
 *    with a doc comment stating this was "pending a later settings-UX
 *    decision". `specs/008-reasoning-router-advanced-accuracy/tasks.md` T010
 *    was an unchecked `[ ]` item, and `RouterFeedbackVersion` had no `"v4"`
 *    member. `.omk/goals/010-reasoning-router-v4-learning-wiring/` held only
 *    an initialized `result.json` (`changedFiles: []`). Conclusion at this
 *    point: NOT ready.
 * 2. SECOND CHECK, made while reading further context for this file (per
 *    this repo's documented multi-session model): `.omk/goals/010-.../` had
 *    gained a `laneS-presecurity.md` (Goal 010's own pre-implementation
 *    security checklist -- review-only, PASS, no blockers), and
 *    `git status --porcelain` now showed `settings-manager.ts` freshly
 *    modified (untouched at check 1). Re-reading `settings-manager.ts` and
 *    `agent-session.ts` in full confirmed a complete, working implementation
 *    ("Goal 010 Lane I" per its own doc comments):
 *    - `settings-manager.ts`: a new `ReasoningRouterLearningSettings`
 *      (`enabled?`, `biasSnapshotPath?`, `feedbackLedgerPath?`) on `Settings`,
 *      plus `getReasoningRouterLearningEnabled/BiasSnapshotPath/
 *      FeedbackLedgerPath` getters that read ONLY `globalSettings` (never the
 *      merged/project-overridable view) -- a project-scope `.omk/settings.json`
 *      can never turn this on, matching Lane S's checklist item 2.1.
 *    - `agent-session.ts`'s `_applyAutoThinkingLevelV4` now reads
 *      `settingsManager.getReasoningRouterLearningEnabled()`; when true, it
 *      loads (once per session, "pinned") and strictly validates a compiled
 *      bias snapshot via the new `parseRouterBiasSnapshot`, computes `bias`
 *      via `getBiasStepsForCell`, and -- after resolving the level -- appends
 *      exactly one bounded, "accepted"-signal `RouterFeedbackRecord` (now
 *      legally tagged `routerVersion: "v4"`) per turn. `hint` stays
 *      permanently `null` (Adaptorch remains unwired, out of this lane's
 *      scope).
 *    - `reasoning-router-bias.ts` gained `isRouterBiasCell`/
 *      `isRouterBiasSnapshot`/`parseRouterBiasSnapshot`/
 *      `getDefaultRouterBiasSnapshotPath` -- a "never trust on-disk JSON,
 *      never throw, return null instead" loader satisfying Lane S's checklist
 *      item 2.4 exactly.
 *    - `router-feedback-collector.ts`'s `RouterFeedbackVersion` was widened to
 *      `"v1" | "v2" | "v3" | "v4"`.
 *    This is the signature of a concurrent Goal 010 implementation lane
 *    landing in this shared worktree while this lane was reading context --
 *    an expected occurrence per this repo's documented multi-session model,
 *    not an error (identical to the 012/Lane V2 precedent this file's header
 *    cites). Given wiring is now genuinely complete, this file writes real,
 *    passing tests against the actual implementation and verifies them for
 *    real (see this lane's evidence file for the exact commands), rather than
 *    the `it.todo`/deferred scaffolding the task's fallback clause would
 *    otherwise have required.
 *
 * All prompts below are synthetic test data (no real session text, paths,
 * tokens, or URLs). SPELLING_PROMPT/PLAN_PROMPT are copied verbatim from
 * 007's/012's own constants (already-verified v4 ground truth), so this
 * file's expectations cannot silently drift from that already-vetted
 * baseline. 010/012/013 are read-only grounding for this file and were not
 * modified. Every snapshot/ledger path used below is a fresh `mkdtempSync`
 * directory, cleaned up in `afterEach`; nothing here ever reads or writes a
 * real (non-temp) agent directory.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { ThinkingLevel } from "omk-agent-core";
import { fauxAssistantMessage } from "omk-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	BIAS_STRONG_THRESHOLD,
	compileBiasSnapshot,
	parseRouterBiasSnapshot,
	type RouterBiasSnapshot,
} from "../../../src/core/reasoning-router-bias.ts";
import { classifyTaskV4, resolveThinkingLevelV4WithUncertainty } from "../../../src/core/reasoning-router-v4.ts";
import {
	isRouterFeedbackRecord,
	type RouterFeedbackLenBucket,
	type RouterFeedbackRecord,
} from "../../../src/core/router-feedback-collector.ts";
import { InteractiveMode } from "../../../src/modes/interactive/interactive-mode.ts";
import { createHarness, type Harness, type HarnessOptions } from "../harness.ts";

/** Verbatim from 007/012 (already-verified v4 ground truth: taskClass "simple-edit", confidenceBand "high", resolves "low" at bias 0). */
const SPELLING_PROMPT = "correct the spelling of 'recieve' to 'receive'";
/** Verbatim from 007/012 (already-verified v4 ground truth: taskClass "plan", confidenceBand "high"). */
const PLAN_PROMPT = "plan the architecture roadmap for the storage layer";

const FULL_LEVEL_SET: readonly ThinkingLevel[] = ["minimal", "low", "medium", "high", "xhigh", "max"];

/**
 * Copied verbatim from agent-session.ts's private `_deriveRouterFeedbackFeatures`
 * (file-private, not exported), so the synthetic bias-snapshot cells built in
 * this file key-match a real session's own appended feedback records exactly
 * -- pure integer right-shifts, no floating-point `log2` drift risk.
 */
function computeLenBucket(promptText: string): RouterFeedbackLenBucket {
	const trimmed = promptText.trim();
	let lenBucket = 0;
	let remaining = trimmed.length + 1;
	while (remaining > 1 && lenBucket < 7) {
		remaining >>= 1;
		lenBucket++;
	}
	return lenBucket as RouterFeedbackLenBucket;
}

function readJsonlRecords(path: string): unknown[] {
	return readFileSync(path, "utf-8")
		.split("\n")
		.filter((line) => line.length > 0)
		.map((line) => JSON.parse(line));
}

function writeSnapshotFile(path: string, snapshot: RouterBiasSnapshot): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, JSON.stringify(snapshot));
}

function writeRawSnapshotFile(path: string, raw: string): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, raw);
}

/** Builds a single-cell, unanimous-outcome bias snapshot for `prompt` via the real compiler (routerVersion "v4"). */
function buildSingleCellSnapshot(
	prompt: string,
	outcome: "up" | "down",
	count: number = BIAS_STRONG_THRESHOLD + 1,
): RouterBiasSnapshot {
	const predictedClass = classifyTaskV4({ prompt }).taskClass;
	const records: RouterFeedbackRecord[] = Array.from({ length: count }, () => ({
		routerVersion: "v4",
		laneType: "none",
		predictedClass,
		resolvedLevel: "low",
		acceptedLevel: outcome === "up" ? "high" : "minimal",
		signal: "s1-override",
		outcome,
		lenBucket: computeLenBucket(prompt),
		hadFence: false,
		hadDiff: false,
	}));
	return compileBiasSnapshot(records, { routerVersion: "v4" });
}

// ============================================================================
// Session-level harness (InteractiveMode private-method tunneling -- identical
// idiom to 005/007/012; redefined locally per this repo's self-containment
// convention for regression test files).
// ============================================================================

type SubmitEditor = { onSubmit?: (text: string) => Promise<void> | void };

type ThinkSubmitContext = {
	readonly defaultEditor: SubmitEditor;
	readonly editor: { readonly setText: (text: string) => void };
	readonly session: Harness["session"];
	readonly footer: { readonly invalidate: () => void };
	readonly handleThinkCommand: (level?: string) => void;
	readonly enableAutoThinkingMode: (version: "v1" | "v2" | "v3" | "v4") => void;
	readonly applyThinkingLevel: (level: ThinkingLevel) => void;
	readonly showThinkingSelector: () => void;
	readonly showError: (message: string) => void;
	readonly showStatus: (message: string) => void;
	readonly updateEditorBorderColor: () => void;
};

type InteractiveModeThinkPrivate = {
	setupEditorSubmitHandler(this: ThinkSubmitContext): void;
	handleThinkCommand(this: ThinkSubmitContext, level?: string): void;
	enableAutoThinkingMode(this: ThinkSubmitContext, version: "v1" | "v2" | "v3" | "v4"): void;
	applyThinkingLevel(this: ThinkSubmitContext, level: ThinkingLevel): void;
};

const interactiveModePrototype = InteractiveMode.prototype as unknown as InteractiveModeThinkPrivate;

const harnesses: Harness[] = [];
const scratchDirs: string[] = [];

afterEach(() => {
	while (harnesses.length > 0) {
		harnesses.pop()?.cleanup();
	}
	while (scratchDirs.length > 0) {
		const dir = scratchDirs.pop();
		if (dir) rmSync(dir, { recursive: true, force: true });
	}
});

function scratchDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "omk-014-learning-"));
	scratchDirs.push(dir);
	return dir;
}

async function createThinkSubmitContext(
	settings?: HarnessOptions["settings"],
): Promise<{ readonly harness: Harness; readonly context: ThinkSubmitContext }> {
	const harness = await createHarness({ models: [{ id: "faux-think", reasoning: true }], settings });
	harnesses.push(harness);

	const context: ThinkSubmitContext = {
		defaultEditor: {},
		editor: { setText: vi.fn() },
		session: harness.session,
		footer: { invalidate: vi.fn() },
		handleThinkCommand(level?: string) {
			interactiveModePrototype.handleThinkCommand.call(context, level);
		},
		enableAutoThinkingMode(version: "v1" | "v2" | "v3" | "v4") {
			interactiveModePrototype.enableAutoThinkingMode.call(context, version);
		},
		applyThinkingLevel(level: ThinkingLevel) {
			interactiveModePrototype.applyThinkingLevel.call(context, level);
		},
		showThinkingSelector: vi.fn(),
		showError: vi.fn(),
		showStatus: vi.fn(),
		updateEditorBorderColor: vi.fn(),
	};

	interactiveModePrototype.setupEditorSubmitHandler.call(context);
	return { harness, context };
}

async function submit(context: ThinkSubmitContext, command: string): Promise<void> {
	const handler = context.defaultEditor.onSubmit;
	expect(handler).toBeDefined();
	await handler?.(command);
}

async function promptAndReadLevel(harness: Harness, prompt: string): Promise<ThinkingLevel | undefined> {
	harness.setResponses([fauxAssistantMessage("ok")]);
	await harness.session.prompt(prompt);
	return harness.session.thinkingLevel;
}

// ============================================================================
// Tests
// ============================================================================

describe("goal 010 lane T: default settings — auto-v4 behavior and ledger/snapshot I/O unchanged", () => {
	it('/think auto-v4 resolves the known simple-edit sentinel to "low" with no learning settings configured', async () => {
		const { harness, context } = await createThinkSubmitContext();

		expect(harness.settingsManager.getReasoningRouterLearningEnabled()).toBe(false);

		await submit(context, "/think auto-v4");
		expect(await promptAndReadLevel(harness, SPELLING_PROMPT)).toBe("low");
		expect(context.showError).not.toHaveBeenCalled();
	});

	it("/think auto-v4 resolves the known plan sentinel exactly as the real classifier+resolver predict with no learning settings configured", async () => {
		const { harness, context } = await createThinkSubmitContext();
		await submit(context, "/think auto-v4");

		const availableLevels = harness.session.getAvailableThinkingLevels();
		const verdict = classifyTaskV4({ prompt: PLAN_PROMPT });
		expect(verdict.taskClass).toBe("plan");
		const expectedLevel = resolveThinkingLevelV4WithUncertainty(verdict, availableLevels, undefined, 0, null);

		expect(await promptAndReadLevel(harness, PLAN_PROMPT)).toBe(expectedLevel);
		expect(context.showError).not.toHaveBeenCalled();
	});

	it("configuring biasSnapshotPath/feedbackLedgerPath alone (without enabled: true) never creates either file", async () => {
		const dir = scratchDir();
		const biasSnapshotPath = join(dir, "snapshot.json");
		const feedbackLedgerPath = join(dir, "ledger.jsonl");

		const { harness, context } = await createThinkSubmitContext({
			reasoningRouterLearning: { biasSnapshotPath, feedbackLedgerPath },
		});
		expect(harness.settingsManager.getReasoningRouterLearningEnabled()).toBe(false);

		await submit(context, "/think auto-v4");
		await promptAndReadLevel(harness, SPELLING_PROMPT);
		await promptAndReadLevel(harness, PLAN_PROMPT);

		expect(existsSync(biasSnapshotPath)).toBe(false);
		expect(existsSync(feedbackLedgerPath)).toBe(false);
		expect(context.showError).not.toHaveBeenCalled();
	});
});

describe("goal 010 lane T: opt-in learning, no snapshot present — same resolution, one bounded ledger record per turn", () => {
	it("resolves the simple-edit sentinel identically to the default (bias 0 with no snapshot) and appends exactly one well-formed, ten-key v4 feedback record with no forbidden keys", async () => {
		const dir = scratchDir();
		const biasSnapshotPath = join(dir, "snapshot.json"); // deliberately never created: "no snapshot"
		const feedbackLedgerPath = join(dir, "ledger.jsonl");

		const { harness, context } = await createThinkSubmitContext({
			reasoningRouterLearning: { enabled: true, biasSnapshotPath, feedbackLedgerPath },
		});
		expect(harness.settingsManager.getReasoningRouterLearningEnabled()).toBe(true);
		expect(existsSync(biasSnapshotPath)).toBe(false);

		await submit(context, "/think auto-v4");
		expect(await promptAndReadLevel(harness, SPELLING_PROMPT)).toBe("low");
		expect(context.showError).not.toHaveBeenCalled();

		const rawRecords = readJsonlRecords(feedbackLedgerPath);
		expect(rawRecords).toHaveLength(1);
		const [rawRecord] = rawRecords;
		expect(isRouterFeedbackRecord(rawRecord)).toBe(true);
		const record = rawRecord as RouterFeedbackRecord;

		expect(Object.keys(record).sort()).toEqual([
			"acceptedLevel",
			"hadDiff",
			"hadFence",
			"laneType",
			"lenBucket",
			"outcome",
			"predictedClass",
			"resolvedLevel",
			"routerVersion",
			"signal",
		]);
		expect(record).toEqual({
			routerVersion: "v4",
			laneType: "none",
			predictedClass: "simple-edit",
			resolvedLevel: "low",
			acceptedLevel: "low",
			signal: "s2-accept",
			outcome: "accepted",
			lenBucket: computeLenBucket(SPELLING_PROMPT),
			hadFence: false,
			hadDiff: false,
		});
	});

	it("appends one ordered ledger line per auto-v4 turn", async () => {
		const dir = scratchDir();
		const feedbackLedgerPath = join(dir, "ledger.jsonl");
		const { harness, context } = await createThinkSubmitContext({
			reasoningRouterLearning: { enabled: true, feedbackLedgerPath },
		});

		await submit(context, "/think auto-v4");
		await promptAndReadLevel(harness, SPELLING_PROMPT);
		await promptAndReadLevel(harness, PLAN_PROMPT);

		const rawRecords = readJsonlRecords(feedbackLedgerPath);
		expect(rawRecords).toHaveLength(2);
		for (const raw of rawRecords) {
			expect(isRouterFeedbackRecord(raw)).toBe(true);
		}
		const records = rawRecords as RouterFeedbackRecord[];
		expect(records[0].predictedClass).toBe("simple-edit");
		expect(records[1].predictedClass).toBe("plan");
	});
});

describe("goal 010 lane T: opt-in learning with a valid bias snapshot — escalates/de-escalates auto-v4 resolution within bounds", () => {
	it('a unanimous up-vote snapshot escalates the simple-edit sentinel from "low" to "high" (+2 ladder rungs, the documented bias bound)', async () => {
		expect(classifyTaskV4({ prompt: SPELLING_PROMPT }).confidenceBand).toBe("high");

		const dir = scratchDir();
		const biasSnapshotPath = join(dir, "snapshot.json");
		const feedbackLedgerPath = join(dir, "ledger.jsonl");
		writeSnapshotFile(biasSnapshotPath, buildSingleCellSnapshot(SPELLING_PROMPT, "up"));

		const { harness, context } = await createThinkSubmitContext({
			reasoningRouterLearning: { enabled: true, biasSnapshotPath, feedbackLedgerPath },
		});

		await submit(context, "/think auto-v4");
		expect(await promptAndReadLevel(harness, SPELLING_PROMPT)).toBe("high");
		expect(context.showError).not.toHaveBeenCalled();
	});

	it('a unanimous down-vote snapshot de-escalates the simple-edit sentinel from "low" to "minimal" (-2 ladder rungs, clamped at the floor)', async () => {
		const dir = scratchDir();
		const biasSnapshotPath = join(dir, "snapshot.json");
		const feedbackLedgerPath = join(dir, "ledger.jsonl");
		writeSnapshotFile(biasSnapshotPath, buildSingleCellSnapshot(SPELLING_PROMPT, "down"));

		const { harness, context } = await createThinkSubmitContext({
			reasoningRouterLearning: { enabled: true, biasSnapshotPath, feedbackLedgerPath },
		});

		await submit(context, "/think auto-v4");
		expect(await promptAndReadLevel(harness, SPELLING_PROMPT)).toBe("minimal");
		expect(context.showError).not.toHaveBeenCalled();
	});

	it("bias for a cell absent from the snapshot stays 0 (a snapshot compiled for a different prompt's cell never biases this one)", async () => {
		const dir = scratchDir();
		const biasSnapshotPath = join(dir, "snapshot.json");
		const feedbackLedgerPath = join(dir, "ledger.jsonl");
		// Compiled for SPELLING_PROMPT's cell only; PLAN_PROMPT's cell is absent from it.
		writeSnapshotFile(biasSnapshotPath, buildSingleCellSnapshot(SPELLING_PROMPT, "up"));

		const { harness, context } = await createThinkSubmitContext({
			reasoningRouterLearning: { enabled: true, biasSnapshotPath, feedbackLedgerPath },
		});
		await submit(context, "/think auto-v4");

		const availableLevels = harness.session.getAvailableThinkingLevels();
		const verdict = classifyTaskV4({ prompt: PLAN_PROMPT });
		const expectedUnbiasedLevel = resolveThinkingLevelV4WithUncertainty(verdict, availableLevels, undefined, 0, null);

		expect(await promptAndReadLevel(harness, PLAN_PROMPT)).toBe(expectedUnbiasedLevel);
	});
});

describe("goal 010 lane T: opt-in learning with an invalid or corrupted on-disk snapshot — ignored, falls back to unbiased resolution (end-to-end)", () => {
	const invalidSnapshotCases: Array<[string, string]> = [
		["unparsable JSON text", "{not valid json"],
		["valid JSON, missing every required key", "{}"],
		[
			"well-formed shape but biasCells is not an array",
			JSON.stringify({
				schemaVersion: "router-bias-snapshot/v1",
				sourceRecordDigest: "a".repeat(64),
				consideredCount: 0,
				droppedCount: 0,
				biasCells: "not-an-array",
			}),
		],
		[
			"schemaVersion does not match the current snapshot schema",
			JSON.stringify({
				schemaVersion: "router-bias-snapshot/v2",
				sourceRecordDigest: "a".repeat(64),
				consideredCount: 0,
				droppedCount: 0,
				biasCells: [],
			}),
		],
		[
			"a cell carries an out-of-range biasSteps value",
			JSON.stringify({
				schemaVersion: "router-bias-snapshot/v1",
				sourceRecordDigest: "a".repeat(64),
				consideredCount: 6,
				droppedCount: 0,
				biasCells: [
					{
						predictedClass: "simple-edit",
						laneType: "none",
						lenBucket: computeLenBucket(SPELLING_PROMPT),
						hadFence: false,
						hadDiff: false,
						biasSteps: 3,
						nStrong: 6,
						nTotal: 6,
					},
				],
			}),
		],
	];

	it.each(invalidSnapshotCases)(
		'%s: the simple-edit sentinel still resolves unbiased ("low") and a normal feedback record is still appended',
		async (_label, raw) => {
			const dir = scratchDir();
			const biasSnapshotPath = join(dir, "snapshot.json");
			const feedbackLedgerPath = join(dir, "ledger.jsonl");
			writeRawSnapshotFile(biasSnapshotPath, raw);

			const { harness, context } = await createThinkSubmitContext({
				reasoningRouterLearning: { enabled: true, biasSnapshotPath, feedbackLedgerPath },
			});

			await submit(context, "/think auto-v4");
			expect(await promptAndReadLevel(harness, SPELLING_PROMPT)).toBe("low");
			expect(context.showError).not.toHaveBeenCalled();

			const rawRecords = readJsonlRecords(feedbackLedgerPath);
			expect(rawRecords).toHaveLength(1);
			expect(isRouterFeedbackRecord(rawRecords[0])).toBe(true);
		},
	);
});

describe("goal 010 lane T: parseRouterBiasSnapshot rejects the same malformed snapshots directly (unit-level)", () => {
	it.each([
		["unparsable JSON text", "{not valid json"],
		["valid JSON, missing every required key", "{}"],
		[
			"well-formed shape but biasCells is not an array",
			JSON.stringify({
				schemaVersion: "router-bias-snapshot/v1",
				sourceRecordDigest: "a".repeat(64),
				consideredCount: 0,
				droppedCount: 0,
				biasCells: "not-an-array",
			}),
		],
	])("%s -> null, never throws", (_label, raw) => {
		expect(() => parseRouterBiasSnapshot(raw)).not.toThrow();
		expect(parseRouterBiasSnapshot(raw)).toBeNull();
	});

	it("a genuinely valid compiled snapshot round-trips through JSON + parseRouterBiasSnapshot unchanged", () => {
		const snapshot = buildSingleCellSnapshot(SPELLING_PROMPT, "up");
		const parsed = parseRouterBiasSnapshot(JSON.stringify(snapshot));
		expect(parsed).toEqual(snapshot);
	});
});

describe("goal 010 lane T: manual /think low after auto-v4 still wins, even against an actively non-zero bias", () => {
	it('/think low exits auto-v4 and pins the level at "low" even though the active snapshot would otherwise escalate the same prompt to "high"', async () => {
		const dir = scratchDir();
		const biasSnapshotPath = join(dir, "snapshot.json");
		const feedbackLedgerPath = join(dir, "ledger.jsonl");
		writeSnapshotFile(biasSnapshotPath, buildSingleCellSnapshot(SPELLING_PROMPT, "up"));

		const { harness, context } = await createThinkSubmitContext({
			reasoningRouterLearning: { enabled: true, biasSnapshotPath, feedbackLedgerPath },
		});

		await submit(context, "/think auto-v4");
		expect(await promptAndReadLevel(harness, SPELLING_PROMPT)).toBe("high"); // bias is genuinely active here

		await submit(context, "/think low");
		expect(harness.session.thinkingMode).toBe("manual");

		expect(await promptAndReadLevel(harness, SPELLING_PROMPT)).toBe("low");
		expect(context.showError).not.toHaveBeenCalled();
	});
});

describe("goal 010 lane T: resolver-level bias clamp bounds (direct, defense in depth)", () => {
	it("resolveThinkingLevelV4WithUncertainty clamps an out-of-spec bias magnitude to the documented +-2 bound, never throwing or leaving the ladder", () => {
		const verdict = classifyTaskV4({ prompt: SPELLING_PROMPT });

		expect(() => resolveThinkingLevelV4WithUncertainty(verdict, FULL_LEVEL_SET, undefined, 99, null)).not.toThrow();
		expect(resolveThinkingLevelV4WithUncertainty(verdict, FULL_LEVEL_SET, undefined, 99, null)).toBe(
			resolveThinkingLevelV4WithUncertainty(verdict, FULL_LEVEL_SET, undefined, 2, null),
		);
		expect(resolveThinkingLevelV4WithUncertainty(verdict, FULL_LEVEL_SET, undefined, -99, null)).toBe(
			resolveThinkingLevelV4WithUncertainty(verdict, FULL_LEVEL_SET, undefined, -2, null),
		);
	});
});
