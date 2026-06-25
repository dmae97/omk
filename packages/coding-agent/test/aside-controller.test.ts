import { describe, expect, it } from "vitest";
import { AsideController } from "../examples/extensions/aside-computer-use/controller.ts";
import type { AuthorizerPolicy } from "../examples/extensions/aside-computer-use/risk-authorize.ts";
import type {
	Approver,
	BrowserAction,
	BrowserClient,
	McpCallResult,
	Observation,
	PlannedActionCandidate,
	Planner,
} from "../examples/extensions/aside-computer-use/types.ts";

const policy: AuthorizerPolicy = {
	deniedActions: ["payment", "account_deletion", "credential_export"],
	privilegedR3Actions: [],
	allowedOrigins: ["localhost:*"],
	allowReadAnyOrigin: false,
};

function mockClient(
	observation: Observation,
	executeImpl?: (a: BrowserAction) => { ok: boolean; raw: McpCallResult; sideEffectKind?: string },
): BrowserClient {
	return {
		observe: async () => observation,
		execute: async (a) =>
			executeImpl
				? executeImpl(a)
				: {
						ok: true,
						raw: { content: [{ type: "text", text: "ok" }] },
						sideEffectKind: isMutating(a.kind) ? a.kind : undefined,
					},
		listTools: async () => [],
		close: async () => {},
	};
}

function sequenceClient(
	observations: readonly Observation[],
	executeImpl: (a: BrowserAction, index: number) => { ok: boolean; raw: McpCallResult; sideEffectKind?: string },
): BrowserClient & {
	executeCount: () => number;
	observeCount: () => number;
	executedActions: () => readonly BrowserAction[];
} {
	let observeIndex = 0;
	let executeIndex = 0;
	const executed: BrowserAction[] = [];
	return {
		observe: async () => observations[Math.min(observeIndex++, observations.length - 1)],
		execute: async (action) => {
			executed.push(action);
			return executeImpl(action, executeIndex++);
		},
		listTools: async () => [],
		close: async () => {},
		executeCount: () => executeIndex,
		observeCount: () => observeIndex,
		executedActions: () => executed,
	};
}

function isMutating(kind: string): boolean {
	return ["submit", "send_message", "create_issue", "comment", "delete", "payment"].includes(kind);
}

function scoredCandidate(
	kind: string,
	scores: Partial<Omit<PlannedActionCandidate, "action" | "risk">>,
): PlannedActionCandidate {
	return {
		action: { kind, url: "http://localhost:3000/docs", description: kind },
		risk: "R0",
		goalProgress: 0,
		observationSupport: 0,
		selectorCertainty: 0,
		policyFit: 0,
		reversibility: 0,
		toolReliability: 0,
		evidenceGain: 0,
		...scores,
	};
}

/** A planner that replays a scripted action list, then signals done. */
function scriptedPlanner(actions: BrowserAction[]): Planner {
	let i = 0;
	return {
		nextAction: async () => {
			if (i >= actions.length) return { done: true };
			return { action: actions[i++] };
		},
	};
}

const alwaysApprove: Approver = async () => true;
const alwaysDeny: Approver = async () => false;

function makeController(ports: {
	client: BrowserClient;
	planner: Planner;
	approve?: Approver;
	maxSteps?: number;
}): AsideController {
	return new AsideController({
		client: ports.client,
		planner: ports.planner,
		approve: ports.approve ?? alwaysApprove,
		policy,
		evidenceDirectory: "/tmp/aside-evidence",
		maxSteps: ports.maxSteps ?? 5,
		maxRetries: 1,
	});
}

describe("AsideController — completion", () => {
	it("completes immediately when observation satisfies structured criteria", async () => {
		const obs: Observation = { url: "http://localhost:3000/login", text: "Welcome to the login page" };
		const controller = makeController({ client: mockClient(obs), planner: scriptedPlanner([]) });
		const result = await controller.runTask({
			goal: "verify login page",
			criteria: [{ id: "c1", description: "text:Welcome to the login page" }],
		});
		expect(result.status).toBe("completed");
		expect(result.finalUrl).toBe("http://localhost:3000/login");
	});

	it("treats token-overlap fallback criteria as inconclusive by default", async () => {
		const obs: Observation = { url: "http://localhost:3000/login", text: "Welcome to the login page" };
		const controller = makeController({ client: mockClient(obs), planner: scriptedPlanner([]) });
		const result = await controller.runTask({
			goal: "verify login page",
			criteria: [{ id: "c1", description: "login page" }],
		});
		expect(result.status).toBe("inspection_required");
		expect(result.summary).toContain("criteria unmet");
	});

	it("satisfies DOM selector/value criteria from the initial observation", async () => {
		const obs: Observation = {
			url: "http://localhost:3000/login",
			dom: [{ selector: "#status", value: "Ready" }],
		};
		const controller = makeController({ client: mockClient(obs), planner: scriptedPlanner([]) });
		const result = await controller.runTask({
			goal: "verify status",
			criteria: [{ id: "c1", description: "dom:#status=Ready" }],
		});
		expect(result.status).toBe("completed");
	});

	it("uses exact quoted phrases as strong criteria", async () => {
		const obs: Observation = { url: "http://localhost:3000/login", text: "Welcome to the login page" };
		const controller = makeController({ client: mockClient(obs), planner: scriptedPlanner([]) });
		const result = await controller.runTask({
			goal: "verify phrase",
			criteria: [{ id: "c1", description: 'text contains "Welcome to the login page"' }],
		});
		expect(result.status).toBe("completed");
	});
});

