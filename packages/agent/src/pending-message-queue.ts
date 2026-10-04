import type { AgentMessage, QueueMode } from "./types.ts";

export class PendingMessageQueue {
	private messages: AgentMessage[] = [];
	private head = 0;
	public mode: QueueMode;

	constructor(mode: QueueMode) {
		this.mode = mode;
	}

	enqueue(message: AgentMessage): void {
		this.messages.push(message);
	}

	hasItems(): boolean {
		return this.head < this.messages.length;
	}

	drain(): AgentMessage[] {
		if (this.mode === "all") {
			const drained = this.messages.slice(this.head);
			this.clear();
			return drained;
		}
		const first = this.messages[this.head];
		if (!first) return [];
		// Release the consumed payload immediately. Compact geometrically so a
		// continuously replenished queue bounds dead slots without quadratic copies.
		delete this.messages[this.head++];
		if (this.head === this.messages.length) {
			this.clear();
		} else if (this.head >= 1024 && this.head * 2 >= this.messages.length) {
			this.messages = this.messages.slice(this.head);
			this.head = 0;
		}
		return [first];
	}

	clear(): void {
		this.messages = [];
		this.head = 0;
	}
}
