import { Agent, type AgentMessage, type AgentTool } from "omk-agent-core";
import { type Api, type AssistantMessage, type Context, createAssistantMessageEventStream, type Model } from "omk-ai";
import { Type } from "typebox";
import { describe, expect, it } from "vitest";
import type { CompactionSettings } from "../src/core/compaction/compaction-headroom.ts";
import type { TokenCounterAdapter } from "../src/core/context-budget-token-counter.ts";
import { GoalAcceptance } from "../src/core/goal-acceptance.ts";
import {
	factFromRequiredCapabilityUnavailable,
	isRequiredToolsEnabled,
	RequiredCapabilityUnavailable,
	type RequiredToolContract,
} from "../src/core/required-tools.ts";
import { SessionTurnAdmission, type SessionTurnAdmissionHost } from "../src/core/session-turn-admission.ts";
import { mcpToolGroup } from "../src/core/tool-schema-budget.ts";

const counter: TokenCounterAdapter = {
	id: "quarter",
	priority: 0,
	isAvailable: () => true,
	supports: () => true,
	countText: (input, modelId) => ({
		tokens: Math.ceil(input.length / 4),
		method: "estimated",
		confidence: "high",
		adapterId: "quarter",
		modelId,
		notes: [],
	}),
};
const settings: CompactionSettings = {
	enabled: true,
	reserveTokens: 8192,
	keepRecentTokens: 10000,
	maxUsageRatio: 0.7,
};
const model = {
	id: "window-262000",
	name: "test",
	api: "openai-completions",
	provider: "test",
	baseUrl: "http://localhost",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 262_000,
	maxTokens: 16384,
} as Model<Api>;
function tool(name: string, tokens: number): AgentTool {
	return {
		name,
		label: name,
		description: "d".repeat(tokens * 4),
		parameters: Type.Object({}),
		execute: async () => ({ content: [], details: {} }),
	};
}
const user: AgentMessage = { role: "user", content: [{ type: "text", text: "hello" }], timestamp: 1 };
const catalog = () => [
	tool("read", 100),
	tool("notion__query", 100_000),
	tool("runpod__create", 50_000),
	tool("github__pr", 5_000),
];
const ON = { OMK_REQUIRED_TOOLS: "1" };

function harness(options: {
	tools: AgentTool[];
	env?: NodeJS.ProcessEnv;
	contract?: () => RequiredToolContract | undefined;
	withHook?: boolean;
}) {
	const notices: string[] = [];
	const compactions: number[] = [];
	const state = { systemPrompt: "system", messages: [] as AgentMessage[], tools: options.tools };
	const host: SessionTurnAdmissionHost = {
		model: () => model,
		state: () => state,
		contextWindow: (_p, window) => window,
		compactionSettings: () => settings,
		latestCompactionTimestamp: () => undefined,
		toolGroup: (name) => (name.includes("__") ? mcpToolGroup(name) : undefined),
		compact: async () => {
			compactions.push(1);
		},
		notify: (message) => notices.push(message),
		...(options.withHook === false
			? {}
			: { requiredTools: options.contract ?? (() => undefined), env: options.env ?? {} }),
	};
	const admission = new SessionTurnAdmission(host);
	const sent = () => admission.fitTools(state.tools, []).map((t) => t.name);
	return { admission, state, notices, compactions, sent };
}
const contract = (tools: string[], id = "seg-1"): RequiredToolContract => ({
	taskSegmentId: id,
	tools: new Set(tools),
	source: "acceptance",
});

