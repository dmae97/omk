import type { AgentToolResult } from "@oh-my-pi/pi-agent-core";

export interface PendingAction {
	label: string;
	sourceToolName: string;
	apply(): Promise<AgentToolResult<unknown>>;
	details?: unknown;
}

export class PendingActionStore {
	#actions: PendingAction[] = [];

	push(action: PendingAction): void {
		this.#actions.push(action);
	}

	peek(): PendingAction | null {
		return this.#actions.at(-1) ?? null;
	}

	pop(): PendingAction | null {
		return this.#actions.pop() ?? null;
	}

	clear(): void {
		this.#actions = [];
	}

	get hasPending(): boolean {
		return this.#actions.length > 0;
	}
}
