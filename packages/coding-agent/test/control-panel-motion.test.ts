import fc from "fast-check";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
	ControlPanelComponent,
	type ControlPanelMotionOptions,
} from "../src/modes/interactive/components/control-panel.ts";
import {
	easeOutCubic,
	INTRO_MS,
	type IntroGate,
	MIN_MOTION_WIDTH,
	revealAt,
	shouldAnimateIntro,
	TICK_MS,
} from "../src/modes/interactive/components/control-panel-motion.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

initTheme("omk-paper-dark");

const content = {
	appName: "omk",
	version: "0.0.0",
	compactInstructions: () => "",
	expandedInstructions: () => "",
	compactOnboarding: () => "",
	onboarding: () => "",
};

const favourable: IntroGate = {
	isTTY: true,
	forceColor: false,
	noColor: false,
	expanded: true,
	width: 160,
	reducedMotion: false,
	headerVisible: true,
};

describe("reveal timing", () => {
	test("is one short ease-out pass within the motion budget", () => {
		expect(INTRO_MS).toBeLessThanOrEqual(500);
		expect(TICK_MS).toBeLessThanOrEqual(100);
		expect(revealAt(0)).toBe(0);
		expect(revealAt(INTRO_MS)).toBe(1);
		expect(revealAt(INTRO_MS * 10)).toBe(1);
		// Ease-out: more than half of the ink lands in the first half of the time.
		expect(revealAt(INTRO_MS / 2)).toBeGreaterThan(0.5);
	});

	test("non-finite or negative time yields the final frame instead of a stuck pencil state", () => {
		for (const elapsed of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1]) {
			expect(revealAt(elapsed)).toBe(1);
		}
	});

	test("is monotone non-decreasing and bounded in [0, 1]", () => {
		fc.assert(
			fc.property(
				fc.double({ min: 0, max: 2 * INTRO_MS, noNaN: true }),
				fc.double({ min: 0, max: 2 * INTRO_MS, noNaN: true }),
				(a, b) => {
					const [lo, hi] = a <= b ? [a, b] : [b, a];
					expect(revealAt(lo)).toBeLessThanOrEqual(revealAt(hi));
					expect(revealAt(lo)).toBeGreaterThanOrEqual(0);
					expect(revealAt(hi)).toBeLessThanOrEqual(1);
				},
			),
			{ numRuns: 300 },
		);
		expect(easeOutCubic(-1)).toBe(0);
		expect(easeOutCubic(2)).toBe(1);
	});
});

describe("intro gate", () => {
	test("plays only when every condition allows it", () => {
		expect(shouldAnimateIntro(favourable)).toBe(true);
		expect(shouldAnimateIntro({ ...favourable, isTTY: false })).toBe(false);
		expect(shouldAnimateIntro({ ...favourable, isTTY: false, forceColor: true })).toBe(true);
		expect(shouldAnimateIntro({ ...favourable, noColor: true })).toBe(false);
		expect(shouldAnimateIntro({ ...favourable, expanded: false })).toBe(false);
		expect(shouldAnimateIntro({ ...favourable, reducedMotion: true })).toBe(false);
		expect(shouldAnimateIntro({ ...favourable, headerVisible: false })).toBe(false);
		expect(shouldAnimateIntro({ ...favourable, width: MIN_MOTION_WIDTH - 1 })).toBe(false);
		expect(shouldAnimateIntro({ ...favourable, width: MIN_MOTION_WIDTH })).toBe(true);
	});
});

describe("ControlPanelComponent motion lifecycle", () => {
	const saved = {
		noColor: process.env.NO_COLOR,
		force: process.env.FORCE_COLOR,
		reduced: process.env.OMK_REDUCED_MOTION,
	};

	beforeEach(() => {
		vi.useFakeTimers();
		delete process.env.NO_COLOR;
		delete process.env.FORCE_COLOR;
		delete process.env.OMK_REDUCED_MOTION;
	});

	afterEach(() => {
		vi.useRealTimers();
		for (const [key, value] of [
			["NO_COLOR", saved.noColor],
			["FORCE_COLOR", saved.force],
			["OMK_REDUCED_MOTION", saved.reduced],
		] as const) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	});

	function options(
		clock: { value: number },
		overrides: Partial<ControlPanelMotionOptions> = {},
	): ControlPanelMotionOptions {
		return {
			requestRender: vi.fn(),
			isTTY: () => true,
			isReducedMotion: () => false,
			isHeaderVisibleHint: () => true,
			now: () => clock.value,
			...overrides,
		};
	}

	test("expanding starts exactly one timer, and the timer stops by itself after the intro", () => {
		const clock = { value: 0 };
		const opts = options(clock);
		const panel = new ControlPanelComponent(content, opts);
		panel.setExpanded(true);
		panel.setExpanded(true);
		expect(vi.getTimerCount()).toBe(1);
		expect(opts.requestRender).toHaveBeenCalledTimes(1);

		clock.value = INTRO_MS;
		vi.advanceTimersByTime(TICK_MS);
		expect(vi.getTimerCount()).toBe(0);
		// The stop repaints the final frame once.
		expect(opts.requestRender).toHaveBeenCalledTimes(2);
		panel.dispose();
	});

	test("dispose and stopMotion leave no timer; collapsing ends the intro", () => {
		const clock = { value: 0 };
		const panel = new ControlPanelComponent(content, options(clock));
		panel.setExpanded(true);
		panel.stopMotion();
		expect(vi.getTimerCount()).toBe(0);
		panel.dispose();
		panel.dispose();
		expect(vi.getTimerCount()).toBe(0);

		const collapsing = new ControlPanelComponent(content, options(clock));
		collapsing.setExpanded(true);
		collapsing.setExpanded(false);
		expect(vi.getTimerCount()).toBe(0);
	});

	test("reduced motion, NO_COLOR, a hidden header, a narrow width or no options keep the panel static", () => {
		const clock = { value: 0 };
		const cases: Array<() => ControlPanelComponent> = [
			() => new ControlPanelComponent(content, options(clock, { isReducedMotion: () => true })),
			() => new ControlPanelComponent(content, options(clock, { isHeaderVisibleHint: () => false })),
			() => new ControlPanelComponent(content, options(clock, { getRenderWidth: () => MIN_MOTION_WIDTH - 1 })),
			() => new ControlPanelComponent(content),
			() => {
				process.env.NO_COLOR = "1";
				return new ControlPanelComponent(content, options(clock));
			},
			() => {
				delete process.env.NO_COLOR;
				process.env.OMK_REDUCED_MOTION = "1";
				return new ControlPanelComponent(content, options(clock));
			},
		];
		for (const make of cases) {
			const panel = make();
			panel.setExpanded(true);
			expect(vi.getTimerCount()).toBe(0);
			panel.dispose();
		}
	});

	test("NO_COLOR renders plain text with no escape sequences", () => {
		process.env.NO_COLOR = "1";
		const panel = new ControlPanelComponent(content, options({ value: 0 }));
		panel.setExpanded(true);
		expect(panel.render(160).join("\n")).not.toMatch(/\x1b/);
	});
});
