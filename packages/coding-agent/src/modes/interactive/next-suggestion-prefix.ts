import type { RecordedMainRequest } from "../../core/next-suggestion.ts";
import type {
	SuggestionAcceptTracker,
	SuggestionCandidateSource,
	SuggestionDisplaySurface,
} from "../../core/next-suggestion-accept-trace.ts";
import type { SuggestionEditorPort } from "./suggestion-active-editor.ts";

export const NEXT_SUGGESTIONS_PREFIX_ENV = "OMK_NEXT_SUGGESTIONS_PREFIX";

export interface SuggestionEditorSnapshot {
	readonly text: string;
	readonly cursor?: { readonly line: number; readonly col: number };
}

export type SuggestionProjection =
	| { readonly kind: "none" }
	| { readonly kind: "empty-editor" | "inline-suffix"; readonly text: string };

export function isPrefixSuggestionsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
	return /^(?:1|on|true|yes)$/i.test(env[NEXT_SUGGESTIONS_PREFIX_ENV]?.trim() ?? "");
}

function cursorAtEnd(text: string, cursor: SuggestionEditorSnapshot["cursor"]): boolean {
	if (!cursor) return false;
	const lines = text.split("\n");
	return cursor.line === lines.length - 1 && cursor.col === (lines.at(-1) ?? "").length;
}

/** Project one existing candidate without normalization, generation, or editor mutation. */
export function projectSuggestion(candidate: string, snapshot: SuggestionEditorSnapshot): SuggestionProjection {
	if (snapshot.text.length === 0) return { kind: "empty-editor", text: candidate };
	if (!cursorAtEnd(snapshot.text, snapshot.cursor)) return { kind: "none" };
	if (!candidate.startsWith(snapshot.text) || candidate.length === snapshot.text.length) return { kind: "none" };
	return { kind: "inline-suffix", text: candidate.slice(snapshot.text.length) };
}

export interface ShownCandidate {
	readonly record: RecordedMainRequest;
	readonly parentTurnIndex: number;
	readonly settledAtEpochMs: number;
	readonly quotaCheckedAtEpochMs: number;
	readonly source: SuggestionCandidateSource;
}

export type ShownState = { text: string; readonly candidate: ShownCandidate; surface: SuggestionDisplaySurface };

export function createShownState(
	text: string,
	record: RecordedMainRequest,
	parentTurnIndex: number,
	settledAtEpochMs: number,
	quotaCheckedAtEpochMs: number,
	source: SuggestionCandidateSource,
): ShownState {
	return {
		text,
		candidate: { record, parentTurnIndex, settledAtEpochMs, quotaCheckedAtEpochMs, source },
		surface: "empty-editor",
	};
}

export interface SuggestionDisplayInput {
	readonly suggestion: string;
	readonly candidate: ShownCandidate;
	readonly editor: SuggestionEditorPort;
	readonly basePlaceholder: string;
	readonly acceptTrace?: SuggestionAcceptTracker;
	readonly requestRender?: () => void;
}

export interface InlineSuggestionDisplayInput extends SuggestionDisplayInput {
	readonly suffix: string;
	readonly state: ShownState;
}

export function showEmptySuggestion(input: SuggestionDisplayInput): void {
	const { candidate, editor, suggestion } = input;
	editor.setInlineSuggestion?.("");
	editor.setPlaceholder(suggestion);
	const { provider, id } = candidate.record.model;
	input.acceptTrace?.shown(
		{
			parentTurnIndex: candidate.parentTurnIndex,
			provider,
			model: id,
			candidateSource: candidate.source,
			displaySurface: "empty-editor",
			settledAtEpochMs: candidate.settledAtEpochMs,
			quotaCheckedAtEpochMs: candidate.quotaCheckedAtEpochMs,
			shownAtEpochMs: Date.now(),
		},
		suggestion,
	);
	input.requestRender?.();
}

export function showInlineSuggestion(input: InlineSuggestionDisplayInput): void {
	const { candidate, editor, suggestion } = input;
	const firstInline = input.state.surface !== "inline-prefix";
	editor.setPlaceholder(input.basePlaceholder);
	editor.setInlineSuggestion?.(input.suffix);
	if (firstInline) {
		const { provider, id } = candidate.record.model;
		input.acceptTrace?.shown(
			{
				parentTurnIndex: candidate.parentTurnIndex,
				provider,
				model: id,
				candidateSource: candidate.source,
				displaySurface: "inline-prefix",
				settledAtEpochMs: candidate.settledAtEpochMs,
				quotaCheckedAtEpochMs: candidate.quotaCheckedAtEpochMs,
				shownAtEpochMs: Date.now(),
			},
			suggestion,
		);
	}
	input.state.surface = "inline-prefix";
	input.requestRender?.();
}
