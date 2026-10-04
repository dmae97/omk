/**
 * Agent loop that works with AgentMessage throughout.
 * Transforms to Message[] only at the LLM call boundary.
 */

import {
	type AssistantMessage,
	type AssistantMessageEvent,
	type AssistantMessageEventStream,
	type Context,
	EventStream,
	type Model,
	type ToolResultMessage,
	validateToolArguments,
} from "omk-ai";
import { bindToolIdentity } from "./builtin-tool-resource-claims.ts";
import { partitionToolBatchWaves } from "./parallel-tool-batch.ts";
import { pinProviderConfig, requestAssistantResponse } from "./provider-request.ts";

export { getVisionRouteModel, isVisionRouteModel, VISION_ROUTE_MODEL } from "./vision-route.ts";

import { type DeferredCall, deferredStillConflicts } from "./tool-dag-deferred.ts";
import { type DagFrontierScheduleCache, resolveDagFrontierMemo } from "./tool-dag-memo.ts";
import { finishDagTasks, type OwnedTaskResult, startDagTask } from "./tool-dag-owned-task.ts";
import { reduceDagDependencies } from "./tool-dag-reduce.ts";
import { applyConcurrencyCap, assignDagDependencies } from "./tool-dag-scheduler.ts";
import {
	awaitWithAbort,
	createErrorToolResult,
	createImmutableJsonSnapshot,
	createImmutableSnapshot,
	type ExecutedToolCallOutcome,
	type FinalizedToolCallOutcome,
	finalizeExecutedToolCall,
	parseJsonValue,
	stampToolResultEnvelope,
} from "./tool-execution-boundary.ts";
import { type ClaimableToolCall, resolveToolClaimsForCall, type ToolClaimResolution } from "./tool-resource-claims.ts";
import { indexFinalizedToolCalls } from "./tool-terminal-index.ts";
import { resolveToolTimeoutMs, runToolCallWithTimeout } from "./tool-timeout.ts";
import { hasUnsettledTimeout } from "./tool-timeout-settlement.ts";
import {
	createSyntheticToolResult,
	inspectTranscriptIntegrity,
	repairTranscriptIntegrity,
} from "./tool-transcript-integrity.ts";
import {
	type AgentContext,
	type AgentEvent,
	type AgentLoopConfig,
	type AgentLoopTurnUpdate,
	type AgentMessage,
	type AgentTool,
	type AgentToolCall,
	type AgentToolResult,
	createToolResultEnvelope,
	type StreamFn,
	type ToolCallDisposition,
	type ToolResultEnvelope,
} from "./types.ts";

export type AgentEventSink = (event: AgentEvent) => Promise<void> | void;

const EMPTY_USAGE = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

export interface FailureTerminationPlan {
	/** Messages to publish as the run result (closure results + optional failure). */
	messages: AgentMessage[];
	/** Synthetic assistant failure message, or `undefined` when fail-closed. */
	failureMessage: AgentMessage | undefined;
	/** Synthetic tool results used to close an open turn, in source order. */
	closureResults: ToolResultMessage[];
}

/**
 * Decide how to terminate a run after the underlying loop rejected.
 *
 * A synthetic assistant failure may only be appended on top of a transcript
 * whose tool turns are all closed. When `completedMessages` ends with an open
 * tool turn, a safe missing-only closure (synthetic results for the unambiguous
 * missing tail calls) is appended first so the failure assistant never creates
 * an `assistant(tool calls) -> assistant(failure)` interleaving.
 *
 * If the transcript is ambiguous (duplicate/orphan/interleave, or a
 * mid-transcript gap) it is never auto-repaired: the plan returns no failure
 * message so the caller ends the stream without fabricating a turn over
 * corruption. Pure apart from `Date.now()` on the failure message.
 */
export function planFailureTermination(
	completedMessages: readonly AgentMessage[],
	model: Model<any>,
	error: unknown,
	aborted: boolean,
): FailureTerminationPlan {
	const messages = [...completedMessages];
	const closureResults: ToolResultMessage[] = [];

	if (!inspectTranscriptIntegrity(messages).ok) {
		try {
			const repaired = repairTranscriptIntegrity(messages, "Tool result missing; run terminated by error");
			// repairTranscriptIntegrity appends synthetic results only for
			// unambiguous missing tail calls; anything ambiguous throws above.
			for (let i = messages.length; i < repaired.length; i++) {
				const result = createImmutableSnapshot(repaired[i] as ToolResultMessage);
				closureResults.push(result);
				messages.push(result);
			}
		} catch {
			// Ambiguous transcript: never auto-repair. Fail closed without a
			// synthetic assistant turn over a corrupt transcript.
			return { messages, failureMessage: undefined, closureResults: [] };
		}
	}

	const failureMessage: AgentMessage = createImmutableSnapshot({
		role: "assistant",
		content: [{ type: "text", text: "" }],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: EMPTY_USAGE,
		stopReason: aborted ? "aborted" : "error",
		errorMessage: error instanceof Error ? error.message : String(error),
		timestamp: Date.now(),
	});
	return { messages: [...messages, failureMessage], failureMessage, closureResults };
}

/**
 * Terminate the public event stream after the underlying loop rejected.
 *
 * Uses {@link planFailureTermination} so the disposition of any unresolved tool
 * calls matches transcript repair exactly: an unambiguous open turn is closed
 * with synthetic results before a coherent
 * message_start/message_end/turn_end/agent_end sequence for the failure
 * assistant, and an ambiguous transcript fails closed (agent_end only, no
 * fabricated assistant). The stream always settles for `for await` consumers
 * and `stream.result()`.
 */
function endStreamWithFailure(
	stream: EventStream<AgentEvent, AgentMessage[]>,
	config: AgentLoopConfig,
	completedMessages: AgentMessage[],
	error: unknown,
	signal?: AbortSignal,
): void {
	const plan = planFailureTermination(completedMessages, config.model, error, signal?.aborted ?? false);

	for (const result of plan.closureResults) {
		stream.push({ type: "message_start", message: result });
		stream.push({ type: "message_end", message: result });
	}

	if (plan.failureMessage) {
		stream.push({ type: "message_start", message: plan.failureMessage });
		stream.push({ type: "message_end", message: plan.failureMessage });
		stream.push({ type: "turn_end", message: plan.failureMessage, toolResults: [] });
	}

	stream.push({ type: "agent_end", messages: plan.messages });
	stream.end(plan.messages);
}

/**
 * Start an agent loop with a new prompt message.
 * The prompt is added to the context and events are emitted for it.
 */
export function agentLoop(
	prompts: AgentMessage[],
	context: AgentContext,
	config: AgentLoopConfig,
	signal?: AbortSignal,
	streamFn?: StreamFn,
): EventStream<AgentEvent, AgentMessage[]> {
	const stream = createAgentStream();
	const completedMessages: AgentMessage[] = [];

	void runAgentLoop(
		prompts,
		context,
		config,
		async (event) => {
			if (event.type === "message_end") {
				completedMessages.push(event.message);
			}
			stream.push(event);
		},
		signal,
		streamFn,
	).then(
		(messages) => {
			stream.end(messages);
		},
		(error: unknown) => {
			endStreamWithFailure(stream, config, completedMessages, error, signal);
		},
	);

	return stream;
}

/**
 * Continue an agent loop from the current context without adding a new message.
 * Used for retries - context already has user message or tool results.
 *
 * **Important:** The last message in context must convert to a `user` or `toolResult` message
 * via `convertToLlm`. If it doesn't, the LLM provider will reject the request.
 * This cannot be validated here since `convertToLlm` is only called once per turn.
 */
