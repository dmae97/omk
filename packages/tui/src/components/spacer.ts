import { nextRenderGeneration } from "../render-generation.ts";
import type { Component } from "../tui.ts";

/**
 * Spacer component that renders empty lines
 */
export class Spacer implements Component {
	private lines: number;
	private renderGeneration = 0;

	constructor(lines: number = 1) {
		this.lines = lines;
	}

	setLines(lines: number): void {
		if (lines === this.lines) return;
		this.lines = lines;
		this.renderGeneration = nextRenderGeneration();
	}

	getRenderGeneration(): number {
		return this.renderGeneration;
	}

	invalidate(): void {
		// No cached state to invalidate currently
	}

	render(_width: number): string[] {
		const result: string[] = [];
		for (let i = 0; i < this.lines; i++) {
			result.push("");
		}
		return result;
	}
}
