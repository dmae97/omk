import type { AgentSession, AgentSessionEvent } from "../../core/agent-session.ts";
import { readStatusHistory, type StatusHistory } from "./status-panel-history.ts";

export type StatusPanelActivitySnapshot = StatusHistory & {
	tool?: { name: string; seconds: number; count: number };
};

/** Live tool execution belongs to this UI/session, never to a process-global TODO or another branch. */
export class StatusPanelActivity {
	private disposed = false;
	private identity = "";
	private leaf: string | null | undefined;
	private systemPrompt = "";
	private history: StatusHistory = { skills: { selected: [], loaded: [] }, checks: {} };
	private readonly tools = new Map<string, { name: string; started: number }>();
	private timer: ReturnType<typeof setInterval> | undefined;
	private readonly repaint: () => void;
	private readonly now: () => number;

	constructor(repaint: () => void, now: () => number = () => performance.now()) {
		this.repaint = repaint;
		this.now = now;
	}

	private sync(session: AgentSession): void {
		if (this.identity !== session.sessionId) {
			this.clearTools();
			this.identity = session.sessionId;
			this.leaf = undefined;
		}
	}

	observe(session: AgentSession, event: AgentSessionEvent): void {
		if (this.disposed) return;
		this.sync(session);
		if (event.type === "tool_execution_start") {
			this.tools.set(event.toolCallId, { name: event.toolName, started: this.now() });
			this.timer ??= setInterval(this.repaint, 1000).unref();
		} else if (event.type === "tool_execution_end") {
			this.tools.delete(event.toolCallId);
			if (!this.tools.size) this.clearTools();
		} else if (event.type === "agent_end" || event.type === "agent_start") this.clearTools();
	}

	read(session: AgentSession): StatusPanelActivitySnapshot {
		this.sync(session);
		const leaf = session.sessionManager.getLeafId();
		if (leaf !== this.leaf || session.systemPrompt !== this.systemPrompt) {
			const branch = session.sessionManager.getBranch();
			if (this.leaf && !branch.some((entry) => entry.id === this.leaf)) this.clearTools();
			this.history = readStatusHistory(branch, session.systemPrompt);
			this.leaf = leaf;
			this.systemPrompt = session.systemPrompt;
		}
		const first = this.tools.values().next().value;
		return {
			...this.history,
			...(first
				? {
						tool: {
							name: first.name,
							seconds: Math.max(0, Math.floor((this.now() - first.started) / 1000)),
							count: this.tools.size,
						},
					}
				: {}),
		};
	}

	private clearTools(): void {
		this.tools.clear();
		if (this.timer) clearInterval(this.timer);
		this.timer = undefined;
	}

	dispose(): void {
		this.disposed = true;
		this.clearTools();
	}
}
