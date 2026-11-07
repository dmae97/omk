import childProcess from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, vi } from "vitest";
import { AuthStorage } from "../../src/core/auth-storage.ts";
import { createEventBus } from "../../src/core/event-bus.ts";
import { loadExtensions } from "../../src/core/extensions/loader.ts";
import { ExtensionRunner } from "../../src/core/extensions/runner.ts";
import type { Extension, ExtensionRuntime, LoadExtensionsResult } from "../../src/core/extensions/types.ts";
import { ModelRegistry } from "../../src/core/model-registry.ts";
import type { PackageManifestDialect } from "../../src/core/package-manifest.ts";
import { SessionManager } from "../../src/core/session-manager.ts";

export interface RegistryContract {
	commands?: string[];
	tools?: string[];
	events?: Record<string, number>;
	flags?: Record<string, { type: string; default?: boolean | string }>;
	shortcuts?: string[];
	renderers?: string[];
	providers?: string[];
}
export interface InventoryRow {
	id: string;
	scope?: string;
	discovery?: string;
	envVar?: string;
	registry: RegistryContract;
	baseline: string;
	sourceReview: string;
	eventChannels?: string[];
	resources?: string[];
	features: { family: string; cases?: string[]; unverified?: string }[];
	unverified: { status: "UNVERIFIED"; reason: string }[];
	selected?: {
		kind: string;
		name?: string;
		args?: Record<string, unknown>;
		event?: Record<string, unknown>;
		expected?: unknown;
		text?: string;
	};
}
export const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
export const inventory = JSON.parse(
	readFileSync(new URL("./native-extension-inventory.json", import.meta.url), "utf8"),
) as {
	entries: InventoryRow[];
	builtins: InventoryRow[];
};
export const dialects = ["omk+pi", "omk"] as const;
export const emptyRegistry = {
	commands: [],
	tools: [],
	events: {},
	flags: {},
	shortcuts: [],
	renderers: [],
	providers: [],
};

export function registryOf(extension: Extension, runtime: ExtensionRuntime): RegistryContract {
	return {
		commands: [...extension.commands.keys()].sort(),
		tools: [...extension.tools.keys()].sort(),
		events: Object.fromEntries([...extension.handlers].map(([name, handlers]) => [name, handlers.length])),
		flags: Object.fromEntries(
			[...extension.flags].map(([name, flag]) => [
				name,
				{ type: flag.type, ...(flag.default === undefined ? {} : { default: flag.default }) },
			]),
		),
		shortcuts: [...extension.shortcuts.keys()].sort(),
		renderers: [...extension.messageRenderers.keys()].sort(),
		providers: [...runtime.providerOwners]
			.filter(([, owner]) => owner === extension.resolvedPath)
			.map(([name]) => name)
			.sort(),
	};
}