export function agentLoopContinue(
	context: AgentContext,
	config: AgentLoopConfig,
	signal?: AbortSignal,
	streamFn?: StreamFn,
): EventStream<AgentEvent, AgentMessage[]> {
	if (context.messages.length === 0) {
		throw new Error("Cannot continue: no messages in context");
	}

	// Guard: the last message must be one the provider can build on. A plain
	// text/thinking assistant turn is acceptable (convertToLlm may merge or the
	// provider supports assistant pre-fill); only an assistant turn that still
	// carries unresolved tool calls is a hard error because the provider will
	// reject the request without matching tool results.
	assertContinuableTranscript(context.messages);

	const stream = createAgentStream();
	const completedMessages: AgentMessage[] = [];

	void runAgentLoopContinue(
		context,
		config,
		async (event) => {
			if (event.type === "message_end") {
				completedMessages.push(event.message);
			}
			stream.push(event);
		},
		signal,
		streamFn,
	).then(
		(messages) => {
			stream.end(messages);
		},
		(error: unknown) => {
			endStreamWithFailure(stream, config, completedMessages, error, signal);
		},
	);

	return stream;
}

export async function runAgentLoop(
	prompts: AgentMessage[],
	context: AgentContext,
	config: AgentLoopConfig,
	emit: AgentEventSink,
	signal?: AbortSignal,
	streamFn?: StreamFn,
): Promise<AgentMessage[]> {
	const newMessages: AgentMessage[] = [...prompts];
	const currentContext: AgentContext = { ...context, messages: [...context.messages, ...prompts] };
	const publish: AgentEventSink = (event) => emit(createImmutableSnapshot(event));
	const pinnedConfig = await pinProviderConfig(config, publish);

	await publish({ type: "agent_start" });
	await publish({ type: "turn_start" });
	for (const prompt of prompts) {
		await publish({ type: "message_start", message: prompt });
		await publish({ type: "message_end", message: prompt });
	}

	await runLoop(currentContext, newMessages, pinnedConfig, signal, publish, streamFn);
	return newMessages;
}

export async function runAgentLoopContinue(
	context: AgentContext,
	config: AgentLoopConfig,
	emit: AgentEventSink,
	signal?: AbortSignal,
	streamFn?: StreamFn,
): Promise<AgentMessage[]> {
	if (context.messages.length === 0) {
		throw new Error("Cannot continue: no messages in context");
	}

	assertContinuableTranscript(context.messages);

	const newMessages: AgentMessage[] = [];
	const currentContext: AgentContext = { ...context };
	const publish: AgentEventSink = (event) => emit(createImmutableSnapshot(event));
	const pinnedConfig = await pinProviderConfig(config, publish);

	await publish({ type: "agent_start" });
	await publish({ type: "turn_start" });
	await runLoop(currentContext, newMessages, pinnedConfig, signal, publish, streamFn);
	return newMessages;
}

function createAgentStream(): EventStream<AgentEvent, AgentMessage[]> {
	return new EventStream<AgentEvent, AgentMessage[]>(
		(event: AgentEvent) => event.type === "agent_end",
		(event: AgentEvent) => (event.type === "agent_end" ? event.messages : []),
	);
}

/**
 * Validate the full transcript before continuing. Replaces the earlier
 * last-message-only tail check: `assistant(A,B) -> result(A)` and any
 * duplicate/orphan/interleaved structure now fail before the first provider
 * request, not only a trailing assistant message that still carries tool calls.
 *
 * A trailing assistant turn with no tool calls (plain text/thinking) remains
 * continuable, so compaction, session resume, and explicit retries keep working.
 */
function assertContinuableTranscript(messages: AgentMessage[]): void {
	const report = inspectTranscriptIntegrity(messages);
	if (report.ok) {
		return;
	}
	const last = messages[messages.length - 1];
	if (last !== undefined && last.role === "assistant" && last.content.some((block) => block.type === "toolCall")) {
		throw new Error(
			"Cannot continue: the last assistant message has pending tool calls without matching results. " +
				"Add tool results or a new user message before continuing.",
		);
	}
	const summary = report.issues.map((issue) => `${issue.kind}:${issue.toolCallId}`).join(", ");
	throw new Error(
		`Cannot continue: invalid tool transcript (${summary}). ` +
			"Append terminal tool results or repair the transcript before continuing.",
	);
}

/** Throw when the tool transcript could not be accepted by a provider. */
function assertValidToolTranscript(messages: AgentMessage[], describe: (summary: string) => string): void {
	const integrityReport = inspectTranscriptIntegrity(messages);
	if (integrityReport.ok) {
		return;
	}
	const summary = integrityReport.issues.map((issue) => `${issue.kind}:${issue.toolCallId}`).join(", ");
	throw new Error(describe(summary));
}

/** Inject queued steering messages into the transcript before the next assistant turn. */
async function injectPendingMessages(
	pendingMessages: AgentMessage[],
	currentContext: AgentContext,
	newMessages: AgentMessage[],
	emit: AgentEventSink,
): Promise<void> {
	for (const message of pendingMessages) {
		await emit({ type: "message_start", message });
		await emit({ type: "message_end", message });
		currentContext.messages.push(message);
		newMessages.push(message);
	}
}

/** Close every emitted tool call with a synthetic terminal result and end the run. */
async function closeRunOnTerminalStop(
	currentContext: AgentContext,
	message: AssistantMessage,
	toolCalls: AgentToolCall[],
	newMessages: AgentMessage[],
	emit: AgentEventSink,
): Promise<void> {
	const toolResults: ToolResultMessage[] = [];
	const reason =
		message.stopReason === "aborted"
			? "Operation aborted"
			: "Skipped because the provider terminated before tool execution";
	const disposition = message.stopReason === "aborted" ? "aborted" : "skipped";
	for (const toolCall of toolCalls) {
		const result = createImmutableSnapshot(
			createSyntheticToolResult(toolCall.id, toolCall.name, reason, Date.now(), disposition),
		);
		currentContext.messages.push(result);
		newMessages.push(result);
		toolResults.push(result);
		await emitToolResultMessage(result, emit);
	}
	await emit({ type: "turn_end", message, toolResults });
	await emit({ type: "agent_end", messages: newMessages });
}

/** Drain an optional message queue, normalizing absent queues to an empty list. */
async function drainMessageQueue(queue?: () => Promise<AgentMessage[]>): Promise<AgentMessage[]> {
	return queue === undefined ? [] : await queue();
}

/** Validate an optional per-run provider-turn budget. */
function validateMaxTurns(maxTurns: number | undefined): number | undefined {
	if (maxTurns === undefined) return undefined;
	if (!Number.isSafeInteger(maxTurns) || maxTurns < 1) {
		throw new RangeError("maxTurns must be a positive safe integer");
	}
	return maxTurns;
}

/** Reject ambiguous provider-emitted tool transcripts before any tool executes. */
function assertEmittedTranscriptUnambiguous(messages: AgentMessage[]): void {
	const emittedAmbiguities = inspectTranscriptIntegrity(messages).issues.filter(
		(issue) => issue.kind !== "missing_result",
	);
	if (emittedAmbiguities.length === 0) {
		return;
	}
	const summary = emittedAmbiguities.map((issue) => `${issue.kind}:${issue.toolCallId}`).join(", ");
	throw new Error(`Refusing tool execution: invalid emitted tool transcript (${summary}).`);
}

