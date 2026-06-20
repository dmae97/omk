import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
	ControlPanelComponent,
	type ControlPanelContent,
	type ControlPanelMotionOptions,
} from "../src/modes/interactive/components/control-panel.ts";
import {
	composeStaticBanner,
	type GradientColorMode,
} from "../src/modes/interactive/components/control-panel-gradient.ts";
import {
	composeIdleBanner,
	composeIntroBanner,
	IDLE_MS,
	INTRO_MS,
	shouldAnimate,
} from "../src/modes/interactive/components/control-panel-gradient-motion.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

initTheme("dark");

function makeContent(): ControlPanelContent {
	return {
		appName: "omk",
		version: "0.0.0",
		compactInstructions: () => "",
		expandedInstructions: () => "",
		compactOnboarding: () => "",
		onboarding: () => "",
	};
}

function makeMotionOptions(
	clock: { value: number },
	over?: Partial<ControlPanelMotionOptions>,
): ControlPanelMotionOptions {
	return {
		requestRender: vi.fn(),
		isTTY: () => true,
		isReducedMotion: () => false,
		isIdleDriftEnabled: () => false,
		isHeaderVisibleHint: () => true,
		now: () => clock.value,
		...over,
	};
}

const ESC_RE = /\x1b\[[0-?]*[ -/]*[@-~]/g;
const TEST_ART = ["  ____   __  __ _  __", " / __ \\ /  |/  / |/ /", "/ /_/ // /|_/ /    < ", "\\____//_/  /_/_/|_| "];

function stripAnsi(value: string): string {
	return value.replace(ESC_RE, "");
}

function visibleWidth(value: string): number {
	return stripAnsi(value).length;
}

function escapeCount(value: string, needle: string): number {
	return value.split(needle).length - 1;
}

describe("composeIntroBanner — deterministic frames", () => {
	const mode: GradientColorMode = "truecolor";

	test("elapsed 0 produces deterministic scrambled output", () => {
		const frame1 = composeIntroBanner(TEST_ART, mode, false, 0);
		const frame2 = composeIntroBanner(TEST_ART, mode, false, 0);
		expect(frame1).toEqual(frame2);
		expect(frame1).toHaveLength(TEST_ART.length);
	});

	test("elapsed 450 produces deterministic output", () => {
		const frame1 = composeIntroBanner(TEST_ART, mode, false, 450);
		const frame2 = composeIntroBanner(TEST_ART, mode, false, 450);
		expect(frame1).toEqual(frame2);
		expect(frame1).toHaveLength(TEST_ART.length);
	});

	test("elapsed 900 (INTRO_MS) matches composeStaticBanner exactly", () => {
		const introFinal = composeIntroBanner(TEST_ART, mode, false, INTRO_MS);
		const staticFrame = composeStaticBanner(TEST_ART, mode, false);
		for (let i = 0; i < TEST_ART.length; i++) {
			expect(stripAnsi(introFinal[i])).toBe(stripAnsi(staticFrame[i]));
		}
	});

	test("elapsed >= INTRO_MS all produce static output", () => {
		const introOver = composeIntroBanner(TEST_ART, mode, false, INTRO_MS + 100);
		const staticFrame = composeStaticBanner(TEST_ART, mode, false);
		for (let i = 0; i < TEST_ART.length; i++) {
			expect(stripAnsi(introOver[i])).toBe(stripAnsi(staticFrame[i]));
		}
	});

	test("NO_COLOR produces plain text with no ANSI escapes", () => {
		const frame = composeIntroBanner(TEST_ART, mode, true, 450);
		const joined = frame.join("\n");
		expect(stripAnsi(joined)).toBe(joined);
	});

	test("spaces remain spaces in scrambled frames", () => {
		const frame = composeIntroBanner(TEST_ART, mode, false, 0);
		for (let y = 0; y < TEST_ART.length; y++) {
			const sourceGlyphs = Array.from(TEST_ART[y]);
			const stripped = stripAnsi(frame[y]);
			for (let x = 0; x < sourceGlyphs.length; x++) {
				if (sourceGlyphs[x] === " ") {
					expect(stripped[x]).toBe(" ");
				}
			}
		}
	});
});

describe("composeIdleBanner — width preservation and determinism", () => {
	const mode: GradientColorMode = "truecolor";

	test("preserves visible width for every line", () => {
		const frame = composeIdleBanner(TEST_ART, mode, false, 1000);
		for (let i = 0; i < TEST_ART.length; i++) {
			expect(visibleWidth(frame[i])).toBe(TEST_ART[i].length);
		}
	});

	test("ANSI open and close counts are balanced", () => {
		const frame = composeIdleBanner(TEST_ART, mode, false, 1000);
		const joined = frame.join("\n");
		const opens = escapeCount(joined, "\x1b[38;2;") + escapeCount(joined, "\x1b[38;5;");
		const closes = escapeCount(joined, "\x1b[39m");
		expect(opens).toBe(closes);
	});

	test("deterministic at fixed elapsed", () => {
		const frame1 = composeIdleBanner(TEST_ART, mode, false, 2100);
		const frame2 = composeIdleBanner(TEST_ART, mode, false, 2100);
		expect(frame1).toEqual(frame2);
	});

	test("NO_COLOR produces plain text", () => {
		const frame = composeIdleBanner(TEST_ART, mode, true, 1000);
		const joined = frame.join("\n");
		expect(stripAnsi(joined)).toBe(joined);
	});
});

describe("shouldAnimate — truth table", () => {
	const base = {
		phase: "intro" as const,
		isTTY: true,
		noColor: false,
		colorMode: "truecolor" as const,
		expanded: true,
		width: 32,
		reducedMotion: false,
		busy: false,
		headerVisibleHint: true,
		idleDriftEnabled: false,
	};

	test("intro true when all gates favorable", () => {
		expect(shouldAnimate(base)).toBe(true);
	});

	test("false for noColor", () => {
		expect(shouldAnimate({ ...base, noColor: true })).toBe(false);
	});

	test("false for non-TTY", () => {
		expect(shouldAnimate({ ...base, isTTY: false })).toBe(false);
	});

	test("false for reducedMotion", () => {
		expect(shouldAnimate({ ...base, reducedMotion: true })).toBe(false);
	});

	test("false for not expanded", () => {
		expect(shouldAnimate({ ...base, expanded: false })).toBe(false);
	});

	test("false for width < 32", () => {
		expect(shouldAnimate({ ...base, width: 31 })).toBe(false);
	});

	test("false for busy", () => {
		expect(shouldAnimate({ ...base, busy: true })).toBe(false);
	});

	test("false for headerVisibleHint false", () => {
		expect(shouldAnimate({ ...base, headerVisibleHint: false })).toBe(false);
	});

	test("idle true only when idleDriftEnabled", () => {
		expect(shouldAnimate({ ...base, phase: "idle" })).toBe(false);
		expect(shouldAnimate({ ...base, phase: "idle", idleDriftEnabled: true })).toBe(true);
	});
});

describe("BannerMotion lifecycle with fake timers", () => {
	const clock = { value: 0 };

	beforeEach(() => {
		clock.value = 0;
		delete process.env.NO_COLOR;
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	test("setExpanded(true) starts exactly one timer and requests a render", () => {
		const opts = makeMotionOptions(clock);
		const panel = new ControlPanelComponent(makeContent(), opts);
		panel.setExpanded(true);
		expect(vi.getTimerCount()).toBe(1);
		expect(opts.requestRender).toHaveBeenCalledTimes(1);
		panel.dispose();
		expect(vi.getTimerCount()).toBe(0);
	});

	test("duplicate setExpanded(true) keeps a single timer", () => {
		const panel = new ControlPanelComponent(makeContent(), makeMotionOptions(clock));
		panel.setExpanded(true);
		panel.setExpanded(true);
		expect(vi.getTimerCount()).toBe(1);
		panel.dispose();
	});

	test("intro-only: quiesces to static after INTRO_MS and emits final render", () => {
		const opts = makeMotionOptions(clock);
		const panel = new ControlPanelComponent(makeContent(), opts);
		panel.setExpanded(true);
		(opts.requestRender as ReturnType<typeof vi.fn>).mockClear();
		clock.value = INTRO_MS + 50;
		vi.advanceTimersByTime(150);
		expect(vi.getTimerCount()).toBe(0);
		expect(opts.requestRender).toHaveBeenCalled();
		panel.dispose();
	});

	test("idle drift (opt-in) runs past INTRO_MS then quiesces after IDLE_MS", () => {
		const opts = makeMotionOptions(clock, { isIdleDriftEnabled: () => true });
		const panel = new ControlPanelComponent(makeContent(), opts);
		panel.setExpanded(true);
		clock.value = INTRO_MS + 10;
		vi.advanceTimersByTime(100);
		expect(vi.getTimerCount()).toBe(1); // transitioned to idle, still animating
		clock.value = INTRO_MS + 10 + IDLE_MS + 10;
		vi.advanceTimersByTime(100);
		expect(vi.getTimerCount()).toBe(0);
		panel.dispose();
	});

	test("dispose() is idempotent and leaves no timers", () => {
		const panel = new ControlPanelComponent(makeContent(), makeMotionOptions(clock));
		panel.setExpanded(true);
		panel.dispose();
		panel.dispose();
		expect(vi.getTimerCount()).toBe(0);
	});

	test("stopMotion() stops the timer and requests one final render", () => {
		const opts = makeMotionOptions(clock);
		const panel = new ControlPanelComponent(makeContent(), opts);
		panel.setExpanded(true);
		(opts.requestRender as ReturnType<typeof vi.fn>).mockClear();
		panel.stopMotion();
		expect(vi.getTimerCount()).toBe(0);
		expect(opts.requestRender).toHaveBeenCalledTimes(1);
	});

	test("no motion options => no timer (static behavior preserved)", () => {
		const panel = new ControlPanelComponent(makeContent());
		panel.setExpanded(true);
		expect(vi.getTimerCount()).toBe(0);
	});

	test("reducedMotion gate prevents the timer from starting", () => {
		const panel = new ControlPanelComponent(makeContent(), makeMotionOptions(clock, { isReducedMotion: () => true }));
		panel.setExpanded(true);
		expect(vi.getTimerCount()).toBe(0);
	});
});

describe("render width regression — ControlPanelComponent", () => {
	const widths = [20, 31, 32, 48, 80, 200];

	test("static render keeps visibleWidth(line) <= width for all widths", () => {
		const panel = new ControlPanelComponent(makeContent());
		panel.setExpanded(true);
		for (const width of widths) {
			for (const line of panel.render(width)) {
				expect(visibleWidth(line)).toBeLessThanOrEqual(width);
			}
		}
	});

	test("NO_COLOR=1 produces no ANSI escapes in banner body", () => {
		const lines = composeStaticBanner(TEST_ART, "truecolor", true);
		for (const line of lines) {
			expect(stripAnsi(line)).toBe(line);
		}
	});
});
