/**
 * Spec 091 stage 1 UI: gray next-task suggestion in the empty editor.
 *
 * Installed only when `OMK_NEXT_SUGGESTIONS` is on; otherwise
 * {@link installNextSuggestions} returns without touching the session or the
 * editor. Tab inserts the suggestion into an empty editor (never sends); any
 * other key dismisses it and cancels a pending generation. A result that
 * arrives after the user typed or sent the next turn is discarded.
 */
import type { StreamFn } from "omk-agent-core";
import type { AssistantMessage } from "omk-ai";
import { getKeybindings } from "omk-tui";
import type { AgentSession } from "../../core/agent-session.ts";
import {
	isNextSuggestionsEnabled,
	MainRequestRecorder,
	type QuotaUsage,
	type RecordedMainRequest,
} from "../../core/next-suggestion.ts";
import {
	dismissReasonForKey,
	suggestionAcceptTracker,
	traceQueuedDispatch,
	userMessageText,
} from "../../core/next-suggestion-accept-trace.ts";
import * as settlement from "../../core/next-suggestion-settlement.ts";
import type { SubscriptionUsageReader } from "../../core/subscription-usage-reader.ts";
import {
	disposeInteractiveSubscriptionUsage,
	interactiveSubscriptionUsageReader,
} from "./interactive-subscription-usage.ts";
import { NextSuggestionCandidate } from "./next-suggestion-candidate.ts";
import { runSettledSuggestion } from "./next-suggestion-run.ts";
import type { NextSuggestionOptions, SuggestionSessionPort } from "./next-suggestion-types.ts";
import { type ActiveEditor, followActiveEditor, type SuggestionEditorPort } from "./suggestion-active-editor.ts";

export type { NextSuggestionOptions, SuggestionSessionPort } from "./next-suggestion-types.ts";

function lastAssistant(messages: readonly unknown[]): AssistantMessage | undefined {
	const last = messages.at(-1) as { role?: string } | undefined;
	return last?.role === "assistant" ? (last as AssistantMessage) : undefined;
}

export class NextSuggestionController {
	private readonly session: SuggestionSessionPort;
	private readonly editor: SuggestionEditorPort;
	private readonly basePlaceholder: string;
	private readonly options: NextSuggestionOptions;
	private readonly recorder: MainRequestRecorder;
	private readonly inner: StreamFn;
	private generation = 0;
	private readonly keyHandler = (data: string): boolean => this.handleKey(data);
	private pending: AbortController | undefined;
	private pendingTask: Promise<void> | undefined;
	private pendingRecord: RecordedMainRequest | undefined;
	private pendingFinal: AssistantMessage | undefined;
	private readonly candidates: NextSuggestionCandidate;
	private shown: string | undefined;
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
		return this.shown;
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
			this.options.requestRender?.();
		}
	}

	private handleKey(data: string): boolean {
		if (this.disposed) return false;
		const suggestion = this.shown;
		if (suggestion !== undefined) this.candidates.dismiss(suggestion);
		const isTab = this.options.isTab ?? ((key: string) => getKeybindings().matches(key, "tui.input.tab"));
		const trace = this.options.acceptTrace;
		trace?.observeEditor(this.editor.getText(), Date.now());
		if (
			suggestion !== undefined &&
			isTab(data) &&
			this.editor.getText().length === 0 &&
			!this.editor.isShowingAutocomplete()
		) {
			trace?.accepted(Date.now());
			this.cancel();
			this.editor.setText(suggestion);
			return true;
		}
		if (suggestion !== undefined) trace?.dismissed(dismissReasonForKey(data), Date.now());
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
			onPending: (controller) => {
				this.pending = controller;
			},
			show: (text, source, parentTurnIndex, settledAt, quotaCheckedAt) =>
				this.show(text, source, parentTurnIndex, settledAt, quotaCheckedAt),
		});
	}

	private show(
		text: string,
		record: RecordedMainRequest,
		parentTurnIndex: number,
		settledAtEpochMs: number,
		quotaCheckedAtEpochMs: number,
	): void {
		this.shown = text;
		this.editor.setPlaceholder(text);
		const { provider, id } = record.model;
		const timing = { settledAtEpochMs, quotaCheckedAtEpochMs, shownAtEpochMs: Date.now() };
		this.options.acceptTrace?.shown({ parentTurnIndex, provider, model: id, ...timing }, text);
		this.options.requestRender?.();
	}
}

export { type ActiveEditor, followActiveEditor, type SuggestionEditorPort };

let active: NextSuggestionController | undefined;
let activeSession: SuggestionSessionPort | undefined;
let activeInteractiveSession: AgentSession | undefined;

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

/**
 * Highest used percent across the active provider's quota windows. A provider
 * with no quota source reports `"no_quota"`; a source that returns no windows
 * (offline, credential missing, API error) reports `"unavailable"`.
 */
export async function activeQuotaUsage(session: AgentSession, reader: SubscriptionUsageReader): Promise<QuotaUsage> {
	const snapshot = await reader.read(session.state.model?.provider ?? "");
	if (snapshot === undefined) return "no_quota";
	const used = snapshot.windows
		.map((window) => window.usedPercent)
		.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
	return used.length > 0 ? Math.max(...used) : "unavailable";
}

/** Interactive wiring: one call site in interactive-mode. */
export function installInteractiveNextSuggestions(
	session: AgentSession,
	activeEditor: () => ActiveEditor,
	basePlaceholder: string,
	requestRender: () => void,
	usageReader?: SubscriptionUsageReader,
): NextSuggestionController | undefined {
	const editor = followActiveEditor(activeEditor, basePlaceholder);
	const reader = usageReader ?? interactiveSubscriptionUsageReader(session, requestRender);
	activeInteractiveSession = session;
	return installNextSuggestions(session as unknown as SuggestionSessionPort, editor, basePlaceholder, {
		requestRender,
		quotaUsage: () => activeQuotaUsage(session, reader),
		settle: settlement.suggestionMetricsSettler(() => session.sessionId, session.sessionManager.getCwd()),
		acceptTrace: suggestionAcceptTracker(() => session.sessionId, session.sessionManager.getCwd()),
	});
}

/** Release the active suggestion controller and shared UI notifications at TUI shutdown. */
export function disposeInteractiveNextSuggestions(): void {
	active?.dispose();
	if (activeInteractiveSession) {
		disposeInteractiveSubscriptionUsage(activeInteractiveSession);
		activeInteractiveSession = undefined;
	}
}
