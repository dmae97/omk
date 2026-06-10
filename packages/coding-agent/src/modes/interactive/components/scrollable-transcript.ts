import type { Component } from "@earendil-works/omk-tui";
import { buildTranscriptViewportLines, clampScrollFromBottom, maxScrollFromBottom } from "../cockpit-scroll.ts";

export interface ScrollableTranscriptMetrics {
	lineCount: number;
	viewportHeight: number;
	maxScrollFromBottom: number;
	clampedScrollFromBottom: number;
}

export interface ScrollableTranscriptOptions {
	getScrollFromBottom: (lineCount: number, viewportHeight: number) => number;
	getViewportHeight: (width: number, totalHeight: number | undefined) => number;
	onMetrics?: (metrics: ScrollableTranscriptMetrics) => void;
}

export class ScrollableTranscriptComponent implements Component {
	private readonly source: Component;
	private readonly options: ScrollableTranscriptOptions;

	constructor(source: Component, options: ScrollableTranscriptOptions) {
		this.source = source;
		this.options = options;
	}

	invalidate(): void {
		this.source.invalidate?.();
	}

	render(width: number, height?: number): string[] {
		const sourceLines = this.source.render(width);
		const viewportHeight = Math.max(1, this.options.getViewportHeight(width, height));
		const clampedScrollFromBottom = clampScrollFromBottom(
			this.options.getScrollFromBottom(sourceLines.length, viewportHeight),
			sourceLines.length,
			viewportHeight,
		);
		this.options.onMetrics?.({
			lineCount: sourceLines.length,
			viewportHeight,
			maxScrollFromBottom: maxScrollFromBottom(sourceLines.length, viewportHeight),
			clampedScrollFromBottom,
		});
		return buildTranscriptViewportLines(sourceLines, viewportHeight, clampedScrollFromBottom);
	}
}
