import { visibleWidth } from "omk-tui";
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
		expect(introFinal).toEqual(staticFrame);
	});

	test("elapsed >= INTRO_MS all produce static output", () => {
		const introOver = composeIntroBanner(TEST_ART, mode, false, INTRO_MS + 100);
		const staticFrame = composeStaticBanner(TEST_ART, mode, false);
		expect(introOver).toEqual(staticFrame);
	});

	test("256-color final intro frame matches composeStaticBanner exactly", () => {
		expect(composeIntroBanner(TEST_ART, "256color", false, INTRO_MS)).toEqual(
			composeStaticBanner(TEST_ART, "256color", false),
		);
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

	test("false for non-TTY without FORCE_COLOR", () => {
		const previousForceColor = process.env.FORCE_COLOR;
		try {
			delete process.env.FORCE_COLOR;
			expect(shouldAnimate({ ...base, isTTY: false })).toBe(false);
		} finally {
			if (previousForceColor === undefined) delete process.env.FORCE_COLOR;
			else process.env.FORCE_COLOR = previousForceColor;
		}
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
		delete process.env.FORCE_COLOR;
		delete process.env.OMK_REDUCED_MOTION;
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

	test("getRenderWidth below the banner minimum prevents the timer from starting", () => {
		const panel = new ControlPanelComponent(makeContent(), makeMotionOptions(clock, { getRenderWidth: () => 31 }));
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

test("color and motion policy matrix derives ANSI and motion from control-panel behavior", () => {
	type EnvKey = "NO_COLOR" | "FORCE_COLOR" | "OMK_REDUCED_MOTION";
	type PolicyRow = {
		name: string;
		isTTY: boolean;
		idleDriftEnabled: boolean;
		env: Partial<Record<EnvKey, string | undefined>>;
	};

	const rows: PolicyRow[] = [
		{
			name: "default TTY",
			isTTY: true,
			idleDriftEnabled: false,
			env: {},
		},
		{
			name: "non-TTY",
			isTTY: false,
			idleDriftEnabled: false,
			env: {},
		},
		{
			name: "NO_COLOR=1",
			isTTY: true,
			idleDriftEnabled: false,
			env: { NO_COLOR: "1" },
		},
		{
			name: "FORCE_COLOR=1",
			isTTY: false,
			idleDriftEnabled: false,
			env: { FORCE_COLOR: "1" },
		},
		{
			name: "NO_COLOR=1 FORCE_COLOR=1",
			isTTY: true,
			idleDriftEnabled: false,
			env: { NO_COLOR: "1", FORCE_COLOR: "1" },
		},
		{
			name: "OMK_REDUCED_MOTION=1",
			isTTY: true,
			idleDriftEnabled: false,
			env: { OMK_REDUCED_MOTION: "1" },
		},
		{
			name: "idle drift opt-in",
			isTTY: true,
			idleDriftEnabled: true,
			env: {},
		},
		{
			name: "idle drift reduced motion",
			isTTY: true,
			idleDriftEnabled: true,
			env: { OMK_REDUCED_MOTION: "1" },
		},
	];

	const previousEnv: Record<EnvKey, string | undefined> = {
		NO_COLOR: process.env.NO_COLOR,
		FORCE_COLOR: process.env.FORCE_COLOR,
		OMK_REDUCED_MOTION: process.env.OMK_REDUCED_MOTION,
	};

	function setPolicyEnv(values: Partial<Record<EnvKey, string | undefined>>): void {
		for (const key of Object.keys(previousEnv) as EnvKey[]) {
			const value = values[key];
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	}

	try {
		for (const row of rows) {
			setPolicyEnv(row.env);
			const noColor = process.env.NO_COLOR !== undefined;
			const forceColor = process.env.FORCE_COLOR !== undefined;
			const reducedMotion = process.env.OMK_REDUCED_MOTION !== undefined;
			const policyAllowsAnsi = !noColor && (row.isTTY || forceColor);
			const policyAllowsIntroMotion = policyAllowsAnsi && !reducedMotion;
			const policyAllowsIdleMotion = policyAllowsIntroMotion && row.idleDriftEnabled;

			const introMotion = shouldAnimate({
				phase: "intro",
				isTTY: row.isTTY,
				noColor,
				colorMode: "truecolor",
				expanded: true,
				width: 80,
				reducedMotion,
				busy: false,
				headerVisibleHint: true,
				idleDriftEnabled: row.idleDriftEnabled,
			});
			const idleMotion = shouldAnimate({
				phase: "idle",
				isTTY: row.isTTY,
				noColor,
				colorMode: "truecolor",
				expanded: true,
				width: 80,
				reducedMotion,
				busy: false,
				headerVisibleHint: true,
				idleDriftEnabled: row.idleDriftEnabled,
			});

			const clock = { value: 0 };
			const requestRender = vi.fn();
			const panel = new ControlPanelComponent(
				makeContent(),
				makeMotionOptions(clock, {
					requestRender,
					isTTY: () => row.isTTY,
					isReducedMotion: () => reducedMotion,
					isIdleDriftEnabled: () => row.idleDriftEnabled,
					getRenderWidth: () => 80,
				}),
			);

			vi.useFakeTimers();
			try {
				panel.render(80);
				panel.setExpanded(true);
				const renderedPanel = panel.render(80).join("\n");
				const componentStartedMotion = requestRender.mock.calls.length > 0;
				const actualAnsi = ESC_RE.test(renderedPanel);

				expect(actualAnsi, `${row.name} ANSI policy must come from rendered control-panel output`).toBe(
					policyAllowsAnsi,
				);
				expect(introMotion, `${row.name} reduced motion/NO_COLOR/FORCE_COLOR intro motion policy`).toBe(
					policyAllowsIntroMotion,
				);
				expect(
					componentStartedMotion,
					`${row.name} component motion policy must be observable without vi.getTimerCount`,
				).toBe(policyAllowsIntroMotion);
				expect(idleMotion, `${row.name} idle drift reduced motion policy`).toBe(policyAllowsIdleMotion);
			} finally {
				panel.dispose();
				vi.clearAllTimers();
				vi.useRealTimers();
			}
		}
	} finally {
		setPolicyEnv(previousEnv);
	}
});
test("OMK_REDUCED_MOTION=1 suppresses control-panel motion even when the TTY option is favorable", () => {
	const previousReducedMotion = process.env.OMK_REDUCED_MOTION;
	const previousNoColor = process.env.NO_COLOR;
	let panel: ControlPanelComponent | undefined;

	try {
		delete process.env.NO_COLOR;
		process.env.OMK_REDUCED_MOTION = "1";
		vi.useFakeTimers();
		const clock = { value: 0 };
		panel = new ControlPanelComponent(
			makeContent(),
			makeMotionOptions(clock, {
				isReducedMotion: () => false,
				isTTY: () => true,
				isHeaderVisibleHint: () => true,
				getRenderWidth: () => 80,
			}),
		);
		panel.render(80);
		panel.setExpanded(true);

		expect(vi.getTimerCount(), "reduced motion env must prevent motion timers").toBe(0);
	} finally {
		panel?.dispose();
		vi.clearAllTimers();
		vi.useRealTimers();
		if (previousReducedMotion === undefined) delete process.env.OMK_REDUCED_MOTION;
		else process.env.OMK_REDUCED_MOTION = previousReducedMotion;
		if (previousNoColor === undefined) delete process.env.NO_COLOR;
		else process.env.NO_COLOR = previousNoColor;
	}
});

test("FORCE_COLOR=1 enables control-panel motion for color-capable non-TTY policy", () => {
	const previousForceColor = process.env.FORCE_COLOR;
	const previousNoColor = process.env.NO_COLOR;
	const previousReducedMotion = process.env.OMK_REDUCED_MOTION;
	let panel: ControlPanelComponent | undefined;

	try {
		process.env.FORCE_COLOR = "1";
		delete process.env.NO_COLOR;
		delete process.env.OMK_REDUCED_MOTION;
		vi.useFakeTimers();

		const clock = { value: 0 };
		panel = new ControlPanelComponent(
			makeContent(),
			makeMotionOptions(clock, {
				isReducedMotion: () => false,
				isTTY: () => false,
				isHeaderVisibleHint: () => true,
				getRenderWidth: () => 80,
			}),
		);

		panel.render(80);
		panel.setExpanded(true);

		expect(vi.getTimerCount(), "FORCE_COLOR policy must be explicit for non-TTY motion").toBe(1);
	} finally {
		panel?.dispose();
		vi.clearAllTimers();
		vi.useRealTimers();
		if (previousForceColor === undefined) delete process.env.FORCE_COLOR;
		else process.env.FORCE_COLOR = previousForceColor;
		if (previousNoColor === undefined) delete process.env.NO_COLOR;
		else process.env.NO_COLOR = previousNoColor;
		if (previousReducedMotion === undefined) delete process.env.OMK_REDUCED_MOTION;
		else process.env.OMK_REDUCED_MOTION = previousReducedMotion;
	}
});