export function preservationHarness() {
	let temp = "";
	let cwd = "";
	let agentDir = "";
	let previousCwd = "";
	const attempts: string[] = [];
	const loaded: LoadExtensionsResult[] = [];
	beforeEach(() => {
		temp = mkdtempSync(join(tmpdir(), "omk-entry-preservation-"));
		cwd = join(temp, "project");
		agentDir = join(temp, "agent");
		mkdirSync(join(cwd, ".git"), { recursive: true });
		mkdirSync(agentDir, { recursive: true });
		previousCwd = process.cwd();
		process.chdir(cwd);
		for (const [key, value] of Object.entries({
			HOME: temp,
			USERPROFILE: temp,
			OMK_CODING_AGENT_DIR: agentDir,
			OMK_GOAL_AUTONOMY: "0",
			OMK_GOAL_OUTPUT_RECALL: "0",
			OMK_EVIDENCE_LIFECYCLE: "0",
		}))
			vi.stubEnv(key, value);
		for (const key of [
			"TELEGRAM_BOT_TOKEN",
			"TELEGRAM_CHAT_ID",
			"OMK_TELEGRAM_TOKEN",
			"OMK_TELEGRAM_CHAT_ID",
			"WT_SESSION",
			"KITTY_WINDOW_ID",
		])
			vi.stubEnv(key, "");
		const deny = (boundary: string) => () => {
			attempts.push(boundary);
			throw new Error(`Unintended external boundary: ${boundary}`);
		};
		vi.stubGlobal("fetch", vi.fn(deny("fetch")));
		for (const method of ["exec", "execFile", "execSync", "execFileSync", "spawn", "spawnSync", "fork"] as const)
			vi.spyOn(childProcess, method).mockImplementation(deny(method) as never);
		for (const module of [http, https])
			for (const method of ["request", "get"] as const)
				vi.spyOn(module, method).mockImplementation(deny(method) as never);
		syncBuiltinESMExports();
	});
	afterEach(() => {
		for (const result of loaded.splice(0))
			for (const extension of result.extensions)
				for (const unsubscribe of extension.eventBusSubscriptions ?? []) unsubscribe();
		const unexpected = [...attempts];
		attempts.length = 0;
		vi.restoreAllMocks();
		syncBuiltinESMExports();
		vi.unstubAllGlobals();
		vi.unstubAllEnvs();
		process.chdir(previousCwd);
		rmSync(temp, { recursive: true, force: true });
		expect(unexpected, "no external executable or network calls").toEqual([]);
	});
	return {
		get cwd() {
			return cwd;
		},
		get agentDir() {
			return agentDir;
		},
		track(result: LoadExtensionsResult) {
			loaded.push(result);
			return result;
		},
		async load(row: InventoryRow, dialect: PackageManifestDialect) {
			const bus = createEventBus();
			const subscriptions = vi.spyOn(bus, "on");
			const result = await loadExtensions([resolve(repoRoot, row.id)], cwd, bus, {
				packageManifestDialect: dialect,
			});
			loaded.push(result);
			expect(result.errors, row.id).toEqual([]);
			expect(result.extensions).toHaveLength(1);
			const extension = result.extensions[0];
			expect(extension.path).toBe(resolve(repoRoot, row.id));
			expect(extension.resolvedPath).toBe(resolve(repoRoot, row.id));
			expect(registryOf(extension, result.runtime)).toEqual({ ...emptyRegistry, ...row.registry });
			expect(subscriptions.mock.calls.map(([channel]) => channel).sort()).toEqual(row.eventChannels ?? []);
			for (const name of row.registry.providers ?? [])
				expect(result.runtime.providerOwners.get(name)).toBe(extension.resolvedPath);
			return result;
		},
		context(result: LoadExtensionsResult) {
			const sessionManager = SessionManager.inMemory(cwd);
			const modelRegistry = ModelRegistry.create(AuthStorage.inMemory(), join(agentDir, "models.json"));
			const runner = new ExtensionRunner(result.extensions, result.runtime, cwd, sessionManager, modelRegistry);
			const notify = vi.fn();
			const sendUserMessage = vi.fn();
			const sendMessage = vi.fn();
			result.runtime.sendUserMessage = sendUserMessage;
			result.runtime.sendMessage = sendMessage;
			result.runtime.appendEntry = sessionManager.appendCustomEntry.bind(sessionManager);
			result.runtime.getActiveTools = () => [];
			result.runtime.getAllTools = () => [];
			result.runtime.getCommands = () => [];
			result.runtime.getThinkingLevel = () => "off";
			const ctx = runner.createCommandContext();
			return { runner, ctx: { ...ctx, ui: { ...ctx.ui, notify } }, notify, sendUserMessage, sendMessage };
		},
	};
}

export async function runSelected(
	row: InventoryRow,
	result: LoadExtensionsResult,
	harness: ReturnType<typeof preservationHarness>,
) {
	const selected = row.selected;
	if (!selected) throw new Error(`No selected case declared for ${row.id}`);
	const extension = result.extensions[0];
	const { ctx, runner, notify, sendUserMessage } = harness.context(result);
	if (selected.kind === "tool") {
		const tool = extension.tools.get(selected.name!)!.definition;
		const output = await tool.execute(
			"preservation",
			selected.args ?? {},
			new AbortController().signal,
			undefined,
			ctx,
		);
		if (selected.text)
			expect(output.content).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ type: "text", text: expect.stringContaining(selected.text) }),
				]),
			);
		if (selected.expected) expect(output).toMatchObject(selected.expected);
	} else if (selected.kind === "event") {
		const handlers = extension.handlers.get(selected.name!)!;
		expect(handlers.length).toBeGreaterThan(0);
		const outputs = [];
		for (const handler of handlers)
			outputs.push((await handler({ type: selected.name, ...selected.event } as never, ctx)) ?? null);
		expect(outputs).toEqual(selected.expected);
	} else if (selected.kind === "input") {
		const errors: unknown[] = [];
		runner.onError((error) => errors.push(error));
		expect(await runner.emitInput(selected.text!, undefined, "interactive", "steer")).toEqual(selected.expected);
		expect(errors).toEqual([]);
	} else if (selected.kind === "command") {
		await extension.commands.get(selected.name!)!.handler(selected.text ?? "", ctx);
		if (selected.expected) expect(notify.mock.calls).toEqual(selected.expected);
	} else if (selected.kind === "completion") {
		expect(extension.commands.get(selected.name!)!.getArgumentCompletions?.(selected.text ?? "")).toEqual(
			selected.expected,
		);
	} else if (selected.kind === "message") {
		await extension.commands.get(selected.name!)!.handler(selected.text ?? "", { ...ctx, isIdle: () => false });
		expect(sendUserMessage.mock.calls.map((args) => (args.at(-1) === undefined ? args.slice(0, -1) : args))).toEqual(
			selected.expected,
		);
	} else throw new Error(`Unknown selected case ${selected.kind}`);
}
