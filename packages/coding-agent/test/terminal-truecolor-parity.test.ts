import { detectCapabilities, resetCapabilitiesCache, setCapabilities } from "omk-tui";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initTheme, theme } from "../src/modes/interactive/theme/theme.ts";
import { detectTrueColor, getTrueColorSupport } from "../src/utils/terminal-truecolor.ts";

// theme.ts must pick the same color mode as omk-tui's getCapabilities().trueColor
// (the pre-spec-024 behavior) without importing omk-tui on the `-p` path.
const TERMINAL_ENV_KEYS = [
	"COLORTERM",
	"TERM",
	"TERM_PROGRAM",
	"TERMINAL_EMULATOR",
	"TMUX",
	"KITTY_WINDOW_ID",
	"GHOSTTY_RESOURCES_DIR",
	"WEZTERM_PANE",
	"ITERM_SESSION_ID",
	"WT_SESSION",
] as const;

type TerminalEnv = Partial<Record<(typeof TERMINAL_ENV_KEYS)[number], string>>;

// [label, env, expected trueColor]
const CASES: Array<[string, TerminalEnv, boolean]> = [
	["no hints", {}, false],
	["plain xterm-256color", { TERM: "xterm-256color" }, false],
	["COLORTERM=truecolor", { COLORTERM: "truecolor" }, true],
	["COLORTERM=24bit", { COLORTERM: "24bit" }, true],
	["COLORTERM=TrueColor (case)", { COLORTERM: "TrueColor" }, true],
	["COLORTERM=256color", { COLORTERM: "256color" }, false],
	["TERM_PROGRAM=WezTerm", { TERM_PROGRAM: "WezTerm" }, true],
	["WEZTERM_PANE", { WEZTERM_PANE: "0" }, true],
	["TERM_PROGRAM=iTerm.app", { TERM_PROGRAM: "iTerm.app" }, true],
	["ITERM_SESSION_ID", { ITERM_SESSION_ID: "w0t0p0" }, true],
	["TERM_PROGRAM=vscode", { TERM_PROGRAM: "vscode" }, true],
	["WT_SESSION (Windows Terminal)", { WT_SESSION: "1" }, true],
	["TERM_PROGRAM=kitty", { TERM_PROGRAM: "kitty" }, true],
	["KITTY_WINDOW_ID", { KITTY_WINDOW_ID: "1" }, true],
	["TERM_PROGRAM=ghostty", { TERM_PROGRAM: "ghostty" }, true],
	["TERM=xterm-ghostty", { TERM: "xterm-ghostty" }, true],
	["GHOSTTY_RESOURCES_DIR", { GHOSTTY_RESOURCES_DIR: "/opt/ghostty" }, true],
	["TERM_PROGRAM=alacritty", { TERM_PROGRAM: "alacritty" }, true],
	["TERM_PROGRAM=zed", { TERM_PROGRAM: "zed" }, true],
	["JetBrains JediTerm", { TERMINAL_EMULATOR: "JetBrains-JediTerm" }, true],
	["TERM_PROGRAM=Apple_Terminal", { TERM_PROGRAM: "Apple_Terminal" }, false],
	["tmux inside WezTerm without COLORTERM", { TMUX: "/tmp/tmux-1/default,1,0", TERM_PROGRAM: "WezTerm" }, false],
	["tmux with COLORTERM=truecolor", { TMUX: "/tmp/tmux-1/default,1,0", COLORTERM: "truecolor" }, true],
	["TERM=tmux-256color", { TERM: "tmux-256color", WT_SESSION: "1" }, false],
	["TERM=screen-256color in Windows Terminal", { TERM: "screen-256color", WT_SESSION: "1" }, false],
	["TERM=screen with COLORTERM=24bit", { TERM: "screen", COLORTERM: "24bit" }, true],
];

let savedEnv: TerminalEnv;

function applyEnv(env: TerminalEnv): void {
	for (const key of TERMINAL_ENV_KEYS) delete process.env[key];
	Object.assign(process.env, env);
}

beforeEach(() => {
	savedEnv = {};
	for (const key of TERMINAL_ENV_KEYS) {
		if (process.env[key] !== undefined) savedEnv[key] = process.env[key];
	}
	resetCapabilitiesCache();
});

afterEach(() => {
	applyEnv(savedEnv);
	resetCapabilitiesCache();
});

describe("theme truecolor detection parity with omk-tui getCapabilities", () => {
	it.each(CASES)("%s", (_label, env, expected) => {
		applyEnv(env);
		// The original rule: omk-tui detectCapabilities() (tmux hyperlink probe stubbed).
		const original = detectCapabilities(() => false).trueColor;
		expect(original).toBe(expected);
		expect(detectTrueColor()).toBe(original);
		expect(getTrueColorSupport()).toBe(original);

		initTheme("dark");
		const prefix = theme.getFgAnsi("accent").slice(0, 7);
		expect(prefix).toBe(original ? "\x1b[38;2;" : "\x1b[38;5;");
	});

	it("follows omk-tui setCapabilities overrides like getCapabilities did", () => {
		applyEnv({ COLORTERM: "truecolor" });
		setCapabilities({ images: null, trueColor: false, hyperlinks: false });
		expect(getTrueColorSupport()).toBe(false);
		initTheme("dark");
		expect(theme.getFgAnsi("accent").startsWith("\x1b[38;5;")).toBe(true);

		applyEnv({});
		setCapabilities({ images: null, trueColor: true, hyperlinks: false });
		expect(getTrueColorSupport()).toBe(true);
		initTheme("dark");
		expect(theme.getFgAnsi("accent").startsWith("\x1b[38;2;")).toBe(true);
	});
});
