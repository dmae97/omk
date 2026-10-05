import type {
	ContextBudgetTokenConfidence,
	ContextBudgetTokenCountMethod,
	TokenCounterAdapter,
	TokenCountResult,
} from "./context-budget-token-counter-types.ts";

/**
 * Fallback token estimator. `estimateTextTokensFromParts` returns exactly what
 * `estimateTextTokens(parts.join(""))` would, without building the joined text:
 * admission counts the whole transcript every turn, and the joined copy was a
 * history-sized large-object allocation per count.
 */

const CODE_KEYWORD = /\b(function|const|let|class|interface|import|export|return|async|await)\b/;

/** Count `parts.join("")`; adapters with `countTextParts` never build the joined text. */
export function countTextParts(
	counter: TokenCounterAdapter,
	parts: readonly string[],
	modelId: string,
): TokenCountResult {
	return counter.countTextParts ? counter.countTextParts(parts, modelId) : counter.countText(parts.join(""), modelId);
}

interface CharClassCounts {
	asciiWord: number;
	whitespace: number;
	cjk: number;
	hangul: number;
	kana: number;
	emojiOrWide: number;
	punctuation: number;
	other: number;
}

function emptyCounts(): CharClassCounts {
	return { asciiWord: 0, whitespace: 0, cjk: 0, hangul: 0, kana: 0, emojiOrWide: 0, punctuation: 0, other: 0 };
}

// Index scan over UTF-16 code units, pairing surrogates exactly like `for...of`.
// A per-code-point string plus a `/\s/u` test allocated ~50 bytes per input char.
function countCharClasses(input: string, counts: CharClassCounts): void {
	for (let index = 0; index < input.length; index++) {
		let codePoint = input.charCodeAt(index);
		if (codePoint >= 0xd800 && codePoint <= 0xdbff && index + 1 < input.length) {
			const low = input.charCodeAt(index + 1);
			if (low >= 0xdc00 && low <= 0xdfff) {
				codePoint = (codePoint - 0xd800) * 0x400 + (low - 0xdc00) + 0x10000;
				index++;
			}
		}
		if (isUnicodeWhitespace(codePoint)) {
			counts.whitespace += 1;
		} else if (isHangul(codePoint)) {
			counts.hangul += 1;
		} else if (isHiraganaOrKatakana(codePoint)) {
			counts.kana += 1;
		} else if (isCjkIdeograph(codePoint)) {
			counts.cjk += 1;
		} else if (isAsciiAlphaNumeric(codePoint) || codePoint === 0x5f) {
			counts.asciiWord += 1;
		} else if (isEmojiOrWideSymbol(codePoint)) {
			counts.emojiOrWide += 1;
		} else if (isAsciiPunctuation(codePoint)) {
			counts.punctuation += 1;
		} else {
			counts.other += 1;
		}
	}
}

export function estimateTextTokens(input: string, modelId = "unknown"): TokenCountResult {
	if (input.length === 0) return emptyInputResult(modelId);
	const counts = emptyCounts();
	countCharClasses(input, counts);
	return finishEstimate(counts, input.length, CODE_KEYWORD.test(input), looksJsonLike(input), modelId);
}

/** Same result as `estimateTextTokens(parts.join(""), modelId)`. */
export function estimateTextTokensFromParts(parts: readonly string[], modelId = "unknown"): TokenCountResult {
	if (!hasNeutralJoints(parts)) return estimateTextTokens(parts.join(""), modelId);
	const counts = emptyCounts();
	let length = 0;
	let keyword = false;
	for (const part of parts) {
		length += part.length;
		countCharClasses(part, counts);
		// Neutral joints keep every `\b...\b` match inside one part with the same boundaries.
		if (!keyword) keyword = CODE_KEYWORD.test(part);
	}
	if (length === 0) return emptyInputResult(modelId);
	return finishEstimate(counts, length, keyword, partsLookJsonLike(parts), modelId);
}

/**
 * True when no joint between non-empty parts sits next to a regex word char or
 * splits a surrogate pair, so per-part scanning equals scanning the joined text.
 */
function hasNeutralJoints(parts: readonly string[]): boolean {
	let previous = "";
	for (const part of parts) {
		if (part.length === 0) continue;
		if (previous.length > 0) {
			const left = previous.charCodeAt(previous.length - 1);
			const right = part.charCodeAt(0);
			if (isRegexWordUnit(left) || isRegexWordUnit(right)) return false;
			if (left >= 0xd800 && left <= 0xdbff && right >= 0xdc00 && right <= 0xdfff) return false;
		}
		previous = part;
	}
	return true;
}

function isRegexWordUnit(code: number): boolean {
	return isAsciiAlphaNumeric(code) || code === 0x5f;
}

/** `looksJsonLike(parts.join(""))`: first and last code units outside `trim()` whitespace. */
function partsLookJsonLike(parts: readonly string[]): boolean {
	let first = "";
	for (let p = 0; p < parts.length && first === ""; p++) {
		const part = parts[p];
		for (let i = 0; i < part.length; i++) {
			if (!isUnicodeWhitespace(part.charCodeAt(i))) {
				first = part[i];
				break;
			}
		}
	}
	let last = "";
	for (let p = parts.length - 1; p >= 0 && last === ""; p--) {
		const part = parts[p];
		for (let i = part.length - 1; i >= 0; i--) {
			if (!isUnicodeWhitespace(part.charCodeAt(i))) {
				last = part[i];
				break;
			}
		}
	}
	return (first === "{" && last === "}") || (first === "[" && last === "]");
}

function emptyInputResult(modelId: string): TokenCountResult {
	return createTokenResult(0, "estimated", "medium", "fallback-estimator", modelId, ["empty-input"]);
}

