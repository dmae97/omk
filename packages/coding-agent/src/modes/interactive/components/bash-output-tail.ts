/**
 * Rolling tail of streamed text for display: keeps the most recent `keepChars` characters, so
 * per-chunk display work stays bounded no matter how much a command prints.
 *
 * With `keepChars > maxBytes`, `truncateTail(text, { maxBytes, maxLines })` returns the same
 * result content and `truncated` flag as on the full text: once trimmed, the tail holds more than
 * `maxBytes` bytes (a character is at least one byte), so truncateTail truncates it and walks back
 * over the same trailing lines, and the partial first line can never fit. Callers use
 * `keepChars = 2 * maxBytes` for margin.
 */
export class RollingTextTail {
	private readonly keepChars: number;
	private tail = "";

	constructor(keepChars: number) {
		this.keepChars = Math.max(1, Math.floor(keepChars));
	}

	append(text: string): void {
		this.tail += text;
		// Trim only once the tail doubles, so trimming costs amortized O(1) per appended character.
		if (this.tail.length > this.keepChars * 2) {
			this.tail = this.tail.slice(this.tail.length - this.keepChars);
		}
	}

	get text(): string {
		return this.tail;
	}
}
