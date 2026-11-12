/**
 * Editor presentation of a composed suggestion, shared by the settled-turn pipeline and the
 * startup path. Kept apart from the controller, which owns keys and cancellation.
 */
import { type ShownState, showEmptySuggestion, suggestionRevision } from "./next-suggestion-prefix.ts";
import {
	type ComposedSuggestion,
	composeSuggestion,
	type SuggestionShowTiming,
	sessionCanSend,
	snapshotOutcome,
} from "./next-suggestion-run.ts";
import type { NextSuggestionOptions, SuggestionSessionPort } from "./next-suggestion-types.ts";
import type { SuggestionEditorPort } from "./suggestion-active-editor.ts";

export interface PresentSuggestionInput {
	readonly session: SuggestionSessionPort;
	readonly editor: SuggestionEditorPort;
	readonly basePlaceholder: string;
	readonly options: NextSuggestionOptions;
	readonly previous: ShownState | undefined;
	readonly composed: ComposedSuggestion;
	readonly timing: SuggestionShowTiming;
}

/** Put the prompt in the placeholder and return its shown state; an identical prompt is left as is. */
export function presentSuggestion(input: PresentSuggestionInput): ShownState {
	const { composed, previous, session } = input;
	if (previous?.text === composed.prompt) return previous;
	const model = session.model;
	const shown: ShownState = {
		text: composed.prompt,
		title: composed.title,
		...(composed.task ? { task: composed.task } : {}),
		candidate: { provider: model?.provider ?? "", model: model?.id ?? "", ...input.timing, source: composed.source },
		revision: suggestionRevision(session.agent.state.messages, model, sessionCanSend(session, input.options)),
		surface: "empty-editor",
	};
	showEmptySuggestion({
		suggestion: composed.prompt,
		candidate: shown.candidate,
		editor: input.editor,
		basePlaceholder: input.basePlaceholder,
		acceptTrace: input.options.acceptTrace,
		requestRender: input.options.requestRender,
		refines: previous !== undefined,
	});
	return shown;
}

/**
 * Local suggestion for a controller that no turn settles in front of (startup, resume, session
 * switch). Nothing for a running turn, an aborted last turn, or an editor that holds a draft.
 */
export function initialSuggestion(
	session: SuggestionSessionPort,
	editor: SuggestionEditorPort,
	options: NextSuggestionOptions,
): ComposedSuggestion | undefined {
	const outcome = snapshotOutcome(session.agent.state.messages);
	if (outcome === "aborted" || session.agent.state.isStreaming || editor.getText().length > 0) return undefined;
	return composeSuggestion({ session, outcome, canSend: sessionCanSend(session, options), env: options.env });
}
