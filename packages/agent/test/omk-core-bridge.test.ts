import { describe, expect, test } from "vitest";
import { createOmkCoreBridge, routeOmkTask, runOmkLoop, verifyOmkEvidenceGate } from "../src/omk-core-bridge.ts";

describe("OMK core bridge", () => {
	test("routes merge work to runtimes with merge authority", () => {
		const decision = routeOmkTask(
			{ goal: "OMK foundation", prompt: "merge the TUI and run baseline checks", role: "coordinator" },
			[
				{ id: "read-only", priority: 10, capabilities: { read: true } },
				{ id: "workspace", priority: 20, capabilities: { write: true, patch: true, shell: true, merge: true } },
			],
		);

		expect(decision.risk).toBe("merge");
		expect(decision.selectedRuntime).toBe("workspace");
		expect(decision.fallbackChain).toEqual(["workspace"]);
		expect(decision.sandboxMode).toBe("workspace-write");
	});

	test("blocks completion when evidence is required but absent", () => {
		const decision = routeOmkTask({ goal: "OMK", prompt: "implement control loop", role: "coder" });
		const gate = verifyOmkEvidenceGate(decision, []);

		expect(decision.evidenceRequired).toBe(true);
		expect(gate.passed).toBe(false);
		expect(gate.reason).toContain("Evidence is required");
	});

	test("summarizes verify-to-control loop after accepted evidence", () => {
		const bridge = createOmkCoreBridge();
		const result = bridge.runLoop(
			{ goal: "OMK", prompt: "implement routing", role: "coder" },
			[{ id: "workspace", capabilities: { write: true, patch: true } }],
			[{ kind: "command", passed: true, summary: "focused test passed" }],
		);

		expect(result.evidenceGate.passed).toBe(true);
		expect(result.control.label).toBe("OMK://CONTROL");
		expect(result.control.phase).toBe("control");
		expect(result.control.summary).toContain("ready");
	});

	test("keeps read-only review routes evidence-aware", () => {
		const result = runOmkLoop({ goal: "OMK", prompt: "review docs only", role: "reviewer" });

		expect(result.route.readOnly).toBe(true);
		expect(result.route.evidenceRequired).toBe(true);
		expect(result.control.status).toBe("blocked");
	});
});
