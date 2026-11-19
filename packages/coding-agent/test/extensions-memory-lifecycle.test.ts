import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getModel } from "omk-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEventBus } from "../src/core/event-bus.ts";
import { listLoadedExtensions, trackLoadedExtensions } from "../src/core/extensions/internal-loaded-extensions.ts";
import { createExtensionRuntime, loadExtensionFromFactory, loadExtensions } from "../src/core/extensions/loader.ts";
import type { ExtensionActions } from "../src/core/extensions/types.ts";
import { DefaultResourceLoader } from "../src/core/resource-loader.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
	vi.restoreAllMocks();
});
function directory() {
	const root = mkdtempSync(join(tmpdir(), "omk-extension-memory-"));
	roots.push(root);
	return root;
}

describe("retired extension runtime memory ownership", () => {
	it("preserves pre-bind stubs, provider queuing and unregister behavior", async () => {
		const runtime = createExtensionRuntime();
		expect(() => runtime.assertActive()).not.toThrow();
		expect(() => runtime.refreshTools()).not.toThrow();
		expect(() => runtime.getActiveTools()).toThrow("Extension runtime not initialized");
		await expect(runtime.setModel(getModel("openai", "gpt-4o-mini"))).rejects.toThrow(
			"Extension runtime not initialized",
		);
		runtime.registerProvider("first", {});
		runtime.registerProvider("second", {}, "second.ts");
		runtime.unregisterProvider("first");
		expect(runtime.pendingProviderRegistrations).toEqual([
			{ name: "second", config: {}, extensionPath: "second.ts" },
		]);
	});

	it("releases every bound action and provider callback, rejecting calls without executing them", async () => {
		const runtime = createExtensionRuntime();
		const callback = vi.fn(() => {
			throw new Error("retired owner executed");
		});
		const actions = {
			sendMessage: callback,
			sendUserMessage: callback,
			appendEntry: callback,
			setSessionName: callback,
			getSessionName: callback,
			setLabel: callback,
			getActiveTools: callback,
			getAllTools: callback,
			setActiveTools: callback,
			refreshTools: callback,
			getCommands: callback,
			setModel: callback,
			getThinkingLevel: callback,
			setThinkingLevel: callback,
			callMcpTool: callback,
		} satisfies Required<ExtensionActions>;
		Object.assign(runtime, actions, { registerProvider: callback, unregisterProvider: callback });
		runtime.invalidate("retired owner");
		for (const key of Object.keys(actions) as Array<keyof typeof actions>) {
			expect(runtime[key], key).not.toBe(callback);
		}
		await expect(runtime.setModel(getModel("openai", "gpt-4o-mini"))).rejects.toThrow("retired owner");
		expect(runtime.callMcpTool).toBeUndefined();
		expect(() => runtime.getActiveTools()).toThrow("retired owner");
		expect(() => runtime.refreshTools()).toThrow("retired owner");
		expect(() => runtime.registerProvider("late", {})).toThrow("retired owner");
		expect(() => runtime.unregisterProvider("late")).toThrow("retired owner");
		expect(callback).not.toHaveBeenCalled();
	});

	it("drops pending payloads and the runtime-owned inventory without mutating the caller's extension array", async () => {
		const runtime = createExtensionRuntime();
		const extension = await loadExtensionFromFactory(
			(api) => {
				api.registerFlag("payload", { type: "string", default: "x".repeat(1024) });
				api.registerProvider("pending", { api: "openai-completions" });
			},
			directory(),
			createEventBus(),
			runtime,
			"memory.ts",
		);
		const extensions = trackLoadedExtensions(runtime, [extension]);
		const pending = runtime.pendingProviderRegistrations;
		expect(listLoadedExtensions(runtime)).toHaveLength(1);
		expect(pending).toHaveLength(1);
		runtime.invalidate();
		expect(runtime.flagValues.size).toBe(0);
		expect(runtime.providerOwners.size).toBe(0);
		expect(pending).toHaveLength(0);
		expect(listLoadedExtensions(runtime)).toEqual([]);
		expect(extensions).toEqual([extension]);
		expect(() => runtime.assertActive()).toThrow(/stale/);
		runtime.invalidate("different reason");
		expect(() => runtime.assertActive()).toThrow(/stale/);
	});
});

