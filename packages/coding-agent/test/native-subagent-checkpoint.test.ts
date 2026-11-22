import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { parsePatch } from "diff";
import { describe, expect, it } from "vitest";

const patch = parsePatch(
	readFileSync(fileURLToPath(new URL("../resources/native-subagents/0.78.0.patch", import.meta.url)), "utf8"),
).find((entry) => entry.newFileName === "src/runs/background/subagent-runner.js")!;
// Execute the shipped repair's actual sections, without loading a personal package or a model.
const source = patch.hunks
	.map((hunk) =>
		hunk.lines
			.filter((line) => !line.startsWith("-"))
			.map((line) => line.slice(1))
			.join("\n"),
	)
	.join("\n");
const helperStart = source.indexOf("    const deliverDeadlineCheckpoint = (flatIndex) => {");
const helper = source.slice(helperStart, source.indexOf("\n    };", helperStart) + 7);
const boundaryStart = source.indexOf(
	'        if (event.type === "turn_end" && pendingDeadlineCheckpoints.delete(flatIndex)) {',
);
const boundary = source.slice(boundaryStart, source.indexOf("\n        syncTopLevelCurrentTool();", boundaryStart));
const scheduling = source.slice(
	source.indexOf("    if (config.deadlineAt !== undefined) {"),
	source.indexOf("    appendJsonl(eventsPath"),
);

type Reply = { role: string; stopReason: string; content: { type: string; text?: string }[]; errorMessage?: string };
const finalReply: Reply = { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "done" }] };
const toolReply: Reply = { role: "assistant", stopReason: "toolUse", content: [{ type: "toolCall" }] };

function schedule(lead = 30000, now = 0) {
	const timers: { fn: () => void; at: number; delay: number }[] = [];
	const steers: { targetIndex: number; source: string; message: string }[] = [];
	const state = { now, timedOut: false, stopped: false, interrupted: false };
	const context = {
		config: { timeoutMs: 180000, deadlineAt: 180000, checkpointBeforeDeadlineMs: lead },
		Date: { now: () => state.now },
		setTimeout: (fn: () => void, delay: number) => {
			const timer = { fn, delay, at: state.now + delay, unref() {} };
			timers.push(timer);
			return timer;
		},
		timeoutRunner: () => {
			state.timedOut = true;
		},
		timeoutTimer: undefined,
		checkpointTimer: undefined,
		get timedOut() {
			return state.timedOut;
		},
		get stopped() {
			return state.stopped;
		},
		get interrupted() {
			return state.interrupted;
		},
		statusPayload: { state: "running", steps: [{ status: "running" }] },
		flatSteps: [{}] as { runner?: { type: string } }[],
		pendingDeadlineCheckpoints: new Set<number>(),
		deliverSteerRequest: (request: (typeof steers)[number]) => steers.push(request),
	};
	vm.runInNewContext(`${helper}\n${scheduling}`, context);
	return {
		timers,
		steers,
		state,
		context,
		turnEnd(message: Reply, index = 0) {
			vm.runInNewContext(
				boundary,
				Object.assign(context, { event: { type: "turn_end", message }, flatIndex: index }),
			);
		},
	};
}

describe("shipped native deadline checkpoint repair", () => {
	it("retains the original absolute deadline through slow bootstrap", () => {
		const run = schedule(30000, 73000);
		expect(run.timers.map((timer) => [timer.delay, timer.at])).toEqual([
			[107000, 180000],
			[77000, 150000],
		]);
		run.state.now = 180000;
		run.timers[0].fn();
		expect(run.state.timedOut).toBe(true);
		expect(run.context.config.deadlineAt).toBe(180000);
	});

	it("never adds a second model turn after a successful final answer", () => {
		const run = schedule();
		run.state.now = 150000;
		run.timers[1].fn();
		expect(run.steers).toHaveLength(0);
		run.turnEnd(finalReply);
		expect(run.steers).toHaveLength(0);
		expect(run.context.pendingDeadlineCheckpoints.size).toBe(0);
	});

	it("delivers once after an unfinished tool turn", () => {
		const run = schedule();
		run.state.now = 150000;
		run.timers[1].fn();
		run.state.now = 155000;
		run.turnEnd(toolReply);
		run.turnEnd(toolReply);
		expect(run.steers).toHaveLength(1);
		expect(run.steers[0]).toMatchObject({ targetIndex: 0, source: "deadline-checkpoint" });
		expect(run.steers[0].message).toContain("about 25 seconds");
	});

	it.each(["timedOut", "stopped", "interrupted"] as const)("cannot revive a %s child", (flag) => {
		const run = schedule();
		run.state.now = 150000;
		run.timers[1].fn();
		run.state[flag] = true;
		run.turnEnd(toolReply);
		expect(run.steers).toHaveLength(0);
	});

	it.each(["expired", "step-complete", "run-complete"])("cannot deliver to %s state", (state) => {
		const run = schedule();
		run.state.now = 150000;
		run.timers[1].fn();
		if (state === "expired") run.state.now = 180001;
		if (state === "step-complete") run.context.statusPayload.steps[0].status = "complete";
		if (state === "run-complete") run.context.statusPayload.state = "complete";
		run.turnEnd(toolReply);
		expect(run.steers).toHaveLength(0);
	});

	it("keeps parallel checkpoint disposition independent", () => {
		const run = schedule();
		run.context.statusPayload.steps.push({ status: "running" });
		run.context.flatSteps.push({});
		run.state.now = 150000;
		run.timers[1].fn();
		run.turnEnd(finalReply, 0);
		run.turnEnd(toolReply, 1);
		expect(run.steers.map((steer) => steer.targetIndex)).toEqual([1]);
	});

	it("delivers external CLI checkpoints without native events", () => {
		const run = schedule();
		run.context.flatSteps[0].runner = { type: "external-cli" };
		run.state.now = 150000;
		run.timers[1].fn();
		expect(run.steers).toHaveLength(1);
	});

	it.each([
		{ ...finalReply, content: [] },
		{ ...finalReply, content: [{ type: "text", text: "  " }] },
		{ ...finalReply, errorMessage: "failed" },
		{ ...finalReply, content: [...finalReply.content, ...toolReply.content] },
	])("retains the checkpoint for a nonterminal reply %#", (reply) => {
		const run = schedule();
		run.state.now = 150000;
		run.timers[1].fn();
		run.turnEnd(reply);
		expect(run.steers).toHaveLength(1);
	});
});
