import { describe, expect, it } from "vitest";
import { subagentWorkerEnv } from "../examples/extensions/subagent/worker-env.ts";
import {
	FINISH_CHECK_EXTRA_TURN_FRACTION,
	FINISH_CHECK_REVERIFY_FRACTION,
	FINISH_CHECK_SAVE_NOW_FRACTION,
	FINISH_CHECK_SKIP_FRACTION,
	resolveFinishCheckExtraTurn,
	resolveFinishCheckReverify,
	reverifySkipReason,
	shouldReverify,
} from "../src/core/finish-check.ts";
import { extractRequirements, parseFinishCheckLedger } from "../src/core/finish-check-requirements.ts";
import {
	buildReverifyFixMessage,
	buildReverifyMessage,
	FINISH_CHECK_REVERIFY_MARKER,
	FINISH_CHECK_REVERIFY_MAX_DELIVERABLES,
	FINISH_CHECK_REVERIFY_SCRATCH_DIR,
	freshContextMessages,
	mergeFailingItems,
	parseVerifyReply,
	reverifyDeliverables,
	verifyUsage,
} from "../src/core/finish-check-reverify.ts";

// spec 032: fresh-context re-verification for early finishes.

describe("finish-check reverify: flag", () => {
	it("reads OMK_FINISH_CHECK_REVERIFY exactly like OMK_FINISH_CHECK_EXTRA_TURN", () => {
		for (const value of ["on", "1", "true", "ON", " enabled ", "enable"]) {
			expect(resolveFinishCheckReverify(value), value).toBe(true);
		}
		for (const value of [undefined, "", "off", "0", "false", "always", "yes please"]) {
			expect(resolveFinishCheckReverify(value), String(value)).toBe(false);
		}
		for (const value of ["on", "1", "off", "maybe", undefined]) {
			expect(resolveFinishCheckReverify(value)).toBe(resolveFinishCheckExtraTurn(value));
		}
	});

	it("is never passed to subagent workers, even when they opt into the finish check", () => {
		const env = subagentWorkerEnv({
			OMK_FINISH_CHECK_REVERIFY: "on",
			OMK_FINISH_CHECK_WORKERS: "1",
			OMK_TIME_BUDGET_SEC: "900",
		});
		expect(env.OMK_FINISH_CHECK_REVERIFY).toBeUndefined();
		expect(env.OMK_TIME_BUDGET_SEC).toBeUndefined();
		expect(env.OMK_FINISH_CHECK).toBe("1");
	});
});

describe("finish-check reverify: trigger", () => {
	const base = {
		enabled: true,
		hasUI: false,
		firstSettleFraction: 0.2,
		aborted: false,
		hasPendingMessages: false,
		alreadyVerified: false,
	};

	it("fires on an early first settle in a headless run with the flag on", () => {
		expect(shouldReverify(base)).toBe(true);
	});

	it("uses 0.3 as the cutoff, below the other finish-check thresholds", () => {
		expect(FINISH_CHECK_REVERIFY_FRACTION).toBe(0.3);
		expect(FINISH_CHECK_REVERIFY_FRACTION).toBeLessThan(FINISH_CHECK_SAVE_NOW_FRACTION);
		expect(FINISH_CHECK_SAVE_NOW_FRACTION).toBeLessThan(FINISH_CHECK_EXTRA_TURN_FRACTION);
		expect(FINISH_CHECK_EXTRA_TURN_FRACTION).toBeLessThan(FINISH_CHECK_SKIP_FRACTION);
		expect(shouldReverify({ ...base, firstSettleFraction: 269 / 900 })).toBe(true);
		expect(shouldReverify({ ...base, firstSettleFraction: FINISH_CHECK_REVERIFY_FRACTION })).toBe(false);
		expect(shouldReverify({ ...base, firstSettleFraction: 0.5 })).toBe(false);
	});

	it("never fires without the flag, without a budget, with a UI, after an abort or pending input, or twice", () => {
		expect(shouldReverify({ ...base, enabled: false })).toBe(false);
		expect(shouldReverify({ ...base, firstSettleFraction: undefined })).toBe(false);
		expect(shouldReverify({ ...base, hasUI: true })).toBe(false);
		expect(shouldReverify({ ...base, aborted: true })).toBe(false);
		expect(shouldReverify({ ...base, hasPendingMessages: true })).toBe(false);
		expect(shouldReverify({ ...base, alreadyVerified: true })).toBe(false);
	});

	it("names the first reason it does not fire, for the run log (AC19)", () => {
		expect(reverifySkipReason(base)).toBeUndefined();
		expect(reverifySkipReason({ ...base, enabled: false })).toBe("disabled");
		expect(reverifySkipReason({ ...base, hasUI: true, aborted: true })).toBe("ui");
		expect(reverifySkipReason({ ...base, alreadyVerified: true })).toBe("already-verified");
		expect(reverifySkipReason({ ...base, aborted: true, hasPendingMessages: true })).toBe("check-aborted");
		expect(reverifySkipReason({ ...base, hasPendingMessages: true, firstSettleFraction: 0.5 })).toBe("pending-input");
		expect(reverifySkipReason({ ...base, firstSettleFraction: undefined })).toBe("no-budget");
		expect(reverifySkipReason({ ...base, firstSettleFraction: FINISH_CHECK_REVERIFY_FRACTION })).toBe("late");
	});
});

