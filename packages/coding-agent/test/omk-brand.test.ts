import { visibleWidth } from "@earendil-works/omk-tui";
import { describe, expect, it } from "vitest";
import { VERSION } from "../src/config.ts";
import { OmkBrandComponent } from "../src/modes/interactive/components/omk-brand.ts";
import {
	OmkBrandStartupComponent,
	renderOmkBrandFrame,
} from "../src/modes/interactive/components/omk-brand-surface.ts";

function stripAnsi(text: string): string {
	return text.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "");
}

function withSigil<T>(sigil: string | undefined, run: () => T): T {
	const previous = process.env.OMK_SIGIL;
	if (sigil === undefined) delete process.env.OMK_SIGIL;
	else process.env.OMK_SIGIL = sigil;
	try {
		return run();
	} finally {
		if (previous === undefined) delete process.env.OMK_SIGIL;
		else process.env.OMK_SIGIL = previous;
	}
}

describe("OMK brand control surface", () => {
	it("renders the OMK wordmark by default in the centered splash", () => {
		const lines = withSigil(undefined, () =>
			renderOmkBrandFrame({
				cols: 100,
				version: "v0.8.0",
				provider: "deepseek",
				model: "deepseek-v4-pro:max",
				cwd: "~/project",
				branch: "main",
				showStatusBar: true,
				showPrompt: true,
			}),
		);
		const text = stripAnsi(lines.join("\n"));

		expect(text).toContain("OMK//CONTROL");
		expect(text).toContain("route · verify · loop · control");
		expect(text).toContain("██████╗ ███╗   ███╗██╗  ██╗");
		expect(text).toContain("╚██████╔╝██║ ╚═╝ ██║██║  ██╗");
		expect(text).toContain("deepseek-v4-pro:max");
		expect(text).toContain("route · verify · loop");
		expect(text).not.toMatch(/forge/i);
		expect(text).not.toContain("SYSTEM STATUS");
		for (const line of lines) {
			expect(visibleWidth(line)).toBeLessThanOrEqual(100);
		}
	});

	it("version stamp tracks canonical package VERSION, not stale hardcoded v0.8.0", () => {
		const lines = withSigil(undefined, () =>
			renderOmkBrandFrame({
				cols: 100,
				showStatusBar: true,
				showPrompt: true,
			}),
		);
		const text = stripAnsi(lines.join("\n"));

		expect(text).toContain(`omk v${VERSION} · OMK//CONTROL`);
		expect(text).not.toContain("v0.8.0");
	});

	it("keeps narrow terminal output within the viewport", () => {
		const lines = renderOmkBrandFrame({ cols: 48, showStatusBar: true, showPrompt: true });

		for (const line of lines) {
			expect(visibleWidth(line)).toBeLessThanOrEqual(48);
		}
	});

	it("supports the legacy forge sigil via OMK_SIGIL=forge", () => {
		const lines = withSigil("forge", () =>
			renderOmkBrandFrame({ cols: 100, showStatusBar: false, showPrompt: false }),
		);
		const text = stripAnsi(lines.join("\n"));

		expect(text).toContain("╰─────╮");
		expect(text).not.toContain("██████╗");
		for (const line of lines) {
			expect(visibleWidth(line)).toBeLessThanOrEqual(100);
		}
	});

	it("/brand component uses live model data", () => {
		const component = new OmkBrandComponent({
			getData: () => ({
				version: "v0.78.0",
				provider: "mimo",
				model: "mimo-v2.5-pro",
				cwd: "~/omk",
				branch: "feature/control",
			}),
		});
		const text = stripAnsi(component.render(92).join("\n"));

		expect(text).toContain("OMK//CONTROL");
		expect(text).toContain("mimo-v2.5-pro");
		expect(text).toContain("feature/control");
		expect(text).not.toMatch(/forge/i);
	});

	it("changes ANSI gradient output between animation frames", () => {
		const frame0 = renderOmkBrandFrame({ cols: 90, frame: 0, showStatusBar: false, showPrompt: false });
		const frame1 = renderOmkBrandFrame({ cols: 90, frame: 1, showStatusBar: false, showPrompt: false });

		expect(frame1.join("\n")).not.toBe(frame0.join("\n"));
		expect(stripAnsi(frame0.join("\n"))).toContain("OMK//CONTROL");
		expect(stripAnsi(frame1.join("\n"))).toContain("OMK//CONTROL");
	});

	it("startup component keeps help collapsed until expanded", () => {
		const component = new OmkBrandStartupComponent({
			getCollapsedHint: () => "collapsed hint",
			getExpandedHelp: () => "expanded help",
		});

		expect(stripAnsi(component.render(90).join("\n"))).toContain("collapsed hint");
		component.setExpanded(true);
		expect(stripAnsi(component.render(90).join("\n"))).toContain("expanded help");
	});
});