describe("spec 104: required-tool contract in turn admission", () => {
	it("flag is off by default", () => {
		expect(isRequiredToolsEnabled({})).toBe(false);
		expect(isRequiredToolsEnabled(ON)).toBe(true);
	});

	it("1. flag off: sent tools, schema bytes and notices equal main for an over-budget MCP set", async () => {
		const base = harness({ tools: catalog(), withHook: false });
		const off = harness({ tools: catalog(), env: {}, contract: () => contract(["notion__query"]) });
		await base.admission.admit([user], counter);
		await off.admission.admit([user], counter);
		const bytes = (h: ReturnType<typeof harness>) =>
			JSON.stringify(h.admission.fitTools(h.state.tools, []).map((t) => [t.name, t.description, t.parameters]));
		expect(bytes(off)).toBe(bytes(base));
		expect(off.sent()).toEqual(["read", "runpod__create", "github__pr"]);
		expect(off.notices).toEqual(base.notices);
	});

	it("2. required tool in the largest group: that group stays, the next-largest optional group is withheld", async () => {
		const h = harness({ tools: catalog(), env: ON, contract: () => contract(["notion__query"]) });
		await h.admission.admit([user], counter);
		expect(h.sent()).toEqual(["read", "notion__query", "github__pr"]);
		expect(h.notices.at(-1)).toContain("runpod");
	});

	it("3. required groups alone exceed the ceiling after one compaction: RequiredCapabilityUnavailable, never complete", async () => {
		const h = harness({
			tools: [tool("read", 100), tool("notion__query", 250_000)],
			env: ON,
			contract: () => contract(["notion__query"]),
		});
		const error = await h.admission.admit([user], counter).catch((e: unknown) => e);
		expect(error).toBeInstanceOf(RequiredCapabilityUnavailable);
		expect((error as RequiredCapabilityUnavailable).missing).toEqual(["notion__query"]);
		expect(h.compactions.length).toBeLessThanOrEqual(1);
		const fact = factFromRequiredCapabilityUnavailable(error as RequiredCapabilityUnavailable);
		expect(fact).toMatchObject({ status: "insufficient", reason: "required_capability_missing", required: true });

		const acceptance = new GoalAcceptance();
		const at = "2026-10-21T00:00:00.000Z";
		const goal = { ref: { id: "g1" }, createdAt: at, updatedAt: at, generationStartedAt: at } as never;
		let transitions = 0;
		const store = { transition: () => transitions++ } as never;
		acceptance.recordRequiredCapabilityMissing(goal, (error as RequiredCapabilityUnavailable).missing);
		await expect(acceptance.complete(store, goal, "/nonexistent")).rejects.toThrow("required tools unavailable");
		expect(transitions).toBe(0);
		acceptance.forget(goal);
		await acceptance.complete(store, goal, "/nonexistent");
		expect(transitions).toBe(1);
	});

	it("flag off keeps today's error for the same over-ceiling set", async () => {
		const h = harness({
			tools: [tool("read", 100), tool("notion__query", 250_000)],
			env: {},
			contract: () => contract(["notion__query"]),
		});
		await expect(h.admission.admit([user], counter)).resolves.toBeUndefined();
		expect(h.sent()).toEqual(["read"]);
	});

	it("4. revoked permission takes effect at once on the provider payload; required ⇒ missing before the request", async () => {
		const payloads: string[][] = [];
		const tools = [tool("read", 100), tool("browser__verify", 1_000), tool("github__pr", 1_000)];
		let required: string[] = [];
		const h = harness({ tools, env: ON, contract: () => (required.length ? contract(required) : undefined) });
		const agent = new Agent({
			getApiKey: () => "fake",
			initialState: { model, systemPrompt: "system", tools },
			streamFn: (_m, context: Context) => {
				payloads.push((context.tools ?? []).map((t) => t.name));
				const stream = createAssistantMessageEventStream();
				const message: AssistantMessage = {
					role: "assistant",
					content: [{ type: "text", text: "ok" }],
					api: model.api,
					provider: model.provider,
					model: model.id,
					usage: {
						input: 0,
						output: 0,
						cacheRead: 0,
						cacheWrite: 0,
						totalTokens: 0,
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
					},
					stopReason: "stop",
					timestamp: Date.now(),
				};
				queueMicrotask(() => stream.push({ type: "done", reason: "stop", message }));
				return stream;
			},
		});
		agent.prepareTools = (t, pending) => h.admission.fitTools(t, pending);
		h.state.tools = agent.state.tools;
		await agent.prompt("N");
		expect(payloads.at(-1)).toContain("browser__verify");
		// Revoked between N and N+1 (optional): gone from the very next payload.
		agent.state.tools = tools.filter((t) => t.name !== "browser__verify");
		h.state.tools = agent.state.tools;
		await agent.prompt("N+1");
		expect(payloads.at(-1)).not.toContain("browser__verify");
		// Required and revoked: refused before any request is sent.
		required = ["browser__verify"];
		const before = payloads.length;
		expect(() => h.admission.fitTools(agent.state.tools, [])).toThrow(RequiredCapabilityUnavailable);
		await agent.prompt("N+2").catch(() => {});
		expect(payloads.length).toBe(before);
	});

	it("5. required tool added mid-segment is present on the next request", async () => {
		let required = ["github__pr"];
		const h = harness({ tools: catalog(), env: ON, contract: () => contract(required) });
		await h.admission.admit([user], counter);
		expect(h.sent()).not.toContain("notion__query");
		required = ["github__pr", "notion__query"];
		expect(h.sent()).toContain("notion__query");
	});

	it("6. within a segment with no changes: names, order and schema bytes identical across 3 requests", async () => {
		const h = harness({ tools: catalog(), env: ON, contract: () => contract(["github__pr"]) });
		await h.admission.admit([user], counter);
		const snap = () => JSON.stringify(h.admission.fitTools(h.state.tools, []).map((t) => [t.name, t.description]));
		const first = snap();
		expect(snap()).toBe(first);
		expect(snap()).toBe(first);
	});

	it("7. a contract change alone re-fits (key includes the required set)", async () => {
		let required = ["runpod__create"];
		const h = harness({ tools: catalog(), env: ON, contract: () => contract(required) });
		await h.admission.admit([user], counter);
		expect(h.sent()).toEqual(["read", "runpod__create", "github__pr"]);
		required = ["notion__query"];
		expect(h.sent()).toEqual(["read", "notion__query", "github__pr"]);
	});

	it("§2.3: optional groups withheld at segment start stay withheld unless the budget frees", async () => {
		let segmentTools = ["read"];
		const tools = [tool("read", 100), tool("a__x", 90_000), tool("b__x", 80_000), tool("c__x", 1_000)];
		const h = harness({ tools, env: ON, contract: () => contract(segmentTools) });
		await h.admission.admit([user], counter);
		expect(h.sent()).toEqual(["read", "b__x", "c__x"]);
		// a shrinks below b: a plain re-fit would swap; within the segment b stays in, a stays out.
		h.state.tools = [tool("read", 100), tool("a__x", 70_000), tool("b__x", 100_000), tool("c__x", 1_000)];
		expect(h.sent()).not.toContain("a__x");
		// Budget frees (everything fits): all restored.
		h.state.tools = [tool("read", 100), tool("a__x", 1_000), tool("b__x", 1_000), tool("c__x", 1_000)];
		expect(h.sent()).toEqual(["read", "a__x", "b__x", "c__x"]);
		segmentTools = ["read", "c__x"];
		expect(h.sent()).toEqual(["read", "a__x", "b__x", "c__x"]);
	});
});

