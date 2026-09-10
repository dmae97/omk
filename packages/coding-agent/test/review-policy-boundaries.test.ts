import { describe, expect, it } from "vitest";
import { createWorkspaceSandboxPolicy } from "../src/core/sandbox/default-policy.ts";
import { decideSandboxFallback, mergeSandboxPolicy, preflightBashSpawn } from "../src/core/sandbox/policy.ts";
import { EvidenceGate, FailClosedMergeGate, TaskContractBuilder } from "../src/guardrails/evidence-system.ts";

describe("review F12: fail-closed gate configuration", () => {
	it("rejects malformed contract JSON without echoing the submitted data", () => {
		let failure: unknown;
		try {
			TaskContractBuilder.fromJSON("fixture-private");
		} catch (error) {
			failure = error;
		}
		expect(failure).toBeInstanceOf(SyntaxError);
		if (!(failure instanceof Error)) throw new Error("Expected parse failure");
		expect(failure.message).not.toContain("fixture-private");
	});

	it("rejects an explicitly empty gate list", () => {
		expect(() => new FailClosedMergeGate([])).toThrow(TypeError);
	});
	it("rejects a sparse gate list instead of treating missing entries as passed", () => {
		const gates: EvidenceGate[] = [];
		gates.length = 1;
		expect(() => new FailClosedMergeGate(gates)).toThrow(TypeError);
	});
	it("pins the configured list against later caller mutation", () => {
		const gates = [new EvidenceGate()];
		const gate = new FailClosedMergeGate(gates);
		gates.length = 0;
		const failed = new TaskContractBuilder("fixture").setClaim("fixture").setVerdict("fail").build();
		expect(gate.check(failed).status).toBe("blocked");
	});
});

describe("review F20: sandbox narrowing", () => {
	it("preserves monotone enforcement for all mode pairs", () => {
		const modes = ["off", "audit", "enforce"] as const;
		for (const baseMode of modes)
			for (const requested of modes) {
				const base = { ...createWorkspaceSandboxPolicy("/work", "enforce"), mode: baseMode };
				const merged = mergeSandboxPolicy(base, { mode: requested });
				expect(modes.indexOf(merged.mode)).toBeGreaterThanOrEqual(modes.indexOf(baseMode));
			}
	});
	it("can narrow a filesystem-root policy instead of misclassifying it as an escape", () => {
		const base = createWorkspaceSandboxPolicy("/", "enforce");
		const merged = mergeSandboxPolicy(base, { filesystem: { ...base.filesystem, root: "/work" } });
		expect(merged.filesystem.root).toBe("/work");
	});

	it.each(["audit", "off"] as const)("does not downgrade enforcement to %s without allowBroaden", (mode) => {
		const base = createWorkspaceSandboxPolicy("/work", "enforce");
		const merged = mergeSandboxPolicy(base, { mode });
		expect(merged.mode).toBe("enforce");
		expect(decideSandboxFallback(merged, { platform: "linux", backendAvailable: false }).allowShell).toBe(false);
	});
	it.each(["/", "/other"])("does not move the root to %s without allowBroaden", (root) => {
		const base = createWorkspaceSandboxPolicy("/work", "enforce");
		const merged = mergeSandboxPolicy(base, { filesystem: { ...base.filesystem, root } });
		expect(merged.filesystem.root).toBe(base.filesystem.root);
		expect(
			preflightBashSpawn(merged, { platform: "linux", backendAvailable: true }, { command: "true", cwd: "/other" })
				.allowed,
		).toBe(false);
	});
	it("keeps supported narrowing and explicit trusted broadening", () => {
		const base = createWorkspaceSandboxPolicy("/work", "audit");
		const narrowed = mergeSandboxPolicy(base, {
			mode: "enforce",
			filesystem: { ...base.filesystem, root: "/work/sub" },
		});
		expect(narrowed.mode).toBe("enforce");
		expect(narrowed.filesystem.root).toBe("/work/sub");
		const explicit = mergeSandboxPolicy(
			narrowed,
			{ mode: "off", filesystem: { ...base.filesystem, root: "/other" } },
			{ allowBroaden: true },
		);
		expect(explicit.mode).toBe("off");
		expect(explicit.filesystem.root).toBe("/other");
	});
});
