import { visibleWidth } from "omk-tui";
import { beforeAll, expect, it } from "vitest";
import { boxBottom, boxTextLine, boxTop, sidebarRule } from "../src/modes/interactive/components/control-panel-box.ts";
import { statusPaneLayout } from "../src/modes/interactive/components/status-pane-layout.ts";
import { initTheme, theme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

beforeAll(() => initTheme("omk-paper-dark"));
it("uses the pane boundary, sentence-case section hierarchy and existing values", () => {
	const rows = [
		boxTop(40, "STATUS RAIL"),
		boxTextLine(40, "cwd  ~/작업/프로젝트"),
		sidebarRule(40, "MODEL"),
		boxTextLine(40, "id   test-model"),
		boxBottom(40),
	];
	const output = statusPaneLayout(rows, 40);
	const plain = output.map(stripAnsi).join("\n");
	expect(plain).toContain("OMK  /  Session");
	expect(plain).toContain("Model ─");
	expect(plain).toContain("~/작업/프로젝트");
	expect(plain).toContain("test-model");
	expect(plain).not.toMatch(/[│┌└]/);
	expect(output.every((line) => visibleWidth(line) <= 40)).toBe(true);
});
it("preserves semantic value colors instead of inheriting the removed frame color", () => {
	const model = theme.fg("text", "test-model");
	const run = theme.fg("success", "✓ idle");
	const rows = [
		boxTop(40, "STATUS RAIL"),
		boxTextLine(40, `${theme.fg("muted", "id   ")}${model}`),
		boxTextLine(40, `${theme.fg("muted", "run  ")}${run}`),
		boxBottom(40),
	];
	const output = statusPaneLayout(rows, 40).join("\n");
	expect(output).toContain(model);
	expect(output).toContain(run);
});
it("aligns short and long labels on the same value column", () => {
	const rows = [
		boxTop(40, "STATUS RAIL"),
		boxTextLine(40, "id   model"),
		boxTextLine(40, "think max"),
		boxTextLine(40, "run  ✓ idle"),
		boxBottom(40),
	];
	const plain = statusPaneLayout(rows, 40).map((line) => stripAnsi(line).trimEnd());
	expect(plain.find((line) => line.includes("model"))).toBe(" id    model");
	expect(plain.find((line) => line.includes("max"))).toBe(" think max");
	expect(plain.find((line) => line.includes("idle"))).toBe(" run   ✓ idle");
});
it("clips CJK and long section labels within narrow panes", () => {
	for (const width of [10, 20, 34, 40, 80]) {
		const rows = [
			boxTop(width, "STATUS RAIL"),
			sidebarRule(width, "CONTEXT"),
			boxTextLine(width, "模型🚀e\u0301".repeat(20)),
			boxBottom(width),
		];
		expect(statusPaneLayout(rows, width).every((line) => visibleWidth(line) <= width)).toBe(true);
	}
});
