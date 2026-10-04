import { fauxAssistantMessage } from "omk-ai";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_ACTION_CONSTRAINTS } from "../../src/metacognition/policy.ts";
import { createInitialMetaState, refreshMetaBudget } from "../../src/metacognition/state.ts";
import { createHarness, type Harness } from "./harness.ts";

let harness: Harness | undefined;

afterEach(() => {
	harness?.cleanup();
	harness = undefined;
});

describe("core metacognition runtime", () => {
	it("starts from a host-owned state with unknown verifier health", () => {
		const state = createInitialMetaState({
			taskId: "session-1",
			stageId: "agent-session",
			targetArtifact: "/workspace",
			goalScope: "runtime-observation",
			candidateHash: "candidate-1",
			environmentHash: "environment-1",
			changeScope: ["src/example.ts"],
			budget: { remainingMs: 10_000, remainingRequests: 4, remainingTokens: 20_000, remainingConcurrent: 2 },
			authorizedActions: DEFAULT_ACTION_CONSTRAINTS.authorizedActions,
		});

		expect(state.obligations).toEqual([]);
		expect(state.verifier.runnerHealth).toBe("unverified");
		expect(state.evidence.report).toBeNull();
		expect(state.policy.authorizedActions).toEqual(DEFAULT_ACTION_CONSTRAINTS.authorizedActions);
		expect(JSON.stringify(state)).not.toContain("system-prompt-secret");
	});

	it("refreshes only bounded budget facts", () => {
		const state = createInitialMetaState({
			taskId: "session-1",
			stageId: "agent-session",
			targetArtifact: "/workspace",
			goalScope: "runtime-observation",
			candidateHash: "candidate-1",
			environmentHash: "environment-1",
			budget: { remainingMs: 10_000, remainingRequests: 4, remainingTokens: 20_000, remainingConcurrent: 2 },
			authorizedActions: DEFAULT_ACTION_CONSTRAINTS.authorizedActions,
		});
		const next = refreshMetaBudget(state, {
			remainingMs: 500,
			remainingRequests: 1,
			remainingTokens: 10_000,
			remainingConcurrent: 1,
		});

		expect(next.budget).toEqual({
			remainingMs: 500,
			remainingRequests: 1,
			remainingTokens: 10_000,
			remainingConcurrent: 1,
		});
		expect(next.checkpointCount).toBe(state.checkpointCount);
		expect(() =>
			refreshMetaBudget(state, {
				remainingMs: -1,
				remainingRequests: 1,
				remainingTokens: 1,
				remainingConcurrent: 1,
			}),
		).toThrow();
	});

	it("advances a real prompt through host checkpoints without changing completion", async () => {
		harness = await createHarness({ settings: { resourceGovernor: { mode: "off" } } });
		harness.setResponses([fauxAssistantMessage("ok")]);

		const before = harness.session.metacognition.state;
		expect(before.checkpointCount).toBe(0);
		await expect(harness.session.prompt("private prompt text")).resolves.toBeUndefined();
		const after = harness.session.metacognition.state;
		const diagnostic = harness.session.metacognition.lastDiagnostic;

		expect(after.checkpointCount).toBeGreaterThanOrEqual(2);
		expect(after.checkpointCount).toBeGreaterThan(before.checkpointCount);
		expect(diagnostic?.schema).toBe("omk.metacognition.diagnostic.v1");
		expect(diagnostic?.taskId).toBe(after.goal.taskId);
		expect(diagnostic?.finishKind).toBe("continue");
		expect(JSON.stringify({ state: after, diagnostic })).not.toContain("private prompt text");
		expect(harness.faux.state.callCount).toBe(1);
	});
});
