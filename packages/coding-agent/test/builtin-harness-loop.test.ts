import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getModel } from "omk-ai";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentSession } from "../src/core/agent-session.ts";
import { createEventBus } from "../src/core/event-bus.ts";
import goalController from "../src/core/extensions/builtin/goal-controller.ts";
import identicalLoop from "../src/core/extensions/builtin/identical-loop.ts";
import promptPreset from "../src/core/extensions/builtin/prompt-preset.ts";
import toolPairRepair from "../src/core/extensions/builtin/tool-pair-repair.ts";
import type { ExtensionAPI, ExtensionContext } from "../src/core/extensions/types.ts";
import {
	isProgressStallSteerSuppressed,
	setProgressStallSteerSuppressed,
} from "../src/core/progress-stall-steer-gate.ts";
import { DefaultResourceLoader } from "../src/core/resource-loader.ts";
import { createAgentSession } from "../src/core/sdk.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";

const BUILTIN_PATHS = [
	"<builtin:identical-loop>",
	"<builtin:tool-pair-repair>",
	"<builtin:prompt-preset>",
	"<builtin:goal-controller>",
] as const;

const HARNESS_ENV = ["OMK_IDENTICAL_LOOP", "OMK_TOOL_PAIR_REPAIR", "OMK_PROMPT_PRESET", "OMK_GOAL_CONTROLLER"] as const;

let tempDir: string;
let agentDir: string;
let session: AgentSession | undefined;
let savedEnv: Record<string, string | undefined>;

async function newSession(): Promise<{ session: AgentSession; loader: DefaultResourceLoader }> {
	const settingsManager = SettingsManager.create(tempDir, agentDir);
	const loader = new DefaultResourceLoader({ cwd: tempDir, agentDir, settingsManager });
	await loader.reload();
	const created = await createAgentSession({
		cwd: tempDir,
		agentDir,
		model: getModel("anthropic", "claude-sonnet-4-5"),
		settingsManager,
		sessionManager: SessionManager.inMemory(),
		resourceLoader: loader,
	});
	session = created.session;
	await created.session.bindExtensions({});
	return { session: created.session, loader };
}

