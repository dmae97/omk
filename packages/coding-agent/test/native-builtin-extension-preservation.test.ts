import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createEventBus, type EventBus } from "../src/core/event-bus.ts";
import { HARNESS_FACTORIES } from "../src/core/extensions/builtin/harness-factories.ts";
import { DefaultResourceLoader } from "../src/core/resource-loader.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import {
	dialects,
	emptyRegistry,
	inventory,
	preservationHarness,
	registryOf,
} from "./fixtures/native-extension-harness.ts";

describe.each(dialects)("real resource-loader builtin composition (%s)", (dialect) => {
	const harness = preservationHarness();
	function loader(noExtensions = false, eventBus?: EventBus) {
		return new DefaultResourceLoader({
			cwd: harness.cwd,
			agentDir: harness.agentDir,
			packageManifestDialect: dialect,
			settingsManager: SettingsManager.inMemory(),
			noExtensions,
			eventBus,
			noSkills: true,
			noPromptTemplates: true,
			noThemes: true,
			noContextFiles: true,
		});
	}
	async function reload(resourceLoader = loader()) {
		await resourceLoader.reload();
		const result = harness.track(resourceLoader.getExtensions());
		expect(result.errors).toEqual([]);
		return result;
	}
	function user(source: string) {
		mkdirSync(join(harness.agentDir, "extensions"), { recursive: true });
		writeFileSync(join(harness.agentDir, "extensions", "synthetic.ts"), source);
	}
	it("composes all seven authoritative harness factories plus safety, todo and memory in exact order", async () => {
		const resourceLoader = loader();
		const expected = [
			"<builtin:command-safety>",
			"<builtin:todo-checklist>",
			...HARNESS_FACTORIES.map((item) => item.path),
			"<builtin:tencent-memory>",
		];
		expect(inventory.builtins.map((row) => row.id)).toEqual(expected);
		for (let index = 0; index < 2; index++) {
			const result = await reload(resourceLoader);
			expect(result.extensions.map((extension) => extension.path)).toEqual(expected);
			for (const row of inventory.builtins) {
				const extension = result.extensions.find((extension) => extension.path === row.id)!;
				expect(registryOf(extension, result.runtime), row.id).toEqual({ ...emptyRegistry, ...row.registry });
			}
		}
	});
	it.each(inventory.builtins)("$envVar disable/re-enable across reload preserves other factories", async (row) => {
		const resourceLoader = loader();
		const first = await reload(resourceLoader);
		vi.stubEnv(row.envVar!, "0");
		const disabled = await reload(resourceLoader);
		expect(disabled.extensions.map((extension) => extension.path)).toEqual(
			first.extensions.map((extension) => extension.path).filter((path) => path !== row.id),
		);
		vi.stubEnv(row.envVar!, "1");
		const enabled = await reload(resourceLoader);
		expect(enabled.extensions.map((extension) => extension.path)).toContain(row.id);
	});
	it("noExtensions retains existing harness/safety/todo semantics and excludes Tencent memory", async () => {
		const result = await reload(loader(true));
		expect(result.extensions.map((extension) => extension.path)).toEqual(
			inventory.builtins.map((row) => row.id).filter((path) => path !== "<builtin:tencent-memory>"),
		);
	});
	it("a real user todo factory suppresses fallback update_todo before and after reload", async () => {
		user(
			'import {Type} from "typebox"; export default api => api.registerTool({name:"todo",label:"Synthetic todo",description:"Fixture",parameters:Type.Object({}),execute:async()=>({content:[]})});',
		);
		const resourceLoader = loader();
		for (let index = 0; index < 2; index++) {
			const result = await reload(resourceLoader);
			const names = result.extensions.flatMap((extension) => [...extension.tools.keys()]);
			expect(names.filter((name) => name === "todo")).toHaveLength(1);
			expect(names).not.toContain("update_todo");
			expect(result.extensions.map((extension) => extension.path)).not.toContain("<builtin:todo-checklist>");
		}
	});
	it("safety precedes user short-circuit handlers and blocks without executing a command", async () => {
		user(
			'export default api => api.on("tool_call", () => {api.sendUserMessage("later handler"); return {block:false};});',
		);
		const result = await reload();
		expect(result.extensions[0].path).toBe("<builtin:command-safety>");
		const { runner, sendUserMessage } = harness.context(result);
		expect(
			await runner.emitToolCall({
				type: "tool_call",
				toolCallId: "blocked",
				toolName: "bash",
				input: { command: "rm -rf /" },
			}),
		).toMatchObject({ block: true });
		expect(sendUserMessage).not.toHaveBeenCalled();
	});
	it("identical-loop blocks its sixth call through the actual runner", async () => {
		const result = await reload();
		const { runner, sendMessage } = harness.context(result);
		let last: unknown;
		for (let index = 0; index < 6; index++)
			last = await runner.emitToolCall({
				type: "tool_call",
				toolCallId: `loop-${index}`,
				toolName: "bash",
				input: { command: "echo fixture" },
			});
		expect(last).toMatchObject({ block: true, reason: expect.stringContaining("identical loop") });
		expect(sendMessage).toHaveBeenCalled();
	});
	it("pair repair runs via the actual context hook without mutating its input", async () => {
		const result = await reload();
		const { runner } = harness.context(result);
		const messages = [
			{ role: "assistant", content: [{ type: "toolCall", id: "a" }], timestamp: 1 },
			{ role: "toolResult", toolCallId: "orphan", content: [], timestamp: 2 },
		];
		const before = structuredClone(messages);
		expect(await runner.emitContext(messages as never)).toEqual([]);
		expect(messages).toEqual(before);
	});
	it("DeepSeek and model preset prompt hooks execute without any provider call", async () => {
		const result = await reload();
		const { ctx } = harness.context(result);
		const event = { type: "before_agent_start", prompt: "fixture", systemPrompt: "BASE", systemPromptOptions: {} };
		const deepseek = result.extensions.find((extension) => extension.path === "<builtin:deepseek-harness>")!;
		const preset = result.extensions.find((extension) => extension.path === "<builtin:prompt-preset>")!;
		const deepseekContext = { ...ctx, model: { provider: "deepseek", id: "deepseek-v3.2" } };
		expect(
			await deepseek.handlers.get("before_agent_start")![0](event as never, deepseekContext as never),
		).toMatchObject({ systemPrompt: expect.stringContaining('<model_harness id="deepseek_harness">') });
		expect(
			await preset.handlers.get("before_agent_start")![0](
				event as never,
				{ ...ctx, model: { provider: "openai", id: "gpt-6-astra" } } as never,
			),
		).toMatchObject({ systemPrompt: expect.stringContaining('<model_preset id="gpt-6-astra">') });
		expect(event.systemPrompt).toBe("BASE");
	});
	it("goal command reports no durable goal from an isolated empty project", async () => {
		const result = await reload();
		const { ctx, notify } = harness.context(result);
		await result.extensions
			.find((extension) => extension.commands.has("goal"))!
			.commands.get("goal")!
			.handler("", ctx);
		expect(notify).toHaveBeenCalledWith("no durable goal", "info");
	});
	it("opt-in deliverable and finish factories register their enabled lifecycle families", async () => {
		vi.stubEnv("OMK_DELIVERABLE_GUARD", "1");
		vi.stubEnv("OMK_FINISH_CHECK", "1");
		const result = await reload();
		const deliverable = result.extensions.find((extension) => extension.path === "<builtin:deliverable-guard>")!;
		const finish = result.extensions.find((extension) => extension.path === "<builtin:finish-check>")!;
		expect([...deliverable.handlers.keys()].sort()).toEqual([
			"agent_settled",
			"input",
			"message_end",
			"session_shutdown",
			"tool_execution_end",
		]);
		expect([...finish.handlers.keys()].sort()).toEqual([
			"agent_settled",
			"before_agent_start",
			"input",
			"message_end",
			"tool_execution_end",
		]);
	});
	it("Tencent memory status is local, unconfigured, non-capturing and not connection verification", async () => {
		const result = await reload();
		const { ctx } = harness.context(result);
		const tool = result.extensions
			.find((extension) => extension.tools.has("tencent_memory"))!
			.tools.get("tencent_memory")!.definition;
		expect(await tool.execute("status", { action: "status" }, undefined, undefined, ctx)).toMatchObject({
			details: { configured: false, credentialAvailable: false, automaticCapture: false, connectionVerified: false },
		});
	});
	it("reload removes old real event-bus subscriptions instead of stacking callbacks", async () => {
		user('export default api => {api.events.on("synthetic:reload", () => api.sendUserMessage("one callback"));};');
		const bus = createEventBus();
		const resourceLoader = loader(false, bus);
		const old = harness.context(await reload(resourceLoader));
		const fresh = harness.context(await reload(resourceLoader));
		bus.emit("synthetic:reload", {});
		expect(old.sendUserMessage).not.toHaveBeenCalled();
		expect(fresh.sendUserMessage).toHaveBeenCalledExactlyOnceWith("one callback", undefined);
	});
});
