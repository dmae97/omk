import { describe, expect, it } from "vitest";
import { hexTo256, rgbTo256 } from "../src/modes/interactive/theme/theme.ts";

// Re-implement the documented pre-enhancement rule so we can assert byte-identical
// output for the near-neutral regression guard.
function oldRgbTo256(r: number, g: number, b: number): number {
	const CUBE_VALUES = [0, 95, 135, 175, 215, 255];
	const GRAY_VALUES = Array.from({ length: 24 }, (_, i) => 8 + i * 10);

	function findClosestCubeIndex(value: number): number {
		let minDist = Infinity;
		let minIdx = 0;
		for (let i = 0; i < CUBE_VALUES.length; i++) {
			const dist = Math.abs(value - CUBE_VALUES[i]);
			if (dist < minDist) {
				minDist = dist;
				minIdx = i;
			}
		}
		return minIdx;
	}

	function findClosestGrayIndex(gray: number): number {
		let minDist = Infinity;
		let minIdx = 0;
		for (let i = 0; i < GRAY_VALUES.length; i++) {
			const dist = Math.abs(gray - GRAY_VALUES[i]);
			if (dist < minDist) {
				minDist = dist;
				minIdx = i;
			}
		}
		return minIdx;
	}

	function colorDistance(r1: number, g1: number, b1: number, r2: number, g2: number, b2: number): number {
		const dr = r1 - r2;
		const dg = g1 - g2;
		const db = b1 - b2;
		return dr * dr * 0.299 + dg * dg * 0.587 + db * db * 0.114;
	}

	const rIdx = findClosestCubeIndex(r);
	const gIdx = findClosestCubeIndex(g);
	const bIdx = findClosestCubeIndex(b);
	const cubeR = CUBE_VALUES[rIdx];
	const cubeG = CUBE_VALUES[gIdx];
	const cubeB = CUBE_VALUES[bIdx];
	const cubeIndex = 16 + 36 * rIdx + 6 * gIdx + bIdx;
	const cubeDist = colorDistance(r, g, b, cubeR, cubeG, cubeB);

	const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
	const grayIdx = findClosestGrayIndex(gray);
	const grayValue = GRAY_VALUES[grayIdx];
	const grayIndex = 232 + grayIdx;
	const grayDist = colorDistance(r, g, b, grayValue, grayValue, grayValue);

	const spread = Math.max(r, g, b) - Math.min(r, g, b);
	if (spread < 10 && grayDist < cubeDist) {
		return grayIndex;
	}
	return cubeIndex;
}

describe("rgbTo256 / hexTo256 256-color quantization", () => {
	it("preserves byte-identical output for spread<10 colors (neutral regression guard)", () => {
		const colors: Array<[number, number, number]> = [
			[128, 128, 128],
			[200, 196, 192],
			[240, 238, 235],
			[10, 12, 14],
			[95, 92, 90],
			[255, 250, 248],
			[180, 175, 172],
			[135, 130, 128],
		];
		for (const [r, g, b] of colors) {
			expect(rgbTo256(r, g, b)).toBe(oldRgbTo256(r, g, b));
		}
	});

	it("maps near-neutral mid-spread colors to the grayscale ramp", () => {
		expect(hexTo256("#ede7f6")).toBeGreaterThanOrEqual(232);
		expect(hexTo256("#ede7f6")).toBeLessThanOrEqual(255);
		expect(hexTo256("#d0d0e0")).toBeGreaterThanOrEqual(232);
		expect(hexTo256("#d0d0e0")).toBeLessThanOrEqual(255);
	});

	it("keeps saturated colors in the color cube", () => {
		expect(hexTo256("#ff0000")).toBeGreaterThanOrEqual(16);
		expect(hexTo256("#ff0000")).toBeLessThanOrEqual(231);
		expect(hexTo256("#00ff00")).toBeGreaterThanOrEqual(16);
		expect(hexTo256("#00ff00")).toBeLessThanOrEqual(231);
		expect(hexTo256("#0000ff")).toBeGreaterThanOrEqual(16);
		expect(hexTo256("#0000ff")).toBeLessThanOrEqual(231);
	});

	it("maps pure black and pure white correctly", () => {
		expect(rgbTo256(0, 0, 0)).toBe(16);
		expect(rgbTo256(255, 255, 255)).toBe(231);
	});
});
