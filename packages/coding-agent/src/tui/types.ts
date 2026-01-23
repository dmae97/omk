/**
 * Shared types for TUI rendering components.
 */

import type { Theme } from "$c/modes/theme/theme";

export type State = "pending" | "running" | "success" | "error" | "warning";
export type IconType = "success" | "error" | "running" | "pending" | "warning" | "info";

export interface TreeContext {
	index: number;
	isLast: boolean;
	depth: number;
	theme: Theme;
	prefix: string;
	continuePrefix: string;
}
