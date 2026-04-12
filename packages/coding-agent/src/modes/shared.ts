import type { TabBarTheme } from "@oh-my-pi/pi-tui";
import { theme } from "./theme/theme";

// ═══════════════════════════════════════════════════════════════════════════
// Text Sanitization
// ═══════════════════════════════════════════════════════════════════════════

/** Sanitize text for display in a single-line status. Strips C0/C1 control characters (including ANSI ESC), collapses whitespace, trims. */
export function sanitizeStatusText(text: string): string {
	return text
		.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
		.replace(/ +/g, " ")
		.trim();
}

// ═══════════════════════════════════════════════════════════════════════════
// Tab Bar Theme
// ═══════════════════════════════════════════════════════════════════════════

/** Shared tab bar theme used by model-selector and settings-selector. */
export function getTabBarTheme(): TabBarTheme {
	return {
		label: (text: string) => theme.bold(theme.fg("accent", text)),
		activeTab: (text: string) => theme.bold(theme.bg("selectedBg", theme.fg("text", text))),
		inactiveTab: (text: string) => theme.fg("muted", text),
		hint: (text: string) => theme.fg("dim", text),
	};
}

export { parseCommandArgs } from "../utils/command-args";
