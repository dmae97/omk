import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";
import type { SuggestionSkipReason } from "./next-suggestion.ts";

export type ClearReason =
	| "new_turn"
	| "disposed"
	| "replaced"
	| "accepted"
	| "typed_over"
	| "other"
	| "stale_revision"
	| "autocomplete";
export type DisplayReason =
	| ClearReason
	| SuggestionSkipReason
	| "editor_nonempty"
	| "stale_turn"
	| "invalid_output"
	| "empty"
	| "timeout"
	| "abandoned";
export type DisplayReporter = (
	event: "offered" | "rendered" | "skipped" | "cleared",
	reason?: DisplayReason,
	surface?: "empty-editor" | "inline-prefix",
	source?: "generated" | "cache" | "local",
) => void;
export interface DisplayTurn {
	readonly parentTurnIndex: number;
	readonly settledAtEpochMs: number;
	readonly provider?: string;
	readonly model?: string;
}

/** UI events are not provider requests: keep them out of cost and request totals. */
export function suggestionDisplayLogger(sessionId: () => string, cwd: string, env = process.env) {
	if (/^(?:0|false|off|disable|disabled)$/i.test(env.OMK_TURN_METRICS?.trim() ?? "")) return undefined;
	const dir = env.OMK_TURN_METRICS_DIR ?? join(cwd, ".omk", "metrics");
	const file = join(dir, "suggestion-display.jsonl");
	return (turn: DisplayTurn): DisplayReporter => {
		const id = sessionId();
		return (event, reason, surface, source) => {
			try {
				mkdirSync(dir, { recursive: true });
				if ((statSync(file, { throwIfNoEntry: false })?.size ?? 0) >= 8 * 1024 * 1024)
					renameSync(file, `${file}.1`);
				const { parentTurnIndex, settledAtEpochMs, provider, model } = turn;
				const row = {
					schemaVersion: 1,
					sessionId: id,
					parentTurnIndex,
					settledAtEpochMs,
					provider,
					model,
					atEpochMs: Date.now(),
					event,
					reason,
					surface,
					source,
				};
				appendFileSync(file, `${JSON.stringify(row)}\n`, { mode: 0o600 });
			} catch {
				/* Best effort, never block editor input on a logging failure. */
			}
		};
	};
}