function finishEstimate(
	counts: CharClassCounts,
	length: number,
	hasCodeKeyword: boolean,
	jsonLike: boolean,
	modelId: string,
): TokenCountResult {
	const { asciiWord, whitespace, cjk, hangul, kana, emojiOrWide, punctuation, other } = counts;
	const codeLike = hasCodeKeyword || (punctuation > length / 8 && whitespace > length / 20);
	const nonAsciiRatio = (hangul + cjk + kana + emojiOrWide + other) / Math.max(1, length);
	const base =
		asciiWord / (codeLike ? 3.2 : 4) +
		whitespace / 12 +
		punctuation / 2.1 +
		hangul / 0.95 +
		kana / 1.0 +
		cjk / 1.2 +
		emojiOrWide * 1.8 +
		other / 2;
	const adjusted = base * (jsonLike ? 1.12 : 1) * (codeLike ? 1.08 : 1);
	const tokens = Math.max(1, Math.ceil(adjusted));
	const compositionParts: string[] = [];
	if (hangul > 0) compositionParts.push(`hangul:${hangul}`);
	if (kana > 0) compositionParts.push(`kana:${kana}`);
	if (cjk > 0) compositionParts.push(`cjk:${cjk}`);
	if (asciiWord > 0) compositionParts.push(`ascii:${asciiWord}`);
	if (emojiOrWide > 0) compositionParts.push(`emoji:${emojiOrWide}`);
	const notes = [
		codeLike ? "code-like" : "prose-like",
		jsonLike ? "json-like" : "not-json-like",
		nonAsciiRatio > 0 ? `non-ascii:${(nonAsciiRatio * 100).toFixed(0)}%` : "latin-only",
		`composition(${compositionParts.join(",")})`,
	];
	const confidence: ContextBudgetTokenConfidence =
		nonAsciiRatio > 0.4 ? "low" : nonAsciiRatio > 0.15 ? "medium" : "high";
	return createTokenResult(tokens, "estimated", confidence, "fallback-estimator", modelId, notes);
}

function createTokenResult(
	tokens: number,
	method: ContextBudgetTokenCountMethod,
	confidence: ContextBudgetTokenConfidence,
	adapterId: string,
	modelId: string,
	notes: readonly string[],
): TokenCountResult {
	if (!Number.isFinite(tokens)) throw new TypeError("Tokenizer returned a non-finite token count");
	return {
		tokens: Math.max(0, Math.ceil(tokens)),
		method,
		confidence,
		adapterId,
		modelId,
		notes,
	};
}

/** Exactly the code points `/\s/u` matches: ECMAScript WhiteSpace and LineTerminator. */
function isUnicodeWhitespace(codePoint: number): boolean {
	if (codePoint <= 0x20) return codePoint === 0x20 || (codePoint >= 0x09 && codePoint <= 0x0d);
	if (codePoint < 0xa0) return false;
	return (
		codePoint === 0xa0 ||
		codePoint === 0x1680 ||
		(codePoint >= 0x2000 && codePoint <= 0x200a) ||
		codePoint === 0x2028 ||
		codePoint === 0x2029 ||
		codePoint === 0x202f ||
		codePoint === 0x205f ||
		codePoint === 0x3000 ||
		codePoint === 0xfeff
	);
}

function isAsciiAlphaNumeric(codePoint: number): boolean {
	return (
		(codePoint >= 48 && codePoint <= 57) ||
		(codePoint >= 65 && codePoint <= 90) ||
		(codePoint >= 97 && codePoint <= 122)
	);
}

function isAsciiPunctuation(codePoint: number): boolean {
	return codePoint >= 33 && codePoint <= 126;
}

function isHangul(codePoint: number): boolean {
	// Composed syllables (가-힣)
	if (codePoint >= 0xac00 && codePoint <= 0xd7af) return true;
	// Jamo: initial (ㄱ-ㅎ), medial (ㅏ-ㅣ)
	if (codePoint >= 0x1100 && codePoint <= 0x11ff) return true;
	// Compatibility jamo (ㄱ-ㅎ, ㅏ-ㅣ) and Hangul letters
	if (codePoint >= 0x3130 && codePoint <= 0x318f) return true;
	// Extended jamo
	if (codePoint >= 0xa960 && codePoint <= 0xa97c) return true;
	return false;
}

function isHiraganaOrKatakana(codePoint: number): boolean {
	// Hiragana (ぁ-より)
	if (codePoint >= 0x3040 && codePoint <= 0x309f) return true;
	// Katakana (ァ-ヿ) + halfwidth katakana
	if (codePoint >= 0x30a0 && codePoint <= 0x30ff) return true;
	if (codePoint >= 0xff65 && codePoint <= 0xff9f) return true;
	return false;
}

function isCjkIdeograph(codePoint: number): boolean {
	// CJK Unified Ideographs (main block: 中, 国, etc.)
	if (codePoint >= 0x4e00 && codePoint <= 0x9fff) return true;
	// CJK Extension A (rare)
	if (codePoint >= 0x3400 && codePoint <= 0x4dbf) return true;
	// CJK compatibility ideographs
	if (codePoint >= 0xf900 && codePoint <= 0xfaff) return true;
	return false;
}

function isEmojiOrWideSymbol(codePoint: number): boolean {
	// Main emoji blocks
	if (codePoint >= 0x1f000) return true;
	// Misc symbols, dingbats
	if (codePoint >= 0x2600 && codePoint <= 0x27bf) return true;
	// CJK fullwidth/special forms that occupy double width
	if (codePoint >= 0xff01 && codePoint <= 0xff60) return true;
	if (codePoint >= 0xffe0 && codePoint <= 0xffe6) return true;
	return false;
}

function looksJsonLike(input: string): boolean {
	const trimmed = input.trim();
	return (trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"));
}
