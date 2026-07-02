import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
	ControlPanelComponent,
	type ControlPanelContent,
	type ControlPanelMotionOptions,
} from "../src/modes/interactive/components/control-panel.ts";
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

function makeMotionOptions(clock: { value: number }): ControlPanelMotionOptions {
	return {
		requestRender: vi.fn(),
		isTTY: () => true,
		isReducedMotion: () => false,
		isIdleDriftEnabled: () => false,
		isHeaderVisibleHint: () => true,
		now: () => clock.value,
	};
}

function makeIdleMotionOptions(clock: { value: number }): ControlPanelMotionOptions {
	return {
		...makeMotionOptions(clock),
		isIdleDriftEnabled: () => true,
	};
}

const ESC_RE = /\x1b\[[0-?]*[ -/]*[@-~]/g;

function stripAnsi(value: string): string {
	return value.replace(ESC_RE, "");
}

describe("ControlPanelComponent motion render bridge", () => {
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

	test("render uses deterministic intro frames while motion is active", () => {
		const clock = { value: 0 };
		const panel = new ControlPanelComponent(makeContent(), makeMotionOptions(clock));
		panel.setExpanded(true);
		const plain = stripAnsi(panel.render(96).join("\n"));

		expect(plain).not.toContain("____   __  __");
		expect(plain).toContain("SYSTEM MAP");
		panel.dispose();
	});

	test("idle drift keeps the expanded banner animated after the intro reveal", () => {
		const clock = { value: 0 };
		const panel = new ControlPanelComponent(makeContent(), makeIdleMotionOptions(clock));
		panel.setExpanded(true);

		clock.value = 950;
		vi.advanceTimersByTime(100);
		const firstFrame = panel.render(96).join("\n");

		clock.value = 1400;
		vi.advanceTimersByTime(100);
		const secondFrame = panel.render(96).join("\n");

		expect(firstFrame).not.toBe(secondFrame);
		expect(stripAnsi(secondFrame)).toContain("SYSTEM MAP");
		panel.dispose();
	});
});
