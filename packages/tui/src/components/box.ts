import type { Component } from "../tui.ts";
import { applyBackgroundToLine, visibleWidth } from "../utils.ts";

type RenderCache = {
	/** Shallow copies of each child's rendered lines (guards against in-place mutation). */
	childOutputs: string[][];
	width: number;
	bgSample: string | undefined;
	lines: string[];
};

/**
 * Box component - a container that applies padding and background to all children
 */
export class Box implements Component {
	children: Component[] = [];
	private paddingX: number;
	private paddingY: number;
	private bgFn?: (text: string) => string;

	// Cache for rendered output
	private cache?: RenderCache;

	constructor(paddingX = 1, paddingY = 1, bgFn?: (text: string) => string) {
		this.paddingX = paddingX;
		this.paddingY = paddingY;
		this.bgFn = bgFn;
	}

	addChild(component: Component): void {
		this.children.push(component);
		this.invalidateCache();
	}

	removeChild(component: Component): void {
		const index = this.children.indexOf(component);
		if (index !== -1) {
			this.children.splice(index, 1);
			this.invalidateCache();
		}
	}

	clear(): void {
		this.children = [];
		this.invalidateCache();
	}

	setBgFn(bgFn?: (text: string) => string): void {
		this.bgFn = bgFn;
		// Don't invalidate here - we'll detect bgFn changes by sampling output
	}

	private invalidateCache(): void {
		this.cache = undefined;
	}

	private matchCache(width: number, childOutputs: string[][], bgSample: string | undefined): boolean {
		const cache = this.cache;
		if (!cache || cache.width !== width || cache.bgSample !== bgSample) return false;
		if (cache.childOutputs.length !== childOutputs.length) return false;
		for (let c = 0; c < childOutputs.length; c++) {
			const previous = cache.childOutputs[c];
			const current = childOutputs[c];
			if (previous.length !== current.length) return false;
			for (let i = 0; i < current.length; i++) {
				if (previous[i] !== current[i]) return false;
			}
		}
		return true;
	}

	invalidate(): void {
		this.invalidateCache();
		for (const child of this.children) {
			child.invalidate?.();
		}
	}

	render(width: number): string[] {
		if (this.children.length === 0) {
			return [];
		}

		const contentWidth = Math.max(1, width - this.paddingX * 2);
		const leftPad = " ".repeat(this.paddingX);

		// Render all children. Compare their raw output with the cached copy before
		// building padded lines: children return cached arrays, so an unchanged Box costs
		// reference comparisons instead of re-concatenating and re-comparing every line.
		const childOutputs: string[][] = [];
		let lineCount = 0;
		for (const child of this.children) {
			const lines = child.render(contentWidth);
			childOutputs.push(lines);
			lineCount += lines.length;
		}

		if (lineCount === 0) {
			return [];
		}

		// Check if bgFn output changed by sampling
		const bgSample = this.bgFn ? this.bgFn("test") : undefined;

		// Check cache validity
		if (this.matchCache(width, childOutputs, bgSample)) {
			return this.cache!.lines;
		}

		const childLines: string[] = [];
		for (const lines of childOutputs) {
			for (const line of lines) {
				childLines.push(leftPad + line);
			}
		}

		// Apply background and padding
		const result: string[] = [];

		// Top padding
		for (let i = 0; i < this.paddingY; i++) {
			result.push(this.applyBg("", width));
		}

		// Content
		for (const line of childLines) {
			result.push(this.applyBg(line, width));
		}

		// Bottom padding
		for (let i = 0; i < this.paddingY; i++) {
			result.push(this.applyBg("", width));
		}

		// Update cache
		this.cache = { childOutputs: childOutputs.map((lines) => lines.slice()), width, bgSample, lines: result };

		return result;
	}

	private applyBg(line: string, width: number): string {
		const visLen = visibleWidth(line);
		const padNeeded = Math.max(0, width - visLen);
		const padded = line + " ".repeat(padNeeded);

		if (this.bgFn) {
			return applyBackgroundToLine(padded, width, this.bgFn);
		}
		return padded;
	}
}
