import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type Component, type Terminal, Text, TUI, visibleWidth } from "omk-tui";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthStorage } from "../../../../packages/coding-agent/src/core/auth-storage.ts";
import { loadExtensions } from "../../../../packages/coding-agent/src/core/extensions/loader.ts";
import { ExtensionRunner } from "../../../../packages/coding-agent/src/core/extensions/runner.ts";
import type { ExtensionUIContext } from "../../../../packages/coding-agent/src/core/extensions/types.ts";
import { FooterDataProvider } from "../../../../packages/coding-agent/src/core/footer-data-provider.ts";
import { KeybindingsManager } from "../../../../packages/coding-agent/src/core/keybindings.ts";
import { ModelRegistry } from "../../../../packages/coding-agent/src/core/model-registry.ts";
import { SessionManager } from "../../../../packages/coding-agent/src/core/session-manager.ts";
import {
	getEditorTheme,
	initTheme,
	loadThemeFromPath,
} from "../../../../packages/coding-agent/src/modes/interactive/theme/theme.ts";
import { stripTerminalSequences } from "../src/compat.ts";
import type { SubscriptionUsageData } from "../src/subscription-usage.ts";

const cleanups: (() => unknown)[] = [];
afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function start(mode: "tui" | "rpc" | "print" | "json" = "tui") {
	const cwd = mkdtempSync(join(tmpdir(), "omk-atelier-"));
	cleanups.push(() => rmSync(cwd, { recursive: true, force: true }));
	const loaded = await loadExtensions([resolve("index.ts")], cwd);
	expect(loaded.errors).toEqual([]);
	const sm = SessionManager.inMemory(cwd);
	const registry = ModelRegistry.create(AuthStorage.inMemory(), join(cwd, "models.json"));
	const runner = new ExtensionRunner(loaded.extensions, loaded.runtime, cwd, sm, registry);
	const terminal = {
		columns: 140,
		rows: 44,
		kittyProtocolActive: false,
		start() {},
		stop() {},
		drainInput: async () => {},
		write() {},
		moveBy() {},
		hideCursor() {},
		showCursor() {},
		clearLine() {},
		clearFromCursor() {},
		clearScreen() {},
		setTitle() {},
		setProgress() {},
	} satisfies Terminal;
	const tui = new TUI(terminal);
	const errors: string[] = [],
		notices: string[] = [];
	runner.onError((error) => errors.push(error.error));
	initTheme("dark");
	let currentTheme = loadThemeFromPath(resolve("themes/omk-atelier-dark.json"), "truecolor");
	let footer: (Component & { dispose?(): void }) | undefined;
	let editor: Component | undefined;
	let idle = true;
	const keybindings = new KeybindingsManager();
	const closeOverlays: (() => void)[] = [];
	const footerData: FooterDataProvider & SubscriptionUsageData = new FooterDataProvider(cwd);
	cleanups.push(() => footerData.dispose());
	footerData.getSubscriptionUsage = () => [
		{ label: "CODEX", windows: [{ label: "5H", usedPercent: 35, resetsAt: Date.now() / 1000 + 3600 }] },
		{ label: "META", windows: [], message: "no observed usage yet" },
	];
	const ui: ExtensionUIContext = {
		...runner.getUIContext(),
		get theme() {
			return currentTheme;
		},
		notify: (message) => {
			notices.push(message);
		},
		onTerminalInput: (handler) => tui.addInputListener(handler),
		setFooter(factory) {
			if (footer) {
				tui.removeChild(footer);
				footer.dispose?.();
			}
			footer = factory?.(tui, currentTheme, footerData);
			if (footer) tui.addChild(footer);
		},
		setEditorComponent(factory) {
			if (editor) tui.removeChild(editor);
			editor = factory?.(tui, getEditorTheme(), keybindings);
			if (editor) tui.addChild(editor);
		},
		async custom(factory, options) {
			return new Promise((done, reject) => {
				Promise.resolve(
					factory(tui, currentTheme, keybindings, (value) => {
						close();
						done(value);
					}),
				).then((component) => {
					const overlayOptions =
						typeof options?.overlayOptions === "function" ? options.overlayOptions() : options?.overlayOptions;
					const handle = tui.showOverlay(component, overlayOptions);
					close = () => {
						handle.hide();
						component.dispose?.();
					};
					closeOverlays.push(close);
					options?.onHandle?.(handle);
				}, reject);
				let close = () => {};
			});
		},
		setTheme(value) {
			const name = typeof value === "string" ? value : value.name;
			if (name !== "omk-atelier-dark" && name !== "omk-atelier-light")
				return { success: false, error: "Unknown theme" };
			currentTheme = loadThemeFromPath(resolve(`themes/${name}.json`), "truecolor");
			tui.invalidate();
			return { success: true };
		},
	};
	runner.bindCore(
		{
			sendMessage() {},
			sendUserMessage() {},
			appendEntry: (type, data) => {
				sm.appendCustomEntry(type, data);
			},
			setSessionName() {},
			getSessionName: () => undefined,
			setLabel() {},
			getActiveTools: () => ["read", "todo", "update_todo"],
			getAllTools: () => [],
			setActiveTools() {},
			refreshTools() {},
			getCommands: () => [],
			setModel: async () => false,
			getThinkingLevel: () => "high",
			setThinkingLevel() {},
		},
		{
			getModel: () => registry.getAll()[0],
			getSignal: () => undefined,
			isIdle: () => idle,
			abort() {},
			hasPendingMessages: () => false,
			shutdown() {},
			getContextUsage: () => ({ tokens: 8000, contextWindow: 100000, percent: 8 }),
			compact() {},
			getSystemPrompt: () => "",
		},
	);
	runner.setUIContext(ui, mode);
	cleanups.push(async () => {
		await runner.emit({ type: "session_shutdown", reason: "quit" });
		for (const close of closeOverlays) close();
	});
	tui.addChild(new Text("OMK transcript 한국어", 0, 0));
	await runner.emit({ type: "session_start", reason: "startup" });
	await Promise.resolve();
	const command = async (args: string, name = "atelier") => {
		const registered = runner.getCommand(name);
		expect(registered).toBeDefined();
		await registered?.handler(args, runner.createCommandContext());
	};
	const render = (raw = false) => {
		const composite = Reflect.get(tui, "compositeOverlays");
		const lines: string[] = Reflect.apply(composite, tui, [
			tui.render(tui.contentWidth),
			terminal.columns,
			terminal.rows,
		]);
		for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(terminal.columns);
		return raw ? lines.join("\n") : stripTerminalSequences(lines.join("\n"));
	};
	return {
		runner,
		tui,
		terminal,
		errors,
		notices,
		command,
		render,
		cwd,
		footerData,
		setIdle: (value: boolean) => {
			idle = value;
		},
		get theme() {
			return currentTheme;
		},
	};
}

