/**
 * Accept-trace for next-task suggestions (default off: `OMK_NEXT_SUGGESTIONS_ACCEPT_TRACE`).
 *
 * One outcome record per shown suggestion, written once its fate is known:
 * `accepted` (Tab) with how it ended (`exact` / `edited` sent via `prompt`,
 * `steer` or `followUp`, `cleared` when the editor was emptied, `abandoned` when it was never
 * sent) and an edit-distance-ratio bucket, or `dismissed` with a reason. Two
 * one-off marker records exist: `cap_reached` (written once when the 10 MB cap
 * is hit; nothing is written after it) and `salt_invalid` (the salt file is not
 * 32 bytes; one marker per process, no outcome records, no salt or session id). Records go to their
 * own file (`suggestion-outcomes.jsonl`) next to `turns.jsonl`, so the turn
 * stream is untouched. Metadata only: the suggestion and prompt text are held in
 * memory for the comparison and never written.
 */
import { createHash, randomBytes } from "node:crypto";
import * as fs from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "../config.ts";
import { inputAlreadyHandled } from "./deferred-turn-input.ts";
import type { PromptOptions } from "./prompt-options.ts";

export const ACCEPT_TRACE_ENV = "OMK_NEXT_SUGGESTIONS_ACCEPT_TRACE";
export const SUGGESTION_OUTCOME_SCHEMA_VERSION = "omk-suggestion-outcome-1" as const;
export const SUGGESTION_OUTCOMES_FILE = "suggestion-outcomes.jsonl";
/** Longest prompt prefix compared; keeps the edit-distance work bounded (200 x 2000 cells). */
export const MAX_COMPARED_CHARS = 2000;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
/** Per-install salt for `sessionHash` (0600, under the agent dir; never logged). */
export const SESSION_SALT_FILE = "suggestion-trace-salt";

export type SentAs = "exact" | "edited" | "cleared" | "abandoned";
/** Dispatch path at submit time: new run, steer into the running turn, or follow-up queued after it. */
export type SentVia = "prompt" | "steer" | "followUp";
/** `abandoned`: shown, then replaced by another suggestion or the session ended, with no input. */
export type DismissReason = "typed_over" | "new_turn" | "other" | "abandoned";
export const EDIT_RATIO_BUCKETS = ["0", "le_0.1", "le_0.3", "le_0.6", "gt_0.6"] as const;
export type EditRatioBucket = (typeof EDIT_RATIO_BUCKETS)[number];

export function isAcceptTraceEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
	return /^(?:1|on|true|yes)$/i.test(env[ACCEPT_TRACE_ENV]?.trim() ?? "");
}

/** Timing and identity of one shown suggestion; numbers and identifiers only. */
export interface ShownSuggestionMeta {
	readonly parentTurnIndex: number;
	readonly provider: string;
	readonly model: string;
	/** `prompt_settled` handled (turn end as seen by the controller). */
	readonly settledAtEpochMs: number;
	/** Quota check finished (the request starts right after). */
	readonly quotaCheckedAtEpochMs: number;
	/** Placeholder set (suggestion visible). */
	readonly shownAtEpochMs: number;
}

export interface SuggestionOutcomeRecord extends ShownSuggestionMeta {
	readonly schemaVersion: typeof SUGGESTION_OUTCOME_SCHEMA_VERSION;
	/** sha256(salt + sessionId), hex, first 16 chars. The raw session id is never written. */
	readonly sessionHash: string;
	readonly outcome: "accepted" | "dismissed";
	readonly decidedAtEpochMs: number;
	readonly msToAccept?: number;
	readonly sentAs?: SentAs;
	/** Only on `exact` / `edited`. */
	readonly sentVia?: SentVia;
	readonly editRatioBucket?: EditRatioBucket;
	readonly dismissReason?: DismissReason;
}

export function editDistance(a: string, b: string): number {
	if (a === b) return 0;
	if (a.length === 0) return b.length;
	if (b.length === 0) return a.length;
	let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
	for (let i = 1; i <= a.length; i++) {
		const row = [i];
		for (let j = 1; j <= b.length; j++) {
			const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
			row[j] = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + cost);
		}
		prev = row;
	}
	return prev[b.length]!;
}

export function editRatioBucket(suggestion: string, sent: string): EditRatioBucket {
	const a = suggestion.slice(0, MAX_COMPARED_CHARS);
	const b = sent.slice(0, MAX_COMPARED_CHARS);
	const longest = Math.max(a.length, b.length);
	const ratio = longest === 0 ? 0 : editDistance(a, b) / longest;
	if (ratio === 0) return "0";
	if (ratio <= 0.1) return "le_0.1";
	if (ratio <= 0.3) return "le_0.3";
	return ratio <= 0.6 ? "le_0.6" : "gt_0.6";
}

