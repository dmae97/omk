import type { AgentSession } from "../../core/agent-session.ts";
import { SubscriptionUsageReader } from "../../core/subscription-usage-reader.ts";

const readers = new WeakMap<AgentSession, SubscriptionUsageReader>();

/** One reader per live AgentSession, shared by the status rail and suggestion controller. */
export function interactiveSubscriptionUsageReader(
	session: AgentSession,
	requestRender: () => void,
): SubscriptionUsageReader {
	let reader = readers.get(session);
	if (!reader) {
		reader = new SubscriptionUsageReader(() => session, undefined, requestRender);
		readers.set(session, reader);
	}
	return reader;
}

export function disposeInteractiveSubscriptionUsage(session: AgentSession): void {
	readers.get(session)?.dispose();
	readers.delete(session);
}
