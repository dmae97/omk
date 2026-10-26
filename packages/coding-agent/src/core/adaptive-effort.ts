/**
 * Adaptive reasoning effort per phase (spec 037), default on; `OMK_ADAPTIVE_EFFORT=0`/`false`/`off` opts out.
 *
 * Loaded lazily by `createSdkProviderStream` only when the flag is on; with it off this module
 * is never imported and requests are byte-identical to main.
 *
 * The configured effort (`options.reasoning`) is the ceiling. Calls in the high group
 * (plan/debug/verify) pass `options` through unchanged; calls in the low group (explore, edit,
 * build, run, or no phase yet) send `high`, or the ceiling if lower, or the next supported level
 * below. The group changes only after 2 consecutive classifications in the new group, at most
 * 4 times per wrapper (one per session). Only `options.reasoning` ever changes: `model`,
 * `context.systemPrompt`, `context.tools` and `context.messages` are passed through as is, so
 * the prompt cache prefix stays the same (spec 037 section 5).
 */
import type { StreamFn } from "omk-agent-core";
import {
	type Api,
	type AssistantMessage,
	type Context,
	getSupportedThinkingLevels,
	type Model,
	type ThinkingLevel,
} from "omk-ai";
import { effortSentFor, type LlmCallPhaseFields, setLlmCallPhaseFields } from "./llm-call-run-log.ts";
import {
	decideCall,
	type EffortGroup,
	effortGroupOf,
	type Phase,
	type RecentCall,
	type ResolvedPhase,
	resolvePhase,
	type TodoKind,
	toolPhase,
} from "./phase-classifier.ts";
import { appendRunLog } from "./run-log.ts";
import { activeTodoKind } from "./todo-runtime-state.ts";

export const ADAPTIVE_EFFORT_ENV = "OMK_ADAPTIVE_EFFORT";
export const SWITCH_AFTER_CLASSIFICATIONS = 2;
export const MAX_EFFORT_SWITCHES = 4;
const LOW_GROUP_TARGET: ThinkingLevel = "high";
const LEVELS: readonly ThinkingLevel[] = ["minimal", "low", "medium", "high", "xhigh", "max", "ultra"];
const RECENT_CALLS = 5;
/** Once saturated, preserve correctness by disabling adaptation rather than forgetting seen IDs. */
export const ADAPTIVE_EFFORT_MAX_SEEN_IDS = 8192;
export const ADAPTIVE_EFFORT_MAX_SEEN_CODE_UNITS = 1024 * 1024;

export interface AdaptiveEffortOptions {
	/**
	 * Active todo kind (spec 049 `activeTodoKind()`), read on every classified call.
	 * Defaults to the read-only accessor, independent of `OMK_TODO_VERIFY`.
	 */
	readonly todoKind?: () => TodoKind | undefined;
	/** Run-log sink for the 037 fields; defaults to the `llm-call.jsonl` setter (spec 059). */
	readonly record?: (fields: LlmCallPhaseFields | undefined) => void;
	/** Called once if tracking saturates; errors cannot affect provider requests. */
	readonly onHistoryLimit?: () => void;
}

function providerValue(model: Model<Api>, level: ThinkingLevel): string | null {
	const mapped = model.thinkingLevelMap?.[level];
	return mapped === undefined ? level : mapped;
}

/**
 * The level the low group sends, or `undefined` when nothing lower than the ceiling can be sent
 * (`lowerClamped`): no ceiling, no supported level at or below the target, or the target goes
 * out with the same provider value as the ceiling (ceiling `high` or below, grok-4.5 at `max`).
 */
export function lowGroupEffort(model: Model<Api>, ceiling: ThinkingLevel | undefined): ThinkingLevel | undefined {
	if (ceiling === undefined) return undefined;
	const ceilingIndex = LEVELS.indexOf(ceiling);
	if (ceilingIndex < 0) return undefined;
	const targetIndex = Math.min(ceilingIndex, LEVELS.indexOf(LOW_GROUP_TARGET));
	// Distinct provider values only; of levels sharing one, the lowest is kept (xhigh/max/ultra → xhigh).
	const seen = new Set<string>();
	let chosen: ThinkingLevel | undefined;
	for (const level of getSupportedThinkingLevels(model)) {
		if (level === "off") continue;
		const value = providerValue(model, level);
		if (typeof value !== "string" || seen.has(value)) continue;
		seen.add(value);
		if (LEVELS.indexOf(level) <= targetIndex) chosen = level;
	}
	if (chosen === undefined) return undefined;
	return providerValue(model, chosen) === effortSentFor(model, ceiling) ? undefined : chosen;
}

function lastAssistant(context: Context): AssistantMessage | undefined {
	for (let i = context.messages.length - 1; i >= 0; i--) {
		const message = context.messages[i];
		if (message.role === "assistant") return message;
	}
	return undefined;
}

