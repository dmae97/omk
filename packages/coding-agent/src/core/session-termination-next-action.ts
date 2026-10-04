import type {
	ClassifySessionTerminationInput,
	SessionTerminationCauseCode,
	SessionTerminationKind,
} from "./session-termination-types.ts";

function compactionNextAction(causeCode: SessionTerminationCauseCode, message: string): string {
	switch (causeCode) {
		case "compaction.aborted":
			return "Retry /compact if cancellation was unintended; avoid Escape while compaction is running.";
		case "compaction.stale":
			return /already compacted/i.test(message)
				? "Compaction already finished. Reduce the newest input or switch to a larger-context model; another /compact cannot shrink a single oversized message."
				: "Retry /compact after pending session changes settle.";
		case "compaction.quota_exhausted":
			return "The summarization model's quota is exhausted — retrying cannot help yet. Switch model (/model), set compaction.model in settings, or wait for the quota reset, then retry /compact. OMK already tried the failover chain automatically.";
		default:
			return /after automatic compaction/i.test(message)
				? "Automatic compaction could not bring the input under the model limit. Shorten the latest input or switch to a larger-context model."
				: "Resolve the reported compaction error, then retry /compact.";
	}
}

function configurationNextAction(message: string): string {
	if (/compaction cannot shrink/i.test(message)) {
		return "The system prompt, tool schemas and latest input alone overflow this model's input window, so compaction cannot help. Switch to a larger-context model with /model, or disable unused MCP servers.";
	}
	return /does not provide an export named/i.test(message)
		? "Provider code failed to load. Quit and restart OMK so the rebuilt adapter is imported; /new session does not reload modules."
		: "This model or client is not valid for the current login. Switch with /model or fix provider/client settings; /new session will not grant access.";
}

/** The recovery step a terminated run's owner should take next. */
export function nextActionFor(
	classification: { readonly kind: SessionTerminationKind; readonly causeCode: SessionTerminationCauseCode },
	input: ClassifySessionTerminationInput,
): string {
	switch (classification.kind) {
		case "completed":
			return "No recovery action is required; continue with the next prompt.";
		case "user_abort":
			return "Review possible partial side effects, then retry only if intended.";
		case "budget_exhausted":
			return "Review partial work and remaining requests; start a new run only with an explicitly approved budget.";
		case "resource_pressure":
			return "Host resources are constrained; reduce load or wait for recovery, then retry.";
		case "provider_abort":
			return "Confirm provider availability, then retry the request.";
		case "provider_auth":
			// A credential-less install resolves a placeholder model whose provider is
			// literally "unknown"; never echo that back as a login target.
			return `Run /login${input.provider && input.provider !== "unknown" ? ` ${input.provider}` : ""} in an interactive session, or set the provider's API key environment variable, then retry.`;
		case "provider_rate_limit":
			return "Wait for the provider retry window or choose another model, then retry.";
		case "provider_network":
			return "Check network and provider connectivity, then retry.";
		case "provider_protocol":
			return "Check request parameters and tool/message consistency in /debug before retrying. A new session does not reload provider code; restart OMK after an adapter update.";
		case "provider_refusal":
			return "Model declined this turn (content/safety stop). Usually a false positive on Fable/Claude — auto-retry once, or switch model (k3/qwen3.8-max/grok-4.5/deepseek) / rephrase as a pure coding task.";
		case "context_overflow":
			return "Compact or reduce context, or switch to a larger-context model.";
		case "tool_timeout":
			return "Inspect possible tool side effects and increase the tool timeout only if safe.";
		case "tool_fatal":
			return "Inspect the failed tool result and repair its configuration before retrying.";
		case "compaction":
			return compactionNextAction(classification.causeCode, input.message);
		case "persistence":
			return `Run omk session doctor --session ${input.sessionId} before resuming.`;
		case "process_signal":
			return "Review possible partial side effects before resuming the session.";
		case "process_crash":
			return `Run omk session doctor --session ${input.sessionId} and review partial side effects.`;
		case "transcript_invalid":
			return `Run omk session doctor --session ${input.sessionId}; do not resume until integrity passes.`;
		case "configuration":
			return configurationNextAction(input.message);
		case "internal_error":
			return `Inspect run ${input.runId} diagnostics and the run journal before retrying.`;
	}
}
