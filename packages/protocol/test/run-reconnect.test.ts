import { describe, expect, it } from "vitest";
import { parseRunReconnectCommand, VERIFIED_COMMAND_VERSION } from "../src/index.ts";

const command = {
	schemaVersion: VERIFIED_COMMAND_VERSION,
	kind: "reconnect",
	runId: "run-1",
	commandId: "observe-1",
	executionId: "12345678-1234-4234-8234-123456789abc",
	expectedRevision: 6,
	expectedGeneration: 1,
	contractDigest: "a".repeat(64),
};
describe("same-execution reconnect command", () => {
	it("preserves the original execution and generation bindings", () => {
		expect(parseRunReconnectCommand(command)).toEqual(command);
		expect(Object.isFrozen(parseRunReconnectCommand(command))).toBe(true);
	});
	it.each([
		{ kind: "restart_writer" },
		{ schemaVersion: "unknown" },
		{ executionId: "../other" },
		{ executionId: "1".repeat(32) },
		{ expectedGeneration: 0 },
		{ expectedRevision: -1 },
		{ contractDigest: "bad" },
		{ extra: "approve" },
	])("rejects invalid or ambiguous input %j", (patch) => {
		expect(() => parseRunReconnectCommand({ ...command, ...patch })).toThrow();
	});
});
