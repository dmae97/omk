import type { Component } from "omk-tui";
import { theme } from "../theme/theme.ts";
import { composeStaticBanner, MIN_BANNER_WIDTH } from "./control-panel-gradient.ts";
import {
	composeIdleBanner,
	composeIntroBanner,
	IDLE_MS,
	INTRO_MS,
	shouldAnimate,
} from "./control-panel-gradient-motion.ts";
import {
	CONTROL_PANEL_ASCII_ART,
	type ControlPanelContent,
	renderControlPanelLayout,
	renderControlPanelRightPane,
} from "./control-panel-layout.ts";

export type { ControlPanelContent, ControlPanelStatusSnapshot } from "./control-panel-layout.ts";

export interface ControlPanelMotionOptions {
	requestRender: () => void;
	isTTY: () => boolean;
	isReducedMotion: () => boolean;
	isIdleDriftEnabled: () => boolean;
	isHeaderVisibleHint: () => boolean;
	getRenderWidth?: () => number;
	now?: () => number;
}

type BannerMotionPhase = "intro" | "idle" | "static";

export class ControlPanelComponent implements Component {
	private expanded = false;
	private readonly content: ControlPanelContent;
	private readonly motionOptions: ControlPanelMotionOptions | undefined;
	private motionPhase: BannerMotionPhase = "static";
	private motionStartMs = 0;
	private motionTimerId: ReturnType<typeof setInterval> | undefined;
	private lastRenderWidth = 0;

	constructor(content: ControlPanelContent, motionOptions?: ControlPanelMotionOptions) {
		this.content = content;
		this.motionOptions = motionOptions;
	}

	setExpanded(expanded: boolean): void {
		const wasExpanded = this.expanded;
		this.expanded = expanded;
		if (!wasExpanded && expanded) {
			this.startMotion();
		} else if (wasExpanded && !expanded) {
			this.stopMotionToStatic();
		}
	}

	invalidate(): void {}

	dispose(): void {
		if (this.motionTimerId !== undefined) {
			clearInterval(this.motionTimerId);
			this.motionTimerId = undefined;
		}
		this.motionPhase = "static";
		this.motionStartMs = 0;
	}

	stopMotion(): void {
		const hadTimer = this.motionTimerId !== undefined;
		this.dispose();
		if (hadTimer) {
			this.motionOptions?.requestRender();
		}
	}

	render(width: number): string[] {
		this.lastRenderWidth = width;
		const lines = renderControlPanelLayout(
			this.content,
			this.expanded,
			width,
			this.currentBannerFrame(),
			this.currentSparkleMs(),
		);
		return this.shouldRenderPlainBanner() ? lines.map(stripAnsi) : lines;
	}

	private currentSparkleMs(): number {
		const opts = this.motionOptions;
		if (!opts || this.motionPhase === "static") return 0;
		return Math.max(0, (opts.now ?? Date.now)() - this.motionStartMs);
	}

	private currentMotionWidth(): number {
		const width = this.motionOptions?.getRenderWidth?.() ?? this.lastRenderWidth;
		return width > 0 ? width : MIN_BANNER_WIDTH;
	}

	private startMotion(): void {
		const opts = this.motionOptions;
		if (!opts || this.motionTimerId !== undefined || !this.canAnimate("intro")) return;

		this.motionPhase = "intro";
		this.motionStartMs = (opts.now ?? Date.now)();
		this.motionTimerId = setInterval(() => this.tick(), 100);
		if (this.motionTimerId && typeof this.motionTimerId === "object" && "unref" in this.motionTimerId) {
			this.motionTimerId.unref();
		}
		opts.requestRender();
	}

	private currentBannerFrame(): string[] | undefined {
		const opts = this.motionOptions;
		if (!opts) return undefined;
		const mode = theme.getColorMode();
		const noColor = this.shouldRenderPlainBanner();
		if (this.motionPhase === "static") {
			return this.expanded ? composeStaticBanner(CONTROL_PANEL_ASCII_ART, mode, noColor) : undefined;
		}
		const elapsedMs = Math.max(0, (opts.now ?? Date.now)() - this.motionStartMs);
		if (this.motionPhase === "idle") {
			return composeIdleBanner(CONTROL_PANEL_ASCII_ART, mode, noColor, elapsedMs);
		}
		return composeIntroBanner(CONTROL_PANEL_ASCII_ART, mode, noColor, elapsedMs);
	}

	private shouldRenderPlainBanner(): boolean {
		const opts = this.motionOptions;
		if (process.env.NO_COLOR !== undefined) return true;
		if (!opts) return false;
		return !opts.isTTY() && process.env.FORCE_COLOR === undefined;
	}

	private tick(): void {
		const opts = this.motionOptions;
		if (!opts || !this.canAnimate(this.motionPhase === "idle" ? "idle" : "intro")) {
			this.stopMotionToStatic();
			return;
		}

		const now = (opts.now ?? Date.now)();
		if (this.motionPhase === "intro" && now - this.motionStartMs >= INTRO_MS) {
			if (!opts.isIdleDriftEnabled()) {
				this.stopMotionToStatic();
				return;
			}
			this.motionPhase = "idle";
			this.motionStartMs = now;
		}
		if (this.motionPhase === "idle" && now - this.motionStartMs >= IDLE_MS) {
			this.stopMotionToStatic();
			return;
		}
		opts.requestRender();
	}

	private stopMotionToStatic(): void {
		const hadTimer = this.motionTimerId !== undefined;
		this.dispose();
		if (hadTimer) {
			this.motionOptions?.requestRender();
		}
	}

	private canAnimate(phase: "intro" | "idle"): boolean {
		const opts = this.motionOptions;
		if (!opts) return false;
		return shouldAnimate({
			phase,
			isTTY: opts.isTTY(),
			noColor: this.shouldRenderPlainBanner(),
			colorMode: theme.getColorMode(),
			expanded: this.expanded,
			width: this.currentMotionWidth(),
			reducedMotion: opts.isReducedMotion() || process.env.OMK_REDUCED_MOTION !== undefined,
			busy: false,
			headerVisibleHint: opts.isHeaderVisibleHint(),
			idleDriftEnabled: opts.isIdleDriftEnabled(),
		});
	}
}

export class ControlPanelRightPaneComponent implements Component {
	private readonly content: ControlPanelContent;

	constructor(content: ControlPanelContent) {
		this.content = content;
	}

	invalidate(): void {}

	render(width: number): string[] {
		return renderControlPanelRightPane(this.content, width);
	}
}

const ANSI_ESCAPE_RE = /\x1b\[[0-?]*[ -/]*[@-~]/g;

function stripAnsi(value: string): string {
	return value.replace(ANSI_ESCAPE_RE, "");
}