describe("finish-check reverify: verifier instruction", () => {
	const task = "Fix parse.py so /app/out.txt lists every symbol. The output must have at least 10 lines.";
	const requirements = extractRequirements(task);

	it("quotes the task and lists deliverables, requirements, the different-input step and the reply format", () => {
		const [unmeasured] = parseFinishCheckLedger("", requirements).filter((item) => item.numeric);
		const message = buildReverifyMessage({
			task,
			deliverables: ["/app/out.txt", "parse.py"],
			requirements,
			unmeasured: [unmeasured],
		});
		expect(message.startsWith(FINISH_CHECK_REVERIFY_MARKER)).toBe(true);
		expect(message).toContain(task);
		expect(message).toContain("someone else's work");
		expect(message).toContain("- /app/out.txt\n- parse.py");
		for (const [index, requirement] of requirements.entries())
			expect(message).toContain(`REQ ${index + 1}: ${requirement}`);
		expect(message).toContain(`REQ ${unmeasured.id}: ${unmeasured.requirement}`);
		expect(message).toContain("<label> <measured> <op> <limit>");
		expect(message).toContain("build at least two new inputs that differ from them");
		expect(message).toContain("Do not count re-running the given examples.");
		expect(message).toContain(FINISH_CHECK_REVERIFY_SCRATCH_DIR);
		expect(message).toContain("Do not search other directories or the web for tests or answers.");
		expect(message).toContain("`VERIFY <n>: PASS|FAIL - <what was checked>; expected <x>; got <y>`");
		expect(message).toContain("`VERDICT: PASS|FAIL`");
	});

	it("says no deliverables were recorded and has no measure part when there is nothing to list", () => {
		const message = buildReverifyMessage({
			task: "Make it work.",
			deliverables: [],
			requirements: [],
			unmeasured: [],
		});
		expect(message).toContain("No deliverables were recorded");
		expect(message).not.toContain("<label> <measured> <op> <limit>");
	});

	it("lists written paths and the task's absolute paths once each, at most 30", () => {
		const written = ["/app/a.txt", "b.py", "/app/a.txt", ...Array.from({ length: 40 }, (_, i) => `/tmp/f${i}`)];
		const paths = reverifyDeliverables(written, ["Save the model to /app/model.bin.", "Write /app/a.txt"]);
		expect(paths.slice(0, 3)).toEqual(["/app/a.txt", "b.py", "/tmp/f0"]);
		expect(new Set(paths).size).toBe(paths.length);
		expect(paths).toHaveLength(FINISH_CHECK_REVERIFY_MAX_DELIVERABLES);
		expect(reverifyDeliverables(["x.txt"], ["Save the model to /app/model.bin."])).toEqual([
			"x.txt",
			"/app/model.bin",
		]);
	});
});

describe("finish-check reverify: fresh context", () => {
	const user = (text: string) => ({ role: "user", content: [{ type: "text", text }] });
	const assistant = (text: string) => ({ role: "assistant", content: [{ type: "text", text }] });

	it("keeps only the verifier instruction and what follows it", () => {
		const instruction = user(`${FINISH_CHECK_REVERIFY_MARKER}\nverify`);
		const messages = [
			user("the task"),
			assistant("I hard-coded 0x400000"),
			{ role: "toolResult", content: [{ type: "text", text: "ok" }] },
			user("Finish check: …"),
			assistant("REQ 1: PASS"),
			instruction,
			assistant("checking"),
			{ role: "toolResult", content: [{ type: "text", text: "got 0x400000" }] },
		];
		expect(freshContextMessages(messages)).toEqual(messages.slice(5));
	});

	it("returns undefined when there is no instruction, and finds a string-content instruction", () => {
		expect(freshContextMessages([user("task"), assistant("done")])).toBeUndefined();
		const messages = [user("task"), { role: "user", content: `${FINISH_CHECK_REVERIFY_MARKER} go` }];
		expect(freshContextMessages(messages)).toEqual(messages.slice(1));
	});
});