describe("AsideController — safety gates", () => {
	it("blocks a denied action (payment) regardless of approval", async () => {
		const obs: Observation = { url: "http://localhost:3000/cart", text: "checkout" };
		const controller = makeController({
			client: mockClient(obs),
			planner: scriptedPlanner([{ kind: "payment", url: "http://localhost:3000/checkout", description: "pay now" }]),
		});
		const result = await controller.runTask({
			goal: "checkout",
			criteria: [{ id: "c1", description: "zzzqqq absent" }],
		});
		expect(result.status).toBe("blocked");
		expect(result.summary).toContain("denied list");
	});

	it("blocks a mutation to a foreign origin", async () => {
		const obs: Observation = { url: "http://localhost:3000/app", text: "app" };
		const controller = makeController({
			client: mockClient(obs),
			planner: scriptedPlanner([{ kind: "submit", url: "https://evil.com/form", description: "submit" }]),
		});
		const result = await controller.runTask({ goal: "x", criteria: [{ id: "c1", description: "zzzqqq absent" }] });
		expect(result.status).toBe("blocked");
		expect(result.summary).toContain("allowedOrigins");
	});

	it("denies an R2 mutation when human approval is refused", async () => {
		const obs: Observation = { url: "http://localhost:3000/comment", text: "comment box" };
		const controller = makeController({
			client: mockClient(obs),
			planner: scriptedPlanner([
				{ kind: "submit", url: "http://localhost:3000/comment", description: "post comment" },
			]),
			approve: alwaysDeny,
		});
		const result = await controller.runTask({
			goal: "comment",
			criteria: [{ id: "c1", description: "zzzqqq absent" }],
		});
		expect(result.status).toBe("denied");
		expect(result.sideEffects.some((s) => s.description.includes("human approval denied"))).toBe(true);
	});

	it("flags inspection_required when an approved mutation has an unverifiable outcome", async () => {
		const obs: Observation = { url: "http://localhost:3000/comment", text: "comment box" };
		const controller = makeController({
			client: mockClient(obs),
			planner: scriptedPlanner([
				{ kind: "submit", url: "http://localhost:3000/comment", description: "post comment" },
			]),
		});
		const result = await controller.runTask({
			goal: "comment",
			criteria: [{ id: "c1", description: "zzzqqq absent" }],
			account: "work",
			browserProfileId: "default",
		});
		expect(result.status).toBe("inspection_required");
		expect(result.uncertainties.some((u) => u.includes("unknown"))).toBe(true);
	});

	it("completes a mutation when post-action observation confirms the criterion", async () => {
		const client = sequenceClient(
			[
				{ url: "http://localhost:3000/comment", text: "comment form" },
				{ url: "http://localhost:3000/comment", dom: [{ selector: "#flash", value: "Posted" }] },
			],
			() => ({ ok: true, raw: { content: [{ type: "text", text: "ok" }] }, sideEffectKind: "submit" }),
		);
		const controller = makeController({
			client,
			planner: scriptedPlanner([
				{ kind: "submit", url: "http://localhost:3000/comment", description: "post comment" },
			]),
		});
		const result = await controller.runTask({
			goal: "comment",
			criteria: [{ id: "c1", description: "dom:#flash=Posted" }],
		});
		expect(result.status).toBe("completed");
		expect(client.executeCount()).toBe(1);
	});
});

