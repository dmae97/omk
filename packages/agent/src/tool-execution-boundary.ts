import type { AssistantMessage } from "omk-ai";
import { truncateTail } from "./harness/utils/truncate.ts";
import { createImmutableSnapshot } from "./plain-data.ts";
import type {
	AgentContext,
	AgentLoopConfig,
	AgentToolCall,
	AgentToolResult,
	ToolResultEnvelope,
	ToolTimeoutDisposition,
} from "./types.ts";
import { createToolResultEnvelope, isToolResultEnvelope } from "./types.ts";

export { createImmutableJsonSnapshot, createImmutableSnapshot, parseJsonValue } from "./plain-data.ts";

export type AbortBoundResult<T> = { kind: "completed"; value: T } | { kind: "aborted" };

/** Race one async extension boundary against the parent run's abort signal. */
export async function awaitWithAbort<T>(
	start: () => Promise<T> | T,
	signal: AbortSignal | undefined,
): Promise<AbortBoundResult<T>> {
	if (signal?.aborted) return { kind: "aborted" };
	if (signal === undefined) return { kind: "completed", value: await start() };

	let notifyAbort: (() => void) | undefined;
	const aborted = new Promise<AbortBoundResult<T>>((resolve) => {
		notifyAbort = () => resolve({ kind: "aborted" });
		signal.addEventListener("abort", notifyAbort, { once: true });
	});
	if (signal.aborted) notifyAbort?.();

	try {
		const operation = Promise.resolve(start()).then((value): AbortBoundResult<T> => ({ kind: "completed", value }));
		return await Promise.race([operation, aborted]);
	} finally {
		if (notifyAbort !== undefined) signal.removeEventListener("abort", notifyAbort);
	}
}

export interface ToolDispositionEnvelope {
	omk: ToolResultEnvelope;
}

function createValidatedToolResultSnapshot(result: AgentToolResult<unknown>): AgentToolResult<unknown> {
	const snapshot = createImmutableSnapshot(result);
	if (!Array.isArray(snapshot.content)) throw new TypeError("Tool result content must be an array");
	for (const block of snapshot.content) {
		if (typeof block !== "object" || block === null) throw new TypeError("Invalid tool result content block");
		const type = Reflect.get(block, "type");
		if (type === "text" && typeof Reflect.get(block, "text") === "string") continue;
		if (
			type === "image" &&
			typeof Reflect.get(block, "data") === "string" &&
			typeof Reflect.get(block, "mimeType") === "string"
		) {
			continue;
		}
		throw new TypeError("Invalid tool result content block");
	}
	if (snapshot.terminate !== undefined && typeof snapshot.terminate !== "boolean") {
		throw new TypeError("Tool result terminate must be a boolean");
	}
	return snapshot;
}

/** Build the immutable terminal committed when a tool timeout wins. */
export function createTimeoutToolResult(
	toolName: string,
	timeoutMs: number,
	partial?: AgentToolResult<unknown>,
): AgentToolResult<ToolDispositionEnvelope> {
	const notice = `Tool "${toolName}" timed out after ${timeoutMs}ms. Cancellation was requested; execution may still be running.`;
	return createImmutableSnapshot({
		content: [{ type: "text", text: withPartialOutput(notice, partial) }],
		details: {
			omk: createToolResultEnvelope({
				synthetic: true,
				disposition: "timeout",
				reason: `Tool "${toolName}" timed out after ${timeoutMs}ms`,
				timeoutMs,
				executionStarted: true,
			}),
		},
	});
}

/**
 * Spec 076 #1: keep the text a tool streamed before the timeout won, ahead of the
 * notice. Only text blocks are kept, capped by the shared tail limits (2000 lines /
 * 50 KB, the same as bash and spec 066). Without streamed text the notice is unchanged.
 */
function withPartialOutput(notice: string, partial: AgentToolResult<unknown> | undefined): string {
	const streamed = (partial?.content ?? []).map((block) => (block.type === "text" ? block.text : "")).join("");
	if (!streamed) return notice;
	const details = partial?.details as { fullOutputPath?: unknown } | undefined;
	const fullOutput = typeof details?.fullOutputPath === "string" ? `\nFull output: ${details.fullOutputPath}` : "";
	return `${truncateTail(streamed).content}\n\n${notice}${fullOutput}`;
}

/** Build the immutable terminal committed when parent abort wins. */
export function createAbortedToolResult(executionStarted: boolean): AgentToolResult<ToolDispositionEnvelope> {
	return createImmutableSnapshot({
		content: [{ type: "text", text: "Operation aborted" }],
		details: {
			omk: createToolResultEnvelope({
				synthetic: true,
				disposition: "aborted",
				reason: "Operation aborted",
				executionStarted,
			}),
		},
	});
}

