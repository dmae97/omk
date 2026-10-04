import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
	ControlPanelComponent,
	type ControlPanelContent,
	type ControlPanelMotionOptions,
} from "../src/modes/interactive/components/control-panel.ts";
import { OMK_WORDMARK } from "../src/modes/interactive/components/control-panel-brand.ts";
import { renderControlPanelLayout } from "../src/modes/interactive/components/control-panel-layout.ts";
import { INTRO_MS, TICK_MS } from "../src/modes/interactive/components/control-panel-motion.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

initTheme("omk-paper-dark");

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

function makeMotionOptions(clock: { value: number }): ControlPanelMotionOptions {
	return {
		requestRender: vi.fn(),
		isTTY: () => true,
		isReducedMotion: () => false,
		isHeaderVisibleHint: () => true,
		now: () => clock.value,
	};
}

const ESC_RE = /\x1b\[[0-?]*[ -/]*[@-~]/g;

function stripAnsi(value: string): string {
	return value.replace(ESC_RE, "");
}

describe("ControlPanelComponent ink-in render bridge", () => {
	const originalNoColor = process.env.NO_COLOR;
	const originalForceColor = process.env.FORCE_COLOR;
	const originalReducedMotion = process.env.OMK_REDUCED_MOTION;

	beforeEach(() => {
		vi.useFakeTimers();
		delete process.env.NO_COLOR;
		delete process.env.FORCE_COLOR;
		delete process.env.OMK_REDUCED_MOTION;
	});

	afterEach(() => {
		vi.useRealTimers();
		if (originalNoColor === undefined) delete process.env.NO_COLOR;
		else process.env.NO_COLOR = originalNoColor;
		if (originalForceColor === undefined) delete process.env.FORCE_COLOR;
		else process.env.FORCE_COLOR = originalForceColor;
		if (originalReducedMotion === undefined) delete process.env.OMK_REDUCED_MOTION;
		else process.env.OMK_REDUCED_MOTION = originalReducedMotion;
	});

	for (const width of [96, 160]) {
		test(`at ${width} columns the ink-in changes colour only, then settles on the final frame`, () => {
			const clock = { value: 0 };
			const panel = new ControlPanelComponent(makeContent(), makeMotionOptions(clock));
			panel.setExpanded(true);
			const finalFrame = renderControlPanelLayout(makeContent(), true, width);

			const firstFrame = panel.render(width);
			expect(firstFrame.join("\n")).not.toBe(finalFrame.join("\n"));
			// Same text, same geometry: the reveal only recolours.
			expect(firstFrame.map(stripAnsi)).toEqual(finalFrame.map(stripAnsi));
			expect(stripAnsi(firstFrame.join("\n"))).toContain(OMK_WORDMARK[0]!.trimEnd());

			clock.value = INTRO_MS;
			vi.advanceTimersByTime(TICK_MS);
			expect(panel.render(width)).toEqual(finalFrame);
			panel.dispose();
		});
	}

	test("there is no idle phase: once settled, later frames are identical and no timer remains", () => {
		const clock = { value: 0 };
		const options = makeMotionOptions(clock);
		const panel = new ControlPanelComponent(makeContent(), options);
		panel.setExpanded(true);

		clock.value = INTRO_MS + 10;
		vi.advanceTimersByTime(TICK_MS);
		const settled = panel.render(160).join("\n");
		const rendersAfterSettle = vi.mocked(options.requestRender).mock.calls.length;

		clock.value = INTRO_MS + 5000;
		vi.advanceTimersByTime(5000);
		expect(panel.render(160).join("\n")).toBe(settled);
		expect(vi.mocked(options.requestRender).mock.calls.length).toBe(rendersAfterSettle);
		expect(vi.getTimerCount()).toBe(0);
		panel.dispose();
	});
});