describe("AsideController — control flow", () => {
	it("retries a failed read-only action once and then completes from post-action observation", async () => {
		const client = sequenceClient(
			[
				{ url: "http://localhost:3000/docs", text: "loading" },
				{ url: "http://localhost:3000/docs", text: "Documentation Ready" },
			],
			(_action, index) => ({
				ok: index > 0,
				raw: { content: [{ type: "text", text: index > 0 ? "ok" : "transient" }] },
			}),
		);
		const controller = makeController({
			client,
			planner: scriptedPlanner([{ kind: "read_text", url: "http://localhost:3000/docs", description: "read text" }]),
		});
		const result = await controller.runTask({
			goal: "read docs",
			criteria: [{ id: "c1", description: '"Documentation Ready"' }],
		});
		expect(result.status).toBe("completed");
		expect(client.executeCount()).toBe(2);
	});

	it("does not retry a failed submit action", async () => {
		const client = sequenceClient([{ url: "http://localhost:3000/form", text: "form" }], () => ({
			ok: false,
			raw: { content: [{ type: "text", text: "ambiguous failure" }] },
			sideEffectKind: "submit",
		}));
		const controller = makeController({
			client,
			planner: scriptedPlanner([{ kind: "submit", url: "http://localhost:3000/form", description: "submit" }]),
		});
		const result = await controller.runTask({
			goal: "submit",
			criteria: [{ id: "c1", description: "zzzqqq absent" }],
		});
		expect(result.status).toBe("failed");
		expect(client.executeCount()).toBe(1);
	});

	it("selects the strongest scored candidate before executing", async () => {
		const client = sequenceClient(
			[
				{ url: "http://localhost:3000/docs", text: "Docs loading" },
				{ url: "http://localhost:3000/docs", text: "Docs Ready" },
			],
			() => ({ ok: true, raw: { content: [{ type: "text", text: "ok" }] } }),
		);
		const planner: Planner = {
			nextAction: async () => ({
				candidates: [
					scoredCandidate("read_text", { goalProgress: 1, observationSupport: 1 }),
					scoredCandidate("open_page", {
						goalProgress: 1,
						observationSupport: 1,
						selectorCertainty: 1,
						policyFit: 1,
						reversibility: 1,
					}),
				],
			}),
		};
		const controller = makeController({ client, planner });
		const result = await controller.runTask({
			goal: "open docs",
			criteria: [{ id: "c1", description: "text:Docs Ready" }],
		});
		expect(result.status).toBe("completed");
		expect(client.executedActions()[0]?.kind).toBe("open_page");
	});

	it("requires inspection for ambiguous scored candidates before execution", async () => {
		const client = sequenceClient([{ url: "http://localhost:3000/docs", text: "Docs loading" }], () => ({
			ok: true,
			raw: { content: [{ type: "text", text: "ok" }] },
		}));
		const planner: Planner = {
			nextAction: async () => ({
				candidates: [
					scoredCandidate("read_text", { goalProgress: 1, observationSupport: 1 }),
					scoredCandidate("open_page", { goalProgress: 1, observationSupport: 1 }),
				],
			}),
		};
		const controller = makeController({ client, planner });
		const result = await controller.runTask({
			goal: "open docs",
			criteria: [{ id: "c1", description: "text:Docs Ready" }],
		});
		expect(result.status).toBe("inspection_required");
		expect(result.summary).toContain("ambiguous");
		expect(client.executeCount()).toBe(0);
	});

	it("reports max_steps_exceeded when criteria never satisfy", async () => {
		const obs: Observation = { url: "http://localhost:3000/app", text: "app" };
		const readAction: BrowserAction = {
			kind: "open_page",
			url: "http://localhost:3000/app",
			description: "open page",
		};
		const controller = makeController({
			client: mockClient(obs),
			planner: scriptedPlanner([readAction, readAction, readAction]),
			maxSteps: 2,
		});
		const result = await controller.runTask({ goal: "x", criteria: [{ id: "c1", description: "zzzqqq absent" }] });
		expect(result.status).toBe("max_steps_exceeded");
		expect(result.stepsTaken).toBe(2);
	});

	it("returns failed when observe throws", async () => {
		const client: BrowserClient = {
			observe: async () => {
				throw new Error("browser gone");
			},
			execute: async () => ({ ok: false, raw: { content: [] } }),
			listTools: async () => [],
			close: async () => {},
		};
		const controller = new AsideController({
			client,
			planner: scriptedPlanner([]),
			approve: alwaysApprove,
			policy,
			evidenceDirectory: "/tmp/aside-evidence",
			maxSteps: 5,
			maxRetries: 1,
		});
		const result = await controller.runTask({ goal: "x", criteria: [{ id: "c1", description: "zzzqqq absent" }] });
		expect(result.status).toBe("failed");
		expect(result.summary).toContain("observe failed");
	});
});
