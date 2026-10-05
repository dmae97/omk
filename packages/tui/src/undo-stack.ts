/** Default number of snapshots kept: each one is a full clone of the editor state. */
export const DEFAULT_UNDO_LIMIT = 200;

/**
 * Generic undo stack with clone-on-push semantics.
 *
 * Stores deep clones of state snapshots. Popped snapshots are returned
 * directly (no re-cloning) since they are already detached. Keeps at most
 * `limit` snapshots; pushing past the limit drops the oldest, so a long draft
 * retains O(limit x draft size) instead of O(edits x draft size).
 */
export class UndoStack<S> {
	private stack: S[] = [];
	private readonly limit: number;

	constructor(limit: number = DEFAULT_UNDO_LIMIT) {
		this.limit = Math.max(1, Math.floor(limit));
	}

	/** Push a deep clone of the given state onto the stack, dropping the oldest past the limit. */
	push(state: S): void {
		if (this.stack.length >= this.limit) this.stack.shift();
		this.stack.push(structuredClone(state));
	}

	/** Pop and return the most recent snapshot, or undefined if empty. */
	pop(): S | undefined {
		return this.stack.pop();
	}

	/** Remove all snapshots. */
	clear(): void {
		this.stack.length = 0;
	}

	get length(): number {
		return this.stack.length;
	}
}
