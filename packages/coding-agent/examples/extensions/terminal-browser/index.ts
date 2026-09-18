/**
 * terminal-browser for OMK — renders a real browser inside the OMK TUI.
 *
 * Port of https://github.com/zenbu-labs/terminal-browser/tree/main/claude-code-plugin
 * (MIT, zenbu-labs). Claude Code's function-hooks/Pane API does not exist in OMK,
 * so the pane is implemented as a `ctx.ui.custom` overlay rendering kitty
 * unicode placeholders. The terminal-browser `claude-bridge` HTTP API is reused
 * unchanged (see bridge.ts).
 *
 * Usage:
 *   terminal-browser must be installed (https://terminal-browser.sh).
 *   omk --extension ./examples/extensions/terminal-browser
 *
 * Commands:
 *   /browser [url]   open the browser pane (empty arg toggles close)
 *   /browser close   close the browser pane
 *
 * Tools (registered for the LLM):
 *   terminal_browser_open { url? }
 *   terminal_browser_close
 *
 * Requires a terminal with kitty graphics protocol + unicode placeholders
 * (ghostty, kitty, libghostty terminals). Under tmux or unsupported terminals
 * the command reports a clear error instead of garbling the TUI.
 */

import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "open-multi-agent-kit";
import { Type } from "typebox";
import { TerminalBrowserBridge } from "./bridge.ts";
import { BrowserSurfaceComponent } from "./browser-surface.ts";

const START_URL = "terminal-browser://start";

let bridge: TerminalBrowserBridge | null = null;
let overlayOpen = false;
let pendingUrl: string | null = null;
let surface: BrowserSurfaceComponent | null = null;

function getBridge(ctx: ExtensionContext): TerminalBrowserBridge {
	bridge ??= new TerminalBrowserBridge({
		onAgentText: (text) => {
			const existing = ctx.ui.getEditorText();
			ctx.ui.setEditorText(existing ? `${existing}\n${text}` : `${text}\n`);
		},
	});
	return bridge;
}

function kittyImagesSupported(): boolean {
	if (
		process.env.TMUX ||
		(process.env.TERM ?? "").startsWith("tmux") ||
		(process.env.TERM ?? "").startsWith("screen")
	) {
		return false;
	}
	if (process.env.KITTY_WINDOW_ID) return true;
	const termProgram = (process.env.TERM_PROGRAM ?? "").toLowerCase();
	return termProgram !== "";
}

function normalizeUrl(raw: string): string {
	const text = raw.trim();
	if (/^[a-z][a-z0-9+.-]*:/i.test(text)) return text;
	if (/^localhost(:\d+)?(\/|$)/.test(text) || /^\d+\.\d+\.\d+\.\d+/.test(text)) return `http://${text}`;
	return `https://${text}`;
}

async function openBrowser(
	ctx: ExtensionContext,
	raw: string | null,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
	if (!kittyImagesSupported()) {
		return {
			ok: false,
			error: "This terminal does not support kitty graphics placeholders. terminal-browser needs ghostty/kitty (or a libghostty terminal); tmux and screen are not supported.",
		};
	}
	const b = getBridge(ctx);
	if (!b.isRunning()) {
		const started = await b.start();
		if (!started.ok) return started;
	}
	const alive = b.getState()?.alive === true;
	const url = raw ? normalizeUrl(raw) : alive && b.getState()?.url ? b.getState()!.url! : START_URL;
	overlayOpen = true;
	pendingUrl = url;

	await ctx.ui.custom(
		(tui, theme, _keybindings, done) => {
			surface = new BrowserSurfaceComponent(tui, theme, {
				getState: () => b.getState(),
				post: (pathName, body) => b.post(pathName, body),
				onSized: () => {
					if (pendingUrl) {
						const target = pendingUrl;
						pendingUrl = null;
						void b.openUrl(target);
					}
				},
				onClose: () => {
					surface = null;
					done(undefined);
					void b.hide();
				},
			});
			return surface;
		},
		{
			overlay: true,
			overlayOptions: () => ({
				anchor: "top-right",
				width: "55%",
				maxHeight: "92%",
				margin: 1,
			}),
		},
	);
	overlayOpen = false;
	return { ok: true, url };
}

async function closeBrowser(): Promise<boolean> {
	if (!bridge || (!overlayOpen && !surface)) return false;
	// Closing the surface resolves the ctx.ui.custom promise, which tears the
	// overlay down through the normal path instead of orphaning it.
	surface?.close();
	overlayOpen = false;
	await bridge.hide();
	return true;
}

export default function terminalBrowserExtension(omk: ExtensionAPI) {
	omk.registerCommand("browser", {
		description: "Open terminal-browser inside OMK. Usage: /browser [url] — /browser close to close.",
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("/browser requires the interactive TUI", "error");
				return;
			}
			const arg = args.trim();
			if (arg === "close" || (!arg && overlayOpen)) {
				const closed = await closeBrowser();
				ctx.ui.notify(closed ? "Closed terminal-browser" : "No browser pane was open", "info");
				return;
			}
			const opened = await openBrowser(ctx, arg || null);
			ctx.ui.notify(opened.ok ? `Opened ${opened.url}` : opened.error, opened.ok ? "info" : "error");
		},
	});

	omk.registerTool({
		name: "terminal_browser_open",
		label: "Terminal Browser Open",
		description:
			"Open terminal-browser inside the OMK terminal UI at a URL. Requires the terminal-browser CLI and a kitty-graphics terminal. Control the open page afterwards with the `terminal-browser action` CLI.",
		promptSnippet: "Open a real browser pane inside the terminal at a URL",
		promptGuidelines: [
			"Use terminal_browser_open when the user asks to preview or open a website inside the OMK terminal.",
		],
		parameters: Type.Object({
			url: Type.Optional(Type.String({ description: "Full URL or host name to open" })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if (ctx.mode !== "tui") {
				return {
					content: [
						{
							type: "text",
							text: "terminal-browser requires the interactive TUI; current mode cannot display it.",
						},
					],
					details: { ok: false },
				};
			}
			const opened = await openBrowser(ctx, typeof params.url === "string" ? params.url : null);
			return {
				content: [
					{
						type: "text",
						text: opened.ok ? `opened ${opened.url}` : `could not open the browser: ${opened.error}`,
					},
				],
				details: {
					ok: opened.ok,
					url: opened.ok ? opened.url : undefined,
					error: opened.ok ? undefined : opened.error,
				},
			};
		},
	});

	omk.registerTool({
		name: "terminal_browser_close",
		label: "Terminal Browser Close",
		description: "Close the terminal-browser pane inside OMK.",
		promptSnippet: "Close the terminal browser pane",
		parameters: Type.Object({}),
		async execute(_toolCallId, _params, _signal, _onUpdate, _ctx) {
			const closed = await closeBrowser();
			return {
				content: [{ type: "text", text: closed ? "browser pane closed" : "no browser pane was open" }],
				details: { closed },
			};
		},
	});

	omk.on("session_shutdown", async (_event, _ctx) => {
		await bridge?.shutdown();
		bridge = null;
		overlayOpen = false;
		pendingUrl = null;
		surface = null;
	});
}
