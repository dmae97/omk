import { describe, expect, it } from "vitest";
import { parseRunWriterRestartCommand } from "../src/index.ts";

const request = () => ({
	schemaVersion: "omk.verified-command.v1",
	kind: "restart_writer",
	runId: "run",
	commandId: "restart",
	expectedRevision: 5,
	expectedGeneration: 1,
	contractDigest: "a".repeat(64),
	baseDigest: "b".repeat(64),
});

describe("writer restart command", () => {
	it("binds the exact input checkpoint and prior generation", () => {
		const parsed = parseRunWriterRestartCommand(request());
		expect(parsed).toEqual(request());
		expect(Object.isFrozen(parsed)).toBe(true);
	});
	it.each([0, -1, Infinity, NaN, 0.5])("rejects invalid generation %s", (expectedGeneration) => {
		expect(() => parseRunWriterRestartCommand({ ...request(), expectedGeneration })).toThrow();
	});
	it.each(["../run", "", "/root"])('rejects unsafe run ID "%s"', (runId) => {
		expect(() => parseRunWriterRestartCommand({ ...request(), runId })).toThrow();
	});
	it("rejects missing input, wrong action, and forged authority", () => {
		expect(() => parseRunWriterRestartCommand({ ...request(), baseDigest: "" })).toThrow();
		expect(() => parseRunWriterRestartCommand({ ...request(), kind: "resume" })).toThrow();
		expect(() => parseRunWriterRestartCommand({ ...request(), approved: true })).toThrow();
	});
});
