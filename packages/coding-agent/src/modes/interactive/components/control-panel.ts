import type { Component } from "omk-tui";
import {
	type ControlPanelContent,
	type ControlPanelHeaderKey,
	type ControlPanelStatusSnapshot,
	renderControlPanelLayout,
	renderControlPanelRightPane,
} from "./control-panel-layout.ts";
import { INTRO_MS, revealAt, shouldAnimateIntro, TICK_MS } from "./control-panel-motion.ts";

export type { ControlPanelContent, ControlPanelHeaderKey, ControlPanelStatusSnapshot } from "./control-panel-layout.ts";

export interface ControlPanelMotionOptions {
	requestRender: () => void;
	isTTY: () => boolean;
	isReducedMotion: () => boolean;
	isHeaderVisibleHint: () => boolean;
	getRenderWidth?: () => number;
	now?: () => number;
}

/** RUN labels that mean a turn (or compaction) is in progress. */
const TURN_LABELS: ReadonlySet<string> = new Set(["running", "compacting", "retrying"]);

function isTurnInProgress(snapshot: ControlPanelStatusSnapshot): boolean {
	const label = snapshot.controlPlane?.run.label;
	return label !== undefined && TURN_LABELS.has(label);
}

/**
 * The startup header. It sits at the top of the transcript and scrolls into immutable terminal
 * scrollback, where any change to its rows forces a full repaint and re-emits the transcript
 * into scrollback. So the header reads the live status snapshot only until the first turn
 * starts, then freezes on the last pre-turn snapshot and stops rebuilding it: RUN, VERIFY,
 * ctx/meter and TODO keep the values they had before the first prompt. The status sidebar and
 * the control-pane overlay show the live values.
 *
 * The frozen snapshot is re-captured when the content's `headerKey` changes: a new model or
 * thinking level (/model, model cycling) re-reads the snapshot, and a new session (/new, /resume,
 * /fork) goes back to the live header until that session's first turn starts.
 */
export class ControlPanelComponent implements Component {
	private expanded = false;
	private readonly content: ControlPanelContent;
	private readonly motionOptions: ControlPanelMotionOptions | undefined;
	/** Start of the running ink-in; undefined when the panel is static. */
	private introStartMs: number | undefined;
	private motionTimerId: ReturnType<typeof setInterval> | undefined;
	private lastRenderWidth = 0;
	private preTurnSnapshot: ControlPanelStatusSnapshot | undefined;
	private frozenContent: ControlPanelContent | undefined;
	private renderCache: { key: string; lines: string[] } | undefined;
	private lastHeaderKey: ControlPanelHeaderKey | undefined;

	constructor(content: ControlPanelContent, motionOptions?: ControlPanelMotionOptions) {
		this.content = content;
		this.motionOptions = motionOptions;
	}

	setExpanded(expanded: boolean): void {
		const wasExpanded = this.expanded;
		this.expanded = expanded;
		if (!wasExpanded && expanded) {
			this.startIntro();
		} else if (wasExpanded && !expanded) {
			this.stopMotion();
		}
	}

	invalidate(): void {
		this.renderCache = undefined;
	}

	dispose(): void {
		if (this.motionTimerId !== undefined) {
			clearInterval(this.motionTimerId);
			this.motionTimerId = undefined;
		}
		this.introStartMs = undefined;
	}

	/** Ends the ink-in early and repaints the final frame. */
	stopMotion(): void {
		const hadTimer = this.motionTimerId !== undefined;
		this.dispose();
		if (hadTimer) {
			this.motionOptions?.requestRender();
		}
	}

	render(width: number): string[] {
		this.lastRenderWidth = width;
		const reveal = this.currentReveal();
		const plain = this.shouldRenderPlain();
		this.syncHeaderKey();
		const content = this.headerContent();
		// Once frozen the header's inputs only change with width, expansion, the intro reveal or a
		// theme change (invalidate), so reuse the rendered lines instead of re-laying out every frame.
		const key = `${width}|${this.expanded}|${reveal}|${plain}`;
		if (content === this.frozenContent && this.renderCache?.key === key) return this.renderCache.lines;
		const layout = renderControlPanelLayout(content, this.expanded, width, reveal);
		const lines = plain ? layout.map(stripAnsi) : layout;
		this.renderCache = content === this.frozenContent ? { key, lines } : undefined;
		return lines;
	}

