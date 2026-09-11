import { describe, expect, it } from "vitest";
import { parseRunResumeCommand } from "../src/index.ts";

const request = () => ({
	schemaVersion: "omk.verified-command.v1",
	kind: "resume",
	runId: "run-1",
	commandId: "resume-1",
	expectedRevision: 10,
	expectedGeneration: 1,
	contractDigest: "a".repeat(64),
	candidateDigest: "b".repeat(64),
});

describe("fenced resume command", () => {
	it("pins the run, contract, candidate and exact prior owner generation", () => {
		const parsed = parseRunResumeCommand(request());
		expect(parsed).toEqual(request());
		expect(Object.isFrozen(parsed)).toBe(true);
	});
	it.each([0, -1, NaN, Infinity, 0.5])("rejects invalid expected revision %s", (expectedRevision) => {
		expect(() => parseRunResumeCommand({ ...request(), expectedRevision })).toThrow();
	});
	it.each([0, -1, NaN, Infinity, 0.5])("rejects invalid expected generation %s", (expectedGeneration) => {
		expect(() => parseRunResumeCommand({ ...request(), expectedGeneration })).toThrow();
	});
	it("rejects authority fields, foreign paths and missing candidate binding", () => {
		expect(() => parseRunResumeCommand({ ...request(), approved: true })).toThrow();
		expect(() => parseRunResumeCommand({ ...request(), runId: "../other" })).toThrow();
		expect(() => parseRunResumeCommand({ ...request(), candidateDigest: "" })).toThrow();
	});
});
