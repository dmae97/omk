import type { Token } from "marked";
import { isImageLine } from "../terminal-image.ts";
import { applyBackgroundToLine, visibleWidth, wrapTextWithAnsi } from "../utils.ts";

/** Re-lex the last N non-space top-level blocks on every append; earlier blocks are final. */
const STREAMING_TAIL_TOKENS = 2;
/** Link reference definitions change inline parsing of earlier blocks; fall back to a full lex. */
const REFERENCE_DEFINITION = /^ {0,3}\[[^\]\n]+\]:/m;

interface CachedTokenLines {
	width: number;
	nextType: string | undefined;
	lines: string[];
}

/**
 * Streaming cache for one Markdown component. While a message only grows, top-level blocks
 * before the trailing ones cannot change, so their lex result and finished lines are reused
 * instead of re-parsing and re-wrapping the whole message every frame.
 */
export class MarkdownStreamCache {
	private stableText = "";
	private stableTokens: Token[] = [];
	private tokenLines = new WeakMap<Token, CachedTokenLines>();

	reset(): void {
		this.stableText = "";
		this.stableTokens = [];
		this.tokenLines = new WeakMap();
	}

	lex(text: string, lexer: (src: string) => Token[]): Token[] {
		const canReuse =
			this.stableText.length > 0 && text.startsWith(this.stableText) && !REFERENCE_DEFINITION.test(text);
		const tokens = canReuse ? this.stableTokens.concat(lexer(text.slice(this.stableText.length))) : lexer(text);

		// Appended text can only extend or merge into the trailing blocks (lists, fences, tables, setext headings).
		let cut = tokens.length;
		let seen = 0;
		while (cut > 0 && seen < STREAMING_TAIL_TOKENS) {
			cut -= 1;
			if (tokens[cut]?.type !== "space") seen += 1;
		}
		const stable = tokens.slice(0, cut);
		let stableText = "";
		for (const token of stable) stableText += token.raw;
		// Never reuse a prefix that token raws do not reproduce exactly.
		const verified = text.startsWith(stableText);
		this.stableTokens = verified ? stable : [];
		this.stableText = verified ? stableText : "";
		return tokens;
	}

	/** Finished lines for tokens[index]; cached only for tokens in the stable prefix. */
	linesFor(
		token: Token,
		index: number,
		width: number,
		nextType: string | undefined,
		compute: () => string[],
	): string[] {
		const stable = index < this.stableTokens.length;
		const cached = stable ? this.tokenLines.get(token) : undefined;
		if (cached && cached.width === width && cached.nextType === nextType) return cached.lines;
		const lines = compute();
		if (stable) this.tokenLines.set(token, { width, nextType, lines });
		return lines;
	}
}

/** Wrap rendered token lines and apply margins plus background (pure per line). */
export function finishMarkdownLines(
	renderedLines: readonly string[],
	width: number,
	contentWidth: number,
	paddingX: number,
	bgFn: ((text: string) => string) | undefined,
): string[] {
	const margin = " ".repeat(paddingX);
	const out: string[] = [];
	for (const rendered of renderedLines) {
		if (isImageLine(rendered)) {
			out.push(rendered);
			continue;
		}
		for (const line of wrapTextWithAnsi(rendered, contentWidth)) {
			const lineWithMargins = margin + line + margin;
			if (bgFn) out.push(applyBackgroundToLine(lineWithMargins, width, bgFn));
			else out.push(lineWithMargins + " ".repeat(Math.max(0, width - visibleWidth(lineWithMargins))));
		}
	}
	return out;
}
