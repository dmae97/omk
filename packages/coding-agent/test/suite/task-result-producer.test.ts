import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fauxAssistantMessage } from "omk-ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentSessionEvent } from "../../src/core/agent-session.ts";
import { DurableGoalStore } from "../../src/core/durable-goal-store.ts";
import goalController, { type GoalControllerOptions } from "../../src/core/extensions/builtin/goal-controller.ts";
import type { GoalAcceptanceTestHooks } from "../../src/core/extensions/builtin/goal-controller-acceptance.ts";
import { GoalVerifier } from "../../src/core/goal-verification.ts";
import type { TaskCheckFact, TaskResultDowngradeEvent, TaskResultEvent } from "../../src/core/task-result.ts";
import { taskResultSurfaceLine } from "../../src/core/task-result-format.ts";
import { taskResultStatusLine } from "../../src/modes/interactive/task-result-status.ts";
import { createHarness, type Harness } from "./harness.ts";

/**
 * Spec 100 e2e: the real goal controller, GoalAcceptance and GoalVerifier run real `node --test`
 * checks in a temp git repo; facts come only from the producer. Each case checks the TUI line,
 * the print text line and the RPC wire copy of every task-result event.
 */

const CALC_BROKEN = "export const add = (a, b) => a - b;\n";
const CALC_FIXED = "export const add = (a, b) => a + b;\n";
const CALC_TEST = [
	'import test from "node:test";',
	'import assert from "node:assert";',
	'import { add } from "./calc.mjs";',
	'test("adds", () => assert.equal(add(1, 2), 3));',
	"",
].join("\n");

function initProject(cwd: string, calc: string): void {
	writeFileSync(join(cwd, "calc.mjs"), calc);
	writeFileSync(join(cwd, "calc.test.mjs"), CALC_TEST);
	const git = (...args: string[]) => execFileSync("git", args, { cwd, stdio: "ignore" });
	git("init", "-q");
	git("config", "user.email", "goal@test.invalid");
	git("config", "user.name", "goal");
	git("config", "commit.gpgsign", "false");
	git("add", ".");
	git("commit", "-qm", "init");
}

const keep = process.env.OMK_TASK_RESULT;
const harnesses: Harness[] = [];

beforeEach(() => {
	vi.stubEnv("OMK_BASH_SANDBOX", "off");
	process.env.OMK_TASK_RESULT = "1";
});

afterEach(() => {
	vi.unstubAllEnvs();
	for (const h of harnesses.splice(0)) h.cleanup();
	if (keep === undefined) delete process.env.OMK_TASK_RESULT;
	else process.env.OMK_TASK_RESULT = keep;
});

async function newHarness(calc: string, options: GoalControllerOptions = {}): Promise<Harness> {
	const harness = await createHarness({ extensionFactories: [(omk) => goalController(omk, options)] });
	harnesses.push(harness);
	initProject(harness.tempDir, calc);
	return harness;
}

async function waitIdle(harness: Harness): Promise<void> {
	await vi.waitFor(
		async () => {
			await harness.session.agent.waitForIdle();
			expect(harness.session.isStreaming).toBe(false);
		},
		{ timeout: 20_000, interval: 50 },
	);
}

async function goalStatus(harness: Harness): Promise<string | undefined> {
	return (await new DurableGoalStore(join(harness.tempDir, ".omk", "goals", "current.json")).current())?.status;
}

type TaskEvent = TaskResultEvent | TaskResultDowngradeEvent;

/** Every task-result event, with TUI == print == RPC-wire asserted for each one. */
function taskEvents(harness: Harness): TaskEvent[] {
	const events = harness.events.filter(
		(event): event is AgentSessionEvent & TaskEvent =>
			event.type === "task_result" || event.type === "task_result_downgrade",
	);
	for (const event of events) {
		const wire = JSON.parse(JSON.stringify(event)) as TaskEvent;
		expect(wire).toEqual(event);
		const tui = taskResultStatusLine(event);
		expect(tui).toBeDefined();
		expect(taskResultSurfaceLine(event)).toBe(tui);
		expect(taskResultSurfaceLine(wire)).toBe(tui);
	}
	return events;
}

function finalProjection(harness: Harness) {
	const results = taskEvents(harness).filter((event): event is TaskResultEvent => event.type === "task_result");
	expect(results).toHaveLength(1);
	return (results[0] as TaskResultEvent).projection;
}

/** All facts any event carried, current and attempt history. */
function everyStatus(harness: Harness): string[] {
	return taskEvents(harness).flatMap((event) => {
		const facts: readonly TaskCheckFact[] = event.type === "task_result" ? event.projection.facts : [event.fact];
		return facts.flatMap((fact) => [fact.status, ...(fact.attempts ?? []).map((attempt) => attempt.status)]);
	});
}

