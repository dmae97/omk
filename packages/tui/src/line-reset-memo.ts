import { isImageLine } from "./terminal-image.ts";
import { normalizeTerminalOutput } from "./utils.ts";

/** Reset SGR and close any open OSC 8 hyperlink at segment boundaries. */
export const SEGMENT_RESET = "\x1b[0m\x1b]8;;\x07";

const KITTY_SEQUENCE_PREFIX = "\x1b_G";
const NO_IDS: readonly number[] = [];

export function extractKittyImageIds(line: string): readonly number[] {
	const sequenceStart = line.indexOf(KITTY_SEQUENCE_PREFIX);
	if (sequenceStart === -1) return NO_IDS;

	const paramsStart = sequenceStart + KITTY_SEQUENCE_PREFIX.length;
	const paramsEnd = line.indexOf(";", paramsStart);
	if (paramsEnd === -1) return NO_IDS;

	const params = line.slice(paramsStart, paramsEnd);
	for (const param of params.split(",")) {
		const [key, value] = param.split("=", 2);
		if (key !== "i" || value === undefined) continue;
		const id = Number(value);
		if (Number.isInteger(id) && id > 0 && id <= 0xffffffff) {
			return [id];
		}
	}
	return NO_IDS;
}

/**
 * Per-row memo for line resets (normalization + SEGMENT_RESET) and Kitty image IDs.
 * Rows whose raw text equals the previous frame's raw text at the same index reuse
 * the previous output string and IDs. Unchanged component caches usually compare by
 * reference, so the renderer's diff stays on the cheap reference-equality path.
 */
export class LineResetMemo {
	private raw: string[] = [];
	private out: string[] = [];
	private ids: (readonly number[])[] = [];
	/** Kitty image IDs present in the most recent `apply` result. */
	kittyImageIds = new Set<number>();

	/** Normalizes `lines` in place (image lines untouched) and returns it. */
	apply(lines: string[]): string[] {
		const raw = lines.slice();
		const ids: (readonly number[])[] = new Array(lines.length);
		const kittyImageIds = new Set<number>();
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			if (i < this.raw.length && this.raw[i] === line) {
				lines[i] = this.out[i];
				ids[i] = this.ids[i];
			} else {
				const output = isImageLine(line) ? line : normalizeTerminalOutput(line) + SEGMENT_RESET;
				lines[i] = output;
				ids[i] = extractKittyImageIds(output);
			}
			for (const id of ids[i]) kittyImageIds.add(id);
		}
		this.raw = raw;
		this.out = lines;
		this.ids = ids;
		this.kittyImageIds = kittyImageIds;
		return lines;
	}
}
