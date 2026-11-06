import { fileURLToPath } from "node:url";
import { visibleWidth } from "omk-tui";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { ControlPanelComponent } from "../src/modes/interactive/components/control-panel.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

// The startup deck carries its own status column. With the pinned status rail on screen the
// same status would be drawn twice side by side, so the deck must drop its column then.
function createPanel(pinnedRailVisible: () => boolean, inViewport: () => boolean = () => true): ControlPanelComponent {
	return new ControlPanelComponent(
		{
			appName: "omk",
			version: "1.5.10",
			compactInstructions: () => "Ctrl+C interrupt · / commands",
			expandedInstructions: () => "Ctrl+C to interrupt",
			compactOnboarding: () => "Press Ctrl+O to show full startup help.",
			onboarding: () => "OMK can explain its own features.",
		},
		{
			requestRender: () => {},
			isTTY: () => false,
			isReducedMotion: () => true,
			isHeaderVisibleHint: () => true,
			isPinnedRailVisible: pinnedRailVisible,
			isInViewport: inViewport,
		},
	);
}

let previousPackageDir: string | undefined;
beforeAll(() => {
	previousPackageDir = process.env.OMK_PACKAGE_DIR;
	process.env.OMK_PACKAGE_DIR = fileURLToPath(new URL("../", import.meta.url));
	initTheme("omk-neon-control");
});
afterAll(() => {
	if (previousPackageDir === undefined) delete process.env.OMK_PACKAGE_DIR;
	else process.env.OMK_PACKAGE_DIR = previousPackageDir;
});

describe("startup deck beside the pinned status rail", () => {
	for (const expanded of [false, true]) {
		test(`keeps one status column (expanded=${expanded})`, () => {
			let pinned = false;
			const panel = createPanel(() => pinned);
			panel.setExpanded(expanded);
			const withDeckRail = stripAnsi(panel.render(156).join("\n"));
			expect(withDeckRail).toContain("OMK://CONTROL");
			expect(withDeckRail).toContain("SESSION");

			pinned = true;
			const lines = panel.render(156);
			const plain = stripAnsi(lines.join("\n"));
			expect(plain).not.toMatch(/─ (TODO|SESSION|RESOURCES) /);
			expect(plain).toContain("Scope the work. Route the right agents.");
			for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(156);

			pinned = false;
			expect(stripAnsi(panel.render(156).join("\n"))).toBe(withDeckRail);
		});
	}

	test("keeps its geometry once scrolled into scrollback", () => {
		let pinned = false;
		let inViewport = true;
		const panel = createPanel(
			() => pinned,
			() => inViewport,
		);
		const before = panel.render(156);
		inViewport = false;
		pinned = true;
		expect(panel.render(156)).toEqual(before);
		inViewport = true;
		expect(stripAnsi(panel.render(156).join("\n"))).not.toMatch(/─ (TODO|SESSION|RESOURCES) /);
	});
});