describe("spec 104 rulings: block release and no flip-flop", () => {
	it("completion block releases only after a later turn with the capability present and a passing check", async () => {
		const at = "2026-10-21T00:00:00.000Z";
		let goal = { ref: { id: "g2" }, createdAt: at, updatedAt: at, generationStartedAt: at } as never;
		const store = {
			current: async () => goal,
			transition: async () => {
				goal = { ...(goal as object), updatedAt: at } as never;
				return goal;
			},
		} as never;
		let pass = true;
		const verifier = {
			run: async () => ({
				status: pass ? "passed" : "failed",
				passed: pass,
				capturedAt: at,
				receiptId: `r-${Math.random()}`,
				digest: "d",
				workspace: { sha256: "w", completeness: "complete" },
			}),
			receiptMatches: () => true,
		};
		const acceptance = new GoalAcceptance(() => verifier as never);
		acceptance.approve(goal, "npm test");
		const blocked = (e: unknown) => String((e as Error)?.message ?? "").includes("required tools unavailable");
		acceptance.recordRequiredCapabilityMissing(goal, ["browser__verify"]);
		// A passing check without a capability-present turn does not release.
		await acceptance.check(store, goal, "/nonexistent");
		expect(blocked(await acceptance.complete(store, goal, "/nonexistent").catch((e) => e))).toBe(true);
		// Capability present but the check fails: still blocked.
		acceptance.recordRequiredCapabilityPresent(goal);
		pass = false;
		await acceptance.check(store, goal, "/nonexistent");
		expect(blocked(await acceptance.complete(store, goal, "/nonexistent").catch((e) => e))).toBe(true);
		// Capability present and the check passes: released.
		pass = true;
		await acceptance.check(store, goal, "/nonexistent");
		expect(blocked(await acceptance.complete(store, goal, "/nonexistent").catch((e) => e))).toBe(false);
		// A new miss blocks again; forget() also clears it.
		acceptance.recordRequiredCapabilityMissing(goal, ["browser__verify"]);
		expect(blocked(await acceptance.complete(store, goal, "/nonexistent").catch((e) => e))).toBe(true);
		acceptance.forget(goal);
		expect(blocked(await acceptance.complete(store, goal, "/nonexistent").catch((e) => e))).toBe(false);
	});

	it("a withheld group does not flip back and forth within a segment", async () => {
		const sizes = [
			[90_000, 80_000],
			[70_000, 100_000],
			[90_000, 80_000],
			[70_000, 100_000],
			[90_000, 80_000],
		];
		const make = ([a, b]: number[]) => [tool("read", 100), tool("a__x", a!), tool("b__x", b!), tool("c__x", 1_000)];
		const h = harness({ tools: make(sizes[0]!), env: ON, contract: () => contract(["read"]) });
		await h.admission.admit([user], counter);
		const history = sizes.map((size) => {
			h.state.tools = make(size);
			return h.sent().join(",");
		});
		// Once withheld, a__x never returns while the budget is still tight.
		expect(history.every((names) => !names.includes("a__x"))).toBe(true);
		// After the first swap both stay out; the set is stable from then on.
		expect(new Set(history.slice(1)).size).toBe(1);
		// Control: without the contract (flag on, no segment) the plain re-fit does flip.
		const plain = harness({ tools: make(sizes[0]!), env: ON });
		await plain.admission.admit([user], counter);
		const flips = sizes.map((size) => {
			plain.state.tools = make(size);
			return plain.sent().join(",");
		});
		expect(new Set(flips).size).toBe(2);
	});
});