type ToolBatchTurnOutcome =
	| { kind: "continue"; toolResults: ToolResultMessage[]; hasMoreToolCalls: boolean; stopRun: boolean }
	| { kind: "ended" };

/** Execute one assistant batch, closing unresolved calls and ending the run on abort. */
async function runToolBatchForTurn(
	currentContext: AgentContext,
	message: AssistantMessage,
	toolCalls: AgentToolCall[],
	config: AgentLoopConfig,
	signal: AbortSignal | undefined,
	emit: AgentEventSink,
	newMessages: AgentMessage[],
	dagScheduleCache: DagFrontierScheduleCache,
): Promise<ToolBatchTurnOutcome> {
	const executedToolBatch = await executeToolCalls(currentContext, message, config, signal, emit, dagScheduleCache);
	const toolResults = [...executedToolBatch.messages];
	if (signal?.aborted) {
		// Close only unresolved calls, preserving finalized results, then stop
		// before hooks, queues, or another provider request.
		const synthesized = await closeUnresolvedToolBatch(currentContext, toolCalls, toolResults, emit);
		toolResults.push(...synthesized);
		for (const result of toolResults) newMessages.push(result);
		await emit({ type: "turn_end", message, toolResults });
		await emit({ type: "agent_end", messages: newMessages });
		return { kind: "ended" };
	}
	for (const result of toolResults) newMessages.push(result);
	return {
		kind: "continue",
		toolResults,
		hasMoreToolCalls: !executedToolBatch.terminate,
		stopRun: executedToolBatch.stopRun ?? false,
	};
}

/** Merge a prepareNextTurn snapshot into the active context and loop config. */
function applyNextTurnSnapshot(
	currentContext: AgentContext,
	config: AgentLoopConfig,
	snapshot: AgentLoopTurnUpdate,
): { context: AgentContext; config: AgentLoopConfig } {
	return {
		context: snapshot.context ?? currentContext,
		config: {
			...config,
			model: snapshot.model ?? config.model,
			reasoning:
				snapshot.thinkingLevel === undefined
					? config.reasoning
					: snapshot.thinkingLevel === "off"
						? undefined
						: snapshot.thinkingLevel,
		},
	};
}

/**
 * Main loop logic shared by agentLoop and agentLoopContinue.
 */
async function runLoop(
	initialContext: AgentContext,
	newMessages: AgentMessage[],
	initialConfig: AgentLoopConfig,
	signal: AbortSignal | undefined,
	emit: AgentEventSink,
	streamFn?: StreamFn,
): Promise<void> {
	let currentContext = initialContext;
	let config = initialConfig;
	let firstTurn = true;
	let turnsStarted = 0;
	const maxTurns = validateMaxTurns(initialConfig.maxTurns);
	const dagScheduleCache: DagFrontierScheduleCache = new Map();
	// Check for steering messages at start (user may have typed while waiting)
	let pendingMessages = await drainMessageQueue(config.getSteeringMessages);

	// Outer loop: continues when queued follow-up messages arrive after agent would stop
	while (true) {
		let hasMoreToolCalls = true;

		// Inner loop: process tool calls and steering messages
		while (hasMoreToolCalls || pendingMessages.length > 0) {
			if (!firstTurn) {
				await emit({ type: "turn_start" });
			}
			firstTurn = false;

			// Process pending messages (inject before next assistant response)
			if (pendingMessages.length > 0) {
				await injectPendingMessages(pendingMessages, currentContext, newMessages, emit);
				pendingMessages = [];
			}

			// Stream assistant response
			turnsStarted++;
			const message = await streamAssistantResponse(currentContext, config, signal, emit, streamFn);
			newMessages.push(message);

			// Provider output is untrusted protocol input. Reject duplicate call IDs
			// and every other ambiguous turn before any tool can execute.
			assertEmittedTranscriptUnambiguous(currentContext.messages);

			const toolCalls = message.content.filter((c) => c.type === "toolCall");
			if (message.stopReason === "error" || message.stopReason === "aborted") {
				await closeRunOnTerminalStop(currentContext, message, toolCalls, newMessages, emit);
				return;
			}

			const toolResults: ToolResultMessage[] = [];
			let stopAfterToolBatch = false;
			hasMoreToolCalls = false;
			if (toolCalls.length > 0) {
				const batchOutcome = await runToolBatchForTurn(
					currentContext,
					message,
					toolCalls,
					config,
					signal,
					emit,
					newMessages,
					dagScheduleCache,
				);
				if (batchOutcome.kind === "ended") {
					return;
				}
				toolResults.push(...batchOutcome.toolResults);
				hasMoreToolCalls = batchOutcome.hasMoreToolCalls;
				stopAfterToolBatch = batchOutcome.stopRun;
			}

			await emit({ type: "turn_end", message, toolResults });
			if (stopAfterToolBatch) {
				await emit({ type: "agent_end", messages: newMessages });
				return;
			}
			if (maxTurns !== undefined && turnsStarted >= maxTurns) {
				await emit({ type: "agent_end", messages: newMessages });
				return;
			}

			const nextTurnContext = {
				message,
				toolResults,
				context: currentContext,
				newMessages,
			};
			const nextTurnSnapshot = await config.prepareNextTurn?.(nextTurnContext);
			if (nextTurnSnapshot) {
				const applied = applyNextTurnSnapshot(currentContext, config, nextTurnSnapshot);
				currentContext = applied.context;
				config = applied.config;
			}

			if (
				await config.shouldStopAfterTurn?.({
					message,
					toolResults,
					context: currentContext,
					newMessages,
				})
			) {
				await emit({ type: "agent_end", messages: newMessages });
				return;
			}

			pendingMessages = await drainMessageQueue(config.getSteeringMessages);
		}

		// Agent would stop here. Check for follow-up messages.
		const followUpMessages = await drainMessageQueue(config.getFollowUpMessages);
		if (followUpMessages.length > 0) {
			// Set as pending so inner loop processes them
			pendingMessages = followUpMessages;
			continue;
		}

		// No more messages, exit
		break;
	}

	await emit({ type: "agent_end", messages: newMessages });
}

async function streamAssistantResponse(
	context: AgentContext,
	config: AgentLoopConfig,
	signal: AbortSignal | undefined,
	emit: AgentEventSink,
	streamFn?: StreamFn,
): Promise<AssistantMessage> {
	// Validate the full transcript before every provider request. This fails
	// fast for `assistant(A,B) -> result(A)` and any duplicate/orphan/interleaved
	// structure that the provider would otherwise reject opaquely.
	assertValidToolTranscript(
		context.messages,
		(summary) =>
			`Refusing provider request: invalid tool transcript (${summary}). ` +
			"Append terminal tool results or repair the transcript before retrying.",
	);

	// Pin request-affecting data before asynchronous context/auth hooks can mutate caller state.
	const requestConfig = config.modelContract
		? { ...config, model: createImmutableSnapshot(config.model), headers: config.headers && { ...config.headers } }
		: config;
	// Apply context transform if configured (AgentMessage[] → AgentMessage[])
	let messages = context.messages;
	if (config.transformContext) {
		messages = await config.transformContext(messages, signal);
		assertValidToolTranscript(
			messages,
			(summary) => `Refusing provider request: transformed context has an invalid tool transcript (${summary}).`,
		);
	}

	// Convert to LLM-compatible messages (AgentMessage[] → Message[])
	const llmMessages = await config.convertToLlm(messages);

	// Build LLM context
	const llmContext: Context = {
		systemPrompt: context.systemPrompt,
		systemPromptCacheBoundary: context.systemPromptCacheBoundary,
		systemPromptCacheBoundaryBypass: context.systemPromptCacheBoundaryBypass,
		messages: llmMessages,
		tools: context.tools,
	};

	return requestAssistantResponse(llmContext, requestConfig, {
		signal,
		emit,
		streamFn,
		consume: (response) => consumeAssistantStream(response, context, emit),
	});
}

