/**
 * Spec 091 stage 1 UI: gray next-task suggestion in the empty editor.
 *
 * Installed only when `OMK_NEXT_SUGGESTIONS` is on; otherwise
 * {@link installNextSuggestions} returns without touching the session or the
 * editor. Tab inserts the suggestion without sending it. Any other key dismisses it
 * and cancels pending generation, except the opt-in exact-prefix inline path.
 * A result that arrives after the user typed or sent the next turn is discarded.
 */
import type { StreamFn } from "omk-agent-core";
import type { AssistantMessage } from "omk-ai";
import { getKeybindings } from "omk-tui";
import { isNextSuggestionsEnabled, MainRequestRecorder, type RecordedMainRequest } from "../../core/next-suggestion.ts";
import { dismissReasonForKey, traceQueuedDispatch, userMessageText } from "../../core/next-suggestion-accept-trace.ts";
import { NextSuggestionCandidate } from "./next-suggestion-candidate.ts";
import {
	isPrefixSuggestionsEnabled,
	projectSuggestion,
	type ShownState,
	showEmptySuggestion,
	showInlineSuggestion,
} from "./next-suggestion-prefix.ts";
import { createShownState, lastAssistant, runSettledSuggestion } from "./next-suggestion-run.ts";
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
	private pendingRecord: RecordedMainRequest | undefined;
	private pendingFinal: AssistantMessage | undefined;
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
				this.cancel();
				this.turnsInRun = 0;
			} else if (event.type === "turn_end") this.turnsInRun++;
			else if (event.type === "prompt_settled") void this.onSettled(event.outcome);
			else if (event.type === "message_start" && this.options.acceptTrace && !this.restorePrompt) {
				// Only for ports without prompt(); a real session reports its dispatch branch instead.
				const text = userMessageText(event.message);
				if (text !== undefined) this.options.acceptTrace.sent(text, Date.now(), "prompt");
			}
		});
		editor.onBeforeInput = this.keyHandler;
		if (options.acceptTrace) this.restorePrompt = traceQueuedDispatch(session, options.acceptTrace);
	}

	/** Detach from the session and editor; restores the stream function if still ours. */
	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.options.acceptTrace?.flush(Date.now());
		this.restorePrompt?.();
		this.candidates.clear();
		this.cancel();
		this.unsubscribe();
		if (this.session.agent.streamFn === this.wrapped) this.session.agent.streamFn = this.inner;
		if (this.editor.onBeforeInput === this.keyHandler) this.editor.onBeforeInput = undefined;
		if (active === this) {
			active = undefined;
			activeSession = undefined;
		}
	}

	get suggestion(): string | undefined {
		return this.shown?.text;
	}

	/** Dismiss the visible suggestion and cancel any pending generation. */
	cancel(): void {
		this.generation++;
		this.pending?.abort();
		this.pending = undefined;
		this.pendingTask = undefined;
		this.pendingRecord = undefined;
		this.pendingFinal = undefined;
		if (this.shown !== undefined) {
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

		if (suggestion !== undefined && isTab(data) && !this.editor.isShowingAutocomplete()) {
			const projection = projectSuggestion(suggestion, { text, cursor: this.editor.getCursor?.() });
			if (
				projection.kind === "empty-editor" ||
				(isPrefixSuggestionsEnabled(this.options.env) && projection.kind === "inline-suffix")
			) {
				this.candidates.dismiss(suggestion);
				trace?.accepted(Date.now());
				this.cancel();
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
			const cursor = this.editor.getCursor?.();
			const projection = cursor
				? projectSuggestion(suggestion, {
						text: text + data,
						cursor: { line: cursor.line, col: cursor.col + data.length },
					})
				: { kind: "none" as const };
			if (projection.kind === "inline-suffix" && shown) {
				if (shown.surface === "empty-editor") trace?.dismissed("typed_over", Date.now());
				showInlineSuggestion({
					suffix: projection.text,
					suggestion: shown.text,
					candidate: shown.candidate,
					state: shown,
					editor: this.editor,
					basePlaceholder: this.basePlaceholder,
					acceptTrace: trace,
					requestRender: this.options.requestRender,
				});
				return false;
			}
		}

		if (suggestion !== undefined) {
			trace?.dismissed(dismissReasonForKey(data), Date.now());
			this.candidates.dismiss(suggestion);
		}
		this.cancel();
		return false;
	}

	onSettled(outcome: string | undefined): Promise<void> {
		if (this.disposed) return Promise.resolve();
		const record = this.recorder.lastRequest;
		const finalAssistant = lastAssistant(this.session.agent.state.messages);
		if (this.pendingTask && this.pendingRecord === record && this.pendingFinal === finalAssistant) {
			return this.pendingTask;
		}
		this.cancel();
		const generation = this.generation;
		const task = this.runSettled(outcome, generation, record, finalAssistant);
		this.pendingRecord = record;
		this.pendingFinal = finalAssistant;
		this.pendingTask = task;
		const clear = () => {
			if (this.pendingTask !== task) return;
			this.pendingTask = undefined;
			this.pendingRecord = undefined;
			this.pendingFinal = undefined;
		};
		void task.then(clear, clear);
		return task;
	}

	private runSettled(
		outcome: string | undefined,
		generation: number,
		record: RecordedMainRequest | undefined,
		finalAssistant: AssistantMessage | undefined,
	): Promise<void> {
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
			isCurrent: () => generation === this.generation,
			editorEmpty: () => this.editor.getText().length === 0,
			pendingOwner: this,
			show: (text, record, parentTurnIndex, settledAtEpochMs, quotaCheckedAtEpochMs, source) => {
				this.shown = createShownState(
					text,
					record,
					parentTurnIndex,
					settledAtEpochMs,
					quotaCheckedAtEpochMs,
					source,
				);
				showEmptySuggestion({
					suggestion: text,
					candidate: this.shown.candidate,
					editor: this.editor,
					basePlaceholder: this.basePlaceholder,
					acceptTrace: this.options.acceptTrace,
					requestRender: this.options.requestRender,
				});
			},
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