	/**
	 * Re-captures the header's status snapshot. With `newSession` (/new, /resume) the header goes
	 * back to live until the session's first turn starts; otherwise (/model) a frozen header takes
	 * the current snapshot, or only its model rows while a turn is running.
	 */
	refreshHeaderSnapshot(options: { newSession?: boolean } = {}): void {
		this.renderCache = undefined;
		this.preTurnSnapshot = undefined;
		const frozen = this.frozenContent?.statusSnapshot?.();
		const read = this.content.statusSnapshot;
		if (options.newSession || frozen === undefined || read === undefined) {
			this.frozenContent = undefined;
			return;
		}
		const live = read();
		const { modelProvider, modelId, thinkingLevel } = live;
		const snapshot = isTurnInProgress(live) ? { ...frozen, modelProvider, modelId, thinkingLevel } : live;
		this.frozenContent = { ...this.content, statusSnapshot: () => snapshot };
	}

	/** Refreshes the header when its model/thinking or session key changes since the last render. */
	private syncHeaderKey(): void {
		const key = this.content.headerKey?.();
		const last = this.lastHeaderKey;
		this.lastHeaderKey = key;
		if (key === undefined || last === undefined) return;
		if (key.session !== last.session) this.refreshHeaderSnapshot({ newSession: true });
		else if (key.model !== last.model) this.refreshHeaderSnapshot();
	}

	/** Content with the header's status snapshot: live before the first turn, frozen after. */
	private headerContent(): ControlPanelContent {
		if (this.frozenContent !== undefined) return this.frozenContent;
		const read = this.content.statusSnapshot;
		if (read === undefined) return this.content;
		const snapshot = read();
		if (!isTurnInProgress(snapshot)) {
			this.preTurnSnapshot = snapshot;
			return { ...this.content, statusSnapshot: () => snapshot };
		}
		const frozen = this.preTurnSnapshot ?? snapshot;
		this.preTurnSnapshot = undefined;
		this.frozenContent = { ...this.content, statusSnapshot: () => frozen };
		return this.frozenContent;
	}

	private now(): number {
		return (this.motionOptions?.now ?? Date.now)();
	}

	private currentReveal(): number {
		return this.introStartMs === undefined ? 1 : revealAt(this.now() - this.introStartMs);
	}

	private startIntro(): void {
		const opts = this.motionOptions;
		if (!opts || this.motionTimerId !== undefined || !this.canAnimate()) return;
		this.introStartMs = this.now();
		this.motionTimerId = setInterval(() => this.tick(), TICK_MS);
		if (typeof this.motionTimerId === "object" && "unref" in this.motionTimerId) {
			this.motionTimerId.unref();
		}
		opts.requestRender();
	}

	private tick(): void {
		const done = this.introStartMs === undefined || this.now() - this.introStartMs >= INTRO_MS;
		if (done || !this.canAnimate()) {
			this.stopMotion();
			return;
		}
		this.motionOptions?.requestRender();
	}

	private shouldRenderPlain(): boolean {
		if (process.env.NO_COLOR !== undefined) return true;
		const opts = this.motionOptions;
		if (!opts) return false;
		return !opts.isTTY() && process.env.FORCE_COLOR === undefined;
	}

	private canAnimate(): boolean {
		const opts = this.motionOptions;
		if (!opts) return false;
		const width = opts.getRenderWidth?.() ?? this.lastRenderWidth;
		return shouldAnimateIntro({
			isTTY: opts.isTTY(),
			forceColor: process.env.FORCE_COLOR !== undefined,
			noColor: this.shouldRenderPlain(),
			expanded: this.expanded,
			// Before the first render the width is unknown; assume the deck width so the intro can start.
			width: width > 0 ? width : Number.POSITIVE_INFINITY,
			reducedMotion: opts.isReducedMotion() || process.env.OMK_REDUCED_MOTION !== undefined,
			headerVisible: opts.isHeaderVisibleHint(),
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
