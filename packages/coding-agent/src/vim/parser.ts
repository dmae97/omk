import { VimInputError as VimError, type VimKeyToken } from "./types";

const SPECIAL_KEYS = new Map<string, string>([
	["esc", "Esc"],
	["escape", "Esc"],
	["cr", "CR"],
	["enter", "CR"],
	["return", "CR"],
	["bs", "BS"],
	["backspace", "BS"],
	["tab", "Tab"],
	["c-d", "C-d"],
	["c-u", "C-u"],
	["c-r", "C-r"],
	["c-w", "C-w"],
	["c-o", "C-o"],
]);

function normalizeSpecialKey(raw: string): string | undefined {
	return SPECIAL_KEYS.get(raw.trim().toLowerCase());
}

function toDisplayToken(value: string): string {
	return value.length === 1 ? value : `<${value}>`;
}

export function parseKeySequences(sequences: string[]): VimKeyToken[] {
	const tokens: VimKeyToken[] = [];

	for (let sequenceIndex = 0; sequenceIndex < sequences.length; sequenceIndex += 1) {
		const sequence = sequences[sequenceIndex] ?? "";
		for (let offset = 0; offset < sequence.length; offset += 1) {
			const char = sequence[offset] ?? "";
			if (char !== "<") {
				tokens.push({
					value: char,
					display: char,
					sequenceIndex,
					offset,
				});
				continue;
			}

			const close = sequence.indexOf(">", offset + 1);
			if (close === -1) {
				throw new VimError(`Unterminated special key in sequence ${sequenceIndex + 1}`, {
					value: char,
					display: char,
					sequenceIndex,
					offset,
				});
			}

			const rawSpecial = sequence.slice(offset + 1, close);
			const special = normalizeSpecialKey(rawSpecial);
			if (!special) {
				throw new VimError(`Unknown special key <${rawSpecial}> in sequence ${sequenceIndex + 1}`, {
					value: rawSpecial,
					display: `<${rawSpecial}>`,
					sequenceIndex,
					offset,
				});
			}

			tokens.push({
				value: special,
				display: `<${rawSpecial}>`,
				sequenceIndex,
				offset,
			});
			offset = close;
		}
	}

	return tokens;
}

export function tokensToReplay(tokens: readonly VimKeyToken[]): string[] {
	return tokens.map(token => token.value);
}

export function replayTokens(values: readonly string[]): VimKeyToken[] {
	return values.map((value, index) => ({
		value,
		display: toDisplayToken(value),
		sequenceIndex: 0,
		offset: index,
	}));
}

export function formatVimError(error: unknown): string {
	if (!(error instanceof VimError)) {
		return error instanceof Error ? error.message : String(error);
	}

	const base = error.message;
	if (!error.location) {
		return base;
	}

	return `${base} (sequence ${error.location.sequenceIndex + 1}, token ${error.location.offset + 1})`;
}
