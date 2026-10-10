import { describe, expect, it } from "vitest";
import { subagentWorkerEnv } from "../examples/extensions/subagent/worker-env.ts";
import {
	FINISH_CHECK_EXTRA_TURN_FRACTION,
	FINISH_CHECK_REVERIFY_FRACTION,
	FINISH_CHECK_SAVE_NOW_FRACTION,
	FINISH_CHECK_SKIP_FRACTION,
	resolveFinishCheckExtraTurn,
	resolveFinishCheckReverify,
	shouldReverify,
} from "../src/core/finish-check.ts";
import { extractRequirements, parseFinishCheckLedger } from "../src/core/finish-check-requirements.ts";
import {
	buildReverifyMessage,
	FINISH_CHECK_REVERIFY_MARKER,
	FINISH_CHECK_REVERIFY_MAX_DELIVERABLES,
	FINISH_CHECK_REVERIFY_SCRATCH_DIR,
	freshContextMessages,
	reverifyDeliverables,
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
