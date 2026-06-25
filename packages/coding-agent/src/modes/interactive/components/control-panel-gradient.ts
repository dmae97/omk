import { rgbTo256 } from "../theme/theme.ts";

export type GradientColorMode = "truecolor" | "256color";

export interface GradientGeom {
	cols: number;
	rows: number;
	shear: number;
}

export const MIN_BANNER_WIDTH = 32;

const DEFAULT_SHEAR = 2.2;
const DRIFT = 0.12;

const RAMP_STOPS = [
	{ pos: 0, l: 0.875, c: 0.144, h: 187.2 },
	{ pos: 0.38, l: 0.835, c: 0.174, h: 156.9 },
	{ pos: 0.7, l: 0.675, c: 0.256, h: 338.4 },
	{ pos: 1, l: 0.578, c: 0.247, h: 287.9 },
] as const;

interface OklchColor {
	l: number;
	c: number;
	h: number;
}

function clamp01(value: number): number {
	if (value < 0) return 0;
	if (value > 1) return 1;
	return value;
}

function clampByte(value: number): number {
	if (!Number.isFinite(value)) return 0;
	if (value < 0) return 0;
	if (value > 255) return 255;
	return Math.round(value);
}

function lerp(start: number, end: number, amount: number): number {
	return start + (end - start) * amount;
}

function lerpHue(start: number, end: number, amount: number): number {
	let delta = end - start;
	if (delta > 180) delta -= 360;
	if (delta < -180) delta += 360;
	const hue = start + delta * amount;
	return ((hue % 360) + 360) % 360;
}

function diagonalPosition(x: number, y: number, geom: GradientGeom): number {
	const span = geom.cols - 1 + (geom.rows - 1) * geom.shear;
	if (span <= 0) return 0;
	return clamp01((x + (geom.rows - 1 - y) * geom.shear) / span);
}

function rampColor(amount: number): OklchColor {
	const u = clamp01(amount);
	for (let i = 0; i < RAMP_STOPS.length - 1; i++) {
		const current = RAMP_STOPS[i];
		const next = RAMP_STOPS[i + 1];
		if (u <= next.pos) {
			const local = (u - current.pos) / (next.pos - current.pos);
			return {
				l: lerp(current.l, next.l, local),
				c: lerp(current.c, next.c, local),
				h: lerpHue(current.h, next.h, local),
			};
		}
	}
	const last = RAMP_STOPS[RAMP_STOPS.length - 1];
	return { l: last.l, c: last.c, h: last.h };
}

function linearToSrgb(value: number): number {
	if (value <= 0) return 0;
	if (value >= 1) return 255;
	const srgb = value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055;
	return clampByte(srgb * 255);
}

function oklchToRgb({ l, c, h }: OklchColor): { r: number; g: number; b: number } {
	const hue = (h * Math.PI) / 180;
	const a = c * Math.cos(hue);
	const b = c * Math.sin(hue);
	const lPrime = l + 0.3963377774 * a + 0.2158037573 * b;
	const mPrime = l - 0.1055613458 * a - 0.0638541728 * b;
	const sPrime = l - 0.0894841775 * a - 1.291485548 * b;
	const lLinear = lPrime * lPrime * lPrime;
	const mLinear = mPrime * mPrime * mPrime;
	const sLinear = sPrime * sPrime * sPrime;

	return {
		r: linearToSrgb(4.0767416621 * lLinear - 3.3077115913 * mLinear + 0.2309699292 * sLinear),
		g: linearToSrgb(-1.2684380046 * lLinear + 2.6097574011 * mLinear - 0.3413193965 * sLinear),
		b: linearToSrgb(-0.0041960863 * lLinear - 0.7034186147 * mLinear + 1.707614701 * sLinear),
	};
}

export function colorAt(x: number, y: number, t: number, geom: GradientGeom): { r: number; g: number; b: number } {
	const base = diagonalPosition(x, y, geom);
	const shifted = clamp01(base + DRIFT * Math.sin(2 * Math.PI * t));
	return oklchToRgb(rampColor(shifted));
}

export function staticColorAt(x: number, y: number, geom: GradientGeom): { r: number; g: number; b: number } {
	return colorAt(x, y, 0, geom);
}

export function paintGlyph(
	glyph: string,
	r: number,
	g: number,
	b: number,
	mode: GradientColorMode,
	noColor: boolean,
): string {
	if (noColor || glyph === " ") {
		return glyph;
	}
	const red = clampByte(r);
	const green = clampByte(g);
	const blue = clampByte(b);
	if (mode === "truecolor") {
		return `\x1b[38;2;${red};${green};${blue}m${glyph}\x1b[39m`;
	}
	return `\x1b[38;5;${rgbTo256(red, green, blue)}m${glyph}\x1b[39m`;
}

export function renderGradientLine(
	line: string,
	y: number,
	geom: GradientGeom,
	mode: GradientColorMode,
	noColor: boolean,
): string {
	const glyphs = Array.from(line);
	let rendered = "";
	for (let x = 0; x < glyphs.length; x++) {
		const glyph = glyphs[x];
		const { r, g, b } = staticColorAt(x, y, geom);
		rendered += paintGlyph(glyph, r, g, b, mode, noColor);
	}
	return rendered;
}

export function composeStaticBanner(art: string[], mode: GradientColorMode, noColor: boolean): string[] {
	const geom: GradientGeom = {
		cols: Math.max(0, ...art.map((line) => Array.from(line).length)),
		rows: art.length,
		shear: DEFAULT_SHEAR,
	};
	return art.map((line, y) => renderGradientLine(line, y, geom, mode, noColor));
}

export function shouldGradient(options: {
	isTTY: boolean;
	noColor: boolean;
	colorMode: GradientColorMode;
	expanded: boolean;
	width: number;
}): boolean {
	const modeSupportsGradient = options.colorMode === "truecolor" || options.colorMode === "256color";
	return (
		modeSupportsGradient && options.isTTY && !options.noColor && options.expanded && options.width >= MIN_BANNER_WIDTH
	);
}