/** Printable input replaces the empty editor's placeholder; anything else is `other`. */
export function dismissReasonForKey(data: string): DismissReason {
	return [...data].length === 1 && data >= " " && data !== "\u007f" ? "typed_over" : "other";
}

interface Pending {
	readonly meta: ShownSuggestionMeta;
	readonly text: string;
	acceptedAtEpochMs?: number;
}

/** State machine: shown → (accepted → sent/cleared) | dismissed. Exactly one record per shown suggestion. */
export class SuggestionAcceptTracker {
	private pending: Pending | undefined;
	private readonly write: (record: Omit<SuggestionOutcomeRecord, "schemaVersion" | "sessionHash">) => void;

	constructor(write: (record: Omit<SuggestionOutcomeRecord, "schemaVersion" | "sessionHash">) => void) {
		this.write = write;
	}

	get awaitingSend(): boolean {
		return this.pending?.acceptedAtEpochMs !== undefined;
	}

	shown(meta: ShownSuggestionMeta, text: string): void {
		this.flush(meta.shownAtEpochMs);
		this.pending = { meta, text };
	}

	accepted(atEpochMs: number): void {
		if (this.pending && this.pending.acceptedAtEpochMs === undefined) this.pending.acceptedAtEpochMs = atEpochMs;
	}

	/** A shown, not-yet-accepted suggestion went away. No-op after an accept. */
	dismissed(reason: DismissReason, atEpochMs: number): void {
		const p = this.pending;
		if (!p || p.acceptedAtEpochMs !== undefined) return;
		this.pending = undefined;
		this.write({ ...p.meta, outcome: "dismissed", dismissReason: reason, decidedAtEpochMs: atEpochMs });
	}

	/** Editor text seen before a key; an emptied editor after an accept is `cleared`. */
	observeEditor(text: string, atEpochMs: number): void {
		if (this.awaitingSend && text.length === 0) this.settleAccepted("cleared", undefined, atEpochMs);
	}

	/** The next user message was sent (`via`: new prompt or steer into a running turn); `text` is its user text. */
	sent(text: string, atEpochMs: number, via: SentVia = "prompt"): void {
		const p = this.pending;
		if (!p) return;
		if (p.acceptedAtEpochMs === undefined) {
			this.dismissed("new_turn", atEpochMs);
			return;
		}
		const bucket = editRatioBucket(p.text, text);
		this.settleAccepted(bucket === "0" ? "exact" : "edited", bucket, atEpochMs, via);
	}

	/** Close whatever is open (dispose, or a new suggestion replacing it): never sent ⇒ `abandoned`. */
	flush(atEpochMs: number): void {
		if (this.awaitingSend) this.settleAccepted("abandoned", undefined, atEpochMs);
		else this.dismissed("abandoned", atEpochMs);
	}

	private settleAccepted(sentAs: SentAs, bucket: EditRatioBucket | undefined, atEpochMs: number, via?: SentVia): void {
		const p = this.pending;
		if (!p || p.acceptedAtEpochMs === undefined) return;
		this.pending = undefined;
		this.write({
			...p.meta,
			outcome: "accepted",
			msToAccept: Math.max(0, p.acceptedAtEpochMs - p.meta.shownAtEpochMs),
			sentAs,
			...(bucket ? { editRatioBucket: bucket } : {}),
			...(via && (sentAs === "exact" || sentAs === "edited") ? { sentVia: via } : {}),
			decidedAtEpochMs: atEpochMs,
		});
	}
}

/** The session's dispatch entry point, as seen by the accept trace (optional on test ports). */
type PromptFn = (text: string, options?: PromptOptions) => Promise<void>;
interface QueuedDispatchPort {
	prompt?: PromptFn;
}

/**
 * `sentVia` comes from the branch `AgentSession._prompt` actually took, reported
 * through the `dispatched` prompt option: "prompt" once a run is admitted, or
 * the requested streamingBehavior when the input is queued (`_queueSteer` /
 * `_queueFollowUp`) or deferred for a prompt in preflight (`deferPrompt`).
 * Input handled by an extension command or input hook reports nothing, so it
 * records nothing. Returns the restore function, or `undefined` for a port
 * without `prompt()` (the caller then falls back to `message_start`).
 */
export function traceQueuedDispatch(session: object, trace: SuggestionAcceptTracker): (() => void) | undefined {
	const port = session as unknown as QueuedDispatchPort;
	const inner = port.prompt;
	if (typeof inner !== "function") return undefined;
	const wrapped: PromptFn = (text, options) => {
		// A prepared resume already carries the original call's hook; keep its identity (input-handled marker).
		if (inputAlreadyHandled(options)) return inner.call(port, text, options);
		const outer = options?.dispatched;
		const dispatched: PromptOptions["dispatched"] = (via, sentText) => {
			trace.sent(sentText, Date.now(), via);
			outer?.(via, sentText);
		};
		return inner.call(port, text, { ...options, dispatched });
	};
	port.prompt = wrapped;
	return () => {
		if (port.prompt === wrapped) port.prompt = inner;
	};
}

