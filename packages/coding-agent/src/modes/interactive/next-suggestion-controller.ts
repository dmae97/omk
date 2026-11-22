/**
 * Spec 091 stage 1 UI: gray next-task suggestion in the empty editor.
 *
 * Installed only when `OMK_NEXT_SUGGESTIONS` is on; otherwise
 * {@link installNextSuggestions} returns without touching the session or the
 * editor. The placeholder shows the whole prompt (title, then input → verification →
 * evidence → result) and Tab inserts exactly that text without sending it. Any other key
 * dismisses it and cancels pending generation, except the opt-in exact-prefix inline path.
 * A result that arrives after the user typed or sent the next turn is discarded, and Tab
 * drops a suggestion whose session state changed since it was shown.
 */
import type { StreamFn } from "omk-agent-core";
import type { AssistantMessage } from "omk-ai";
import { getKeybindings } from "omk-tui";
import { isNextSuggestionsEnabled, MainRequestRecorder, type RecordedMainRequest } from "../../core/next-suggestion.ts";
import { dismissReasonForKey, traceQueuedDispatch, userMessageText } from "../../core/next-suggestion-accept-trace.ts";
import type { ClearReason } from "../../core/next-suggestion-display-log.ts";
import { NextSuggestionCandidate } from "./next-suggestion-candidate.ts";
import {
	extendInlineSuggestion,
	isPrefixSuggestionsEnabled,
	projectSuggestion,
	type ShownState,
	sameRevision,
	suggestionRevision,
} from "./next-suggestion-prefix.ts";
import { initialSuggestion, presentSuggestion } from "./next-suggestion-present.ts";
import {
	type ComposedSuggestion,
	lastAssistant,
	runSettledSuggestion,
	type SuggestionShowTiming,
	sessionCanSend,
} from "./next-suggestion-run.ts";
import type { NextSuggestionOptions, SuggestionSessionPort } from "./next-suggestion-types.ts";
import { type ActiveEditor, followActiveEditor, type SuggestionEditorPort } from "./suggestion-active-editor.ts";

export type { NextSuggestionOptions, SuggestionSessionPort } from "./next-suggestion-types.ts";

export class NextSuggestionController {
	private readonly session: SuggestionSessionPort;
	private readonly editor: SuggestionEditorPort;
	private readonly basePlaceholder: string;
	private readonly options: NextSuggestionOptions;
	private readonly recorder: MainRequestRecorder;
	private readonly inner: StreamFn;
	private generation = 0;
	private readonly keyHandler = (data: string): boolean => this.handleKey(data);
	pending: AbortController | undefined;
	private pendingTask: Promise<void> | undefined;
	private noteCancellation?: (reason: ClearReason) => void;
	private readonly candidates: NextSuggestionCandidate;
	private shown: ShownState | undefined;
	private readonly wrapped: StreamFn;
	private readonly unsubscribe: () => void;
	private turnsInRun = 0;
	private restorePrompt: (() => void) | undefined;
	private disposed = false;

	constructor(
		session: SuggestionSessionPort,
		editor: SuggestionEditorPort,
		basePlaceholder: string,
		options: NextSuggestionOptions,
	) {
		this.session = session;
		this.editor = editor;
		this.basePlaceholder = basePlaceholder;
		this.options = options;
		this.candidates = new NextSuggestionCandidate(options.now);
		this.recorder = new MainRequestRecorder(options.now);
		this.inner = session.agent.streamFn;
		this.wrapped = this.recorder.wrap(this.inner);
		session.agent.streamFn = this.wrapped;
		this.unsubscribe = session.subscribe((event) => {
			if (event.type === "agent_start") {
				this.options.acceptTrace?.dismissed("new_turn", Date.now());
				this.candidates.clear();
				this.cancel("new_turn");
				this.turnsInRun = 0;
				this.pendingTask = undefined;
			} else if (event.type === "turn_end") this.turnsInRun++;
			else if (event.type === "compaction_start") this.cancel();
			else if (event.type === "prompt_settled") void this.onSettled(event.outcome);
			else if (event.type === "message_start" && this.options.acceptTrace && !this.restorePrompt) {
				// Only for ports without prompt(); a real session reports its dispatch branch instead.
				const text = userMessageText(event.message);
				if (text !== undefined) this.options.acceptTrace.sent(text, Date.now(), "prompt");
			}
		});
		editor.onBeforeInput = this.keyHandler;
		if (options.acceptTrace) this.restorePrompt = traceQueuedDispatch(session, options.acceptTrace);
		// No turn settles in front of a fresh controller (startup, resume, session switch): show the local one now.
		const composed = initialSuggestion(session, editor, options);
		const at = Date.now();
		if (composed) this.present(composed, { parentTurnIndex: 0, settledAtEpochMs: at, quotaCheckedAtEpochMs: at });
	}

