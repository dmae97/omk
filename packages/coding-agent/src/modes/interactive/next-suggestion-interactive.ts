import type { AgentSession } from "../../core/agent-session.ts";
import { suggestionAcceptTracker } from "../../core/next-suggestion-accept-trace.ts";
import * as settlement from "../../core/next-suggestion-settlement.ts";
import type { SubscriptionUsageReader } from "../../core/subscription-usage-reader.ts";
import {
	disposeInteractiveSubscriptionUsage,
	interactiveSubscriptionUsageReader,
} from "./interactive-subscription-usage.ts";
import {
	disposeNextSuggestions,
	installNextSuggestions,
	type NextSuggestionController,
} from "./next-suggestion-controller.ts";
import { activeQuotaUsage } from "./next-suggestion-run.ts";
import { type ActiveEditor, followActiveEditor } from "./suggestion-active-editor.ts";

let activeInteractiveSession: AgentSession | undefined;

/** Install the session-scoped interactive editor and usage-reader adapters. */
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
	return installNextSuggestions(session, editor, basePlaceholder, {
		requestRender,
		quotaUsage: () => activeQuotaUsage(session, reader),
		settle: settlement.suggestionMetricsSettler(() => session.sessionId, session.sessionManager.getCwd()),
		acceptTrace: suggestionAcceptTracker(() => session.sessionId, session.sessionManager.getCwd()),
	});
}

/** Release the active suggestion controller and shared UI notifications at TUI shutdown. */
export function disposeInteractiveNextSuggestions(): void {
	disposeNextSuggestions();
	if (activeInteractiveSession) {
		disposeInteractiveSubscriptionUsage(activeInteractiveSession);
		activeInteractiveSession = undefined;
	}
}
