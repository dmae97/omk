import { colorAt, type GradientColorMode, type GradientGeom, shouldGradient } from "./control-panel-gradient.ts";

export const INTRO_MS = 900;
export const IDLE_MS = 6000;
const IDLE_PERIOD_MS = 4200;
const REVEAL_BAND = 0.16;
const DEFAULT_SHEAR = 2.2;

function clamp01(value: number): number {
	if (value < 0) return 0;
	if (value > 1) return 1;
	return value;
}

function easeOutCubic(t: number): number {
	const u = clamp01(t);
	return 1 - (1 - u) * (1 - u) * (1 - u);
}

function diagonalPosition(x: number, y: number, geom: GradientGeom): number {
	const span = geom.cols - 1 + (geom.rows - 1) * geom.shear;
	if (span <= 0) return 0;
	return clamp01((x + (geom.rows - 1 - y) * geom.shear) / span);
}

const SCRAMBLE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789@#$%&*+=<>[]{}|/\\~^";
const SCRAMBLE_LEN = SCRAMBLE_CHARS.length;

function scrambleGlyph(x: number, y: number, seed: number): string {
	// Deterministic scramble from position + seed (no Math.random)
	const hash = ((x * 374761393 + y * 668265263 + seed * 1274126177) >>> 0) % SCRAMBLE_LEN;
	return SCRAMBLE_CHARS[hash]!;
}

function dimRgb(r: number, g: number, b: number, factor: number): { r: number; g: number; b: number } {
	return {
		r: Math.round(r * factor),
		g: Math.round(g * factor),
		b: Math.round(b * factor),
	};
}

function paintGlyph(glyph: string, r: number, g: number, b: number, mode: GradientColorMode, noColor: boolean): string {
	if (noColor || glyph === " ") {
		return glyph;
	}
	const red = Math.max(0, Math.min(255, Math.round(r)));
	const green = Math.max(0, Math.min(255, Math.round(g)));
	const blue = Math.max(0, Math.min(255, Math.round(b)));
	if (mode === "truecolor") {
		return `\x1b[38;2;${red};${green};${blue}m${glyph}\x1b[39m`;
	}
	// 256color fallback
	const ri = Math.round((red / 255) * 5);
	const gi = Math.round((green / 255) * 5);
	const bi = Math.round((blue / 255) * 5);
	const index = 16 + 36 * ri + 6 * gi + bi;
	return `\x1b[38;5;${index}m${glyph}\x1b[39m`;
}

/**
 * Phase 2: one-shot intro reveal. Diagonal wipe using easeOutCubic.
 * At elapsed >= INTRO_MS the output is byte-identical to composeStaticBanner.
 */
export function composeIntroBanner(
	art: string[],
	mode: GradientColorMode,
	noColor: boolean,
	elapsedMs: number,
): string[] {
	// Final frame → delegate to static for exact match
	if (elapsedMs >= INTRO_MS) {
		const staticLines: string[] = [];
		const geom: GradientGeom = {
			cols: Math.max(0, ...art.map((line) => Array.from(line).length)),
			rows: art.length,
			shear: DEFAULT_SHEAR,
		};
		for (let y = 0; y < art.length; y++) {
			const glyphs = Array.from(art[y]!);
			let rendered = "";
			for (let x = 0; x < glyphs.length; x++) {
				const glyph = glyphs[x]!;
				const { r, g, b } = colorAt(x, y, 0, geom);
				rendered += paintGlyph(glyph, r, g, b, mode, noColor);
			}
			staticLines.push(rendered);
		}
		return staticLines;
	}

	const geom: GradientGeom = {
		cols: Math.max(0, ...art.map((line) => Array.from(line).length)),
		rows: art.length,
		shear: DEFAULT_SHEAR,
	};

	const p = easeOutCubic(elapsedMs / INTRO_MS);
	const seed = Math.floor(elapsedMs / 100); // changes every 100ms tick

	return art.map((line, y) => {
		const glyphs = Array.from(line);
		let rendered = "";
		for (let x = 0; x < glyphs.length; x++) {
			const glyph = glyphs[x]!;
			if (glyph === " ") {
				rendered += " ";
				continue;
			}
			const d = diagonalPosition(x, y, geom);
			const cell = clamp01((p - d + REVEAL_BAND) / REVEAL_BAND);
			const { r, g, b } = colorAt(x, y, 0, geom);
			if (cell >= 1) {
				rendered += paintGlyph(glyph, r, g, b, mode, noColor);
			} else {
				// Scramble with dimmed color
				const scramble = scrambleGlyph(x, y, seed);
				const dimFactor = 0.3 + 0.7 * cell;
				const { r: dr, g: dg, b: db } = dimRgb(r, g, b, dimFactor);
				rendered += paintGlyph(scramble, dr, dg, db, mode, noColor);
			}
		}
		return rendered;
	});
}

/**
 * Phase 3: opt-in idle drift. Reuses colorAt(x,y,t) DRIFT math.
 */
export function composeIdleBanner(
	art: string[],
	mode: GradientColorMode,
	noColor: boolean,
	elapsedMs: number,
): string[] {
	const geom: GradientGeom = {
		cols: Math.max(0, ...art.map((line) => Array.from(line).length)),
		rows: art.length,
		shear: DEFAULT_SHEAR,
	};

	const t = (elapsedMs % IDLE_PERIOD_MS) / IDLE_PERIOD_MS;

	return art.map((line, y) => {
		const glyphs = Array.from(line);
		let rendered = "";
		for (let x = 0; x < glyphs.length; x++) {
			const glyph = glyphs[x]!;
			const { r, g, b } = colorAt(x, y, t, geom);
			rendered += paintGlyph(glyph, r, g, b, mode, noColor);
		}
		return rendered;
	});
}

/**
 * Gate: should we animate the banner for this phase?
 */
export function shouldAnimate(options: {
	phase: "intro" | "idle";
	isTTY: boolean;
	noColor: boolean;
	colorMode: GradientColorMode;
	expanded: boolean;
	width: number;
	reducedMotion: boolean;
	busy: boolean;
	headerVisibleHint: boolean;
	idleDriftEnabled: boolean;
}): boolean {
	if (!shouldGradient(options)) return false;
	if (options.reducedMotion || options.busy || !options.headerVisibleHint) return false;
	if (options.phase === "idle" && !options.idleDriftEnabled) return false;
	return true;
}
