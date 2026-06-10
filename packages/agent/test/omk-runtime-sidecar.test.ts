import { describe, expect, test } from "vitest";
import {
	compileOmkBloatToNlp,
	extractOmkSignalFrame,
	filterOmkMcpConfigForTurn,
	renderOmkUserFacingRoutingNlp,
	selectOmkProviderRuntime,
} from "../src/omk-runtime-sidecar.ts";

describe("OMK runtime sidecar", () => {
	test("extracts compact signal from a noisy prompt envelope", () => {
		const signal = extractOmkSignalFrame({
			rawText: [
				"Selected provider: deepseek",
				"Selected model: deepseek-chat",
				"Turn risk: write",
				"Sandbox: workspace-write",
				"Role: planner",
				"MCP selected [filesystem, omk-project, memory]",
				"Connected MCP [filesystem, omk-project]",
				"Skills selected [omk-typescript-strict, omk-quality-gate]",
				"Hooks selected [pre-shell-guard, protect-secrets]",
				"'memory': McpError",
				'User request: "implement the bridge"',
			].join("\n"),
		});

		expect(signal.provider).toBe("deepseek");
		expect(signal.model).toBe("deepseek-chat");
		expect(signal.risk).toBe("write");
		expect(signal.role).toBe("planner");
		expect(signal.availableMcp).toContain("filesystem");
		expect(signal.connectedMcp).toEqual(["filesystem", "omk-project"]);
		expect(signal.availableHooks).toEqual(["pre-shell-guard", "protect-secrets"]);
		expect(signal.failedMcp).toContain("memory");
	});

	test("compiles model prompt and keeps sidecar authority out of the prompt", () => {
		const result = compileOmkBloatToNlp({
			rawText: 'User request: "fix failing tests"',
			provider: "auto",
			model: "auto",
			role: "executor",
			capabilityEnvelope: {
				mcpEnabled: ["filesystem", "omk-project", "memory"],
				skillsEnabled: ["omk-typescript-strict", "omk-quality-gate", "omk-flow-feature-dev"],
				hooksEnabled: ["pre-shell-guard", "protect-secrets", "post-format"],
				toolsEnabled: true,
				liveRequired: false,
			},
			runtimeStatus: { failedMcpServers: ["memory"], connectedMcpServers: ["filesystem", "omk-project"] },
		});

		expect(result.runtimeSidecar.intent).toBe("code_edit");
		expect(result.runtimeSidecar.requiredMcp).toEqual(["filesystem"]);
		expect(result.runtimeSidecar.connectedMcp).toEqual(["filesystem", "omk-project"]);
		expect(result.runtimeSidecar.disconnectedMcp).toEqual([]);
		expect(result.runtimeSidecar.selectedHooks).toContain("pre-shell-guard");
		expect(result.runtimeSidecar.persona).toContain("executor persona");
		expect(result.modelPrompt).toContain("Connected MCP: filesystem, omk-project");
		expect(result.modelPrompt).toContain("Selected hooks: pre-shell-guard, protect-secrets, post-format");
		expect(result.modelPrompt).toContain("Warnings: memory unavailable or disconnected");
		expect(result.diagnostics.removedSections).toContain("full capability inventory");
	});

	test("filters MCP config for selected sidecar only", () => {
		const filtered = filterOmkMcpConfigForTurn({
			projectMcpConfig: { filesystem: {}, memory: {}, local: {} },
			userMcpConfig: { fetch: {}, github: {} },
			sidecar: {
				provider: "auto",
				model: "auto",
				intent: "web_research",
				risk: "network",
				sandbox: "read-only",
				requiredMcp: ["fetch"],
				optionalMcp: ["memory"],
				connectedMcp: ["fetch"],
				disconnectedMcp: ["memory"],
				disabledMcp: ["memory"],
				selectedSkills: [],
				selectedHooks: [],
				persona: "coordinator persona for web_research",
				failurePolicy: "required-only",
			},
		});

		expect(Object.keys(filtered.mcpServers)).toEqual(["fetch"]);
	});

	test("renders routing explanation and provider runtime mode", () => {
		const nlp = renderOmkUserFacingRoutingNlp({
			intent: "plan",
			role: "planner",
			selected: {
				requiredMcp: [],
				optionalMcp: ["omk-project"],
				connectedMcp: ["omk-project"],
				disconnectedMcp: ["memory"],
				selectedSkills: ["omk-plan-first"],
				selectedHooks: ["session-context"],
				disabledMcp: [],
				persona: "planner persona for plan",
			},
			ignoredMcpCount: 2,
		});

		expect(nlp).toContain("Intent: plan");
		expect(nlp).toContain("Role: planner");
		expect(nlp).toContain("Selected hooks: session-context");
		expect(nlp).toContain("Connected MCP: omk-project");
		expect(nlp).toContain("Disconnected MCP: memory");
		expect(selectOmkProviderRuntime({ provider: "auto", intent: "plan" })).toBe("provider-event");
		expect(selectOmkProviderRuntime({ provider: "auto", intent: "plan", debugRaw: true })).toBe("provider-print");
	});
});
