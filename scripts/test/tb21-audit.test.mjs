import assert from "node:assert/strict";
import { cpSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { change, digest, evidence, rejected, run } from "./fixtures/tb21-evidence.mjs";

test("audits explicit paired jobs without rewriting inputs or claiming wire verification", (t) => {
	const fixture = evidence(t);
	const before = digest(fixture.result);
	const result = run(fixture);
	assert.equal(result.status, 0, result.stderr);
	const report = JSON.parse(result.stdout);
	assert.equal(report.status, "complete");
	assert.equal(report.manifestSha256, digest(fixture.manifestPath));
	assert.equal(report.modelVerification, "configuration-only");
	assert.equal(report.costSource, "harbor-agent-result");
	assert.deepEqual(report.paired, { n11: 1, n00: 1, n10: 0, n01: 0, deltaPp: 0 });
	assert.deepEqual(report.arms.A, { tasks: 2, solved: 1, exceptions: 0, costUsd: 4, costPerSolved: 4 });
	assert.equal(report.arms.B.costUsd, 2);
	assert.equal(report.evidence.length, 4);
	assert.equal(digest(fixture.result), before);
	assert.doesNotMatch(result.stdout, /DO_NOT_PRINT|\/private\//u);
	assert.ok(!result.stdout.includes(fixture.root));
	assert.equal(result.stdout, run(fixture).stdout);
});

const invalidResults = [
	[
		"missing cost",
		(r) => {
			delete r.agent_result.cost_usd;
		},
		"missing_cost",
	],
	[
		"null cost",
		(r) => {
			r.agent_result.cost_usd = null;
		},
		"missing_cost",
	],
	[
		"negative cost",
		(r) => {
			r.agent_result.cost_usd = -1;
		},
		"invalid_cost",
	],
	[
		"string cost",
		(r) => {
			r.agent_result.cost_usd = "2";
		},
		"invalid_cost",
	],
	[
		"model mismatch",
		(r) => {
			r.config.agent.model_name = "other/model";
		},
		"model_mismatch",
	],
	[
		"task checksum mismatch",
		(r) => {
			r.task_checksum = "f".repeat(64);
		},
		"task_checksum_mismatch",
	],
	[
		"unknown task",
		(r) => {
			r.task_name = "unlisted-task";
		},
		"unexpected_task",
	],
	[
		"duplicate task",
		(r) => {
			r.task_name = "task-two";
		},
		"duplicate_task",
	],
	[
		"trial directory mismatch",
		(r) => {
			r.trial_name = "other-trial";
		},
		"trial_name_mismatch",
	],
	[
		"nonbinary reward",
		(r) => {
			r.verifier_result.rewards.reward = 0.5;
		},
		"invalid_reward",
	],
	[
		"string reward",
		(r) => {
			r.verifier_result.rewards.reward = "1";
		},
		"invalid_reward",
	],
	[
		"missing verifier result",
		(r) => {
			r.verifier_result = null;
		},
		"missing_reward",
	],
	[
		"missing exception status",
		(r) => {
			delete r.exception_info;
		},
		"invalid_exception",
	],
	[
		"contradictory success",
		(r) => {
			r.exception_info = { exception_type: "AgentTimeoutError" };
		},
		"contradictory_success",
	],
];
for (const [name, mutate, code] of invalidResults) {
	test(`refuses a summary on ${name}`, (t) => {
		const fixture = evidence(t);
		change(fixture.result, mutate);
		rejected(run(fixture), code);
	});
}

test("keeps a timed-out task in the denominator when its cost is known", (t) => {
	const fixture = evidence(t);
	change(fixture.result, (r) => {
		r.verifier_result = null;
		r.exception_info = { exception_type: "AgentTimeoutError", exception_message: "DO_NOT_PRINT" };
	});
	const result = run(fixture);
	assert.equal(result.status, 0, result.stderr);
	const report = JSON.parse(result.stdout);
	assert.deepEqual(report.arms.A, { tasks: 2, solved: 0, exceptions: 1, costUsd: 4, costPerSolved: null });
	assert.equal(report.paired.n01, 1);
	assert.equal(report.paired.deltaPp, -50);
	assert.doesNotMatch(result.stdout, /DO_NOT_PRINT/u);
});

test("accepts a measured zero cost instead of confusing it with missing data", (t) => {
	const fixture = evidence(t);
	change(fixture.result, (r) => {
		r.agent_result.cost_usd = 0;
	});
	const result = run(fixture);
	assert.equal(result.status, 0, result.stderr);
	assert.equal(JSON.parse(result.stdout).arms.A.costUsd, 2);
});

for (const missing of ["trial", "result"]) {
	test(`rejects a missing ${missing}`, (t) => {
		const fixture = evidence(t);
		rmSync(missing === "trial" ? join(fixture.root, "arm-a", "A-task-one") : fixture.result, { recursive: true });
		rejected(run(fixture), missing === "trial" ? "trial_count_mismatch" : "invalid_result_file");
	});
}

test("rejects an extra attempt rather than overwriting the task", (t) => {
	const fixture = evidence(t);
	cpSync(join(fixture.root, "arm-a", "A-task-one"), join(fixture.root, "arm-a", "A-task-one-retry"), {
		recursive: true,
	});
	rejected(run(fixture), "trial_count_mismatch");
});

test("rejects a trial id reused across arms", (t) => {
	const fixture = evidence(t);
	const id = JSON.parse(readFileSync(fixture.result, "utf8")).id;
	change(join(fixture.root, "arm-b", "B-task-one", "result.json"), (r) => {
		r.id = id;
	});
	rejected(run(fixture), "duplicate_trial_id");
});

test("keeps private raw trial identifiers out of the report", (t) => {
	const fixture = evidence(t);
	change(fixture.result, (r) => {
		r.id = "DO_NOT_PRINT";
	});
	const result = run(fixture);
	assert.equal(result.status, 0, result.stderr);
	assert.doesNotMatch(result.stdout, /DO_NOT_PRINT/u);
});

test("rejects total cost overflow", (t) => {
	const fixture = evidence(t);
	for (const trial of ["A-task-one", "A-task-two"]) {
		change(join(fixture.root, "arm-a", trial, "result.json"), (r) => {
			r.agent_result.cost_usd = 1e308;
		});
	}
	rejected(run(fixture), "cost_overflow");
});

test("rejects nonfinite cost parsed from JSON exponent overflow", (t) => {
	const fixture = evidence(t);
	writeFileSync(fixture.result, readFileSync(fixture.result, "utf8").replace('"cost_usd":2', '"cost_usd":1e999'));
	rejected(run(fixture), "invalid_cost");
});