beforeEach(() => {
	tempDir = join(tmpdir(), `omk-harness-builtin-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	agentDir = join(tempDir, "agent");
	mkdirSync(agentDir, { recursive: true });
	savedEnv = {};
	for (const name of HARNESS_ENV) {
		savedEnv[name] = process.env[name];
		delete process.env[name];
	}
});

afterEach(() => {
	session?.dispose();
	session = undefined;
	for (const name of HARNESS_ENV) {
		if (savedEnv[name] === undefined) delete process.env[name];
		else process.env[name] = savedEnv[name];
	}
	if (tempDir && existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
});

describe("harness loop built-ins", () => {
	it("loads all four built-ins by default and registers /goal", async () => {
		const { session: s, loader } = await newSession();
		const paths = loader.getExtensions().extensions.map((extension) => extension.path);
		for (const path of BUILTIN_PATHS) expect(paths).toContain(path);
		expect(s.extensionRunner.getRegisteredCommands().map((command) => command.name)).toContain("goal");
	});

	it("omits /goal when OMK_GOAL_CONTROLLER=0", async () => {
		process.env.OMK_GOAL_CONTROLLER = "0";
		const { session: s, loader } = await newSession();
		const paths = loader.getExtensions().extensions.map((extension) => extension.path);
		expect(paths).not.toContain("<builtin:goal-controller>");
		expect(s.extensionRunner.getRegisteredCommands().map((command) => command.name)).not.toContain("goal");
	});

	it("omits model prompt presets when OMK_PROMPT_PRESET=0", async () => {
		process.env.OMK_PROMPT_PRESET = "0";
		const { loader } = await newSession();
		expect(loader.getExtensions().extensions.map((extension) => extension.path)).not.toContain(
			"<builtin:prompt-preset>",
		);
	});

	it("blocks the sixth identical bash call through the live runner", async () => {
		const { session: s } = await newSession();
		const event = {
			type: "tool_call" as const,
			toolCallId: "call-1",
			toolName: "bash" as const,
			input: { command: "ls" },
		};
		let blocked: unknown;
		for (let index = 0; index < 6; index += 1) {
			blocked = await s.extensionRunner.emitToolCall({ ...event, toolCallId: `call-${index}` });
		}
		expect(blocked).toMatchObject({ block: true });
	});

	it("repairs orphan tool pairs through the live context hook", async () => {
		const { session: s } = await newSession();
		const repaired = await s.extensionRunner.emitContext([
			{ role: "assistant", content: [{ type: "toolCall", id: "a" }], timestamp: 1 } as never,
			{ role: "toolResult", toolCallId: "ghost", content: [], timestamp: 2 } as never,
		]);
		expect(repaired).toHaveLength(0);
	});
});

interface CapturedHandler {
	event: string;
	handler: (event: never, ctx: never) => unknown;
}

function createFactoryHarness() {
	const handlers: CapturedHandler[] = [];
	const messages: unknown[] = [];
	const commands: string[] = [];
	const events = createEventBus();
	const omk = {
		events,
		on: (event: string, handler: CapturedHandler["handler"]) => {
			handlers.push({ event, handler });
		},
		sendMessage: (message: unknown) => messages.push(message),
		sendUserMessage: () => {},
		registerCommand: (name: string) => commands.push(name),
	} as unknown as ExtensionAPI;
	const fire = (event: string, payload: unknown, ctx?: unknown) =>
		handlers.filter((entry) => entry.event === event).map((entry) => entry.handler(payload as never, ctx as never));
	return { handlers, messages, commands, omk, fire, events };
}

describe("identical-loop built-in factory", () => {
	it("warns via sendMessage, blocks at the cap, and resets on interactive input", () => {
		const harness = createFactoryHarness();
		identicalLoop(harness.omk);
		const call = { type: "tool_call", toolCallId: "c", toolName: "bash", input: { command: "ls" } };
		expect(harness.fire("tool_call", call)).toEqual([undefined]);
		harness.fire("tool_call", call);
		harness.fire("tool_call", call);
		expect(harness.messages).toHaveLength(1);
		harness.fire("tool_call", call);
		harness.fire("tool_call", call);
		expect(harness.fire("tool_call", call)[0]).toMatchObject({ block: true });
		harness.fire("input", { type: "input", text: "stop", source: "interactive" });
		expect(harness.fire("tool_call", call)).toEqual([undefined]);
	});

	it("steers on near-duplicate bash without progress and respects the finish-check gate", () => {
		setProgressStallSteerSuppressed(false);
		const harness = createFactoryHarness();
		identicalLoop(harness.omk, { remainingBudgetFraction: () => 0.5 });
		for (let index = 0; index < 14; index += 1) {
			const call = {
				type: "tool_call",
				toolCallId: `n-${index}`,
				toolName: "bash",
				input: { command: `python3 -c "import re, json; print(${index}); json.load(open('/app/re.json'))"` },
			};
			expect(harness.fire("tool_call", call)[0]).toBeUndefined();
			harness.fire("tool_result", {
				type: "tool_result",
				toolCallId: `n-${index}`,
				toolName: "bash",
				input: call.input,
				content: [{ type: "text", text: "ok" }],
				isError: false,
				details: undefined,
			});
		}
		expect(
			harness.messages.some((message) => (message as { customType?: string }).customType === "progress-stall"),
		).toBe(true);

		harness.messages.length = 0;
		setProgressStallSteerSuppressed(true);
		for (let index = 0; index < 14; index += 1) {
			const call = {
				type: "tool_call",
				toolCallId: `s-${index}`,
				toolName: "bash",
				input: { command: `python3 -c "import re, json; print(${index + 20}); json.load(open('/app/re.json'))"` },
			};
			harness.fire("tool_call", call);
			harness.fire("tool_result", {
				type: "tool_result",
				toolCallId: `s-${index}`,
				toolName: "bash",
				input: call.input,
				content: [{ type: "text", text: "ok" }],
				isError: false,
				details: undefined,
			});
		}
		expect(harness.messages).toHaveLength(0);
		setProgressStallSteerSuppressed(false);
	});

	it("clears a stale process-wide suppression on session_start", () => {
		const harness = createFactoryHarness();
		identicalLoop(harness.omk);
		setProgressStallSteerSuppressed(true);
		harness.fire("session_start", { type: "session_start" });
		expect(isProgressStallSteerSuppressed()).toBe(false);
	});

	it("uses the low-budget steer text when remainingBudgetFraction is under 20%", () => {
		const harness = createFactoryHarness();
		identicalLoop(harness.omk, { remainingBudgetFraction: () => 0.1 });
		for (let index = 0; index < 14; index += 1) {
			const call = {
				type: "tool_call",
				toolCallId: `b-${index}`,
				toolName: "bash",
				input: { command: `python3 -c "import re, json; print(${index}); json.load(open('/app/re.json'))"` },
			};
			harness.fire("tool_call", call);
			harness.fire("tool_result", {
				type: "tool_result",
				toolCallId: `b-${index}`,
				toolName: "bash",
				input: call.input,
				content: [{ type: "text", text: "ok" }],
				isError: false,
				details: undefined,
			});
		}
		const stall = harness.messages.find(
			(message) => (message as { customType?: string }).customType === "progress-stall",
		) as { content?: string } | undefined;
		expect(stall?.content).toMatch(/Save best state, run verification/);
	});

	it("stays quiet while finish_check is active on the event bus", () => {
		setProgressStallSteerSuppressed(false);
		const harness = createFactoryHarness();
		identicalLoop(harness.omk, { remainingBudgetFraction: () => 0.5 });
		const run = (prefix: string, offset: number) => {
			for (let index = 0; index < 14; index += 1) {
				const call = {
					type: "tool_call",
					toolCallId: `${prefix}-${index}`,
					toolName: "bash",
					input: {
						command: `python3 -c "import re, json; print(${index + offset}); json.load(open('/app/re.json'))"`,
					},
				};
				harness.fire("tool_call", call);
				harness.fire("tool_result", {
					type: "tool_result",
					toolCallId: call.toolCallId,
					toolName: "bash",
					input: call.input,
					content: [{ type: "text", text: "ok" }],
					isError: false,
					details: undefined,
				});
			}
		};
		const stalls = () =>
			harness.messages.filter((message) => (message as { customType?: string }).customType === "progress-stall");

		harness.events.emit("finish_check", { active: true });
		run("f", 0);
		expect(stalls()).toHaveLength(0);
		harness.events.emit("finish_check", { active: false, ledger: [] });
		run("g", 40);
		expect(stalls().length).toBeGreaterThan(0);
	});
});

describe("prompt-preset built-in factory", () => {
	it("uses the current model per request without leaking Astra guidance after a switch", () => {
		const harness = createFactoryHarness();
		promptPreset(harness.omk);
		const event = { type: "before_agent_start", prompt: "hi", systemPrompt: "BASE", systemPromptOptions: {} };
		const ctx = { model: { provider: "openai", id: "gpt-6-astra" } };

		const astra = harness.fire("before_agent_start", event, ctx);
		expect(astra).toEqual([{ systemPrompt: expect.stringMatching(/^BASE\n\n<model_preset id="gpt-6-astra">\n/) }]);
		expect(event.systemPrompt).toBe("BASE");

		ctx.model.id = "gpt-5.6";
		expect(harness.fire("before_agent_start", event, ctx)).toEqual([undefined]);
		ctx.model = { provider: "xai", id: "grok-4.5" };
		expect(harness.fire("before_agent_start", event, ctx)).toEqual([
			{ systemPrompt: expect.stringMatching(/^BASE\n\n<model_preset id="grok">\n/) },
		]);
		ctx.model = { provider: "openai", id: "gpt-6-astra" };
		expect(harness.fire("before_agent_start", event, ctx)).toEqual(astra);
	});

	it("appends model-specific preset blocks for Kimi and Claude", () => {
		const harness = createFactoryHarness();
		promptPreset(harness.omk);
		const event = { type: "before_agent_start", prompt: "hi", systemPrompt: "BASE", systemPromptOptions: {} };
		const kimi = harness.fire("before_agent_start", event, {
			model: { id: "kimi-k2.5" },
		} as unknown as ExtensionContext);
		expect(kimi[0]).toMatchObject({ systemPrompt: expect.stringContaining('<model_preset id="kimi">') });
		const claude = harness.fire("before_agent_start", event, {
			model: { provider: "anthropic", id: "fable-5" },
		} as unknown as ExtensionContext);
		expect(claude[0]).toMatchObject({ systemPrompt: expect.stringContaining('<model_preset id="claude">') });
	});
});

describe("tool-pair-repair built-in factory", () => {
	it("returns repaired messages only when the pair set changed", () => {
		const harness = createFactoryHarness();
		toolPairRepair(harness.omk);
		const orphan = [
			{ role: "assistant", content: [{ type: "toolCall", id: "a" }] },
			{ role: "toolResult", toolCallId: "ghost", content: [] },
		];
		expect(harness.fire("context", { type: "context", messages: orphan })[0]).toMatchObject({ messages: [] });
		const paired = [
			{ role: "assistant", content: [{ type: "toolCall", id: "a" }] },
			{ role: "toolResult", toolCallId: "a", content: [] },
		];
		expect(harness.fire("context", { type: "context", messages: paired })[0]).toBeUndefined();
	});
});

describe("goal-controller built-in factory", () => {
	it("registers the goal command", () => {
		const harness = createFactoryHarness();
		goalController(harness.omk);
		expect(harness.commands).toContain("goal");
	});
});
