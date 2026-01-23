/**
 * Color manipulation utilities for hex colors.
 *
 * @example
 * ```ts
 * import { shiftHue, hexToHsv, hsvToHex } from "@oh-my-pi/pi-utils";
 *
 * // Shift green toward blue for colorblind accessibility
 * const blue = shiftHue("#4ade80", 90); // ~90° shift
 *
 * // Or work with HSV directly
 * const hsv = hexToHsv("#4ade80");
 * hsv.h = (hsv.h + 90) % 360;
 * const newHex = hsvToHex(hsv);
 * ```
 */

export interface HSV {
	/** Hue in degrees (0-360) */
	h: number;
	/** Saturation (0-1) */
	s: number;
	/** Value/brightness (0-1) */
	v: number;
}

export interface RGB {
	/** Red (0-255) */
	r: number;
	/** Green (0-255) */
	g: number;
	/** Blue (0-255) */
	b: number;
}

/**
 * Parse a hex color string to RGB.
 * Supports #RGB, #RRGGBB formats.
 */
export function hexToRgb(hex: string): RGB {
	const h = hex.startsWith("#") ? hex.slice(1) : hex;
	if (h.length === 3) {
		return {
			r: parseInt(h[0] + h[0], 16),
			g: parseInt(h[1] + h[1], 16),
			b: parseInt(h[2] + h[2], 16),
		};
	}
	return {
		r: parseInt(h.slice(0, 2), 16),
		g: parseInt(h.slice(2, 4), 16),
		b: parseInt(h.slice(4, 6), 16),
	};
}

/**
 * Convert RGB to hex color string.
 */
export function rgbToHex(rgb: RGB): string {
	const toHex = (n: number) =>
		Math.max(0, Math.min(255, Math.round(n)))
			.toString(16)
			.padStart(2, "0");
	return `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}`;
}

/**
 * Convert RGB to HSV.
 */
export function rgbToHsv(rgb: RGB): HSV {
	const r = rgb.r / 255;
	const g = rgb.g / 255;
	const b = rgb.b / 255;

	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const d = max - min;

	let h = 0;
	if (d !== 0) {
		if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
		else if (max === g) h = ((b - r) / d + 2) / 6;
		else h = ((r - g) / d + 4) / 6;
	}

	return {
		h: h * 360,
		s: max === 0 ? 0 : d / max,
		v: max,
	};
}

/**
 * Convert HSV to RGB.
 */
export function hsvToRgb(hsv: HSV): RGB {
	const { s, v } = hsv;
	const h = ((hsv.h % 360) + 360) % 360; // Normalize to 0-360

	const i = Math.floor(h / 60);
	const f = h / 60 - i;
	const p = v * (1 - s);
	const q = v * (1 - f * s);
	const t = v * (1 - (1 - f) * s);

	let r: number, g: number, b: number;
	switch (i % 6) {
		case 0:
			r = v;
			g = t;
			b = p;
			break;
		case 1:
			r = q;
			g = v;
			b = p;
			break;
		case 2:
			r = p;
			g = v;
			b = t;
			break;
		case 3:
			r = p;
			g = q;
			b = v;
			break;
		case 4:
			r = t;
			g = p;
			b = v;
			break;
		default:
			r = v;
			g = p;
			b = q;
			break;
	}

	return {
		r: Math.round(r * 255),
		g: Math.round(g * 255),
		b: Math.round(b * 255),
	};
}

/**
 * Convert hex color to HSV.
 */
export function hexToHsv(hex: string): HSV {
	return rgbToHsv(hexToRgb(hex));
}

/**
 * Convert HSV to hex color.
 */
export function hsvToHex(hsv: HSV): string {
	return rgbToHex(hsvToRgb(hsv));
}

/**
 * Shift the hue of a hex color by a given number of degrees.
 *
 * @param hex - Hex color string (#RGB or #RRGGBB)
 * @param degrees - Degrees to shift (positive = toward blue, negative = toward red)
 * @returns New hex color string
 *
 * @example
 * ```ts
 * // Shift green 90° toward blue (for colorblind accessibility)
 * shiftHue("#4ade80", 90) // Returns a cyan/blue color
 * ```
 */
export function shiftHue(hex: string, degrees: number): string {
	const hsv = hexToHsv(hex);
	hsv.h = (hsv.h + degrees) % 360;
	if (hsv.h < 0) hsv.h += 360;
	return hsvToHex(hsv);
}

export interface HSVAdjustment {
	/** Hue shift in degrees (additive) */
	h?: number;
	/** Saturation multiplier */
	s?: number;
	/** Value/brightness multiplier */
	v?: number;
}

/**
 * Adjust HSV components of a hex color.
 *
 * @param hex - Hex color string (#RGB or #RRGGBB)
 * @param adj - Adjustments: h is additive degrees, s and v are multipliers
 * @returns New hex color string
 *
 * @example
 * ```ts
 * // Shift hue +60°, reduce saturation to 71%
 * adjustHsv("#00ff88", { h: 60, s: 0.71 }) // "#4a9eff"
 * ```
 */
export function adjustHsv(hex: string, adj: HSVAdjustment): string {
	const hsv = hexToHsv(hex);
	if (adj.h !== undefined) {
		hsv.h = (hsv.h + adj.h) % 360;
		if (hsv.h < 0) hsv.h += 360;
	}
	if (adj.s !== undefined) {
		hsv.s = Math.max(0, Math.min(1, hsv.s * adj.s));
	}
	if (adj.v !== undefined) {
		hsv.v = Math.max(0, Math.min(1, hsv.v * adj.v));
	}
	return hsvToHex(hsv);
}
