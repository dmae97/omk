import assert from "node:assert/strict";
import { test } from "node:test";
import { change, evidence, rejected, run } from "./fixtures/tb21-evidence.mjs";

for (const field of ["started_at", "finished_at"]) {
	for (const value of [null, undefined]) {
		test(`does not summarize a trial whose ${field} is ${String(value)}`, (t) => {
			const fixture = evidence(t);
			change(fixture.result, (r) => {
				r[field] = value;
			});
			rejected(run(fixture), "unfinished_trial");
		});
	}
}

for (const value of [
	"DO_NOT_PRINT",
	"",
	1788770000,
	"2026-02-31T10:00:00Z",
	"2026-09-07T24:00:00Z",
	"2026-09-07T10:00:00",
	"2026-09-07T10:00:00+25:00",
]) {
	test(`rejects invalid or ambiguous finished_at ${JSON.stringify(value)}`, (t) => {
		const fixture = evidence(t);
		change(fixture.result, (r) => {
			r.finished_at = value;
		});
		rejected(run(fixture), "invalid_trial_time");
	});
}

for (const field of ["started_at", "finished_at"]) {
	for (const suffix of ["\n", "\r\n"]) {
		test(`rejects trailing line endings in ${field}: ${JSON.stringify(suffix)}`, (t) => {
			const fixture = evidence(t);
			change(fixture.result, (r) => {
				r[field] = `2026-09-07T10:00:00Z${suffix}`;
			});
			rejected(run(fixture), "invalid_trial_time");
		});
	}
}

test("rejects reversed execution times", (t) => {
	const fixture = evidence(t);
	change(fixture.result, (r) => {
		r.finished_at = "2026-09-07T09:59:59Z";
	});
	rejected(run(fixture), "invalid_trial_time");
});

test("does not erase a reversed sub-millisecond interval during date parsing", (t) => {
	const fixture = evidence(t);
	change(fixture.result, (r) => {
		r.started_at = "2026-09-07T10:00:00.123457Z";
		r.finished_at = "2026-09-07T10:00:00.123456Z";
	});
	rejected(run(fixture), "invalid_trial_time");
});

test("cannot turn an unfinished timeout into a complete report", (t) => {
	const fixture = evidence(t);
	change(fixture.result, (r) => {
		r.finished_at = null;
		r.exception_info = { exception_type: "AgentTimeoutError" };
		r.verifier_result = null;
	});
	rejected(run(fixture), "unfinished_trial");
});

for (const finish of [
	"2026-09-07T11:00:00.123456+01:00",
	"2026-09-07T05:00:00.123456-05:00",
	"2026-09-07T10:00:00.123456001Z",
]) {
	test(`accepts an equal or later instant with explicit offset ${finish}`, (t) => {
		const fixture = evidence(t);
		change(fixture.result, (r) => {
			r.finished_at = finish;
		});
		const result = run(fixture);
		assert.equal(result.status, 0, result.stderr);
		const report = JSON.parse(result.stdout);
		assert.equal(report.schemaVersion, "omk-tb21-audit-report-2");
		assert.equal(report.completionVerification, "recorded-timestamps");
	});
}

test("orders fractional seconds correctly before the Unix epoch", (t) => {
	const fixture = evidence(t);
	change(fixture.result, (r) => {
		r.started_at = "1969-12-31T23:59:59.999999999Z";
		r.finished_at = "1970-01-01T00:00:00Z";
	});
	const result = run(fixture);
	assert.equal(result.status, 0, result.stderr);
});
