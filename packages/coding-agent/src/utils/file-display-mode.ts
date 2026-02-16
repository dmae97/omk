/**
 * Resolve line-display mode for file-like outputs (read, grep, @file mentions).
 */

export interface FileDisplayMode {
	lineNumbers: boolean;
	hashLines: boolean;
}

/** Session-like object providing settings and tool availability for display mode resolution. */
export interface FileDisplayModeSession {
	/** Whether the edit tool is available. Hashlines are suppressed without it. */
	hasEditTool?: boolean;
	settings: {
		get(key: "readLineNumbers" | "readHashLines" | "edit.mode"): unknown;
	};
}

/**
 * Computes effective line display mode from session settings/env.
 * Hashline mode takes precedence and implies line-addressed output everywhere.
 * Hashlines are suppressed when the edit tool is not available (e.g. explore agents).
 */
export function resolveFileDisplayMode(session: FileDisplayModeSession): FileDisplayMode {
	const { settings } = session;
	const hasEditTool = session.hasEditTool ?? true;
	const hashLines =
		hasEditTool &&
		(settings.get("readHashLines") === true ||
			settings.get("edit.mode") === "hashline" ||
			Bun.env.PI_EDIT_VARIANT === "hashline");
	return {
		hashLines,
		lineNumbers: hashLines || settings.get("readLineNumbers") === true,
	};
}