/** Commit the final assistant message to the transcript and emit its lifecycle. */
async function commitFinalAssistantMessage(
	response: AssistantMessageEventStream,
	context: AgentContext,
	addedPartial: boolean,
	emit: AgentEventSink,
): Promise<AssistantMessage> {
	const finalMessage = await response.result();
	if (addedPartial) {
		context.messages[context.messages.length - 1] = finalMessage;
	} else {
		context.messages.push(finalMessage);
		await emit({ type: "message_start", message: { ...finalMessage } });
	}
	await emit({ type: "message_end", message: finalMessage });
	return finalMessage;
}

/** Forward a partial assistant update into the transcript and event sink. */
async function forwardPartialUpdate(
	event: Extract<AssistantMessageEvent, { partial: AssistantMessage }>,
	partialMessage: AssistantMessage | null,
	context: AgentContext,
	emit: AgentEventSink,
): Promise<AssistantMessage | null> {
	if (!partialMessage) {
		return partialMessage;
	}
	const updated = event.partial;
	context.messages[context.messages.length - 1] = updated;
	await emit({
		type: "message_update",
		assistantMessageEvent: event,
		message: { ...updated },
	});
	return updated;
}

/** Consume the assistant event stream, maintaining the partial message in the transcript. */
async function consumeAssistantStream(
	response: AssistantMessageEventStream,
	context: AgentContext,
	emit: AgentEventSink,
): Promise<AssistantMessage> {
	let partialMessage: AssistantMessage | null = null;
	let addedPartial = false;

	for await (const event of response) {
		switch (event.type) {
			case "start":
				partialMessage = event.partial;
				context.messages.push(partialMessage);
				addedPartial = true;
				await emit({ type: "message_start", message: { ...partialMessage } });
				break;
			case "done":
			case "error":
				return commitFinalAssistantMessage(response, context, addedPartial, emit);
			default:
				partialMessage = await forwardPartialUpdate(event, partialMessage, context, emit);
		}
	}

	return commitFinalAssistantMessage(response, context, addedPartial, emit);
}

/**
 * Execute tool calls from an assistant message.
 */
async function executeToolCalls(
	currentContext: AgentContext,
	assistantMessage: AssistantMessage,
	config: AgentLoopConfig,
	signal: AbortSignal | undefined,
	emit: AgentEventSink,
	dagScheduleCache: DagFrontierScheduleCache,
): Promise<ExecutedToolCallBatch> {
	const toolCalls = assistantMessage.content.filter((c) => c.type === "toolCall");
	// dag-v2 is the safe default; waves-v1 remains an explicit rollback path.
	if ((config.toolScheduler ?? "dag-v2") === "dag-v2") {
		return executeToolCallsDagLevels(
			currentContext,
			assistantMessage,
			toolCalls,
			config,
			signal,
			emit,
			dagScheduleCache,
		);
	}
	const hasSequentialToolCall = toolCalls.some(
		(tc) => currentContext.tools?.find((t) => t.name === tc.name)?.executionMode === "sequential",
	);
	const toolPolicies = new Map<string, "sequential" | "parallel">();
	for (const tool of currentContext.tools ?? []) {
		if (tool.executionMode) {
			toolPolicies.set(tool.name, tool.executionMode);
		}
	}
	const batchWaves = applyConcurrencyCap(
		partitionToolBatchWaves(
			toolCalls.map((tc) => ({ name: tc.name, arguments: tc.arguments as Record<string, unknown> })),
			{
				cwd: config.cwd ?? process.cwd(),
				toolPolicies,
				allowUnknownParallel: (toolName) => toolPolicies.get(toolName) === "parallel",
			},
		),
		config.maxToolConcurrency,
	);
	if (
		config.toolExecution === "sequential" ||
		hasSequentialToolCall ||
		batchWaves.every((wave) => wave.length === 1)
	) {
		return executeToolCallsSequential(currentContext, assistantMessage, toolCalls, config, signal, emit);
	}
	if (batchWaves.length === 1) {
		return executeToolCallsParallel(currentContext, assistantMessage, toolCalls, config, signal, emit);
	}
	return executeToolCallsInWaves(currentContext, assistantMessage, toolCalls, batchWaves, config, signal, emit);
}

/**
 * Execute a partitioned tool-call batch wave by wave: waves run in source
 * order, calls inside a multi-call wave run concurrently, and solo waves run
 * sequentially. Waves are contiguous index runs, so the returned tool result
 * messages keep the model's original tool-call order. An all-terminating wave
 * skips every later call with a synthesized "skipped" result and ends the
 * run, matching the dag-v2 level-termination contract.
 */
async function executeToolCallsInWaves(
	currentContext: AgentContext,
	assistantMessage: AssistantMessage,
	toolCalls: AgentToolCall[],
	waves: number[][],
	config: AgentLoopConfig,
	signal: AbortSignal | undefined,
	emit: AgentEventSink,
): Promise<ExecutedToolCallBatch> {
	const messages: ToolResultMessage[] = [];
	let terminated = false;
	let stopRun = false;
	for (const wave of waves) {
		const waveCalls = wave.map((index) => toolCalls[index]);
		const executedWave =
			waveCalls.length === 1
				? await executeToolCallsSequential(currentContext, assistantMessage, waveCalls, config, signal, emit)
				: await executeToolCallsParallel(currentContext, assistantMessage, waveCalls, config, signal, emit);
		messages.push(...executedWave.messages);
		if (executedWave.terminate || executedWave.stopRun) {
			terminated = true;
			stopRun = executedWave.stopRun ?? false;
			const reason = stopRun
				? "Skipped because the preceding tool wave timed out before settling"
				: "Skipped because the preceding tool wave requested termination";
			const skipped = await closeUnresolvedToolBatch(currentContext, toolCalls, messages, emit, {
				reason,
				disposition: "skipped",
			});
			messages.push(...skipped);
			break;
		}
		if (signal?.aborted) break;
	}
	return { messages, terminate: terminated, stopRun };
}

/**
 * Shared scheduling state for one DAG batch: the last known claim resolution
 * per source index, calls deferred because a post-hook claim change would
 * execute them before an unsettled earlier-source conflict, and calls that
 * have reached a terminal outcome. Shared across the ready frontier so the
 * final-claims contract is enforced for the whole batch.
 */
interface DagBatchScheduleState {
	readonly resolutions: Map<number, ToolClaimResolution>;
	/**
	 * Calls deferred because their post-hook claims conflict with an unsettled
	 * or running call. The stored resolution is only used to prove that conflict
	 * — reusing it there skips an extension callback that cannot change the
	 * conservative answer — while admission always re-resolves, because dynamic
	 * resource identities may change across the wait.
	 */
	readonly deferred: Map<number, DeferredCall<PreparedToolCall>>;
	readonly settled: Set<number>;
}

