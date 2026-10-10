/**
 * Truecolor detection for the theme without importing omk-tui.
 *
 * theme.ts sits on the headless `omk -p` import graph (extension runner,
 * agent session, resource loader), and spec 024 keeps omk-tui off that graph.
 * This mirrors the `trueColor` result of omk-tui's `detectCapabilities()`
 * (packages/tui/src/terminal-image.ts) branch for branch.
 * test/terminal-truecolor-parity.test.ts compares the two across terminal
 * environments, so change both together.
 */

// Shared with omk-tui's getCapabilities() cache. When omk-tui has cached or
// overridden capabilities (setCapabilities), the theme follows that value, as
// it did when it called getCapabilities() directly.
const CAPABILITIES_KEY = Symbol.for("omk-tui:terminal-capabilities");
type CapabilitiesGlobal = Record<symbol, { trueColor: boolean } | undefined>;

/** Pure env-based truecolor rule, identical to omk-tui detectCapabilities().trueColor. */
export function detectTrueColor(env: NodeJS.ProcessEnv = process.env): boolean {
	const termProgram = env.TERM_PROGRAM?.toLowerCase() || "";
	const terminalEmulator = env.TERMINAL_EMULATOR?.toLowerCase() || "";
	const term = env.TERM?.toLowerCase() || "";
	const colorTerm = env.COLORTERM?.toLowerCase() || "";
	const hasTrueColorHint = colorTerm === "truecolor" || colorTerm === "24bit";

	// tmux and screen only pass truecolor through when COLORTERM says so.
	if (env.TMUX || term.startsWith("tmux")) return hasTrueColorHint;
	if (term.startsWith("screen")) return hasTrueColorHint;

	if (env.KITTY_WINDOW_ID || termProgram === "kitty") return true;
	if (termProgram === "ghostty" || term.includes("ghostty") || env.GHOSTTY_RESOURCES_DIR) return true;
	if (env.WEZTERM_PANE || termProgram === "wezterm") return true;
	if (env.ITERM_SESSION_ID || termProgram === "iterm.app") return true;
	if (env.WT_SESSION) return true;
	if (termProgram === "alacritty" || termProgram === "vscode" || termProgram === "zed") return true;
	if (terminalEmulator === "jetbrains-jediterm") return true;

	return hasTrueColorHint;
}

/** omk-tui's cached/overridden capabilities when present, otherwise the env rule. */
export function getTrueColorSupport(): boolean {
	const cached = (globalThis as CapabilitiesGlobal)[CAPABILITIES_KEY];
	return cached ? cached.trueColor : detectTrueColor();
}
