/**
 * Resolve line-display mode for file-like outputs (read, grep, @file mentions).
 */
export interface FileDisplayModeSettings {
	get(key: "readLineNumbers" | "readHashLines" | "edit.mode"): unknown;
}

export interface FileDisplayMode {
	lineNumbers: boolean;
	hashLines: boolean;
}

/**
 * Computes effective line display mode from settings/env.
 * Hashline mode takes precedence and implies line-addressed output everywhere.
 */
export function resolveFileDisplayMode(settings: FileDisplayModeSettings): FileDisplayMode {
	const hashLines =
		settings.get("readHashLines") === true ||
		settings.get("edit.mode") === "hashline" ||
		Bun.env.PI_EDIT_VARIANT === "hashline";

	return {
		hashLines,
		lineNumbers: hashLines || settings.get("readLineNumbers") === true,
	};
}
