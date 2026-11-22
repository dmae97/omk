import type {
	SuggestionAcceptTracker,
	SuggestionCandidateSource,
	SuggestionDisplaySurface,
} from "../../core/next-suggestion-accept-trace.ts";
import type { DisplayReporter } from "../../core/next-suggestion-display-log.ts";
import type { SuggestionSessionPort } from "./next-suggestion-types.ts";
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
	/** Provider and model the suggestion belongs to; empty strings when the session has no model. */
	readonly provider: string;
	readonly model: string;
	readonly parentTurnIndex: number;
	readonly settledAtEpochMs: number;
	readonly quotaCheckedAtEpochMs: number;
	readonly source: SuggestionCandidateSource;
	readonly report?: DisplayReporter;
}

/** Session state a shown suggestion was built from; accept re-checks it before inserting. */
export interface SuggestionRevision {
	readonly sessionId?: string;
	readonly leaf?: string | null;
	readonly messageCount: number;
	readonly lastMessage: unknown;
	readonly modelKey: string;
}

export function suggestionRevision(session: SuggestionSessionPort, canSend: boolean): SuggestionRevision {
	// A login that makes the same model usable is a state change: a "blocked" suggestion goes stale.
	const { model } = session;
	const { messages } = session.agent.state;
	const key = model ? `${model.provider}/${model.id}` : "";
	return {
		sessionId: session.sessionId,
		leaf: session.sessionManager?.getLeafId(),
		messageCount: messages.length,
		lastMessage: messages.at(-1),
		modelKey: canSend ? key : `${key}!`,
	};
}

export function sameRevision(left: SuggestionRevision, right: SuggestionRevision): boolean {
	return (
		left.sessionId === right.sessionId &&
		left.leaf === right.leaf &&
		left.messageCount === right.messageCount &&
		left.lastMessage === right.lastMessage &&
		left.modelKey === right.modelKey
	);
}

export type ShownState = {
	/** The full prompt: exactly what the placeholder shows and what Tab inserts. */
	text: string;
	readonly title: string;
	/** Accepted model sentence behind the suggestion, when one contributed (candidate-cache key). */
	readonly task?: string;
	readonly candidate: ShownCandidate;
	readonly revision: SuggestionRevision;
	inlinePainted?: boolean;
	surface: SuggestionDisplaySurface;
};

export interface SuggestionDisplayInput {
	readonly suggestion: string;
	readonly candidate: ShownCandidate;
	readonly editor: SuggestionEditorPort;
	readonly basePlaceholder: string;
	readonly acceptTrace?: SuggestionAcceptTracker;
	readonly requestRender?: () => void;
	/** The suggestion on screen is being refined in place rather than replaced by a new one. */
	readonly refines?: boolean;
}

export interface InlineSuggestionDisplayInput extends SuggestionDisplayInput {
	readonly suffix: string;
	readonly state: ShownState;
}

export function showEmptySuggestion(input: SuggestionDisplayInput): void {
	const { candidate, editor, suggestion } = input;
	editor.setInlineSuggestion?.("");
	candidate.report?.("offered", undefined, "empty-editor");
	editor.setPlaceholder(
		suggestion,
		candidate.report && (() => candidate.report?.("rendered", undefined, "empty-editor")),
	);
	const meta = {
		parentTurnIndex: candidate.parentTurnIndex,
		provider: candidate.provider,
		model: candidate.model,
		candidateSource: candidate.source,
		displaySurface: "empty-editor" as const,
		settledAtEpochMs: candidate.settledAtEpochMs,
		quotaCheckedAtEpochMs: candidate.quotaCheckedAtEpochMs,
		shownAtEpochMs: Date.now(),
	};
	if (input.refines) input.acceptTrace?.refined(meta, suggestion);
	else input.acceptTrace?.shown(meta, suggestion);
	input.requestRender?.();
}

export function extendInlineSuggestion(
	state: ShownState,
	text: string,
	key: string,
	editor: SuggestionEditorPort,
	basePlaceholder: string,
	acceptTrace?: SuggestionAcceptTracker,
	requestRender?: () => void,
): boolean {
	const cursor = editor.getCursor?.();
	if (!cursor) return false;
	const projection = projectSuggestion(state.text, {
		text: text + key,
		cursor: { line: cursor.line, col: cursor.col + key.length },
	});
	if (projection.kind !== "inline-suffix") return false;
	if (state.surface === "empty-editor") {
		acceptTrace?.dismissed("typed_over", Date.now());
		state.candidate.report?.("cleared", "typed_over", state.surface);
	}
	showInlineSuggestion({
		suffix: projection.text,
		suggestion: state.text,
		candidate: state.candidate,
		state,
		editor,
		basePlaceholder,
		acceptTrace,
		requestRender,
	});
	return true;
}

export function showInlineSuggestion(input: InlineSuggestionDisplayInput): void {
	const { candidate, editor, suggestion } = input;
	const firstInline = input.state.surface !== "inline-prefix";
	editor.setPlaceholder(input.basePlaceholder);
	if (firstInline) candidate.report?.("offered", undefined, "inline-prefix");
	editor.setInlineSuggestion?.(
		input.suffix,
		candidate.report &&
			(() => {
				if (input.state.inlinePainted) return;
				input.state.inlinePainted = true;
				candidate.report?.("rendered", undefined, "inline-prefix");
			}),
	);
	if (firstInline) {
		input.acceptTrace?.shown(
			{
				parentTurnIndex: candidate.parentTurnIndex,
				provider: candidate.provider,
				model: candidate.model,
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