function onlyFact(harness: Harness): TaskCheckFact {
	const { facts } = finalProjection(harness);
	expect(facts).toHaveLength(1);
	return facts[0] as TaskCheckFact;
}

describe("spec 100: task_result from the real GoalAcceptanceFlow", () => {
	it("case 1 fail -> fix: one check, two attempts, final pass with counts", async () => {
		const h = await newHarness(CALC_BROKEN);
		h.setResponses([
			fauxAssistantMessage("not yet"),
			() => {
				writeFileSync(join(h.tempDir, "calc.mjs"), CALC_FIXED);
				return fauxAssistantMessage("fixed add");
			},
		]);
		await h.session.prompt("/goal Fix add");
		await h.session.prompt("/goal verify node --test calc.test.mjs");
		await h.session.prompt("go");
		await waitIdle(h);

		expect(await goalStatus(h)).toBe("completed");
		const projection = finalProjection(h);
		expect(projection.check).toBe("passed");
		expect(projection.coverage).toEqual({ checksRun: 1, checksTotal: 1, receiptsObserved: 2 });
		const fact = onlyFact(h);
		expect(fact).toMatchObject({
			status: "passed",
			attempt: 2,
			checkKind: "test_runner",
			tests: { executed: 1, matched: 1, skipped: 0 },
		});
		expect(fact.attempts?.map((a) => [a.attempt, a.status])).toEqual([[1, "failed"]]);
		expect(h.eventsOfType("task_result_downgrade")).toEqual([]);
		expect(taskResultStatusLine(h.eventsOfType("task_result")[0] as TaskResultEvent)).toContain(
			"checks 1/1, receipts 2 [passed test_runner, tests 1 run/1 matched/0 skipped]",
		);
	});

	it("case 2a edit after the check, before publish: stale, no pass ever, goal stays active", async () => {
		let edited = false;
		const testHooks: GoalAcceptanceTestHooks = {
			afterCheckBeforePublish: ({ cwd }) => {
				if (edited) return;
				edited = true;
				writeFileSync(join(cwd, "extra.txt"), "edit\n");
			},
		};
		const h = await newHarness(CALC_FIXED, { testHooks });
		h.setResponses([fauxAssistantMessage("done")]);
		await h.session.prompt("/goal Keep add");
		await h.session.prompt("/goal verify node --test calc.test.mjs");
		await h.session.prompt("go");
		await waitIdle(h);

		expect(edited).toBe(true);
		expect(await goalStatus(h)).toBe("active");
		expect(onlyFact(h)).toMatchObject({ status: "insufficient", reason: "stale" });
		expect(everyStatus(h)).not.toContain("passed");
		expect(h.eventsOfType("task_result_downgrade")).toEqual([]);
		expect(finalProjection(h).check).toBe("insufficient");
	});

	it("case 2b 099 revision refusal: the pass is downgraded to completion_refused at that moment", async () => {
		const testHooks: GoalAcceptanceTestHooks = {
			afterPublishBeforeComplete: ({ goal, acceptance }) =>
				acceptance.approve(goal, "node --test --test-name-pattern=adds calc.test.mjs"),
		};
		const h = await newHarness(CALC_FIXED, { testHooks });
		h.setResponses([fauxAssistantMessage("done")]);
		await h.session.prompt("/goal Keep add");
		await h.session.prompt("/goal verify node --test calc.test.mjs");
		await h.session.prompt("go");
		await waitIdle(h);

		expect(await goalStatus(h)).toBe("active");
		const [downgrade] = h.eventsOfType("task_result_downgrade") as TaskResultDowngradeEvent[];
		expect(downgrade?.fact).toMatchObject({ status: "insufficient", reason: "completion_refused", attempt: 1 });
		expect(downgrade?.fact.detail).toContain("no passing acceptance receipt");
		expectDowngradeBeforeSettle(h);
		expect(onlyFact(h)).toMatchObject({ status: "insufficient", reason: "completion_refused" });
		expect(finalProjection(h).check).toBe("insufficient");
	});

	it("case 2c edit after publish, before complete(): pass then downgrade, identical on every surface", async () => {
		let edited = false;
		const testHooks: GoalAcceptanceTestHooks = {
			afterPublishBeforeComplete: ({ cwd }) => {
				edited = true;
				writeFileSync(join(cwd, "extra.txt"), "edit\n");
			},
		};
		const h = await newHarness(CALC_FIXED, { testHooks });
		h.setResponses([fauxAssistantMessage("done")]);
		await h.session.prompt("/goal Keep add");
		await h.session.prompt("/goal verify node --test calc.test.mjs");
		await h.session.prompt("go");
		await waitIdle(h);

		expect(edited).toBe(true);
		expect(await goalStatus(h)).toBe("active");
		const downgrades = h.eventsOfType("task_result_downgrade") as TaskResultDowngradeEvent[];
		expect(downgrades).toHaveLength(1);
		const downgrade = downgrades[0] as TaskResultDowngradeEvent;
		expect(downgrade.from).toBe("passed");
		expect(downgrade.fact).toMatchObject({
			status: "insufficient",
			reason: "completion_refused",
			attempt: 1,
			tests: { executed: 1, matched: 1, skipped: 0 },
		});
		expect(downgrade.fact.detail).toContain("workspace changed");
		const line = taskResultStatusLine(downgrade);
		expect(line).toMatch(/attempt 1 downgraded: passed -> insufficient\/completion_refused \(the workspace changed/);
		expectDowngradeBeforeSettle(h);
		expect(onlyFact(h)).toMatchObject({ status: "insufficient", reason: "completion_refused" });
	});

	it("case 3 approved check that could not run: not_run, coverage 0/1, never 0/0", async () => {
		let runs = 0;
		const createVerifier: GoalControllerOptions["createVerifier"] = (options) => {
			const real = new GoalVerifier(options);
			return Object.assign(Object.create(real) as GoalVerifier, {
				run: (command: string, signal?: AbortSignal) => {
					runs += 1;
					// The /goal verify approval runs it for real; the turn's check is refused like a sandbox refusal.
					if (runs > 1) throw new Error("sandbox refused the command");
					return real.run(command, signal);
				},
			});
		};
		const h = await newHarness(CALC_FIXED, { createVerifier });
		h.setResponses([fauxAssistantMessage("done")]);
		await h.session.prompt("/goal Keep add");
		await h.session.prompt("/goal verify node --test calc.test.mjs");
		await h.session.prompt("go");
		await waitIdle(h);

		expect(runs).toBe(2);
		expect(await goalStatus(h)).toBe("blocked");
		expect(onlyFact(h)).toMatchObject({ status: "insufficient", reason: "not_run", required: true });
		const projection = finalProjection(h);
		expect(projection.coverage).toEqual({ checksRun: 0, checksTotal: 1, receiptsObserved: 0 });
		expect(taskResultStatusLine(h.eventsOfType("task_result")[0] as TaskResultEvent)).toContain("checks 0/1");
	});

	it("case 3b no approved command: checks total unknown, rendered ?, never 0", async () => {
		const h = await newHarness(CALC_FIXED);
		h.setResponses([fauxAssistantMessage("done")]);
		await h.session.prompt("go");
		await waitIdle(h);

		const projection = finalProjection(h);
		expect(projection.coverage).toEqual({ checksRun: 0, checksTotal: "unknown", receiptsObserved: 0 });
		expect(taskResultStatusLine(h.eventsOfType("task_result")[0] as TaskResultEvent)).toContain("checks 0/?");
	});

	it("case 4 0 tests: zero_tests, never passed; completion behavior unchanged", async () => {
		const h = await newHarness(CALC_FIXED);
		h.setResponses([fauxAssistantMessage("done")]);
		await h.session.prompt("/goal Keep add");
		await h.session.prompt("/goal verify node --test-name-pattern=nomatch calc.test.mjs");
		await h.session.prompt("go");
		await waitIdle(h);

		expect(onlyFact(h)).toMatchObject({
			status: "insufficient",
			reason: "zero_tests",
			tests: { executed: 0, matched: 0, skipped: 0 },
		});
		expect(everyStatus(h)).not.toContain("passed");
		// Spec 100 decision 2: completion logic is unchanged here; blocking is decided later from data.
		expect(await goalStatus(h)).toBe("completed");
	});

	it("case 4b unreadable runner output: unverified_counts with ? counts, never passed", async () => {
		const h = await newHarness(CALC_FIXED);
		h.setResponses([fauxAssistantMessage("done")]);
		await h.session.prompt("/goal Keep add");
		await h.session.prompt("/goal verify node --test --test-reporter=dot calc.test.mjs");
		await h.session.prompt("go");
		await waitIdle(h);

		expect(onlyFact(h)).toMatchObject({
			status: "insufficient",
			reason: "unverified_counts",
			tests: { executed: "unknown", matched: "unknown", skipped: "unknown" },
		});
		expect(everyStatus(h)).not.toContain("passed");
		expect(taskResultStatusLine(h.eventsOfType("task_result")[0] as TaskResultEvent)).toContain(
			"insufficient/unverified_counts test_runner, tests ? run/? matched/? skipped",
		);
	});

	it("case 5 cancel during the check: cancelled, no pass ever emitted", async () => {
		const h = await newHarness(CALC_FIXED);
		h.setResponses([fauxAssistantMessage("done")]);
		await h.session.prompt("/goal Keep add");
		writeFileSync(join(h.tempDir, "gate.sh"), "if [ -f armed ]; then touch started; sleep 30; fi\nexit 0\n");
		await h.session.prompt("/goal verify sh gate.sh");
		writeFileSync(join(h.tempDir, "armed"), "1\n");
		const run = h.session.prompt("go");
		await vi.waitFor(() => expect(existsSync(join(h.tempDir, "started"))).toBe(true), {
			timeout: 20_000,
			interval: 25,
		});
		await h.session.abort();
		await run;
		await waitIdle(h);

		expect(onlyFact(h)).toMatchObject({ status: "cancelled" });
		expect(everyStatus(h)).not.toContain("passed");
		expect(finalProjection(h).check).toBe("cancelled");
		expect(await goalStatus(h)).toBe("active");
	});

	it("flag off: no task-result event of either kind, so print text and RPC output are unchanged", async () => {
		delete process.env.OMK_TASK_RESULT;
		const h = await newHarness(CALC_FIXED, {
			testHooks: {
				afterCheckBeforePublish: () => {
					throw new Error("hook must not run with the flag off");
				},
			},
		});
		h.setResponses([fauxAssistantMessage("done")]);
		await h.session.prompt("/goal Keep add");
		await h.session.prompt("/goal verify node --test calc.test.mjs");
		await h.session.prompt("go");
		await waitIdle(h);

		expect(await goalStatus(h)).toBe("completed");
		expect(h.events.map((event) => taskResultSurfaceLine(event)).filter((line) => line !== undefined)).toEqual([]);
		expect(h.events.some((event) => event.type.startsWith("task_result"))).toBe(false);
	});
});

function expectDowngradeBeforeSettle(h: Harness): void {
	const types = h.events.map((event) => event.type);
	const downgradeAt = types.indexOf("task_result_downgrade");
	expect(downgradeAt).toBeGreaterThanOrEqual(0);
	expect(downgradeAt).toBeLessThan(types.indexOf("prompt_settled"));
	expect(downgradeAt).toBeLessThan(types.indexOf("task_result"));
	// No later turn starts before the downgrade is out.
	expect(types.slice(downgradeAt).includes("turn_start")).toBe(false);
}

const SRC = join(__dirname, "..", "..", "src");

function sourceFiles(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) return sourceFiles(path);
		return entry.name.endsWith(".ts") ? [path] : [];
	});
}

