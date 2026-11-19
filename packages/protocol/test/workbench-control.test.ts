import { describe, expect, it } from "vitest";
import { RunContractError, VERIFIED_COMMAND_VERSION } from "../src/run-contract.ts";
import {
	MAX_WORKBENCH_CONTROL_BYTES,
	parseWorkbenchControlFrame,
	WORKBENCH_CONTROL_VERSION,
} from "../src/workbench-control.ts";

function request() {
	return {
		schemaVersion: WORKBENCH_CONTROL_VERSION,
		kind: "validate-start",
		requestId: "request-1",
		hostId: "host-1",
		hostEpoch: "7",
		actorId: "operator-1",
		connectionId: "connection-1",
		graphRevision: 0,
		expectedState: "absent",
		nodeId: null,
		attempt: null,
		grantDigest: null,
		command: {
			schemaVersion: VERIFIED_COMMAND_VERSION,
			kind: "start",
			runId: "run-1",
			commandId: "command-1",
			expectedRevision: 0,
			expectedGeneration: 0,
			contractDigest: "a".repeat(64),
		},
	};
}
const frame = (value: unknown = request()) => new TextEncoder().encode(`${JSON.stringify(value)}\n`);

describe("separate no-execution workbench control frame", () => {
	it("parses a versioned immutable initial-state validation request", () => {
		const parsed = parseWorkbenchControlFrame(frame());
		expect(parsed).toEqual(request());
		expect(Object.isFrozen(parsed)).toBe(true);
		expect(Object.isFrozen(parsed.command)).toBe(true);
		expect(parsed.schemaVersion).not.toBe(VERIFIED_COMMAND_VERSION);
		expect(parsed.schemaVersion).not.toBe("omk.native-agent.v1");
	});
	it.each([
		{ schemaVersion: VERIFIED_COMMAND_VERSION },
		{ schemaVersion: "omk.native-agent.v1" },
		{ kind: "execute" },
		{ kind: "reconnect" },
		{ graphRevision: 1 },
		{ expectedState: "running" },
		{ nodeId: "task-1" },
		{ attempt: 1 },
		{ grantDigest: "b".repeat(64) },
		{ approved: true },
		{ executionRequested: true },
		{ authorizationDeadline: Number.MAX_SAFE_INTEGER },
		{ actorId: "../operator" },
	])("rejects unsupported or caller-supplied authority %j", (change) => {
		expect(() => parseWorkbenchControlFrame(frame({ ...request(), ...change }))).toThrow(RunContractError);
	});
	it.each(["0", "01", "-1", "1e2", "9".repeat(41)])("rejects noncanonical/oversized host epoch %s", (hostEpoch) => {
		expect(() => parseWorkbenchControlFrame(frame({ ...request(), hostEpoch }))).toThrow(RunContractError);
	});
	it.each(["nodeId", "attempt", "grantDigest"])("requires explicit nullable binding %s", (field) => {
		const value: Record<string, unknown> = request();
		delete value[field];
		expect(() => parseWorkbenchControlFrame(frame(value))).toThrow(RunContractError);
	});
	it("rejects bare legacy commands and nested arrays or extra fields", () => {
		expect(() => parseWorkbenchControlFrame(frame(request().command))).toThrow(RunContractError);
		expect(() => parseWorkbenchControlFrame(frame([]))).toThrow(RunContractError);
		expect(() => parseWorkbenchControlFrame(frame({ ...request(), command: [] }))).toThrow(RunContractError);
		expect(() =>
			parseWorkbenchControlFrame(frame({ ...request(), command: { ...request().command, approved: true } })),
		).toThrow(RunContractError);
	});
	it.each(['"requestId":"other","requestId"', '"requestId":"other","\\u0072equestId"'])(
		"rejects duplicate or escaped-equivalent request keys %s",
		(replacement) => {
			const text = JSON.stringify(request()).replace('"requestId"', replacement);
			expect(() => parseWorkbenchControlFrame(new TextEncoder().encode(`${text}\n`))).toThrow(RunContractError);
		},
	);
	it("rejects noncompact JSON, repeated frames, CRLF and missing LF", () => {
		const text = JSON.stringify(request());
		for (const value of [text, ` ${text}\n`, `${text}\r\n`, `${text}\n${text}\n`, "\n", "{}\n"]) {
			expect(() => parseWorkbenchControlFrame(new TextEncoder().encode(value))).toThrow(RunContractError);
		}
	});
	it("bounds bytes and rejects malformed UTF-8 and BOM without reflecting input", () => {
		for (const value of [
			new Uint8Array(),
			new Uint8Array([0xc3, 0x28, 10]),
			new Uint8Array([239, 187, 191, ...frame()]),
			new TextEncoder().encode(`${"x".repeat(MAX_WORKBENCH_CONTROL_BYTES + 1)}\n`),
		]) {
			expect(() => parseWorkbenchControlFrame(value)).toThrow(RunContractError);
		}
	});
});