function toolFailed(context: Context, toolCallId: string): boolean {
	return context.messages.some(
		(message) => message.role === "toolResult" && message.toolCallId === toolCallId && message.isError === true,
	);
}

/** Per-session classifier and switch state. */
class AdaptiveEffortState {
	private readonly seen = new Set<string>();
	private seenCodeUnits = 0;
	private saturated = false;
	private recent: RecentCall[] = [];
	private toolPrev: Phase | undefined;
	private resolved: ResolvedPhase | undefined;
	private group: EffortGroup = "low";
	private streak = 0;
	private switches = 0;

	/** Feed the not-yet-seen tool calls of the last assistant message; the phase after the last one. */
	private toolSignal(context: Context): Phase | undefined {
		let signal: Phase | undefined;
		for (const part of lastAssistant(context)?.content ?? []) {
			if (part.type !== "toolCall" || this.seen.has(part.id)) continue;
			if (
				this.seen.size >= ADAPTIVE_EFFORT_MAX_SEEN_IDS ||
				this.seenCodeUnits + part.id.length > ADAPTIVE_EFFORT_MAX_SEEN_CODE_UNITS
			) {
				this.seen.clear();
				this.seenCodeUnits = 0;
				this.recent = [];
				this.saturated = true;
				return undefined;
			}
			this.seen.add(part.id);
			this.seenCodeUnits += part.id.length;
			const failed = toolFailed(context, part.id);
			let phase: Phase | undefined;
			let key: string | null = null;
			if (part.name === "bash") {
				const command = typeof part.arguments?.command === "string" ? part.arguments.command : "";
				({ phase, key } = decideCall({ command, failed, prevPhase: this.toolPrev, recent: this.recent }));
			} else {
				phase = toolPhase(part.name);
				if (phase === undefined) continue;
			}
			this.recent = [...this.recent, { key, failed }].slice(-RECENT_CALLS);
			this.toolPrev = phase;
			signal = phase;
		}
		return signal;
	}

	/** One classification per outer call: resolve the phase, apply hysteresis and the switch cap. */
	classify(context: Context, todoKind: TodoKind | undefined, clamped: boolean): LlmCallPhaseFields | undefined {
		if (this.saturated) return undefined;
		this.resolved = resolvePhase(todoKind, this.toolSignal(context), this.resolved);
		if (this.saturated) return undefined;
		const wanted = effortGroupOf(this.resolved?.phase);
		let effortSwitch: LlmCallPhaseFields["effortSwitch"] = null;
		// A clamped call sends the same effort in both groups, so it neither moves nor counts toward a switch.
		if (!clamped && this.switches < MAX_EFFORT_SWITCHES) {
			this.streak = wanted === this.group ? 0 : this.streak + 1;
			if (this.streak >= SWITCH_AFTER_CLASSIFICATIONS) {
				this.switches++;
				effortSwitch = { from: this.group, to: wanted, n: this.switches };
				this.group = wanted;
				this.streak = 0;
			}
		}
		return {
			phase: this.resolved?.phase ?? null,
			phaseSource: this.resolved?.source ?? null,
			effortGroup: this.group,
			effortSwitch,
			lowerClamped: clamped,
		};
	}
}

/** Wrap `inner` (the 033 cap around the 059 log around the provider) with per-phase effort. */
export function createAdaptiveEffortStreamFn(inner: StreamFn, options: AdaptiveEffortOptions = {}): StreamFn {
	const todoKind = options.todoKind ?? activeTodoKind;
	const record = options.record ?? setLlmCallPhaseFields;
	const onHistoryLimit =
		options.onHistoryLimit ??
		(() => {
			process.emitWarning(
				"Adaptive effort reached its tool-call history limit; using the configured reasoning effort until this stream is recreated.",
				{ code: "OMK_ADAPTIVE_EFFORT_HISTORY_LIMIT" },
			);
			appendRunLog("adaptive-effort", { event: "history_limit" });
		});
	const state = new AdaptiveEffortState();
	let reportedLimit = false;
	return (model, context, streamOptions) => {
		// Summary and compaction calls carry no tools: untouched, and they do not move the state.
		if (!context.tools || context.tools.length === 0) {
			record(undefined);
			return inner(model, context, streamOptions);
		}
		const low = lowGroupEffort(model, streamOptions?.reasoning);
		const fields = state.classify(context, todoKind(), low === undefined);
		if (!fields) {
			record(undefined);
			if (!reportedLimit) {
				reportedLimit = true;
				try {
					onHistoryLimit();
				} catch {
					// Diagnostic failure must not affect the provider call.
				}
			}
			return inner(model, context, streamOptions);
		}
		record(fields);
		if (fields.effortGroup === "high" || low === undefined) return inner(model, context, streamOptions);
		return inner(model, context, { ...streamOptions, reasoning: low });
	};
}
