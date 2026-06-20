export interface BoundedDigestOptions {
	/** Hard ceiling on output character length. */
	maxChars: number;
	/** Fraction of retained content reserved for the beginning of the stream. */
	headRatio?: number;
	/** Separator inserted between pushed segments. */
	separator?: string;
	/** Marker inserted between retained head and tail when content is omitted. */
	marker?: string;
}

export interface BoundedDigestResult {
	text: string;
	truncated: boolean;
	originalChars: number;
	keptChars: number;
}

export const DEFAULT_SESSION_DIGEST_MAX_CHARS = 16_000;
export const DEFAULT_SESSION_FIRST_MESSAGE_MAX_CHARS = 2_000;
export const DEFAULT_DIGEST_HEAD_RATIO = 0.6;
export const DEFAULT_DIGEST_MARKER = " …[omk-digest:truncated]… ";
const FIRST_MESSAGE_TRUNCATION_MARKER = " …[omk-first-message:truncated]";

interface NormalizedDigestOptions {
	maxChars: number;
	headRatio: number;
	headBudget: number;
	tailBudget: number;
	separator: string;
	marker: string;
}

function fitTruncationMarker(marker: string, maxChars: number): string {
	if (maxChars <= 0) return "";
	if (marker.length < maxChars) return marker;
	return maxChars >= 3 ? "…" : "";
}

function normalizeDigestOptions(options: BoundedDigestOptions): NormalizedDigestOptions {
	const maxChars = Number.isFinite(options.maxChars) ? Math.max(0, Math.floor(options.maxChars)) : 0;
	const ratioValue = options.headRatio ?? DEFAULT_DIGEST_HEAD_RATIO;
	const headRatio = Number.isFinite(ratioValue) ? Math.min(1, Math.max(0, ratioValue)) : DEFAULT_DIGEST_HEAD_RATIO;
	const separator = options.separator ?? " ";
	const marker = fitTruncationMarker(options.marker ?? DEFAULT_DIGEST_MARKER, maxChars);
	const headBudget = Math.floor(maxChars * headRatio);
	const tailBudget = Math.max(0, maxChars - headBudget);
	return { maxChars, headRatio, headBudget, tailBudget, separator, marker };
}

export class BoundedDigestAccumulator {
	private readonly options: NormalizedDigestOptions;
	private head = "";
	private tail = "";
	private originalChars = 0;
	private wroteAny = false;
	private overflowed = false;

	constructor(options: BoundedDigestOptions) {
		this.options = normalizeDigestOptions(options);
	}

	push(segment: string): void {
		if (segment.length === 0 || this.options.maxChars <= 0) {
			return;
		}

		const piece = this.wroteAny ? `${this.options.separator}${segment}` : segment;
		this.wroteAny = true;
		this.originalChars += piece.length;
		this.appendToHead(piece);
	}

	result(): BoundedDigestResult {
		if (!this.overflowed) {
			const text = this.head + this.tail;
			return { text, truncated: false, originalChars: this.originalChars, keptChars: text.length };
		}

		const contentBudget = Math.max(0, this.options.maxChars - this.options.marker.length);
		const headBudget = Math.floor(contentBudget * this.options.headRatio);
		const tailBudget = Math.max(0, contentBudget - headBudget);
		const text = `${this.head.slice(0, headBudget)}${this.options.marker}${this.tail.slice(
			Math.max(0, this.tail.length - tailBudget),
		)}`;
		return { text, truncated: true, originalChars: this.originalChars, keptChars: text.length };
	}

	private appendToHead(piece: string): void {
		const headRemaining = this.options.headBudget - this.head.length;
		if (headRemaining > 0) {
			const headPiece = piece.slice(0, headRemaining);
			this.head += headPiece;
			const rest = piece.slice(headPiece.length);
			if (rest.length > 0) {
				this.appendToTail(rest);
			}
			return;
		}

		this.appendToTail(piece);
	}

	private appendToTail(piece: string): void {
		if (this.options.tailBudget <= 0) {
			this.overflowed = true;
			return;
		}

		this.tail += piece;
		if (this.tail.length > this.options.tailBudget) {
			this.tail = this.tail.slice(this.tail.length - this.options.tailBudget);
			this.overflowed = true;
		}
	}
}

export function buildBoundedDigest(segments: readonly string[], options: BoundedDigestOptions): BoundedDigestResult {
	const accumulator = new BoundedDigestAccumulator(options);
	for (const segment of segments) {
		accumulator.push(segment);
	}
	return accumulator.result();
}

export function boundConversationTextForSummary(text: string, maxChars: number): string {
	if (!Number.isFinite(maxChars) || maxChars <= 0 || text.length <= maxChars) {
		return text;
	}
	return buildBoundedDigest([text], { maxChars, headRatio: 0.5 }).text;
}

export function boundSessionFirstMessage(
	text: string,
	maxChars: number = DEFAULT_SESSION_FIRST_MESSAGE_MAX_CHARS,
): string {
	if (!Number.isFinite(maxChars) || maxChars <= 0) return "";
	if (text.length <= maxChars) return text;
	const marker = fitTruncationMarker(FIRST_MESSAGE_TRUNCATION_MARKER, maxChars);
	const contentBudget = Math.max(0, maxChars - marker.length);
	return `${text.slice(0, contentBudget)}${marker}`;
}
