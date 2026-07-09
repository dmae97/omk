/**
 * When threshold autocompaction finishes with agent-level queued messages (steer/follow-up/custom),
 * the TUI must flush its compaction queue. It keys off compaction_end.willRetry.
 */
export function compactionEmitWillRetry(willRetry: boolean, hasQueuedAgentMessages: boolean): boolean {
	return willRetry || hasQueuedAgentMessages;
}