describe("failed extension factory subscription ownership", () => {
	it("attempts every unsubscribe and reports cleanup failures with the factory error as cause", async () => {
		const bus = createEventBus();
		const error = new Error("factory failed");
		const cleanupError = new Error("unsubscribe failed");
		const failed = vi.fn();
		const cleaned: string[] = [];
		const result = loadExtensionFromFactory(
			(api) => {
				api.events.on("first", failed);
				api.events.on("second", failed);
				throw error;
			},
			directory(),
			{
				emit: bus.emit,
				on: (channel, handler) => {
					const unsubscribe = bus.on(channel, handler);
					return () => {
						unsubscribe();
						cleaned.push(channel);
						if (channel === "first") throw cleanupError;
					};
				},
			},
			createExtensionRuntime(),
		);
		await expect(result).rejects.toMatchObject({ cause: error, errors: [error, cleanupError] });
		expect(cleaned).toEqual(["first", "second"]);
		bus.emit("first", null);
		bus.emit("second", null);
		expect(failed).not.toHaveBeenCalled();
	});

	it("cleans up an inline factory's subscriptions while preserving its error and other listeners", async () => {
		const bus = createEventBus();
		const surviving = vi.fn();
		const failed = vi.fn();
		const error = new Error("factory failed");
		bus.on("ping", surviving);
		await expect(
			loadExtensionFromFactory(
				(api) => {
					api.events.on("ping", failed);
					throw error;
				},
				directory(),
				bus,
				createExtensionRuntime(),
			),
		).rejects.toBe(error);
		bus.emit("ping", null);
		expect(surviving).toHaveBeenCalledOnce();
		expect(failed).not.toHaveBeenCalled();
	});

	it.each(["omk", "omk+pi"] as const)(
		"does not accumulate failed listeners across %s resource reloads",
		async (dialect) => {
			const root = directory();
			const agentDir = join(root, "agent");
			mkdirSync(agentDir);
			const extensionPath = join(root, "broken.ts");
			writeFileSync(
				extensionPath,
				`export default async api => {
			api.events.on("memory:ping", () => api.events.emit("memory:failed", null));
			await Promise.resolve();
			throw new Error("factory failed");
		}`,
			);
			const bus = createEventBus();
			const failed = vi.fn();
			const surviving = vi.fn();
			bus.on("memory:failed", failed);
			bus.on("memory:ping", surviving);
			const loader = new DefaultResourceLoader({
				cwd: root,
				agentDir,
				eventBus: bus,
				packageManifestDialect: dialect,
				settingsManager: SettingsManager.inMemory(),
				additionalExtensionPaths: [extensionPath],
				noExtensions: true,
				noSkills: true,
				noPromptTemplates: true,
				noThemes: true,
				noContextFiles: true,
			});
			try {
				for (let i = 0; i < 3; i++) {
					await loader.reload();
					expect(loader.getExtensions().errors).toEqual([
						{ path: extensionPath, error: "Failed to load extension: factory failed" },
					]);
				}
				bus.emit("memory:ping", null);
				expect(surviving).toHaveBeenCalledOnce();
				expect(failed).not.toHaveBeenCalled();
			} finally {
				bus.clear();
			}
		},
	);

	it("keeps a successful sibling's subscription after a path factory fails", async () => {
		const root = directory();
		const failedPath = join(root, "failed.ts");
		const goodPath = join(root, "good.ts");
		writeFileSync(
			failedPath,
			'export default api => { api.events.on("ping", () => api.events.emit("pong", "failed")); throw new Error("bad"); };',
		);
		writeFileSync(
			goodPath,
			'export default api => { api.events.on("ping", () => api.events.emit("pong", "good")); };',
		);
		const bus = createEventBus();
		const replies: unknown[] = [];
		bus.on("pong", (value) => {
			replies.push(value);
		});
		try {
			const loaded = await loadExtensions([failedPath, goodPath], root, bus, { packageManifestDialect: "omk" });
			expect(loaded.errors).toHaveLength(1);
			expect(loaded.extensions).toHaveLength(1);
			bus.emit("ping", null);
			expect(replies).toEqual(["good"]);
		} finally {
			bus.clear();
		}
	});
});
