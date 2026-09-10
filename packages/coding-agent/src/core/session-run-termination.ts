import type { AgentMessage } from "omk-agent-core";
import type { Api, AssistantMessage, Model } from "omk-ai";
import { providerFailureCause, terminationMessage } from "./session-failure-cause.ts";
import {
	type ClassifySessionTerminationInput,
	classifySessionTermination,
	type SessionTermination,
	type SessionTerminationCause,
} from "./session-termination.ts";

interface RunTerminationContext extends Pick<ClassifySessionTerminationInput, "sessionId" | "runId" | "timestamp"> {
	readonly model?: Pick<Model<Api>, "provider" | "id" | "contextWindow">;
	readonly elevatedRisk: boolean;
	readonly userAbortRequested: boolean;
	readonly pendingCause?: SessionTerminationCause;
	readonly toolTimeout?: {
		readonly toolCallId: string;
		readonly toolName: string;
		readonly executionStarted: boolean;
	};
}

/** Translate one settled core run into a cause; lifecycle persistence stays with AgentSession. */
export function classifyRunTermination(
	messages: readonly AgentMessage[],
	context: RunTerminationContext,
): SessionTermination {
	let assistant: AssistantMessage | undefined;
	for (let index = messages.length - 1; index >= 0; index--) {
		const candidate = messages[index];
		if (candidate?.role === "assistant") {
			assistant = candidate;
			break;
		}
	}
	let cause: SessionTerminationCause;
	let message: string;
	let sideEffects: "none" | "possible" = context.elevatedRisk ? "possible" : "none";
	let toolCallId: string | undefined;
	let toolName: string | undefined;

	if (context.toolTimeout) {
		cause = { area: "tool", code: "timeout" };
		message = `Tool ${context.toolTimeout.toolName} timed out.`;
		toolCallId = context.toolTimeout.toolCallId;
		toolName = context.toolTimeout.toolName;
		sideEffects = context.toolTimeout.executionStarted ? "possible" : sideEffects;
	} else if (context.pendingCause?.area === "configuration") {
		cause = context.pendingCause;
		message = "Model dispatch was rejected by the configured model contract.";
	} else if (!assistant) {
		cause = { area: "internal", code: "unclassified" };
		message = "Agent run ended without an assistant result.";
	} else if (assistant.stopReason === "aborted") {
		cause = context.userAbortRequested ? { area: "user", code: "abort" } : { area: "provider", code: "abort" };
		message = terminationMessage(
			assistant.errorMessage,
			context.userAbortRequested ? "The user aborted the run." : "The provider aborted the run.",
		);
	} else if (assistant.stopReason === "error") {
		cause = providerFailureCause(assistant, context.model?.contextWindow ?? 0);
		message = terminationMessage(assistant.errorMessage, "The provider request failed.");
	} else {
		cause = { area: "completed" };
		message = "Run completed.";
	}
	const provider = assistant?.provider || context.model?.provider;
	const model = assistant?.model || context.model?.id;
	return classifySessionTermination({
		sessionId: context.sessionId,
		runId: context.runId,
		timestamp: context.timestamp,
		source: "observed",
		message,
		cause,
		sideEffects,
		...(provider ? { provider } : {}),
		...(model ? { model } : {}),
		...(toolCallId ? { toolCallId } : {}),
		...(toolName ? { toolName } : {}),
	});
}
