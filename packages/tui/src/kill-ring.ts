/**
 * Ring buffer for Emacs-style kill/yank operations.
 *
 * Tracks killed (deleted) text entries. Consecutive kills can accumulate
 * into a single entry. Supports yank (paste most recent) and yank-pop
 * (cycle through older entries).
 * Retention is bounded by entry count and UTF-16 code units. A single newest
 * entry may exceed the character budget so the last kill can still be yanked.
 */
export const KILL_RING_MAX_ENTRIES = 128;
export const KILL_RING_MAX_CODE_UNITS = 2 * 1024 * 1024;

export class KillRing {
	private ring: string[] = [];
	private codeUnits = 0;

	/**
	 * Add text to the kill ring.
	 *
	 * @param text - The killed text to add
	 * @param opts - Push options
	 * @param opts.prepend - If accumulating, prepend (backward deletion) or append (forward deletion)
	 * @param opts.accumulate - Merge with the most recent entry instead of creating a new one
	 */
	push(text: string, opts: { prepend: boolean; accumulate?: boolean }): void {
		if (!text) return;

		if (opts.accumulate && this.ring.length > 0) {
			const last = this.ring.pop()!;
			this.codeUnits -= last.length;
			text = opts.prepend ? text + last : last + text;
			this.ring.push(text);
		} else {
			this.ring.push(text);
		}
		this.codeUnits += text.length;
		while (
			this.ring.length > 1 &&
			(this.ring.length > KILL_RING_MAX_ENTRIES || this.codeUnits > KILL_RING_MAX_CODE_UNITS)
		) {
			this.codeUnits -= this.ring.shift()!.length;
		}
	}

	/** Get most recent entry without modifying the ring. */
	peek(): string | undefined {
		return this.ring.length > 0 ? this.ring[this.ring.length - 1] : undefined;
	}

	/** Move last entry to front (for yank-pop cycling). */
	rotate(): void {
		if (this.ring.length > 1) {
			const last = this.ring.pop()!;
			this.ring.unshift(last);
		}
	}

	get length(): number {
		return this.ring.length;
	}
}