describe("Atelier real OMK loader and event consumer", () => {
	it.skipIf(spawnSync("tmux", ["-V"]).status !== 0)(
		"renders the live sidebar in an owned tmux pane and toggles it with Ctrl+Shift+Q",
		async () => {
			const directory = mkdtempSync(join(tmpdir(), "omk-atelier-tmux-"));
			const socket = join(directory, "socket");
			const tmux = (...args: string[]) =>
				execFileSync("tmux", ["-S", socket, ...args], { encoding: "utf8", timeout: 3000 });
			cleanups.push(() => vi.unstubAllEnvs());
			cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
			const main = tmux(
				"-f",
				"/dev/null",
				"new-session",
				"-d",
				"-x",
				"140",
				"-y",
				"44",
				"-P",
				"-F",
				"#{pane_id}",
				"sleep 60",
			).trim();
			cleanups.push(() => tmux("kill-server"));
			const window = tmux("display-message", "-p", "-t", main, "#{window_id}").trim();
			const neighbor = tmux("new-window", "-d", "-a", "-t", window, "-P", "-F", "#{pane_id}", "sleep 60").trim();
			vi.stubEnv("TMUX", `${socket},1,0`);
			vi.stubEnv("TMUX_PANE", main);
			const h = await start();
			expect(h.tui.contentWidth).toBe(140);
			const panes = () => tmux("list-panes", "-t", main, "-F", "#{pane_id}").trim().split("\n");
			expect(panes()).toHaveLength(2);
			const capture = () => tmux("capture-pane", "-p", "-t", panes().find((pane) => pane !== main) ?? main);
			await expect.poll(capture).toContain("AGENT");
			expect(tmux("display-message", "-p", "-t", main, "#{pane_active}").trim()).toBe("1");
			const shortcuts = h.runner.getShortcuts(new KeybindingsManager().getEffectiveConfig());
			expect(shortcuts.has("ctrl+q")).toBe(false);
			expect(h.runner.getShortcutDiagnostics()).toEqual([]);
			const shortcut = shortcuts.get("ctrl+shift+q");
			expect(shortcut).toBeDefined();
			await shortcut?.handler(h.runner.createCommandContext());
			expect(panes()).toEqual([main]);
			await shortcut?.handler(h.runner.createCommandContext());
			expect(panes()).toHaveLength(2);
			h.render();
			await h.runner.emitToolResult({
				type: "tool_result",
				toolName: "update_todo",
				toolCallId: "tmux-todo",
				input: { items: [{ id: "tmux", label: "Live tmux task", status: "active" }] },
				content: [],
				details: {},
				isError: false,
			});
			await expect.poll(capture).toContain("Live tmux task");
			await expect.poll(capture).toContain("CODEX 5H");
			tmux("resize-pane", "-t", panes().find((pane) => pane !== main) ?? main, "-x", "36");
			await expect.poll(() => Math.max(...capture().trimEnd().split("\n").map(visibleWidth))).toBe(36);
			await h.command("sidebar off");
			tmux("resize-window", "-t", window, "-x", "80", "-y", "44");
			await h.command("sidebar on");
			expect(panes()).toEqual([main]);
			expect(h.notices.at(-2)).toContain("93 columns");
			tmux("resize-window", "-t", window, "-x", "140", "-y", "44");
			await h.command("sidebar on");
			await expect.poll(capture).toContain("Live tmux task");
			const reassigned = panes().find((pane) => pane !== main) ?? main;
			tmux("set-option", "-p", "-t", reassigned, "@omk_atelier_owner", "another-owner");
			await h.runner.emit({ type: "session_shutdown", reason: "reload" });
			expect(panes()).toEqual([main, reassigned]);
			expect(tmux("display-message", "-p", "-t", neighbor, "#{pane_id}").trim()).toBe(neighbor);
			tmux("kill-pane", "-t", reassigned);
			await h.runner.emit({ type: "session_start", reason: "reload" });
			await expect.poll(capture).toContain("AGENT");
			await h.runner.emit({ type: "session_shutdown", reason: "quit" });
			expect(panes()).toEqual([main]);
			expect(h.errors).toEqual([]);
			expect(h.notices.filter((message) => /failed|could not/i.test(message))).toEqual([]);
		},
	);
	it("loads controls, contributes themes, renders and disposes the actual footer/editor/sidebar", async () => {
		const h = await start();
		expect(h.errors).toEqual([]);
		expect(h.notices.filter((m) => /failed|could not/i.test(m))).toEqual([]);
		expect(h.tui.contentWidth).toBe(96);
		expect(h.render()).toContain("AGENT");
		expect(h.render()).toContain("QUOTA");
		expect(h.render()).toContain("CODEX 5H");
		expect(h.render()).toContain("35%");
		expect(h.render()).toContain("OMK transcript");
		const toggle = h.runner.getShortcuts(new KeybindingsManager().getEffectiveConfig()).get("ctrl+shift+q");
		expect(toggle).toBeDefined();
		await toggle?.handler(h.runner.createCommandContext());
		expect(h.tui.contentWidth).toBe(140);
		await toggle?.handler(h.runner.createCommandContext());
		expect(h.tui.contentWidth).toBe(96);
		const resources = await h.runner.emitResourcesDiscover(h.cwd, "startup");
		expect(resources.themePaths).toHaveLength(1);
		await h.command("light", "atelier-theme");
		expect(h.theme.name).toBe("omk-atelier-light");
		expect(h.render(true)).toContain(h.theme.getFgAnsi("text"));
		await h.command("off", "atelier-theme");
		expect(h.notices.at(-1)).toContain("Usage:");
		await h.command("disable");
		expect(h.tui.contentWidth).toBe(140);
		expect(h.render()).not.toContain("AGENT");
		await h.command("enable");
		expect(h.tui.contentWidth).toBe(140);
		await h.command("sidebar on");
		expect(h.tui.contentWidth).toBe(96);
		await h.runner.emit({ type: "session_shutdown", reason: "reload" });
		expect(h.tui.contentWidth).toBe(140);
		await h.runner.emit({ type: "session_start", reason: "reload" });
		expect(h.tui.contentWidth).toBe(96);
		expect(h.errors).toEqual([]);
	});
	it("updates the actual contributed quota panel and clears retired readers on reload", async () => {
		const h = await start();
		expect(h.render()).toContain("35%");
		h.footerData.getSubscriptionUsage = () => [{ label: "CLAUDE", windows: [{ label: "7D", usedPercent: 95 }] }];
		h.render();
		expect(h.render()).toContain("CLAUDE 7D");
		expect(h.render()).not.toContain("CODEX 5H");
		await h.command("sidebar off");
		expect(h.render()).toContain("CLAUDE 7D 95%");
		await h.command("disable");
		expect(h.render()).not.toContain("95%");
		await h.command("enable");
		await h.command("sidebar on");
		h.render();
		expect(h.render()).toContain("95%");
		await h.runner.emit({ type: "session_shutdown", reason: "reload" });
		expect(h.render()).not.toContain("95%");
		await h.runner.emit({ type: "session_start", reason: "reload" });
		h.render();
		expect(h.render()).toContain("95%");
		expect(h.errors).toEqual([]);
	});
	it("consumes real tool events and both OMK TODO result shapes", async () => {
		const h = await start();
		h.setIdle(false);
		await h.runner.emit({ type: "agent_start" });
		await h.runner.emit({
			type: "tool_execution_start",
			toolCallId: "read1",
			toolName: "read",
			args: { path: "/tmp/file.ts" },
		});
		expect(h.render()).toContain("read");
		await h.runner.emitToolResult({
			type: "tool_result",
			toolName: "update_todo",
			toolCallId: "todo1",
			input: { items: [{ id: "impl", label: "Native TODO", status: "active" }] },
			content: [],
			details: {},
			isError: false,
		});
		expect(h.render()).toContain("Native TODO");
		await h.runner.emitToolResult({
			type: "tool_result",
			toolName: "todo",
			toolCallId: "todo2",
			input: {},
			content: [],
			details: { tasks: [{ id: 2, subject: "Session TODO", status: "in_progress" }] },
			isError: false,
		});
		expect(h.render()).toContain("Session TODO");
		await h.runner.emit({
			type: "tool_execution_end",
			toolCallId: "read1",
			toolName: "read",
			result: { content: [], details: {} },
			isError: false,
		});
		h.setIdle(true);
		await h.runner.emit({ type: "agent_settled", messages: [], aborted: false });
		expect(h.render()).toContain("Ready");
		expect(h.errors).toEqual([]);
	});
	it.each(["rpc", "print", "json"] as const)("does not acquire TUI in %s mode", async (mode) => {
		const h = await start(mode);
		expect(h.tui.contentWidth).toBe(140);
		await h.command("sidebar");
		expect(h.notices.at(-1)).toContain("TUI");
		expect(h.errors).toEqual([]);
	});
});
