// Source: https://github.com/wtfzambo/speak-like-you-eat (MIT), adapted for OMK.
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	AgentEndEvent,
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
	ModelRegistry,
	SessionEntry,
} from "open-multi-agent-kit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { writeConfigAtomically } from "../src/config.ts";
import speakLikeYouEat from "../src/extension.ts";
import { type CompleteRewrite, ELI5_SYSTEM_PROMPT } from "../src/rewrite.ts";

const directories: string[] = [];
afterEach(async () => {
	await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

type Command = { handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> };
type Handler = (event: { messages: unknown[] }, ctx: ExtensionContext) => Promise<void>;

function harness(branch: SessionEntry[]) {
	const commands = new Map<string, Command>();
	const events = new Map<string, Handler>();
	const appended: Array<{ customType: string; data: { display: string; rewrite?: string; targetEntryId?: string } }> =
		[];
	const renderers = new Map<string, unknown>();
	const api = {
		registerCommand: (name: string, options: Command) => commands.set(name, options),
		registerEntryRenderer: (name: string, renderer: unknown) => renderers.set(name, renderer),
		registerShortcut: vi.fn(),
		on: (name: string, handler: Handler) => events.set(name, handler),
		appendEntry: (customType: string, data: { display: string; rewrite?: string; targetEntryId?: string }) => {
			appended.push({ customType, data });
			branch.push({
				type: "custom",
				id: `rewrite-${appended.length}`,
				parentId: null,
				timestamp: "now",
				customType,
				data,
			});
		},
	} as unknown as ExtensionAPI;
	const model = { provider: "test", id: "plain", name: "Plain model", reasoning: false };
	const modelRegistry = {
		find: vi.fn(() => model),
		getAvailable: vi.fn(() => [model]),
		hasConfiguredAuth: vi.fn(() => true),
	} as unknown as ModelRegistry;
	const ui = {
		notify: vi.fn(),
		setWorkingMessage: vi.fn(),
		setStatus: vi.fn(),
		custom: async (
			factory: (
				tui: unknown,
				theme: unknown,
				keys: unknown,
				done: (value: unknown) => void,
			) => { dispose?: () => void },
		) => {
			const theme = { fg: (_name: string, text: string) => text, bold: (text: string) => text };
			let component: { dispose?: () => void } | undefined;
			const result = await new Promise<unknown>((resolve) => {
				component = factory({ requestRender: vi.fn() }, theme, {}, resolve);
			});
			component?.dispose?.();
			return result;
		},
	};
	const ctx = {
		mode: "tui",
		cwd: "/workspace",
		ui,
		scopedModels: [{ model }],
		modelRegistry,
		sessionManager: { getBranch: () => branch },
		isProjectTrusted: () => false,
		waitForIdle: async () => undefined,
		signal: undefined,
	} as unknown as ExtensionCommandContext;
	return { api, commands, events, appended, renderers, ctx, ui };
}

async function setup(enabled: boolean, targetText = "Plain response") {
	const agentDir = await mkdtemp(join(tmpdir(), "omk-slye-extension-"));
	directories.push(agentDir);
	await writeConfigAtomically(join(agentDir, "slye.json"), {
		enabled,
		model: { provider: "test", id: "plain" },
	});
	const contexts: Array<{ systemPrompt: string; messages: unknown[] }> = [];
	const complete: CompleteRewrite = async (context) => {
		contexts.push(context);
		return {
			stopReason: "stop",
			content: [
				{ type: "text", text: context.systemPrompt === ELI5_SYSTEM_PROMPT ? "ELI5 result" : "Light result" },
			],
		};
	};
	const target = {
		role: "assistant",
		content: [{ type: "text", text: targetText }],
		stopReason: "stop",
		timestamp: 1,
	} as AgentEndEvent["messages"][number];
	const branch = [
		{ type: "message", id: "target", parentId: null, timestamp: "now", message: target } as SessionEntry,
	];
	const value = harness(branch);
	speakLikeYouEat(value.api, { agentDir, complete });
	return { ...value, contexts, branch, agentDir, targetMessage: target };
}

describe("OMK SLYE extension", () => {
	it("rewrites manually into a display-only companion without changing the target", async () => {
		const { commands, contexts, appended, branch, ctx, renderers } = await setup(false);
		const original = structuredClone(branch[0]);
		await commands.get("slye")!.handler("", ctx);
		expect(contexts).toHaveLength(2);
		for (const context of contexts) {
			expect(context.messages).toHaveLength(1);
			expect(context.messages[0]).toMatchObject({
				role: "user",
				content: expect.stringContaining("Plain response"),
			});
		}
		expect(appended).toEqual([
			{
				customType: "slye.rewrite",
				data: {
					display: "Light result",
					rewrite: "ELI5 result",
					targetEntryId: "target",
					modelName: "Plain model",
				},
			},
		]);
		expect(branch[0]).toEqual(original);
		expect(renderers.has("slye.rewrite")).toBe(true);
		await commands.get("slye")!.handler("", ctx);
		expect(contexts).toHaveLength(2);
	});

	it("automatically rewrites one eligible response only once", async () => {
		const { events, contexts, appended, ctx, targetMessage } = await setup(true, "eligible ".repeat(30));
		const agentEnd = events.get("agent_end")!;
		await agentEnd({ messages: [targetMessage] }, ctx);
		expect(contexts).toHaveLength(2);
		expect(appended).toHaveLength(1);
		await agentEnd({ messages: [targetMessage] }, ctx);
		expect(contexts).toHaveLength(2);
	});

	it("persists off and on without losing the selected model", async () => {
		const { commands, ctx, agentDir, contexts } = await setup(true);
		await commands.get("slye")!.handler("off", ctx);
		expect(JSON.parse(await readFile(join(agentDir, "slye.json"), "utf8"))).toEqual({
			enabled: false,
			model: { provider: "test", id: "plain" },
		});
		await commands.get("slye")!.handler("on", ctx);
		expect(JSON.parse(await readFile(join(agentDir, "slye.json"), "utf8")).enabled).toBe(true);
		expect(contexts).toHaveLength(0);
	});

	it("ignores invalid commands without calling the model", async () => {
		const { commands, contexts, ctx } = await setup(false);
		await commands.get("slye")!.handler("unknown", ctx);
		expect(contexts).toHaveLength(0);
	});

	it("leaves a failed companion append retryable", async () => {
		const { api, commands, contexts, ctx } = await setup(false);
		const append = api.appendEntry;
		api.appendEntry = () => {
			throw new Error("storage failed");
		};
		await commands.get("slye")!.handler("", ctx);
		expect(contexts).toHaveLength(2);
		api.appendEntry = append;
		await commands.get("slye")!.handler("", ctx);
		expect(contexts).toHaveLength(4);
	});
});
