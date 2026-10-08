import { visibleWidth } from "omk-tui";
import { beforeAll, describe, expect, test } from "vitest";
import { meterBar } from "../src/modes/interactive/components/control-panel-box.ts";
import { initTheme, theme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

describe("meterBar", () => {
	beforeAll(() => {
		initTheme("omk-paper-dark");
	});

	test("fills solid cells in the given colour and paints the trough with dim", () => {
		const bar = meterBar(5, 12, "accent");

		expect(stripAnsi(bar)).toBe(`${"█".repeat(5)}${"░".repeat(7)}`);
		expect(bar).toContain(theme.fg("accent", "█".repeat(5)));
		expect(bar).toContain(theme.fg("dim", "░".repeat(7)));
		expect(bar).not.toContain(theme.fg("borderMuted", "░".repeat(7)));
	});

	test.each([
		[-3, 0],
		[0, 0],
		[12, 12],
		[20, 12],
	])("filled=%d keeps the bar exactly 12 cells wide (%d solid)", (filled, solid) => {
		const bar = meterBar(filled, 12, "success");

		expect(visibleWidth(bar)).toBe(12);
		expect(stripAnsi(bar)).toBe(`${"█".repeat(solid)}${"░".repeat(12 - solid)}`);
	});
});
