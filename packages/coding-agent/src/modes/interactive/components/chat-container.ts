import { type Component, isRenderSettled, WindowedContainer } from "omk-tui";
import { disposeComponent } from "../interactive-tool-result.ts";

type SettleableComponent = Component & { markRenderSettled?: () => void };

/** The slice of an agent event the transcript lifecycle needs. */
export interface ChatLifecycleEvent {
	type: string;
	message?: unknown;
}

function isAssistantMessage(message: unknown): boolean {
	return typeof message === "object" && message !== null && (message as { role?: unknown }).role === "assistant";
}

/**
 * Chat transcript container. Extends WindowedContainer so finished messages
 * above the live-line budget freeze into line segments and drop render caches.
 * interactive-mode attaches the terminal height (`setViewportRows`), so the
 * budget is max(120, 2 × rows) and follows resizes; unattached it stays 120.
 *
 * "Finished" follows spec 026 R1 event boundaries, never message data: an
 * assistant message settles at `message_end`, a tool at its final result, and
 * `agent_end` settles everything still open (e.g. a partial message whose
 * `message_end` never arrives because the provider threw mid-stream).
 */
export class ChatContainer extends WindowedContainer {
	/** Children that were unsettled when added and have not been seen settled since. */
	private readonly pending = new Set<Component>();
	/** Children settled by the agent_end backstop without changing how they render. */
	private readonly forcedSettled = new WeakSet<Component>();

	dispose(): void {
		for (const child of this.children) disposeComponent(child);
	}

	override addChild(component: Component): void {
		super.addChild(component);
		if (!isRenderSettled(component)) this.pending.add(component);
	}

	override removeChild(component: Component): void {
		this.pending.delete(component);
		super.removeChild(component);
	}

	override clear(): void {
		this.dispose();
		this.pending.clear();
		super.clear();
	}

	protected override isChildSettled(child: Component): boolean {
		return this.forcedSettled.has(child) || super.isChildSettled(child);
	}

	/** Feed every agent session event (after interactive-mode handled it). */
	handleAgentEvent(event: ChatLifecycleEvent): void {
		if (event.type === "message_end" && isAssistantMessage(event.message)) {
			for (const child of this.pending) (child as SettleableComponent).markRenderSettled?.();
			this.prunePending();
		} else if (event.type === "agent_end") {
			this.settleAll();
		} else if (event.type === "tool_execution_end") {
			this.prunePending();
		}
	}

	/** Backstop: treat every open child as finished (agent_end, end of a history rebuild). */
	settleAll(): void {
		for (const child of this.pending) {
			const settleable = child as SettleableComponent;
			if (typeof settleable.markRenderSettled === "function") settleable.markRenderSettled();
			else this.forcedSettled.add(child);
		}
		this.pending.clear();
	}

	/** Children still live by lifecycle (streaming message, running tool). */
	getLiveChildCount(): number {
		this.prunePending();
		return this.pending.size;
	}

	private prunePending(): void {
		for (const child of this.pending) {
			if (this.isChildSettled(child)) this.pending.delete(child);
		}
	}
}