/**
 * Resolve planned calls for the dependency ready frontier. Immediate outcomes
 * carry no claims; unresolvable arguments become exclusive claim barriers.
 * Barrier levels are a public compatibility schedule, not an admission input.
 */
async function schedulePlannedDagFrontier(
	plans: Array<PlannedToolCall | ImmediateToolCallOutcome>,
	toolPolicies: ReadonlyMap<string, "sequential" | "parallel">,
	boundTools: AgentTool<any>[],
	config: AgentLoopConfig,
	signal: AbortSignal | undefined,
	dagScheduleCache: DagFrontierScheduleCache,
): Promise<{
	order: number[];
	resolutions: Map<number, ToolClaimResolution>;
	/** Conflicting predecessors per source index — the precedence graph the ready queue admits from. */
	dependencies: Map<number, number[]>;
}> {
	const schedulableSourceIndices: number[] = [];
	const claimableCalls: ClaimableToolCall[] = [];
	const immediateSourceIndices: number[] = [];
	plans.forEach((plan, sourceIndex) => {
		if (plan.kind === "planned") {
			schedulableSourceIndices.push(sourceIndex);
			claimableCalls.push({ id: plan.toolCall.id, name: plan.toolCall.name, arguments: plan.args });
		} else {
			immediateSourceIndices.push(sourceIndex);
		}
	});
	const scheduled = await resolveDagFrontierMemo(
		claimableCalls,
		{
			cwd: config.cwd ?? process.cwd(),
			toolPolicies,
			registeredTools: boundTools,
			strictExtensionClaims: config.strictExtensionClaims,
			maxConcurrency: config.maxToolConcurrency,
			resourceKeyResolver: config.resourceKeyResolver,
		},
		signal,
		dagScheduleCache,
	);
	if (scheduled === null) {
		return { order: [], resolutions: new Map(), dependencies: new Map() };
	}
	const resolutions = new Map<number, ToolClaimResolution>();
	scheduled.forEach((entry, position) => {
		resolutions.set(schedulableSourceIndices[position], entry.resolution);
	});
	// Precedence graph in source-index space. Immediate plans carry no claims and
	// therefore no predecessors; they already fail before any tool executes.
	const dependencies = new Map<number, number[]>();
	for (const sourceIndex of immediateSourceIndices) dependencies.set(sourceIndex, []);
	// The public dependency graph retains every conflict edge. The live frontier
	// only needs ordering reachability, so discard transitive synchronization
	// without changing which conflicts must settle before a call can start.
	const frontierDependencies = reduceDagDependencies(assignDagDependencies(scheduled));
	frontierDependencies.forEach((blockers, position) => {
		dependencies.set(
			schedulableSourceIndices[position],
			blockers.map((blocker) => schedulableSourceIndices[blocker]),
		);
	});
	return { order: plans.map((_, sourceIndex) => sourceIndex), resolutions, dependencies };
}

/**
 * Execute a tool-call batch using the dag-v2 scheduler.
 *
 * Planned calls resolve claims in source order, while immediate failures carry
 * no claims. The dependency frontier authorizes ready calls in source order,
 * re-resolves claims from exact post-hook arguments, and starts only safe work.
 * Results remain globally buffered and are emitted in source order.
 */
async function executeToolCallsDagLevels(
	currentContext: AgentContext,
	assistantMessage: AssistantMessage,
	toolCalls: AgentToolCall[],
	config: AgentLoopConfig,
	signal: AbortSignal | undefined,
	emit: AgentEventSink,
	dagScheduleCache: DagFrontierScheduleCache,
): Promise<ExecutedToolCallBatch> {
	const plans = toolCalls.map((toolCall) => planToolCall(currentContext, toolCall));
	const boundTools = plans.flatMap((plan) => (plan.kind === "planned" ? [plan.tool] : []));
	const toolPolicies = new Map<string, "sequential" | "parallel">();
	for (const tool of boundTools) {
		const mode = config.toolExecution ?? tool.executionMode;
		if (mode && !toolPolicies.has(tool.name)) toolPolicies.set(tool.name, mode);
	}

	const schedule = await schedulePlannedDagFrontier(plans, toolPolicies, boundTools, config, signal, dagScheduleCache);
	const batchState: DagBatchScheduleState = {
		resolutions: schedule.resolutions,
		deferred: new Map(),
		settled: new Set(),
	};

	const finalizedByIndex: Array<FinalizedToolCallOutcome | undefined> = new Array(toolCalls.length).fill(undefined);
	let skippedReason: string | undefined;
	let stoppedByUnsettledTimeout = false;

	const frontier = await runDagFrontier(
		currentContext,
		assistantMessage,
		schedule.order,
		schedule.dependencies,
		toolCalls,
		plans,
		toolPolicies,
		config,
		signal,
		emit,
		batchState,
	);
	for (const outcome of frontier.outcomes) finalizedByIndex[outcome.sourceIndex] = outcome.finalized;
	if (frontier.stoppedByUnsettledTimeout) {
		skippedReason = "Skipped because a preceding DAG tool timed out before its execution promise settled";
		stoppedByUnsettledTimeout = true;
	} else if (frontier.terminated) {
		skippedReason = "Skipped because the preceding DAG level requested termination";
	}

	const messages: ToolResultMessage[] = [];
	const finalizedCalls: FinalizedToolCallOutcome[] = [];
	for (let index = 0; index < toolCalls.length; index++) {
		const finalized = finalizedByIndex[index];
		if (finalized) {
			messages.push(createToolResultMessage(finalized));
			finalizedCalls.push(finalized);
		} else if (signal?.aborted) {
			const toolCall = toolCalls[index];
			messages.push(
				createImmutableSnapshot(createSyntheticToolResult(toolCall.id, toolCall.name, "Operation aborted")),
			);
		} else if (skippedReason !== undefined) {
			const toolCall = toolCalls[index];
			messages.push(
				createImmutableSnapshot(
					createSyntheticToolResult(toolCall.id, toolCall.name, skippedReason, Date.now(), "skipped"),
				),
			);
		}
	}
	const finalizedById = indexFinalizedToolCalls(finalizedCalls);
	// Close the full source-ordered batch before result notification; calls not
	// reached by a candidate level receive no execution lifecycle.
	for (const message of messages) {
		currentContext.messages.push(message);
		try {
			await emitToolResultMessage(message, emit);
		} finally {
			finalizedById.get(message.toolCallId)?.commitTerminal?.();
		}
	}

	return {
		messages,
		terminate: skippedReason !== undefined || shouldTerminateToolBatch(finalizedCalls),
		stopRun: stoppedByUnsettledTimeout,
	};
}

type DagLevelOutcome = { sourceIndex: number; finalized: FinalizedToolCallOutcome };

// Re-resolve claims for a prepared call from its exact post-hook arguments.
// Resolution failures fail closed as an immediate error rather than guessing
// at a safe scope.
//
// The wait is bound to the run's abort signal exactly like the initial
// scheduling pass (tool-dag-memo): an extension `resourceClaims()` that never
// settles must not pin a cancelled run. Abandoning the wait does not stop the
// callback — a plain Promise cannot be killed — but the aborted outcome settles
// this call before any late value could admit it, and the frontier loop exits
// on the same signal, so a late fulfilment or rejection lands in a finished
// batch and admits nothing.
async function resolveFinalResolution(
	preparation: PreparedToolCall,
	toolPolicies: ReadonlyMap<string, "sequential" | "parallel">,
	config: AgentLoopConfig,
	signal: AbortSignal | undefined,
): Promise<ToolClaimResolution | ImmediateToolCallOutcome> {
	// awaitWithAbort short-circuits an already-aborted signal before invoking the callback.
	const call = { id: preparation.toolCall.id, name: preparation.toolCall.name, arguments: preparation.args };
	const options = {
		cwd: config.cwd ?? process.cwd(),
		toolPolicies,
		registeredTools: [preparation.tool],
		strictExtensionClaims: config.strictExtensionClaims,
		resourceKeyResolver: config.resourceKeyResolver,
	};
	try {
		const bounded = await awaitWithAbort(() => resolveToolClaimsForCall(call, options), signal);
		if (bounded.kind === "aborted" || signal?.aborted) return immediateOutcome("aborted", "Operation aborted");
		return bounded.value;
	} catch (error) {
		return immediateOutcome("failed", error instanceof Error ? error.message : String(error));
	}
}