	/** Detach from the session and editor; restores the stream function if still ours. */
	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.options.acceptTrace?.flush(Date.now());
		this.restorePrompt?.();
		this.candidates.clear();
		this.cancel("disposed");
		this.unsubscribe();
		if (this.session.agent.streamFn === this.wrapped) this.session.agent.streamFn = this.inner;
		if (this.editor.onBeforeInput === this.keyHandler) this.editor.onBeforeInput = undefined;
		if (active === this) {
			active = undefined;
			activeSession = undefined;
		}
	}

	/** The full prompt on screen: what the placeholder shows and what Tab inserts. */
	get suggestion(): string | undefined {
		return this.shown?.text;
	}

	get title(): string | undefined {
		return this.shown?.title;
	}

	private present(composed: ComposedSuggestion, timing: SuggestionShowTiming): void {
		const { session, editor, basePlaceholder, options, shown: previous } = this;
		this.shown = presentSuggestion({ session, editor, basePlaceholder, options, previous, composed, timing });
	}

	/** Dismiss the visible suggestion and cancel any pending generation. */
	cancel(reason: ClearReason = "other"): void {
		this.noteCancellation?.(reason);
		this.noteCancellation = undefined;
		this.generation++;
		this.pending?.abort();
		this.pending = undefined;
		if (this.shown !== undefined) {
			this.shown.candidate.report?.("cleared", reason, this.shown.surface);
			this.shown = undefined;
			this.editor.setPlaceholder(this.basePlaceholder);
			this.editor.setInlineSuggestion?.("");
			this.options.requestRender?.();
		}
	}

	private handleKey(data: string): boolean {
		if (this.disposed) return false;
		const shown = this.shown;
		const suggestion = shown?.text;
		const text = this.editor.getText();
		const isTab = this.options.isTab ?? ((key: string) => getKeybindings().matches(key, "tui.input.tab"));
		const trace = this.options.acceptTrace;
		trace?.observeEditor(text, Date.now());

		if (shown && !sameRevision(shown.revision, this.revision())) {
			trace?.dismissed("other", Date.now());
			this.cancel("stale_revision");
			return false;
		}
		if (shown && suggestion !== undefined && isTab(data) && !this.editor.isShowingAutocomplete()) {
			const projection = projectSuggestion(suggestion, { text, cursor: this.editor.getCursor?.() });
			if (
				projection.kind === "empty-editor" ||
				(isPrefixSuggestionsEnabled(this.options.env) && projection.kind === "inline-suffix")
			) {
				if (shown.task) this.candidates.dismiss(shown.task);
				trace?.accepted(Date.now());
				this.cancel("accepted");
				if (projection.kind === "empty-editor") this.editor.setText(projection.text);
				else if (this.editor.insertTextAtCursor) this.editor.insertTextAtCursor(projection.text);
				else this.editor.setText(text + projection.text);
				return true;
			}
		}

		if (
			suggestion !== undefined &&
			isPrefixSuggestionsEnabled(this.options.env) &&
			dismissReasonForKey(data) === "typed_over" &&
			!this.editor.isShowingAutocomplete()
		) {
			if (
				shown &&
				extendInlineSuggestion(
					shown,
					text,
					data,
					this.editor,
					this.basePlaceholder,
					trace,
					this.options.requestRender,
				)
			)
				return false;
		}

		if (suggestion !== undefined) {
			trace?.dismissed(dismissReasonForKey(data), Date.now());
			if (shown?.task) this.candidates.dismiss(shown.task);
		}
		this.cancel(this.editor.isShowingAutocomplete() ? "autocomplete" : dismissReasonForKey(data));
		return false;
	}

	onSettled(outcome: string | undefined): Promise<void> {
		if (this.disposed) return Promise.resolve();
		const record = this.recorder.lastRequest;
		const finalAssistant = lastAssistant(this.session.agent.state.messages);
		if (this.pendingTask) return this.pendingTask;
		this.cancel("replaced");
		const generation = this.generation;
		const task = this.runSettled(outcome, generation, record, finalAssistant);
		this.pendingTask = task;
		return task;
	}

	private revision() {
		return suggestionRevision(this.session, sessionCanSend(this.session, this.options));
	}
	private runSettled(
		outcome: string | undefined,
		generation: number,
		record: RecordedMainRequest | undefined,
		finalAssistant: AssistantMessage | undefined,
	): Promise<void> {
		const revision = this.revision();
		let reason: ClearReason | undefined;
		this.noteCancellation = (value) => {
			reason = value;
		};
		return runSettledSuggestion({
			session: this.session,
			options: this.options,
			inner: this.inner,
			candidates: this.candidates,
			outcome,
			generation,
			record,
			finalAssistant,
			parentTurnIndex: Math.max(0, this.turnsInRun - 1),
			isCurrent: () => {
				if (generation !== this.generation) return false;
				if (sameRevision(revision, this.revision())) return true;
				this.cancel("stale_revision");
				return false;
			},
			cancelReason: () => reason,
			editorEmpty: () => this.editor.getText().length === 0,
			pendingOwner: this,
			show: (composed, timing) => this.present(composed, timing),
		});
	}
}

export { type ActiveEditor, followActiveEditor, type SuggestionEditorPort };

let active: NextSuggestionController | undefined, activeSession: SuggestionSessionPort | undefined;

/**
 * No-op unless the flag is on. Idempotent per session: rebinding the same
 * session keeps one controller; binding a new session disposes the old one.
 */
export function installNextSuggestions(
	session: SuggestionSessionPort,
	editor: SuggestionEditorPort,
	basePlaceholder: string,
	options: NextSuggestionOptions = {},
): NextSuggestionController | undefined {
	if (!isNextSuggestionsEnabled(options.env)) return undefined;
	if (active && activeSession === session) return active;
	active?.dispose();
	activeSession = session;
	active = new NextSuggestionController(session, editor, basePlaceholder, options);
	return active;
}

/** Release the active controller without owning interactive usage-reader state. */
export function disposeNextSuggestions(): void {
	active?.dispose();
	activeSession = undefined;
}