/** Read the install's salt as stored (callers must check it is exactly 32 bytes). */
export function sessionHashSalt(agentDir: string = getAgentDir()): Buffer {
	return fs.readFileSync(join(agentDir, SESSION_SALT_FILE), { flag: "r" });
}

function readOrCreateSalt(agentDir: string): Buffer {
	try {
		return sessionHashSalt(agentDir);
	} catch {
		fs.mkdirSync(agentDir, { recursive: true, mode: 0o700 });
		try {
			fs.writeFileSync(join(agentDir, SESSION_SALT_FILE), randomBytes(32), { flag: "wx", mode: 0o600 });
		} catch {
			// Lost a creation race (EEXIST): read the winner's salt below.
		}
		return sessionHashSalt(agentDir);
	}
}

export function sessionHash(salt: Buffer, sessionId: string): string {
	return createHash("sha256").update(salt).update(sessionId, "utf8").digest("hex").slice(0, 16);
}

let saltInvalidReported = false;
/** Test hook: forget that this process already reported an invalid salt. */
export function resetSaltInvalidReportForTests(): void {
	saltInvalidReported = false;
}

/** True when the file's last record is the `cap_reached` marker (survives restarts, so no repeats). */
function endsWithCapMarker(file: string, size: number): boolean {
	const fd = fs.openSync(file, "r");
	try {
		const len = Math.min(size, 512);
		const buf = Buffer.alloc(len);
		fs.readSync(fd, buf, 0, len, size - len);
		const last = buf.toString("utf8").trimEnd().split("\n").pop() ?? "";
		return last.includes('"outcome":"cap_reached"');
	} finally {
		fs.closeSync(fd);
	}
}

const DISABLED = new Set(["0", "false", "off", "disable", "disabled"]);

/** Tracker writing to `<metrics dir>/suggestion-outcomes.jsonl`; `undefined` when flag off or metrics opted out. */
export function suggestionAcceptTracker(
	sessionId: () => string,
	cwd: string,
	env: NodeJS.ProcessEnv = process.env,
	agentDir?: string,
): SuggestionAcceptTracker | undefined {
	if (!isAcceptTraceEnabled(env)) return undefined;
	const metrics = env.OMK_TURN_METRICS;
	if (metrics !== undefined && DISABLED.has(metrics.trim().toLowerCase())) return undefined;
	const file = join(env.OMK_TURN_METRICS_DIR ?? join(cwd, ".omk", "metrics"), SUGGESTION_OUTCOMES_FILE);
	let salt: Buffer | undefined;
	let capped = false;
	const marker = (outcome: "cap_reached" | "salt_invalid", at: number) =>
		`${JSON.stringify({ schemaVersion: SUGGESTION_OUTCOME_SCHEMA_VERSION, outcome, decidedAtEpochMs: at })}\n`;
	return new SuggestionAcceptTracker((record) => {
		try {
			if (capped) return;
			salt ??= readOrCreateSalt(agentDir ?? getAgentDir());
			fs.mkdirSync(join(file, ".."), { recursive: true });
			if (salt.length !== 32) {
				// Not silent, but never the salt or the raw id: one marker per process, then no records.
				if (!saltInvalidReported) {
					saltInvalidReported = true;
					fs.appendFileSync(file, marker("salt_invalid", record.decidedAtEpochMs), "utf8");
				}
				return;
			}
			const hash = sessionHash(salt, sessionId());
			const line = `${JSON.stringify({ schemaVersion: SUGGESTION_OUTCOME_SCHEMA_VERSION, sessionHash: hash, ...record })}\n`;
			const size = fs.statSync(file, { throwIfNoEntry: false })?.size ?? 0;
			if (size + Buffer.byteLength(line) > MAX_FILE_BYTES) {
				capped = true;
				// The marker may run a few bytes past the cap; written once, even across restarts.
				if (!endsWithCapMarker(file, size))
					fs.appendFileSync(file, marker("cap_reached", record.decidedAtEpochMs), "utf8");
				return;
			}
			fs.appendFileSync(file, line, "utf8");
		} catch {
			// Advisory only.
		}
	});
}

/** Text of a user message (string or text parts). */
export function userMessageText(message: unknown): string | undefined {
	if (typeof message !== "object" || message === null || (message as { role?: unknown }).role !== "user")
		return undefined;
	const content = (message as { content?: unknown }).content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((part): part is { type: "text"; text: string } => part?.type === "text" && typeof part.text === "string")
		.map((part) => part.text)
		.join("\n");
}
