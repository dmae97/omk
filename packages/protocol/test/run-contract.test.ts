import { describe, expect, it } from "vitest";
import { parseRunContract, parseRunStartCommand } from "../src/index.ts";

const contract = () => ({
	schemaVersion: "omk.verified-run.v1",
	profile: "linux-command-v1",
	runId: "run-1",
	goal: "Produce the requested greeting",
	workspace: { root: "/project", baseDigest: "a".repeat(64) },
	writablePaths: ["greeting.txt"],
	writer: ["/bin/sh", "-c", "printf hello > greeting.txt"],
	checks: [{ claimId: "greeting", argv: ["/bin/cat", "greeting.txt"], stdout: "hello" }],
	budget: { workMs: 2000, verifyMs: 2000, cleanupMs: 1000, maxOutputBytes: 4096, maxFiles: 100, maxBytes: 65536 },
	apply: "artifact-only",
});

describe("verified run contract boundary", () => {
	it("returns an immutable snapshot rather than caller-owned authority", () => {
		const input = contract();
		const parsed = parseRunContract(input);
		input.writablePaths.push("private");
		expect(parsed.writablePaths).toEqual(["greeting.txt"]);
		expect(Object.isFrozen(parsed.budget)).toBe(true);
		expect(Object.isFrozen(parsed.checks[0].argv)).toBe(true);
	});

	it.each(["schemaVersion", "profile", "apply"])("rejects unsupported %s without downgrading", (key) => {
		expect(() => parseRunContract({ ...contract(), [key]: "unsupported" })).toThrow();
	});

	it.each(["../escape", "/absolute", "a/../b", "a//b", "a/", ".git/config", ".omk/key", "a\\b", "a\u0000b"])(
		"rejects unsafe write scope %s",
		(path) => expect(() => parseRunContract({ ...contract(), writablePaths: [path] })).toThrow(),
	);

	it.each([0, -1, Infinity, NaN, 0.5, 2147483648])("rejects invalid work allocation %s", (workMs) => {
		expect(() => parseRunContract({ ...contract(), budget: { ...contract().budget, workMs } })).toThrow();
	});

	it("rejects empty or duplicate required claims", () => {
		expect(() => parseRunContract({ ...contract(), checks: [] })).toThrow();
		const check = contract().checks[0];
		expect(() => parseRunContract({ ...contract(), checks: [check, check] })).toThrow();
	});

	it("rejects unbounded or relative executable inputs", () => {
		expect(() => parseRunContract({ ...contract(), writer: [] })).toThrow();
		expect(() => parseRunContract({ ...contract(), writer: ["sh"] })).toThrow();
		expect(() =>
			parseRunContract({ ...contract(), workspace: { root: "relative", baseDigest: "invalid" } }),
		).toThrow();
	});

	it("rejects caller-supplied authority and unknown nested fields", () => {
		expect(() => parseRunContract({ ...contract(), approved: true })).toThrow();
		expect(() => parseRunContract({ ...contract(), budget: { ...contract().budget, unlimited: true } })).toThrow();
	});

	it("rejects accessor inputs without evaluating the accessor", () => {
		let accessed = false;
		const input = {
			...contract(),
			get trusted() {
				accessed = true;
				return true;
			},
		};
		expect(() => parseRunContract(input)).toThrow();
		expect(accessed).toBe(false);
	});
});

describe("verified run start command", () => {
	const command = () => ({
		schemaVersion: "omk.verified-command.v1",
		kind: "start",
		runId: "run-1",
		commandId: "command-1",
		expectedRevision: 0,
		expectedGeneration: 0,
		contractDigest: "a".repeat(64),
	});

	it("parses a bounded identity and explicit CAS precondition", () => {
		expect(parseRunStartCommand(command())).toEqual(command());
	});

	it("rejects forged roles and verdicts instead of treating JSON as approval", () => {
		expect(() => parseRunStartCommand({ ...command(), actorRole: "operator" })).toThrow();
		expect(() => parseRunStartCommand({ ...command(), verified: true })).toThrow();
	});

	it.each(["../run", "", "x/y", "a\nb"])("rejects unsafe run identity %s", (runId) => {
		expect(() => parseRunStartCommand({ ...command(), runId })).toThrow();
	});
});
