/**
 * Tests for ExtensionRunner - conflict detection, error handling, tool wrapping.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createTempDirSync, logger } from "@oh-my-pi/pi-utils";
import { ModelRegistry } from "$c/config/model-registry";
import { discoverAndLoadExtensions } from "$c/extensibility/extensions/loader";
import { ExtensionRunner } from "$c/extensibility/extensions/runner";
import { AuthStorage } from "$c/session/auth-storage";
import { SessionManager } from "$c/session/session-manager";

describe("ExtensionRunner", () => {
	let tempDir: ReturnType<typeof createTempDirSync>;
	let extensionsDir: string;
	let sessionManager: SessionManager;
	let modelRegistry: ModelRegistry;

	beforeEach(() => {
		tempDir = createTempDirSync("@pi-runner-test-");
		extensionsDir = join(tempDir.path, ".omp", "extensions");
		mkdirSync(extensionsDir, { recursive: true });
		sessionManager = SessionManager.inMemory();
		const authStorage = new AuthStorage(join(tempDir.path, "auth.json"));
		modelRegistry = new ModelRegistry(authStorage);
	});

	afterEach(() => {
		tempDir.remove();
	});

	describe("shortcut conflicts", () => {
		it("warns when extension shortcut conflicts with built-in", async () => {
			const extCode = `
				export default function(pi) {
					pi.registerShortcut("ctrl+c", {
						description: "Conflicts with built-in",
						handler: async () => {},
					});
				}
			`;
			writeFileSync(join(extensionsDir, "conflict.ts"), extCode);

			const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});

			const result = await discoverAndLoadExtensions([], tempDir.path);
			const runner = new ExtensionRunner(
				result.extensions,
				result.runtime,
				tempDir.path,
				sessionManager,
				modelRegistry,
			);
			const shortcuts = runner.getShortcuts();

			expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("conflicts with built-in"), expect.any(Object));
			expect(shortcuts.has("ctrl+c")).toBe(false);

			warnSpy.mockRestore();
		});

		it("warns when two extensions register same shortcut", async () => {
			// Use a non-reserved shortcut
			const extCode1 = `
				export default function(pi) {
					pi.registerShortcut("ctrl+shift+x", {
						description: "First extension",
						handler: async () => {},
					});
				}
			`;
			const extCode2 = `
				export default function(pi) {
					pi.registerShortcut("ctrl+shift+x", {
						description: "Second extension",
						handler: async () => {},
					});
				}
			`;
			writeFileSync(join(extensionsDir, "ext1.ts"), extCode1);
			writeFileSync(join(extensionsDir, "ext2.ts"), extCode2);

			const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});

			const result = await discoverAndLoadExtensions([], tempDir.path);
			const runner = new ExtensionRunner(
				result.extensions,
				result.runtime,
				tempDir.path,
				sessionManager,
				modelRegistry,
			);
			const shortcuts = runner.getShortcuts();

			expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("shortcut conflict"), expect.any(Object));
			// Last one wins
			expect(shortcuts.has("ctrl+shift+x")).toBe(true);

			warnSpy.mockRestore();
		});
	});

	describe("tool collection", () => {
		it("collects tools from multiple extensions", async () => {
			const toolCode = (name: string) => `
				export default function(pi) {
					const { Type } = pi.typebox;
					pi.registerTool({
						name: "${name}",
						label: "${name}",
						description: "Test tool",
						parameters: Type.Object({}),
						execute: async () => ({ content: [{ type: "text", text: "ok" }], details: {} }),
					});
				}
			`;
			writeFileSync(join(extensionsDir, "tool-a.ts"), toolCode("tool_a"));
			writeFileSync(join(extensionsDir, "tool-b.ts"), toolCode("tool_b"));

			const result = await discoverAndLoadExtensions([], tempDir.path);
			const runner = new ExtensionRunner(
				result.extensions,
				result.runtime,
				tempDir.path,
				sessionManager,
				modelRegistry,
			);
			const tools = runner.getAllRegisteredTools();

			expect(tools.length).toBe(2);
			expect(tools.map((t) => t.definition.name).sort()).toEqual(["tool_a", "tool_b"]);
		});
	});

	describe("command collection", () => {
		it("collects commands from multiple extensions", async () => {
			const cmdCode = (name: string) => `
				export default function(pi) {
					pi.registerCommand("${name}", {
						description: "Test command",
						handler: async () => {},
					});
				}
			`;
			writeFileSync(join(extensionsDir, "cmd-a.ts"), cmdCode("cmd-a"));
			writeFileSync(join(extensionsDir, "cmd-b.ts"), cmdCode("cmd-b"));

			const result = await discoverAndLoadExtensions([], tempDir.path);
			const runner = new ExtensionRunner(
				result.extensions,
				result.runtime,
				tempDir.path,
				sessionManager,
				modelRegistry,
			);
			const commands = runner.getRegisteredCommands();

			expect(commands.length).toBe(2);
			expect(commands.map((c) => c.name).sort()).toEqual(["cmd-a", "cmd-b"]);
		});

		it("gets command by name", async () => {
			const cmdCode = `
				export default function(pi) {
					pi.registerCommand("my-cmd", {
						description: "My command",
						handler: async () => {},
					});
				}
			`;
			writeFileSync(join(extensionsDir, "cmd.ts"), cmdCode);

			const result = await discoverAndLoadExtensions([], tempDir.path);
			const runner = new ExtensionRunner(
				result.extensions,
				result.runtime,
				tempDir.path,
				sessionManager,
				modelRegistry,
			);

			const cmd = runner.getCommand("my-cmd");
			expect(cmd).toBeDefined();
			expect(cmd?.name).toBe("my-cmd");
			expect(cmd?.description).toBe("My command");

			const missing = runner.getCommand("not-exists");
			expect(missing).toBeUndefined();
		});
	});

	describe("error handling", () => {
		it("calls error listeners when handler throws", async () => {
			const extCode = `
				export default function(pi) {
					pi.on("context", async () => {
						throw new Error("Handler error!");
					});
				}
			`;
			writeFileSync(join(extensionsDir, "throws.ts"), extCode);

			const result = await discoverAndLoadExtensions([], tempDir.path);
			const runner = new ExtensionRunner(
				result.extensions,
				result.runtime,
				tempDir.path,
				sessionManager,
				modelRegistry,
			);

			const errors: Array<{ extensionPath: string; event: string; error: string }> = [];
			runner.onError((err) => {
				errors.push(err);
			});

			// Emit context event which will trigger the throwing handler
			await runner.emitContext([]);

			expect(errors.length).toBe(1);
			expect(errors[0].error).toContain("Handler error!");
			expect(errors[0].event).toBe("context");
		});
	});

	describe("message renderers", () => {
		it("gets message renderer by type", async () => {
			const extCode = `
				export default function(pi) {
					pi.registerMessageRenderer("my-type", (message, options, theme) => null);
				}
			`;
			writeFileSync(join(extensionsDir, "renderer.ts"), extCode);

			const result = await discoverAndLoadExtensions([], tempDir.path);
			const runner = new ExtensionRunner(
				result.extensions,
				result.runtime,
				tempDir.path,
				sessionManager,
				modelRegistry,
			);

			const renderer = runner.getMessageRenderer("my-type");
			expect(renderer).toBeDefined();

			const missing = runner.getMessageRenderer("not-exists");
			expect(missing).toBeUndefined();
		});
	});

	describe("flags", () => {
		it("collects flags from extensions", async () => {
			const extCode = `
				export default function(pi) {
					pi.registerFlag("--my-flag", {
						description: "My flag",
						handler: async () => {},
					});
				}
			`;
			writeFileSync(join(extensionsDir, "with-flag.ts"), extCode);

			const result = await discoverAndLoadExtensions([], tempDir.path);
			const runner = new ExtensionRunner(
				result.extensions,
				result.runtime,
				tempDir.path,
				sessionManager,
				modelRegistry,
			);
			const flags = runner.getFlags();

			expect(flags.has("--my-flag")).toBe(true);
		});

		it("can set flag values", async () => {
			const extCode = `
				export default function(pi) {
					pi.registerFlag("--test-flag", {
						description: "Test flag",
						handler: async () => {},
					});
				}
			`;
			writeFileSync(join(extensionsDir, "flag.ts"), extCode);

			const result = await discoverAndLoadExtensions([], tempDir.path);
			const runner = new ExtensionRunner(
				result.extensions,
				result.runtime,
				tempDir.path,
				sessionManager,
				modelRegistry,
			);

			// Setting a flag value should not throw
			runner.setFlagValue("--test-flag", true);

			// The flag values are stored in the shared runtime
			expect(result.runtime.flagValues.get("--test-flag")).toBe(true);
		});
	});

	describe("hasHandlers", () => {
		it("returns true when handlers exist for event type", async () => {
			const extCode = `
				export default function(pi) {
					pi.on("tool_call", async () => undefined);
				}
			`;
			writeFileSync(join(extensionsDir, "handler.ts"), extCode);

			const result = await discoverAndLoadExtensions([], tempDir.path);
			const runner = new ExtensionRunner(
				result.extensions,
				result.runtime,
				tempDir.path,
				sessionManager,
				modelRegistry,
			);

			expect(runner.hasHandlers("tool_call")).toBe(true);
			expect(runner.hasHandlers("agent_end")).toBe(false);
		});
	});
});
