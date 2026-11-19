import { parseRunStartCommand, VERIFIED_COMMAND_VERSION, WORKBENCH_CONTROL_VERSION } from "omk-protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAuthorityClock } from "../src/core/verified-run/authority-clock.ts";
import { AuthorityStore } from "../src/core/verified-run/authority-store.ts";
import * as broker from "../src/core/verified-run/broker.ts";
import * as candidate from "../src/core/verified-run/candidate.ts";
import { digestObject } from "../src/core/verified-run/storage.ts";
import {
	validateWorkbenchControlFrame,
	type WorkbenchControlHostContext,
} from "../src/core/verified-run/workbench-control.ts";

function command() {
	return {
		schemaVersion: VERIFIED_COMMAND_VERSION,
		kind: "start",
		runId: "run-1",
		commandId: "command-1",
		expectedRevision: 0,
		expectedGeneration: 0,
		contractDigest: "a".repeat(64),
	};
}
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
		command: command(),
	};
}
const frame = (value: unknown = request()) => new TextEncoder().encode(`${JSON.stringify(value)}\n`);
let host: AbortController;
let peer: AbortController;
let now: number;
let context: WorkbenchControlHostContext;

beforeEach(() => {
	host = new AbortController();
	peer = new AbortController();
	now = 100;
	context = {
		hostId: "host-1",
		hostEpoch: "7",
		hostSignal: host.signal,
		peer: {
			actorId: "operator-1",
			connectionId: "connection-1",
			signal: peer.signal,
			authorizationDeadline: 150,
		},
		graphRevision: 0,
		runState: "absent",
		expectedCommand: parseRunStartCommand(command()),
		clock: createAuthorityClock(() => now),
	};
	for (const name of ["executeSandbox", "probeVerifiedSandbox"] as const) {
		vi.spyOn(broker, name).mockImplementation(() => {
			throw new Error("execution/probe reached");
		});
	}
	vi.spyOn(candidate, "captureCandidate").mockImplementation(() => {
		throw new Error("workspace capture reached");
	});
	vi.spyOn(AuthorityStore.prototype, "acquire").mockImplementation(() => {
		throw new Error("grant issuance reached");
	});
});
afterEach(() => {
	expect(broker.executeSandbox).not.toHaveBeenCalled();
	expect(broker.probeVerifiedSandbox).not.toHaveBeenCalled();
	expect(candidate.captureCandidate).not.toHaveBeenCalled();
	expect(AuthorityStore.prototype.acquire).not.toHaveBeenCalled();
	vi.restoreAllMocks();
});

describe("inactive workbench no-execution control boundary", () => {
	it("validates the actual separate envelope without issuing a capability", () => {
		const result = validateWorkbenchControlFrame(frame(), context);
		expect(result).toEqual({
			schemaVersion: WORKBENCH_CONTROL_VERSION,
			kind: "validated-no-execution",
			requestId: "request-1",
			hostId: "host-1",
			hostEpoch: "7",
			connectionId: "connection-1",
			runId: "run-1",
			commandId: "command-1",
			commandDigest: digestObject(parseRunStartCommand(command())),
			executionRequested: false,
			capabilities: { execute: false, amendGraph: false, publish: false },
		});
		expect(Object.isFrozen(result)).toBe(true);
		expect(Object.isFrozen(result.capabilities)).toBe(true);
	});
	it("refuses missing trusted identity and serialized lookalike lifetime handles", () => {
		expect(() => validateWorkbenchControlFrame(frame(), null)).toThrow(/workbench_unauthenticated/);
		expect(() => validateWorkbenchControlFrame(frame(), { ...context, peer: null })).toThrow(
			/workbench_unauthenticated/,
		);
		expect(() => validateWorkbenchControlFrame(frame(), JSON.parse(JSON.stringify(context)))).toThrow(
			/workbench_unauthenticated/,
		);
	});
	it.each(["hostId", "actorId", "connectionId"])("refuses wire %s impersonation", (field) => {
		expect(() => validateWorkbenchControlFrame(frame({ ...request(), [field]: "other" }), context)).toThrow(
			/workbench_identity/,
		);
	});
	it("refuses the old epoch even if host id, actor and command still match", () => {
		expect(() => validateWorkbenchControlFrame(frame(), { ...context, hostEpoch: "8" })).toThrow(/stale_epoch/);
		expect(() => validateWorkbenchControlFrame(frame({ ...request(), hostEpoch: "8" }), context)).toThrow(
			/stale_epoch/,
		);
	});
	it.each(["runId", "commandId", "contractDigest"])("refuses changed command binding %s", (field) => {
		const value = field === "contractDigest" ? "b".repeat(64) : "other";
		expect(() =>
			validateWorkbenchControlFrame(frame({ ...request(), command: { ...command(), [field]: value } }), context),
		).toThrow(/command_conflict/);
	});
	it.each([{ graphRevision: 1 }, { runState: "present" as const }])("checks the current host state %j", (change) => {
		expect(() => validateWorkbenchControlFrame(frame(), { ...context, ...change })).toThrow(/precondition/);
	});
	it.each([150, 151])("refuses authorization at the exact deadline and later (%d)", (time) => {
		now = time;
		expect(() => validateWorkbenchControlFrame(frame(), context)).toThrow(/authorization_expired/);
	});
	it("does not renew authorization or manufacture a durable reply on retransmission", () => {
		const first = validateWorkbenchControlFrame(frame(), context);
		now = 149;
		expect(validateWorkbenchControlFrame(frame(), context)).toEqual(first);
		now = 150;
		expect(() => validateWorkbenchControlFrame(frame(), context)).toThrow(/authorization_expired/);
	});
	it("uses the host rollback-detecting clock rather than a wire timestamp", () => {
		validateWorkbenchControlFrame(frame(), context);
		now = 99;
		expect(() => validateWorkbenchControlFrame(frame(), context)).toThrow(/clock_anomaly/);
	});
	it.each(["host", "peer"])("refuses revoked %s lifetime", (which) => {
		(which === "host" ? host : peer).abort();
		expect(() => validateWorkbenchControlFrame(frame(), context)).toThrow(/workbench_unauthenticated/);
	});
	it.each(["host", "peer"])("rechecks %s lifetime after the host clock callback", (which) => {
		expect(() =>
			validateWorkbenchControlFrame(frame(), {
				...context,
				clock: () => {
					(which === "host" ? host : peer).abort();
					return now;
				},
			}),
		).toThrow(/workbench_unauthenticated/);
	});
	it("refuses a deadline that passes before the validation reply", () => {
		let reads = 0;
		expect(() =>
			validateWorkbenchControlFrame(frame(), {
				...context,
				clock: () => (++reads === 1 ? 100 : 150),
			}),
		).toThrow(/authorization_expired/);
	});
	it("refuses peer revocation while obtaining the trusted command binding", () => {
		expect(() =>
			validateWorkbenchControlFrame(frame(), {
				...context,
				get expectedCommand() {
					peer.abort();
					return context.expectedCommand;
				},
			}),
		).toThrow(/workbench_unauthenticated/);
	});
});