export interface ExecutedToolCallOutcome {
	result: AgentToolResult<unknown>;
	isError: boolean;
	executionStarted: boolean;
	terminalDisposition?: ToolTimeoutDisposition;
	isRealPromiseSettled: () => boolean;
	commitTerminal: () => void;
}

export interface FinalizedToolCallOutcome {
	toolCall: AgentToolCall;
	result: AgentToolResult<unknown>;
	isError: boolean;
	envelope: ToolResultEnvelope;
	isRealPromiseSettled?: () => boolean;
	commitTerminal?: () => void;
}

interface FinalizeToolCallOptions {
	currentContext: AgentContext;
	assistantMessage: AssistantMessage;
	prepared: { toolCall: AgentToolCall; args: unknown; timeoutMs: number };
	executed: ExecutedToolCallOutcome;
	afterToolCall: AgentLoopConfig["afterToolCall"];
	signal: AbortSignal | undefined;
}

export function createErrorToolResult(message: string): AgentToolResult<unknown> {
	return createImmutableSnapshot({ content: [{ type: "text", text: message }], details: {} });
}

/** Commit a real result or immutable timeout/abort result across the after hook boundary. */
export async function finalizeExecutedToolCall(options: FinalizeToolCallOptions): Promise<FinalizedToolCallOutcome> {
	const { currentContext, assistantMessage, prepared, executed, afterToolCall, signal } = options;
	let result = executed.result;
	let isError = executed.isError;
	let syntheticFailure = false;
	let terminalDisposition = executed.terminalDisposition;

	try {
		result = createValidatedToolResultSnapshot(result);
	} catch (error) {
		result = createErrorToolResult(`Invalid tool result: ${error instanceof Error ? error.message : String(error)}`);
		isError = true;
		syntheticFailure = true;
	}

	if (terminalDisposition === undefined && signal?.aborted) {
		terminalDisposition = "aborted";
		result = createAbortedToolResult(executed.executionStarted);
		isError = true;
	}
	if (terminalDisposition === undefined && afterToolCall && !syntheticFailure) {
		try {
			const bounded = await awaitWithAbort(
				() =>
					afterToolCall(
						{
							assistantMessage,
							toolCall: prepared.toolCall,
							args: prepared.args,
							result,
							isError,
							context: currentContext,
						},
						signal,
					),
				signal,
			);
			if (bounded.kind === "aborted" || signal?.aborted) {
				terminalDisposition = "aborted";
				result = createAbortedToolResult(executed.executionStarted);
				isError = true;
			} else if (bounded.value) {
				result = {
					content: bounded.value.content ?? result.content,
					details: Object.hasOwn(bounded.value, "details") ? bounded.value.details : result.details,
					terminate: bounded.value.terminate ?? result.terminate,
				};
				isError = bounded.value.isError ?? isError;
			}
		} catch (error) {
			result = createErrorToolResult(error instanceof Error ? error.message : String(error));
			isError = true;
			syntheticFailure = true;
		}
	}

	if (terminalDisposition === undefined) {
		try {
			result = createValidatedToolResultSnapshot(result);
		} catch (error) {
			result = createErrorToolResult(
				`Invalid tool result: ${error instanceof Error ? error.message : String(error)}`,
			);
			isError = true;
			syntheticFailure = true;
		}
	} else {
		isError = true;
	}
	const envelope =
		terminalDisposition !== undefined
			? createToolResultEnvelope({
					disposition: terminalDisposition,
					synthetic: true,
					executionStarted: executed.executionStarted,
					reason:
						terminalDisposition === "timeout"
							? `Tool "${prepared.toolCall.name}" timed out after ${prepared.timeoutMs}ms`
							: "Operation aborted",
					...(terminalDisposition === "timeout" ? { timeoutMs: prepared.timeoutMs } : {}),
				})
			: createToolResultEnvelope({
					disposition: isError ? "failed" : "completed",
					synthetic: syntheticFailure,
					executionStarted: executed.executionStarted,
				});
	return {
		toolCall: prepared.toolCall,
		result,
		isError,
		envelope,
		isRealPromiseSettled: executed.isRealPromiseSettled,
		commitTerminal: executed.commitTerminal,
	};
}

function isPlainDetails(details: unknown): details is Record<string, unknown> {
	if (typeof details !== "object" || details === null || Array.isArray(details)) return false;
	const prototype = Object.getPrototypeOf(details);
	return prototype === Object.prototype || prototype === null;
}

/** Preserve compatibility details while replacing any untrusted `omk` field. */
export function stampToolResultEnvelope(details: unknown, envelope: ToolResultEnvelope): unknown {
	if (!isToolResultEnvelope(envelope)) throw new TypeError("Refusing to persist an invalid tool-result/v2 envelope");
	if (details === undefined) return { omk: envelope };
	if (!isPlainDetails(details)) return { originalDetails: details, omk: envelope };
	const preserved = { ...details };
	delete preserved.omk;
	return { ...preserved, omk: envelope };
}