describe("spec 100 guards", () => {
	it("this e2e never hand-builds or hand-publishes a fact", () => {
		const self = readFileSync(__filename, "utf8");
		for (const forbidden of [
			["publish", "HostTaskFact("].join(""),
			["factFrom", "GoalAcceptance("].join(""),
			["notRun", "Fact("].join(""),
			['source: "host', '_receipt"'].join(""),
			["TASK_RESULT_", "FACT_CHANNEL"].join(""),
		]) {
			expect(self.includes(forbidden), forbidden).toBe(false);
		}
	});

	it("test hooks are reachable only through the goalController options argument", () => {
		const users = sourceFiles(SRC)
			.filter((path) => readFileSync(path, "utf8").includes("testHooks"))
			.map((path) => relative(SRC, path).split("\\").join("/"))
			.sort();
		expect(users).toEqual([
			"core/extensions/builtin/goal-controller-acceptance.ts",
			"core/extensions/builtin/goal-controller.ts",
		]);
		// The built-in registration passes the factory itself; the loader calls factories with one argument.
		const registry = readFileSync(join(SRC, "core/extensions/builtin/harness-factories.ts"), "utf8");
		expect(registry).toContain("{ factory: goalController, ");
		const loader = readFileSync(join(SRC, "core/extensions/loader.ts"), "utf8");
		expect(loader.match(/await factory\(([^)]*)\)/g)).toEqual(["await factory(api)", "await factory(api)"]);
		// No env var, flag or setting names the hooks.
		const flow = readFileSync(join(SRC, "core/extensions/builtin/goal-controller-acceptance.ts"), "utf8");
		const hookLines = flow
			.split("\n")
			.filter((line) => /testHooks|afterCheckBeforePublish|afterPublishBeforeComplete/.test(line));
		for (const line of hookLines) expect(line).not.toMatch(/process\.env|getSetting|settings/);
	});
});
