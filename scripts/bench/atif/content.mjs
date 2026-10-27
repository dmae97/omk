/** Split/join helpers so multi-block content survives the ATIF string slots losslessly. */

export const SEP = "\n\n";

/** Join string pieces; return text plus piece lengths for exact reversal. */
export function joinPieces(pieces) {
	return { text: pieces.join(SEP), lengths: pieces.map((p) => p.length) };
}

export function splitPieces(text, lengths) {
	const out = [];
	let at = 0;
	for (const len of lengths) {
		out.push(text.slice(at, at + len));
		at += len + SEP.length;
	}
	return out;
}

export function omit(obj, keys) {
	const out = {};
	for (const [k, v] of Object.entries(obj)) if (!keys.includes(k)) out[k] = v;
	return out;
}

/**
 * Text-ish content (string | (TextContent|ImageContent)[]) -> { text, layout }.
 * layout keeps every non-text field and block, so `restoreContent` is exact.
 */
export function flattenContent(content) {
	if (typeof content === "string") return { text: content, layout: { kind: "string" } };
	if (!Array.isArray(content)) return { text: "", layout: { kind: "raw", value: content } };
	const texts = [];
	const blocks = content.map((b) => {
		if (b && b.type === "text" && typeof b.text === "string") {
			texts.push(b.text);
			return { ...omit(b, ["text"]), _text: true };
		}
		return b; // images etc. kept verbatim (Q7)
	});
	const { text, lengths } = joinPieces(texts);
	return { text, layout: { kind: "blocks", blocks, lengths } };
}

export function restoreContent(text, layout) {
	if (layout.kind === "string") return text;
	if (layout.kind === "raw") return layout.value;
	const pieces = splitPieces(text, layout.lengths);
	let i = 0;
	return layout.blocks.map((b) => {
		if (b && b._text) {
			const { _text, ...rest } = b;
			return { ...rest, text: pieces[i++] };
		}
		return b;
	});
}
