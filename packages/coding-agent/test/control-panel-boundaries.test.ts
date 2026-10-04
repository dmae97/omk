import { beforeEach, describe, expect, it } from "vitest";
import {
	boxBottom,
	boxRuleLine,
	boxTextLine,
	boxTop,
	divider,
	sidebarRule,
} from "../src/modes/interactive/components/control-panel-box.ts";
import { initTheme, theme } from "../src/modes/interactive/theme/theme.ts";

function expectUsesRole(rendered: string, role: "border" | "borderMuted"): void {
	expect(rendered).toContain(theme.getFgAnsi(role));
}

describe("control panel boundary hierarchy", () => {
	beforeEach(() => {
		initTheme("omk-control-light");
	});

	it("uses the strong border role for outer panel frames", () => {
		expectUsesRole(boxTop(32, "STATUS RAIL"), "border");
		expectUsesRole(boxBottom(32), "border");
		expectUsesRole(boxTextLine(32, "body"), "border");
	});

	it("uses the strong border role for captioned section separators", () => {
		expectUsesRole(sidebarRule(32, "VERIFY"), "border");
		expectUsesRole(divider(32, "SYSTEM MAP", "muted"), "border");
	});

	it("keeps internal rules and meter troughs decorative", () => {
		expectUsesRole(boxRuleLine(32), "borderMuted");
	});
});