/**
 * Execute a planned batch as a dependency ready queue.
 *
 * States are `pending -> ready -> running -> settled`. A call is admitted once
 * every call it actually conflicts with has settled, rather than once its whole
 * barrier level has, so one slow unrelated call no longer delays independent
 * work queued behind it.
 *
 * Admission — authorize, re-resolve claims from exact post-hook arguments, and
 * enforce the final-claims contract — runs one call at a time in source order.
 * That keeps hook ordering and the conflict contract identical to the barrier
 * executor and leaves the shared batch state free of concurrent mutation; only
 * tool execution overlaps. Simultaneously-ready calls are admitted by source
 * index, so admission order stays deterministic even though completion order
 * is not.
 *
 * A call whose post-hook claims newly conflict with an earlier unsettled call
 * yields its turn and is retried after the next settle, which preserves the
 * source-order conflict contract without a separate drain pass.
 */
async function runDagFrontier(
	currentContext: AgentContext,
	assistantMessage: AssistantMessage,
	order: readonly number[],
	dependencies: ReadonlyMap<number, number[]>,
	toolCalls: AgentToolCall[],
	plans: Array<PlannedToolCall | ImmediateToolCallOutcome>,
	toolPolicies: ReadonlyMap<string, "sequential" | "parallel">,
	config: AgentLoopConfig,
	signal: AbortSignal | undefined,
	emit: AgentEventSink,
	state: DagBatchScheduleState,
): Promise<{ outcomes: DagLevelOutcome[]; stoppedByUnsettledTimeout: boolean; terminated: boolean }> {
	const outcomes: DagLevelOutcome[] = [];
	const pending = [...order].sort((left, right) => left - right);
	const running = new Map<number, Promise<OwnedTaskResult<DagLevelOutcome>>>();
	const taskErrors: unknown[] = [];
	// Mirrors applyConcurrencyCap: absent, non-finite, or non-positive is unbounded.
	const cap =
		typeof config.maxToolConcurrency === "number" &&
		Number.isFinite(config.maxToolConcurrency) &&
		config.maxToolConcurrency > 0
			? Math.max(1, Math.floor(config.maxToolConcurrency))
			: Number.POSITIVE_INFINITY;
	let stoppedByUnsettledTimeout = false;
	let terminated = false;

	// Readiness bookkeeping: each pending call tracks how many of its
	// predecessors are still unsettled, and each settle decrements only its
	// successors — the per-settle cost is proportional to the out-degree of the
	// finished call, not to a full rescan of every pending dependency list.
	const remainingPredecessors = new Map<number, number>();
	const successors = new Map<number, number[]>();
	for (const sourceIndex of pending) {
		const blockers = dependencies.get(sourceIndex) ?? [];
		remainingPredecessors.set(sourceIndex, blockers.filter((blocker) => !state.settled.has(blocker)).length);
		for (const blocker of blockers) {
			const followers = successors.get(blocker);
			if (followers) followers.push(sourceIndex);
			else successors.set(blocker, [sourceIndex]);
		}
	}

	const settle = async (outcome: DagLevelOutcome): Promise<void> => {
		outcomes.push(outcome);
		state.settled.add(outcome.sourceIndex);
		for (const follower of successors.get(outcome.sourceIndex) ?? []) {
			const remaining = (remainingPredecessors.get(follower) ?? 0) - 1;
			remainingPredecessors.set(follower, Math.max(0, remaining));
		}
		if (await hasUnsettledTimeout([outcome.finalized])) stoppedByUnsettledTimeout = true;
	};

	try {
		while (!signal?.aborted && !stoppedByUnsettledTimeout && !terminated) {
			// Termination is a property of a settled group, not of one call:
			// shouldTerminateToolBatch requires every member to terminate. Evaluating it
			// only when nothing is in flight keeps the barrier executor's semantics,
			// where a call sharing a level with a non-terminating peer did not end the
			// batch. Judging a single outcome would terminate on the first terminating
			// call and strand its concurrent peers.
			if (running.size === 0 && shouldTerminateToolBatch(outcomes.map((outcome) => outcome.finalized))) {
				terminated = true;
				break;
			}
			let admitted = false;
			for (let position = 0; position < pending.length && running.size < cap; ) {
				if (signal?.aborted || stoppedByUnsettledTimeout) break;
				const sourceIndex = pending[position];
				if ((remainingPredecessors.get(sourceIndex) ?? 0) > 0) {
					position++;
					continue;
				}
				const runningSet = new Set(running.keys());
				const cached = state.deferred.get(sourceIndex);
				let preparation: PreparedToolCall;
				if (cached) {
					// A stale conflict answer only delays this call; admission below
					// re-resolves, so no tool executes from a cached scope.
					if (
						deferredStillConflicts(sourceIndex, cached.resolution, state.settled, runningSet, state.resolutions)
					) {
						position++;
						continue;
					}
					preparation = cached.preparation;
				} else {
					const plan = plans[sourceIndex];
					const preparedOutcome =
						plan.kind === "immediate"
							? plan
							: await authorizePlannedToolCall(currentContext, assistantMessage, plan, config, signal);
					if (preparedOutcome.kind === "immediate") {
						pending.splice(position, 1);
						admitted = true;
						await settle({
							sourceIndex,
							finalized: {
								toolCall: toolCalls[sourceIndex],
								result: preparedOutcome.result,
								isError: preparedOutcome.isError,
								envelope: preparedOutcome.envelope,
							},
						});
						continue;
					}
					preparation = preparedOutcome;
				}
				const resolved = await resolveFinalResolution(preparation, toolPolicies, config, signal);
				if (resolved.kind === "immediate") {
					state.deferred.delete(sourceIndex);
					pending.splice(position, 1);
					admitted = true;
					await settle({
						sourceIndex,
						finalized: {
							toolCall: preparation.toolCall,
							result: resolved.result,
							isError: resolved.isError,
							envelope: resolved.envelope,
						},
					});
					continue;
				}
				state.resolutions.set(sourceIndex, resolved);
				if (deferredStillConflicts(sourceIndex, resolved, state.settled, runningSet, state.resolutions)) {
					// Defer without losing the prepared call: a later scan retries
					// admission from this cache instead of re-invoking authorization.
					state.deferred.set(sourceIndex, { preparation, resolution: resolved });
					position++;
					continue;
				}
				state.deferred.delete(sourceIndex);
				pending.splice(position, 1);
				admitted = true;
				await emitToolExecutionStart(preparation, emit);
				running.set(
					sourceIndex,
					startDagTask(sourceIndex, async (): Promise<DagLevelOutcome> => {
						const executed = await executePreparedToolCall(preparation, config, signal, emit);
						const finalized = await finalizeExecutedToolCall({
							currentContext,
							assistantMessage,
							prepared: preparation,
							executed,
							afterToolCall: config.afterToolCall,
							signal,
						});
						await emitToolExecutionEnd(finalized, emit);
						return { sourceIndex, finalized };
					}),
				);
			}
			if (running.size === 0) {
				// Nothing is in flight: either every call settled, or the remainder is
				// blocked with nothing left that could unblock it. A pending call that
				// can never become ready still gets an explicit terminal outcome rather
				// than vanishing from the batch.
				if (!admitted) {
					for (const sourceIndex of pending.splice(0)) {
						await settle({
							sourceIndex,
							finalized: {
								toolCall: toolCalls[sourceIndex],
								result: createErrorToolResult(
									"DAG dependency deadlock: call could not become ready and nothing is running to unblock it",
								),
								isError: true,
								envelope: createToolResultEnvelope({
									disposition: "failed",
									synthetic: true,
									executionStarted: false,
									reason: "DAG dependency deadlock",
								}),
							},
						});
					}
					break;
				}
				continue;
			}
			const finished = await Promise.race([...running.values()]);
			running.delete(finished.sourceIndex);
			if (finished.status === "rejected") throw finished.reason;
			await settle(finished.value);
		}
	} catch (error) {
		taskErrors.push(error);
	} finally {
		await finishDagTasks(running, settle, taskErrors);
	}
	return { outcomes, stoppedByUnsettledTimeout, terminated };
}

