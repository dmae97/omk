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
 *
 * A row reuses the previous frame's output when its raw text equals the previous
 * raw row at the same index, or at the same distance from the end. The second
 * candidate covers a block of rows inserted or removed above (an off-screen
 * message growing by a line shifts every row below it), so one early change no
 * longer re-normalizes the whole transcript. Output depends only on the raw
 * text, so reuse on equal text is always exact. Unchanged component caches
 * usually compare by reference, keeping the renderer's diff on the cheap path.
 */
export class LineResetMemo {
	private raw: string[] = [];
	private out: string[] = [];
	/** Per-row Kitty IDs, or null when no row of the frame carries any (the common case). */
	private ids: (readonly number[])[] | null = null;
	/** Raw buffer from two frames ago, refilled instead of reallocated. */
	private spareRaw: string[] = [];
	/** Kitty image IDs present in the most recent `apply` result. */
	kittyImageIds = new Set<number>();

	/** Normalizes `lines` in place (image lines untouched) and returns it. */
	apply(lines: string[]): string[] {
		const count = lines.length;
		const raw = this.spareRaw;
		raw.length = count;
		const previousRaw = this.raw;
		const previousOut = this.out;
		const previousIds = this.ids;
		const previousLength = previousRaw.length;
		const shift = previousLength - count;
		let ids: (readonly number[])[] | null = null;
		for (let i = 0; i < count; i++) {
			const line = lines[i];
			raw[i] = line;
			let from = -1;
			if (i < previousLength && previousRaw[i] === line) {
				from = i;
			} else if (shift !== 0) {
				const aligned = i + shift;
				if (aligned >= 0 && aligned < previousLength && previousRaw[aligned] === line) from = aligned;
			}
			let rowIds: readonly number[];
			if (from !== -1) {
				lines[i] = previousOut[from];
				if (previousIds === null) continue;
				rowIds = previousIds[from];
			} else {
				const output = isImageLine(line) ? line : normalizeTerminalOutput(line) + SEGMENT_RESET;
				lines[i] = output;
				rowIds = extractKittyImageIds(output);
			}
			if (rowIds.length > 0) {
				ids ??= new Array<readonly number[]>(count).fill(NO_IDS);
				ids[i] = rowIds;
			}
		}
		const kittyImageIds = new Set<number>();
		if (ids !== null) {
			for (const rowIds of ids) for (const id of rowIds) kittyImageIds.add(id);
		}
		this.spareRaw = previousRaw;
		this.raw = raw;
		this.out = lines;
		this.ids = ids;
		this.kittyImageIds = kittyImageIds;
		return lines;
	}
}
