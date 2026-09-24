import { visibleWidth } from "omk-tui";
import { describe, expect, test } from "vitest";
import {
	ControlPanelComponent,
	ControlPanelRightPaneComponent,
	type ControlPanelStatusSnapshot,
} from "../src/modes/interactive/components/control-panel.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

const ESC_RE = /\x1b\[[0-?]*[ -/]*[@-~]/g;

function stripAnsi(value: string): string {
	return value.replace(ESC_RE, "");
}

/** Decorative or hardcoded-status copy the status rail must never render. */
const RAIL_FORBIDDEN_TEXT = [
	"CYBERPUNK OPS CORE",
	"MATRIX RAIN",
	"NEON GRID ONLINE",
	"NIGHT-CITY-MATRIX-V3",
	"pulse:",
	"sidebar: pinned",
	"route: active",
	"pkg:",
];

function makePanel(): ControlPanelComponent {
	const statusSnapshot = (): ControlPanelStatusSnapshot => ({
		modelProvider: "deepseek",
		modelId: "deepseek-v4-pro",
		thinkingLevel: "max",
		contextPercent: 0,
		contextWindowTokens: 1_000_000,
		headroomStatus: "headroom:0.29.0",
		skillCount: 96,
		mcpCount: 12,
		ansiColorState: "on",
		cwdLabel: "~/open_multi-agent_kit",
		gitBranch: "main",
	});

	return new ControlPanelComponent({
		appName: "omk",
		version: "0.78.0",
		compactInstructions: () => "escape interrupt · ctrl+c/ctrl+d clear/exit · / commands · ! bash · ctrl+o more",
		compactOnboarding: () => "Press ctrl+o to show full startup help and loaded resources.",
		expandedInstructions: () => "OMK//CONTROL READ route/verify/loop/control",
		onboarding: () =>
			[
				"[Context]",
				" 2 loaded · ~/AGENTS.md, AGENTS.md",
				"",
				"[Skills]",
				" 96 loaded · agentmemory, andrej-karpathy-skills, appshot-visual-context, blue-ribbon-nearby, browser-feedback, +91 more",
				"",
				"[Prompts]",
				" 2 loaded · /omk-parallel-goal, /root",
				"",
				"[Extensions]",
				" 3 loaded · headroom-integration, omk-runtime, subagent",
				"",
				"[Themes]",
				" 1 loaded · omk-control-grid-dark",
			].join("\n"),
		statusSnapshot,
	});
}

describe("ControlPanelComponent reference fidelity", () => {
	test("expanded wide render preserves the screenshot deck and fixed right control pane", () => {
		initTheme("omk-control-grid-dark");
		const panel = makePanel();

		panel.setExpanded(true);
		const plain = stripAnsi(panel.render(172).join("\n"));
		panel.dispose();

		expect(plain).toContain("omk v0.78.0 · OMK://CONTROL");
		expect(plain).toContain("████");
		expect(plain).toContain("OMK://CONTROL");
		// The figure plate is the opening's caption: exactly once, in the hero, never a rail row.
		expect(plain.split("FIG. 01 · THE CONTROL LOOP")).toHaveLength(2);
		expect(plain).toContain("MIT · PROVIDER-NEUTRAL");
		expect(plain).toContain("Scope the work. Route the right agents.");
		expect(plain).toContain("Verify every release.");
		for (const forbidden of [
			"CYBERPUNK OPS CORE",
			"NIGHT-CITY-MATRIX-V3",
			"MATRIX RAIN",
			"NEON GRID ONLINE",
			"pulse:",
			"sidebar: pinned",
			"route: active",
			"pkg:",
		]) {
			expect(plain).not.toContain(forbidden);
		}
		for (const section of ["RUN", "VERIFY", "CONTEXT", "RESOURCES"]) expect(plain).toContain(`─ ${section} ─`);
		expect(plain).toContain("meter:");
		expect(plain).toContain("SCOPE → ROUTE → VERIFY → REPLAY");
		expect(plain).not.toContain("OMK://CONTROL READ");
		expect(plain).toContain("MODEL deepseek-v4-pro:max");
		// Hero meta row: model and terminal setup only; RUN/VERIFY/CTX are rail rows beside it.
		expect(plain).toContain("MODEL deepseek-v4-pro:max  ·  THEME CONTROL-GRID-DARK  ·  ANSI ON");
		expect(plain).toContain("state: ? unknown");
		expect(plain).not.toContain("RUN ? unknown");
		expect(plain).toContain("[Context]");
		expect(plain).toContain("1 loaded · omk-control-grid-dark");

		const contextLine = plain.split("\n").find((line) => line.includes("[Context]"));
		const skillsLine = plain.split("\n").find((line) => line.includes("browser-feedback"));
		expect(contextLine).toMatch(/\[Context\]\s+│/);
		expect(contextLine).not.toContain("OMK://CONTROL");
		expect(skillsLine).toMatch(/browser-feedback, \+91 more\s+│/);
	});

	test("right pane component renders the fixed overlay control rail", () => {
		initTheme("omk-control-grid-dark");
		const pane = new ControlPanelRightPaneComponent({
			appName: "omk",
			version: "0.78.0",
			compactInstructions: () => "route/verify/loop/control",
			expandedInstructions: () => "OMK://CONTROL READ route/verify/loop/control",
			compactOnboarding: () => "",
			onboarding: () => "",
			statusSnapshot: () => ({
				modelProvider: "deepseek",
				modelId: "deepseek-v4-pro",
				thinkingLevel: "max",
				contextPercent: 0,
				contextWindowTokens: 1_000_000,
				headroomStatus: "headroom:0.29.0",
				skillCount: 96,
				mcpCount: 12,
				ansiColorState: "on",
				cwdLabel: "~/open_multi-agent_kit",
				gitBranch: "main",
			}),
		});

		const lines = pane.render(38).map(stripAnsi);
		const plain = lines.join("\n");
		expect(plain).toContain("OMK://CONTROL");
		for (const section of ["RUN", "VERIFY", "CONTEXT", "RESOURCES", "TODO", "SESSION"]) {
			expect(plain).toContain(`─ ${section} ─`);
		}
		expect(plain).toContain("meter:");
		expect(plain).toContain("verdict: ? unverified");
		// The overlay is viewport-anchored, so it keeps the live resource rows.
		expect(plain).toContain("cpu: ? unknown");
		expect(plain).toContain("rss: ?");
		for (const forbidden of RAIL_FORBIDDEN_TEXT) expect(plain).not.toContain(forbidden);
		expect(lines.every((line) => visibleWidth(line) === 38)).toBe(true);
	});
});

test("CJK emoji combining visibleWidth fixture keeps every row within 38 display cells", () => {
	const fixture = "模型🚀e\u0301";
	const statusSnapshot = (): ControlPanelStatusSnapshot => ({
		modelProvider: "openrouter",
		modelId: `${fixture}-model-with-a-very-long-tail-${fixture}`,
		thinkingLevel: "high",
		contextPercent: 38,
		contextWindowTokens: 128_000,
		headroomStatus: `headroom-${fixture}`,
		skillCount: 96,
		mcpCount: 12,
		ansiColorState: "on",
		cwdLabel: `~/작업/${fixture}/a-very-long-current-working-directory-that-must-fit`,
		gitBranch: `feature/${fixture}`,
		todoState: {
			items: [
				{ id: "done", label: `done ${fixture}`, status: "done" },
				{ id: "active", label: `active long TODO ${fixture} ${"測".repeat(24)}`, status: "active" },
				{ id: "pending", label: `pending ${fixture}`, status: "pending" },
			],
			updatedAt: 1,
		},
	});
	const panel = new ControlPanelRightPaneComponent({
		appName: "omk",
		version: "0.80.5",
		compactInstructions: () => "compact",
		expandedInstructions: () => "expanded",
		compactOnboarding: () => "compact onboarding",
		onboarding: () => "onboarding",
		statusSnapshot,
	});
	const lines = panel.render(38).map(stripAnsi);
	const wrongWidth = lines.filter((line) => visibleWidth(line) !== 38);

	expect(
		wrongWidth,
		"CJK emoji combining fixture must use display-cell visibleWidth, not code-unit length, for every 38-column right-rail row",
	).toEqual([]);
	expect(
		lines.join("\n"),
		"long TODO CJK semantic fixture should not be clipped to a single 38-cell wide glyph",
	).toContain("測測");
});