type ExecutedToolCallBatch = {
	messages: ToolResultMessage[];
	terminate: boolean;
	/** End the run without another provider request after an unsettled timeout. */
	stopRun?: boolean;
};

async function executeToolCallsSequential(
	currentContext: AgentContext,
	assistantMessage: AssistantMessage,
	toolCalls: AgentToolCall[],
	config: AgentLoopConfig,
	signal: AbortSignal | undefined,
	emit: AgentEventSink,
): Promise<ExecutedToolCallBatch> {
	const finalizedCalls: FinalizedToolCallOutcome[] = [];
	const messages: ToolResultMessage[] = [];

	for (const toolCall of toolCalls) {
		const preparation = await prepareToolCall(currentContext, assistantMessage, toolCall, config, signal);
		let finalized: FinalizedToolCallOutcome;
		if (preparation.kind === "immediate") {
			finalized = {
				toolCall,
				result: preparation.result,
				isError: preparation.isError,
				envelope: preparation.envelope,
			};
		} else {
			await emitToolExecutionStart(preparation, emit);
			const executed = await executePreparedToolCall(preparation, config, signal, emit);
			finalized = await finalizeExecutedToolCall({
				currentContext,
				assistantMessage,
				prepared: preparation,
				executed,
				afterToolCall: config.afterToolCall,
				signal,
			});
		}

		const toolResultMessage = createToolResultMessage(finalized);
		currentContext.messages.push(toolResultMessage);
		if (preparation.kind === "prepared") await emitToolExecutionEnd(finalized, emit);
		try {
			await emitToolResultMessage(toolResultMessage, emit);
		} finally {
			finalized.commitTerminal?.();
		}
		finalizedCalls.push(finalized);
		messages.push(toolResultMessage);

		if (await hasUnsettledTimeout([finalized])) {
			const skipped = await closeUnresolvedToolBatch(currentContext, toolCalls, messages, emit, {
				reason: "Skipped because a preceding tool timed out before settling",
				disposition: "skipped",
			});
			messages.push(...skipped);
			return { messages, terminate: true, stopRun: true };
		}
		if (signal?.aborted) break;
	}

	return {
		messages,
		terminate: shouldTerminateToolBatch(finalizedCalls),
	};
}

async function executeToolCallsParallel(
	currentContext: AgentContext,
	assistantMessage: AssistantMessage,
	toolCalls: AgentToolCall[],
	config: AgentLoopConfig,
	signal: AbortSignal | undefined,
	emit: AgentEventSink,
): Promise<ExecutedToolCallBatch> {
	const finalizedCalls: FinalizedToolCallEntry[] = [];

	for (const toolCall of toolCalls) {
		const preparation = await prepareToolCall(currentContext, assistantMessage, toolCall, config, signal);
		if (preparation.kind === "immediate") {
			const finalized = {
				toolCall,
				result: preparation.result,
				isError: preparation.isError,
				envelope: preparation.envelope,
			} satisfies FinalizedToolCallOutcome;
			finalizedCalls.push(finalized);
			if (signal?.aborted) {
				break;
			}
			continue;
		}

		finalizedCalls.push(async () => {
			await emitToolExecutionStart(preparation, emit);
			const executed = await executePreparedToolCall(preparation, config, signal, emit);
			const finalized = await finalizeExecutedToolCall({
				currentContext,
				assistantMessage,
				prepared: preparation,
				executed,
				afterToolCall: config.afterToolCall,
				signal,
			});
			await emitToolExecutionEnd(finalized, emit);
			return finalized;
		});
		if (signal?.aborted) {
			break;
		}
	}

	const orderedFinalizedCalls = await Promise.all(
		finalizedCalls.map((entry) => (typeof entry === "function" ? entry() : Promise.resolve(entry))),
	);
	const messages: ToolResultMessage[] = [];
	for (const finalized of orderedFinalizedCalls) {
		const toolResultMessage = createToolResultMessage(finalized);
		currentContext.messages.push(toolResultMessage);
		try {
			await emitToolResultMessage(toolResultMessage, emit);
		} finally {
			finalized.commitTerminal?.();
		}
		messages.push(toolResultMessage);
	}

	const stopRun = await hasUnsettledTimeout(orderedFinalizedCalls);
	return { messages, terminate: stopRun || shouldTerminateToolBatch(orderedFinalizedCalls), stopRun };
}

type PlannedToolCall = {
	kind: "planned";
	toolCall: AgentToolCall;
	preparedToolCall: AgentToolCall;
	tool: AgentTool<any>;
	args: unknown;
};

type PreparedToolCall = {
	kind: "prepared";
	toolCall: AgentToolCall;
	tool: AgentTool<any>;
	/** Immutable scheduler/executor arguments fixed after the authorization hook. */
	args: unknown;
	/** Separate immutable public-event snapshot. */
	eventArgs: unknown;
	/** Effective per-call timeout in ms resolved by precedence; 0 disables it. */
	timeoutMs: number;
};

type ImmediateToolCallOutcome = {
	kind: "immediate";
	result: AgentToolResult<any>;
	isError: boolean;
	envelope: ToolResultEnvelope;
};

type FinalizedToolCallEntry = FinalizedToolCallOutcome | (() => Promise<FinalizedToolCallOutcome>);

function shouldTerminateToolBatch(finalizedCalls: FinalizedToolCallOutcome[]): boolean {
	return finalizedCalls.length > 0 && finalizedCalls.every((finalized) => finalized.result.terminate === true);
}

function prepareToolCallArguments(tool: AgentTool<any>, toolCall: AgentToolCall): AgentToolCall {
	if (!tool.prepareArguments) {
		return toolCall;
	}
	const preparedArguments = tool.prepareArguments(toolCall.arguments);
	if (preparedArguments === toolCall.arguments) {
		return toolCall;
	}
	return {
		...toolCall,
		arguments: preparedArguments as Record<string, any>,
	};
}

