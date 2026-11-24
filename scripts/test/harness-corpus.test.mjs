import assert from "node:assert/strict";
import test from "node:test";
import { parseCorpus, selectCorpus, verifyCorpusReport } from "../lib/harness-corpus.mjs";

function fixture() {
	const entry = (id) => ({ id, file: "test/synthetic.test.ts", name: `synthetic ${id}` });
	return {
		schemaVersion: 1,
		baseline: "a".repeat(40),
		recovery: Array.from({ length: 20 }, (_, i) => entry(`H3-${String(i + 1).padStart(2, "0")}`)),
		security: Array.from({ length: 7 }, (_, i) => ({
			id: `H7-${String(i + 1).padStart(2, "0")}`,
			attack: entry(`attack-${i}`),
			control: entry(`control-${i}`),
		})),
	};
}

function report(corpus) {
	return { success: true, numFailedTestSuites: 0, numFailedTests: 0, testResults: [{
		name: "/fixture/test/synthetic.test.ts",
		assertionResults: selectCorpus(corpus).map(({ name }) => ({ fullName: name, status: "passed" })),
	}] };
}

test("accepts every pinned recovery case and attack/control without claiming model safety", () => {
	const corpus = parseCorpus(fixture());
	assert.equal(selectCorpus(corpus).length, 34);
	assert.deepEqual(verifyCorpusReport(corpus, report(corpus), "/fixture"), { recovery: 20, attacks: 7, controls: 7 });
});

for (const [name, mutate] of [
	["missing recovery", c => c.recovery.pop()],
	["missing control", c => delete c.security[0].control],
	["duplicate identity", c => c.recovery[1] = { ...c.recovery[0], id: "H3-02" }],
	["duplicate id", c => c.recovery[1].id = c.recovery[0].id],
	["traversal", c => c.recovery[0].file = "test/../private.test.ts"],
	["absolute path", c => c.recovery[0].file = "/test/fixture.test.ts"],
	["unknown root key", c => c.command = "echo unsafe"],
	["empty name", c => c.recovery[0].name = ""],
	["unversioned baseline", c => c.baseline = "main"],
]) test(`rejects ${name}`, () => {
	const corpus = fixture();
	mutate(corpus);
	assert.throws(() => parseCorpus(corpus), /invalid_corpus/);
});

for (const status of ["pending", "skipped", "todo", "failed", "disabled"]) test(`does not accept ${status}`, () => {
	const corpus = parseCorpus(fixture());
	const observed = report(corpus);
	observed.testResults[0].assertionResults[0].status = status;
	assert.throws(() => verifyCorpusReport(corpus, observed, "/fixture"), /case_not_passed/);
});

for (const [name, mutate, code] of [
	["missing case", r => r.testResults[0].assertionResults.pop(), "case_cardinality"],
	["duplicate case", r => r.testResults[0].assertionResults.push(r.testResults[0].assertionResults[0]), "case_cardinality"],
	["renamed case", r => r.testResults[0].assertionResults[0].fullName = "renamed", "case_cardinality"],
	["wrong file", r => r.testResults[0].name = "/fixture/test/other.test.ts", "case_cardinality"],
	["hook failure", r => r.numFailedTestSuites = 1, "suite_failed"],
	["reported failure", r => r.success = false, "suite_failed"],
	["extra executed case", r => r.testResults[0].assertionResults.push({ fullName: "unselected", status: "passed" }), "unexpected_case"],
]) test(`rejects ${name} in results`, () => {
	const corpus = parseCorpus(fixture());
	const observed = report(corpus);
	mutate(observed);
	assert.throws(() => verifyCorpusReport(corpus, observed, "/fixture"), new RegExp(code));
});

test("allows only unselected skipped tests and refuses malformed reports", () => {
	const corpus = parseCorpus(fixture());
	const observed = report(corpus);
	observed.testResults[0].assertionResults.push({ fullName: "unselected", status: "pending" });
	assert.equal(verifyCorpusReport(corpus, observed, "/fixture").recovery, 20);
	for (const bad of [null, {}, { ...observed, testResults: null }]) {
		assert.throws(() => verifyCorpusReport(corpus, bad, "/fixture"), /invalid_report|suite_failed/);
	}
});
