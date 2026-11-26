import { visibleWidth } from "omk-tui";
import { beforeAll, describe, expect, it } from "vitest";
import {
	OmkStatusHeaderComponent,
	type OmkStatusHeaderSnapshot,
	renderOmkStatusHeader,
} from "../src/modes/interactive/components/omk-status-header.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

const BASE_SNAPSHOT: OmkStatusHeaderSnapshot = {
	version: "2.0.4",
	modelLabel: "antigravity/gemini-4-neon-xhigh",
	thinkingLevel: "xhigh",
	runState: "ok",
	runLabel: "idle",
	verifyState: "unknown",
	verifyLabel: "unverified",
	contextPercent: 12.46,
	contextWindowTokens: 1_000_000,
	cwdLabel: "~/Project/omk",
	gitBranch: "main",
	planBadge: "plan:feature (ro)",
	mcpReady: 7,
	mcpTotal: 7,
	herdrActive: true,
};

const NON_SGR_ESCAPE = /\x1b(?!\[[0-9;]*m)/;
const C1_OR_BIDI = /[\u0080-\u009f\u202a-\u202e\u2066-\u2069]/;

beforeAll(() => {
	initTheme("omk-paper-dark");
});

describe("renderOmkStatusHeader", () => {
	it("renders a compact 4-line paper-academic status header at wide widths with exact width", () => {
		const lines = renderOmkStatusHeader(BASE_SNAPSHOT, 110);
		expect(lines).toHaveLength(4);
		expect(lines.map((line) => visibleWidth(line))).toEqual([110, 110, 110, 110]);
		const joined = lines.join("\n");
		expect(joined).toContain("OMK · STATUS");
		expect(joined).toContain("v2.0.4");
		expect(joined).toContain("antigravity/gemini-4-neon-xhigh");
		expect(joined).toContain("12.4%");
		expect(joined).toContain("main");
		expect(joined).toContain("plan:feature (ro)");
		expect(joined).toContain("HERDR");
	});

	it("collapses cleanly to 3 lines on narrow terminals without overflow", () => {
		const lines = renderOmkStatusHeader(BASE_SNAPSHOT, 72);
		expect(lines).toHaveLength(3);
		expect(lines.map((line) => visibleWidth(line))).toEqual([72, 72, 72]);
	});

	it("sanitizes terminal escape sequences and bidi marks from untrusted fields", () => {
		const poisoned: OmkStatusHeaderSnapshot = {
			...BASE_SNAPSHOT,
			modelLabel: "evil\x1b]52;c;ZXZpbA==\x07model",
			gitBranch: "feat/\x1b[2J\u202ebranch",
			cwdLabel: "~/work/\u009brepo",
			planBadge: "plan:\x1b[2Jro",
		};
		for (const width of [72, 110]) {
			const lines = renderOmkStatusHeader(poisoned, width);
			expect(lines.filter((line) => NON_SGR_ESCAPE.test(line) || C1_OR_BIDI.test(line))).toEqual([]);
			expect(lines.map((line) => visibleWidth(line))).toEqual(lines.map(() => width));
		}
	});

	it("freezes rendered lines once scrolled out of viewport so scrollback never repaints", () => {
		let branch = "main";
		let inViewport = true;
		const comp = new OmkStatusHeaderComponent(
			() => ({ ...BASE_SNAPSHOT, gitBranch: branch }),
			() => inViewport,
		);
		const first = comp.render(100);
		expect(first.join("\n")).toContain("main");

		inViewport = false;
		branch = "feat/changed";
		const frozen = comp.render(100);
		expect(frozen).toEqual(first);

		inViewport = true;
		const refreshed = comp.render(100);
		expect(refreshed.join("\n")).toContain("feat/changed");
	});
});
