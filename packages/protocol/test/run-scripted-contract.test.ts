import { describe, expect, it } from "vitest";
import { parseRunContract } from "../src/index.ts";

function input() {
	return {
		schemaVersion: "omk.verified-run.v1",
		profile: "linux-scripted-agent-v1",
		runId: "scripted",
		goal: "Execute approved steps",
		workspace: { root: "/workspace", baseDigest: "a".repeat(64) },
		writablePaths: ["output"],
		writer: { kind: "scripted-agent", steps: [["/bin/true"]], maxRequests: 2 },
		checks: [{ claimId: "result", argv: ["/bin/true"], stdout: "" }],
		budget: { workMs: 1000, verifyMs: 1000, cleanupMs: 1000, maxOutputBytes: 1024, maxFiles: 10, maxBytes: 1024 },
		apply: "artifact-only",
	};
}

describe("scripted AgentSession contract", () => {
	it("snapshots every step and refuses caller mutation of the model request cap", () => {
		const raw = input();
		const contract = parseRunContract(raw);
		raw.writer.steps[0].push("outside");
		raw.writer.maxRequests = 100;
		if (contract.profile !== "linux-scripted-agent-v1") throw new Error("wrong profile");
		expect(contract.writer.steps).toEqual([["/bin/true"]]);
		expect(contract.writer.maxRequests).toBe(2);
		expect(Object.isFrozen(contract.writer.steps[0])).toBe(true);
	});

	it.each([0, -1, 33, Infinity, NaN, 0.5])("rejects invalid logical request cap %s", (maxRequests) => {
		const raw = input();
		raw.writer.maxRequests = maxRequests;
		expect(() => parseRunContract(raw)).toThrow();
	});

	it.each([{ steps: [] }, { steps: Array.from({ length: 17 }, () => ["/bin/true"]) }, { steps: [["relative"]] }])(
		"rejects an invalid step list",
		({ steps }) => {
			const raw = input();
			raw.writer.steps = steps;
			expect(() => parseRunContract(raw)).toThrow();
		},
	);

	it("does not accept arbitrary provider configuration or authority fields", () => {
		const raw = input();
		expect(() => parseRunContract({ ...raw, writer: { ...raw.writer, provider: "live" } })).toThrow();
		expect(() => parseRunContract({ ...raw, writer: { ...raw.writer, trusted: true } })).toThrow();
	});
});