describe("finish-check reverify: reply parsing", () => {
	const ELF = "VERIFY 1: FAIL - parse new ELF; expected 0x401000; got 0x400000";

	it("reads VERIFY lines and the VERDICT", () => {
		const reply = `Checked.\n- **VERIFY 2: PASS** - out.txt exists\n${ELF}\nVERDICT: FAIL`;
		expect(parseVerifyReply(reply)).toEqual({
			verdict: "fail",
			findings: [
				{ id: 2, status: "pass", text: "out.txt exists" },
				{ id: 1, status: "fail", text: "parse new ELF; expected 0x401000; got 0x400000" },
			],
			failing: [{ id: 1, status: "fail", text: "parse new ELF; expected 0x401000; got 0x400000" }],
		});
	});

	it("derives the verdict from the lines when VERDICT is missing, and is unreported with no lines", () => {
		expect(parseVerifyReply(ELF).verdict).toBe("fail");
		expect(parseVerifyReply("VERIFY 1: PASS - ok").verdict).toBe("pass");
		expect(parseVerifyReply("All good.")).toEqual({ verdict: "unreported", findings: [], failing: [] });
	});

	it("counts no findings when the verifier says VERDICT: PASS", () => {
		const parsed = parseVerifyReply(`${ELF}\nVERDICT: PASS`);
		expect(parsed.verdict).toBe("pass");
		expect(parsed.findings).toHaveLength(1);
		expect(parsed.failing).toEqual([]);
	});
});

describe("finish-check reverify: fix message and records", () => {
	const COREWARS =
		"Your warrior must achieve at least a 75% win rate (75+ wins out of 100 battles) against `stone.red`.";
	const requirements = extractRequirements(COREWARS);
	const finding = { id: 1, status: "fail" as const, text: "parse new ELF; expected 0x401000; got 0x400000" };

	it("lists findings with the keep-saved-output rule and asks for VERIFY lines again", () => {
		const message = buildReverifyFixMessage([finding], []);
		expect(message).toContain("the task is not complete");
		expect(message).toContain("VERIFY 1: FAIL - parse new ELF; expected 0x401000; got 0x400000");
		expect(message).toContain("Keep the currently saved output in place until a new version measures better");
		expect(message).toContain("Re-run the failing checks");
		expect(message).not.toContain("REQ ");
	});

	it("adds failing REQ items in spec 035's wording", () => {
		const [failing] = parseFinishCheckLedger("REQ 1: PASS - stone 74 >= 75", requirements);
		const message = buildReverifyFixMessage([finding], [failing]);
		expect(message).toContain("VERIFY 1: FAIL");
		expect(message).toContain("stone 74 >= 75");
		expect(message).toContain("`REQ <n>: PASS|FAIL - <label> <measured> <op> <limit>`");
		expect(buildReverifyFixMessage([], [failing])).not.toContain("VERIFY");
	});

	it("merges failing numeric items by id, the check's first", () => {
		const check = parseFinishCheckLedger("REQ 1: FAIL - stone 74 >= 75", requirements);
		const verifier = parseFinishCheckLedger("REQ 1: FAIL - stone 70 >= 75", requirements);
		expect(mergeFailingItems(check, verifier)).toEqual([check[0]]);
		expect(mergeFailingItems([], verifier)).toEqual([verifier[0]]);
		expect(mergeFailingItems(parseFinishCheckLedger("REQ 1: PASS - stone 80 >= 75", requirements), [])).toEqual([]);
	});

	it("sums cost and tokens over the verifier's assistant messages", () => {
		const usage = (cost: number, input: number, output: number) => ({
			input,
			output,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: input + output,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: cost },
		});
		const messages = [
			{ role: "user", content: "x" },
			{ role: "assistant", content: [], usage: usage(0.01, 100, 20) },
			{ role: "toolResult", content: [] },
			{ role: "assistant", content: [], usage: usage(0.02, 200, 30) },
		];
		const totals = verifyUsage(messages);
		expect(totals.costUsd).toBeCloseTo(0.03);
		expect(totals).toMatchObject({ inputTokens: 300, outputTokens: 50, totalTokens: 350 });
		expect(verifyUsage([])).toEqual({ costUsd: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 });
	});
});
