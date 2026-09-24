import { OMK_WORDMARK_WIDTH } from "./control-panel-brand.ts";

/**
 * The opening's only motion: when the expanded view opens, the wordmark inks in from its pencil
 * underdrawing, top row first, and the Verify accent stamps on last. One pass, ease-out, never
 * looping. Geometry never changes: only colour does (see `renderControlPanelLayout`).
 */
export const INTRO_MS = 420;
/** Frame cadence while the ink-in runs; the timer stops once the reveal reaches 1. */
export const TICK_MS = 60;
/** Narrowest render that still draws the wordmark (its width plus the frame). */
export const MIN_MOTION_WIDTH = OMK_WORDMARK_WIDTH + 4;

export function easeOutCubic(t: number): number {
	const u = Math.min(1, Math.max(0, t));
	return 1 - (1 - u) ** 3;
}

/** Reveal progress in [0, 1] after `elapsedMs`; non-finite or negative time yields the final frame. */
export function revealAt(elapsedMs: number): number {
	if (!Number.isFinite(elapsedMs) || elapsedMs < 0 || elapsedMs >= INTRO_MS) return 1;
	return easeOutCubic(elapsedMs / INTRO_MS);
}

export interface IntroGate {
	readonly isTTY: boolean;
	readonly forceColor: boolean;
	readonly noColor: boolean;
	readonly expanded: boolean;
	readonly width: number;
	readonly reducedMotion: boolean;
	readonly headerVisible: boolean;
}

/** The ink-in plays only for a visible, colour-capable, expanded header with motion allowed. */
export function shouldAnimateIntro(gate: IntroGate): boolean {
	return (
		(gate.isTTY || gate.forceColor) &&
		!gate.noColor &&
		gate.expanded &&
		gate.width >= MIN_MOTION_WIDTH &&
		!gate.reducedMotion &&
		gate.headerVisible
	);
}