function immediateOutcome(disposition: ToolCallDisposition, reason: string): ImmediateToolCallOutcome {
	return {
		kind: "immediate",
		result: createErrorToolResult(reason),
		isError: true,
		envelope: createToolResultEnvelope({ disposition, synthetic: true, executionStarted: false, reason }),
	};
}

function planToolCall(
	currentContext: AgentContext,
	untrustedToolCall: AgentToolCall,
): PlannedToolCall | ImmediateToolCallOutcome {
	try {
		const toolCall = createImmutableJsonSnapshot(untrustedToolCall);
		if (toolCall.id.length === 0 || toolCall.name.length === 0) throw new TypeError("Invalid empty tool identity");
		const candidate = currentContext.tools?.find((tool) => tool.name === toolCall.name);
		if (!candidate) return immediateOutcome("failed", `Tool ${toolCall.name} not found`);
		const tool = bindToolIdentity(candidate, toolCall.name);
		const prepared = prepareToolCallArguments(tool, toolCall);
		const args = createImmutableJsonSnapshot(prepared.arguments);
		const preparedToolCall = createImmutableSnapshot({ ...toolCall, arguments: args });
		return { kind: "planned", toolCall, preparedToolCall, tool, args };
	} catch (error) {
		return immediateOutcome("failed", error instanceof Error ? error.message : String(error));
	}
}

async function authorizePlannedToolCall(
	currentContext: AgentContext,
	assistantMessage: AssistantMessage,
	plan: PlannedToolCall,
	config: AgentLoopConfig,
	signal: AbortSignal | undefined,
): Promise<PreparedToolCall | ImmediateToolCallOutcome> {
	try {
		const hookArgs = parseJsonValue(validateToolArguments(plan.tool, plan.preparedToolCall));
		const beforeToolCall = config.beforeToolCall;
		if (beforeToolCall) {
			const bounded = await awaitWithAbort(
				() =>
					beforeToolCall(
						{
							assistantMessage: createImmutableSnapshot(assistantMessage),
							toolCall: plan.toolCall,
							args: hookArgs,
							context: currentContext,
						},
						signal,
					),
				signal,
			);
			if (bounded.kind === "aborted" || signal?.aborted) return immediateOutcome("aborted", "Operation aborted");
			if (bounded.value?.block) {
				return immediateOutcome("blocked", bounded.value.reason || "Tool execution was blocked");
			}
		}
		if (signal?.aborted) return immediateOutcome("aborted", "Operation aborted");
		const args = createImmutableJsonSnapshot(hookArgs);
		return {
			kind: "prepared",
			toolCall: plan.toolCall,
			tool: plan.tool,
			args,
			eventArgs: createImmutableSnapshot(args),
			timeoutMs: resolveToolTimeoutMs(plan.tool, config, plan.toolCall.name),
		};
	} catch (error) {
		return immediateOutcome("failed", error instanceof Error ? error.message : String(error));
	}
}

async function prepareToolCall(
	currentContext: AgentContext,
	assistantMessage: AssistantMessage,
	toolCall: AgentToolCall,
	config: AgentLoopConfig,
	signal: AbortSignal | undefined,
): Promise<PreparedToolCall | ImmediateToolCallOutcome> {
	const plan = planToolCall(currentContext, toolCall);
	return plan.kind === "immediate"
		? plan
		: authorizePlannedToolCall(currentContext, assistantMessage, plan, config, signal);
}

async function executePreparedToolCall(
	prepared: PreparedToolCall,
	config: AgentLoopConfig,
	signal: AbortSignal | undefined,
	emit: AgentEventSink,
): Promise<ExecutedToolCallOutcome> {
	let realPromiseSettled = false;
	let commitTerminal = (): void => {};
	const terminalCommitted = new Promise<void>((resolve) => {
		commitTerminal = resolve;
	});
	const executed = await runToolCallWithTimeout({
		toolCallId: prepared.toolCall.id,
		toolName: prepared.toolCall.name,
		timeoutMs: prepared.timeoutMs,
		lateSettlement: config.toolExecutionPolicy?.lateSettlement,
		signal,
		start: async (childSignal, onUpdate) => {
			try {
				return await prepared.tool.execute(prepared.toolCall.id, prepared.args as never, childSignal, onUpdate);
			} finally {
				realPromiseSettled = true;
			}
		},
		emitUpdate: (partialResult) =>
			emit({
				type: "tool_execution_update",
				toolCallId: prepared.toolCall.id,
				toolName: prepared.toolCall.name,
				args: prepared.eventArgs,
				partialResult: createImmutableSnapshot(partialResult),
			}),
		emitLateSettlement: async (settlement) => {
			await terminalCommitted;
			await emit({
				type: "tool_execution_late_settlement",
				toolCallId: settlement.toolCallId,
				toolName: settlement.toolName,
				disposition: settlement.disposition,
				outcome: settlement.outcome,
			});
		},
		toErrorResult: (error) => createErrorToolResult(error instanceof Error ? error.message : String(error)),
	});
	return { ...executed, isRealPromiseSettled: () => realPromiseSettled, commitTerminal };
}

async function emitToolExecutionStart(prepared: PreparedToolCall, emit: AgentEventSink): Promise<void> {
	await emit({
		type: "tool_execution_start",
		toolCallId: prepared.toolCall.id,
		toolName: prepared.toolCall.name,
		args: prepared.eventArgs,
	});
}

async function emitToolExecutionEnd(finalized: FinalizedToolCallOutcome, emit: AgentEventSink): Promise<void> {
	await emit({
		type: "tool_execution_end",
		toolCallId: finalized.toolCall.id,
		toolName: finalized.toolCall.name,
		result: createImmutableSnapshot(finalized.result),
		isError: finalized.isError,
	});
}

function createToolResultMessage(finalized: FinalizedToolCallOutcome): ToolResultMessage {
	return createImmutableSnapshot({
		role: "toolResult",
		toolCallId: finalized.toolCall.id,
		toolName: finalized.toolCall.name,
		content: finalized.result.content,
		details: stampToolResultEnvelope(finalized.result.details, finalized.envelope),
		isError: finalized.isError,
		timestamp: Date.now(),
	});
}

async function emitToolResultMessage(toolResultMessage: ToolResultMessage, emit: AgentEventSink): Promise<void> {
	await emit({ type: "message_start", message: toolResultMessage });
	await emit({ type: "message_end", message: toolResultMessage });
}

/** Commit and notify one synthetic terminal for each unresolved, unstarted call. */
async function closeUnresolvedToolBatch(
	currentContext: AgentContext,
	toolCalls: AgentToolCall[],
	existingResults: ToolResultMessage[],
	emit: AgentEventSink,
	closure?: { reason: string; disposition: "aborted" | "skipped" },
): Promise<ToolResultMessage[]> {
	const resolvedIds = new Set(existingResults.map((result) => result.toolCallId));
	const synthesized: ToolResultMessage[] = [];
	for (const toolCall of toolCalls) {
		if (resolvedIds.has(toolCall.id)) continue;
		const result = createImmutableSnapshot(
			createSyntheticToolResult(
				toolCall.id,
				toolCall.name,
				closure?.reason ?? "Operation aborted",
				Date.now(),
				closure?.disposition ?? "aborted",
			),
		);
		currentContext.messages.push(result);
		await emit({ type: "message_start", message: result });
		await emit({ type: "message_end", message: result });
		synthesized.push(result);
		// Guard against a duplicated call id within the same assistant message.
		resolvedIds.add(toolCall.id);
	}
	return synthesized;
}
