import { stripVTControlCharacters } from "node:util";
import { CURSOR_MARKER, Text, TUI, visibleWidth } from "omk-tui";
import { beforeAll, describe, expect, it } from "vitest";
import { VirtualTerminal } from "../../tui/test/virtual-terminal.ts";
import type { AgentSession } from "../src/core/agent-session.ts";
import type { ReadonlyFooterDataProvider } from "../src/core/footer-data-provider.ts";
import { KeybindingsManager } from "../src/core/keybindings.ts";
import { CustomEditor, formatEditorPlanCaption } from "../src/modes/interactive/components/custom-editor.ts";
import { FooterComponent } from "../src/modes/interactive/components/footer.ts";
import { ToolExecutionComponent } from "../src/modes/interactive/components/tool-execution.ts";
import { footerPanelModel } from "../src/modes/interactive/opentui-footer-model.ts";
import { getEditorTheme, initTheme, theme } from "../src/modes/interactive/theme/theme.ts";

function createFooterSession(): AgentSession {
	return {
		state: {
			model: { id: "gpt-6", provider: "openai", contextWindow: 200_000, reasoning: true },
			thinkingLevel: "high",
		},
		sessionManager: {
			getEntries: () => [
				{
					type: "message",
					message: {
						role: "assistant",
						usage: { input: 12_345, output: 678, cacheRead: 0, cacheWrite: 0, cost: { total: 0.25 } },
					},
				},
			],
			getSessionName: () => "audit",
			getCwd: () => "/tmp/project",
		},
		getContextUsage: () => ({ contextWindow: 200_000, percent: 12.3 }),
		modelRegistry: { isUsingOAuth: () => false },
	} as unknown as AgentSession;
}

function createFooterData(statuses: ReadonlyArray<readonly [string, string]> = []): ReadonlyFooterDataProvider {
	return {
		getGitBranch: () => "main",
		getExtensionStatuses: () => new Map(statuses),
		getAvailableProviderCount: () => 1,
		getCpuPercent: () => null,
		getMemoryRssBytes: () => null,
		getSystemCpuPercent: () => null,
		getSystemMemoryUsedBytes: () => null,
		getSystemMemoryTotalBytes: () => null,
		getPackageIntakeSummary: () => ({
			total: 0,
			acceptedNative: 0,
			acceptedReference: 0,
			acceptedMeasurement: 0,
			acceptedAdvisory: 0,
			deferred: 0,
			reject: 0,
			hardForkBlocked: 0,
			topLanes: [],
		}),
		onBranchChange: () => () => {},
	};
}

describe("Paper Academic TUI chrome", () => {
	beforeAll(() => {
		initTheme("omk-paper-dark", false);
	});

	describe("FooterComponent", () => {
		it("renders structured CWD/GIT metadata, hairline dot separators, and hairline extension rail", () => {
			const footer = new FooterComponent(
				createFooterSession(),
				createFooterData([
					["branch", "main *1"],
					["plan", "plan:feature (ro)"],
				]),
			);
			const width = 100;
			const lines = footer.render(width);
			expect(lines).toHaveLength(3);
			for (const line of lines) {
				expect(visibleWidth(line)).toBeLessThanOrEqual(width);
			}
			const plain = lines.map((line) => stripVTControlCharacters(line));
			expect(plain[0]).toBe("CWD /tmp/project · GIT main · audit");
			expect(plain[1]).toContain("↑12k · ↓678 · $0.250 · 12.3%/200k (auto)");
			expect(plain[1]?.endsWith("gpt-6 • high")).toBe(true);
			expect(plain[2]).toBe("│ main *1 · plan:feature (ro)");

			const model = footerPanelModel(footer.renderParts(width), "#ede6d6");
			expect(model.lines).toHaveLength(3);
			expect(model.lines[1]!.right.map((s) => s.text).join("")).toBe("gpt-6 • high");
		});
	});

	describe("CustomEditor", () => {
		it("renders a closed borderMuted hairline frame and doses borderColor onto the prompt glyph only", () => {
			const ui = new TUI(new VirtualTerminal(80, 30));
			const editor = new CustomEditor(ui, getEditorTheme(), new KeybindingsManager());
			editor.focused = true;
			const loudAccent = (s: string) => theme.fg("accent", s);
			editor.borderColor = loudAccent;

			const lines = editor.render(80);
			expect(lines.length).toBeGreaterThanOrEqual(3);
			for (const line of lines) {
				expect(visibleWidth(line)).toBe(80);
			}

			const plain = lines.map((line) => stripVTControlCharacters(line));
			expect(plain[0]?.startsWith("┌─ ▸ PROMPT ")).toBe(true);
			expect(plain[0]?.endsWith("┐")).toBe(true);
			expect(plain[1]?.startsWith("│")).toBe(true);
			expect(plain[1]?.endsWith("│")).toBe(true);
			expect(plain.at(-1)?.startsWith("└")).toBe(true);
			expect(plain.at(-1)?.endsWith("┘")).toBe(true);

			// Border rules stay low-saturation borderMuted; accent colors only the single glyph.
			expect(lines[0]).toContain(theme.fg("accent", "▸"));
			expect(lines[0]).not.toContain(theme.fg("accent", "───"));
			expect(lines.at(-1)).not.toContain(theme.fg("accent", "───"));
			expect(lines.some((line) => line.includes(CURSOR_MARKER))).toBe(true);
			expect(editor.borderColor).toBe(loudAccent);
		});

		it("surfaces scroll indicators inside the top/bottom hairline rules", () => {
			const ui = new TUI(new VirtualTerminal(60, 18));
			const editor = new CustomEditor(ui, getEditorTheme(), new KeybindingsManager());
			editor.setText(Array.from({ length: 12 }, (_, i) => `line ${i + 1}`).join("\n"));

			const lines = editor.render(60);
			for (const line of lines) {
				expect(visibleWidth(line)).toBe(60);
			}
			const plain = lines.map((line) => stripVTControlCharacters(line));
			expect(plain[0]).toContain("↑ ");
			expect(plain[0]?.startsWith("┌─")).toBe(true);
			expect(plain[0]?.endsWith("┐")).toBe(true);
		});

		it("preserves hairline frame when input contains box-drawing dashes and falls back cleanly below width 8", () => {
			const ui = new TUI(new VirtualTerminal(60, 18));
			const editor = new CustomEditor(ui, getEditorTheme(), new KeybindingsManager());
			editor.setText("────────");
			const lines = editor.render(60);
			const plain = lines.map((line) => stripVTControlCharacters(line));
			expect(plain[0]?.startsWith("┌─ ▸ PROMPT ")).toBe(true);
			expect(plain[1]).toContain("────────");
			expect(plain[1]?.startsWith("│")).toBe(true);
			expect(plain[1]?.endsWith("│")).toBe(true);
			expect(plain.at(-1)?.startsWith("└")).toBe(true);

			const narrow = editor.render(6);
			expect(narrow.length).toBeGreaterThanOrEqual(3);
			for (const line of narrow) {
				expect(visibleWidth(line)).toBeLessThanOrEqual(6);
			}
		});

		it("renders dynamic plan/exec caption in the prompt top hairline when provided", () => {
			const ui = new TUI(new VirtualTerminal(80, 30));
			const editor = new CustomEditor(ui, getEditorTheme(), new KeybindingsManager());
			editor.getPromptLabel = () => formatEditorPlanCaption(theme.fg("warning", "plan:feature (ro)"));

			const planningLine = stripVTControlCharacters(editor.render(80)[0]!);
			expect(planningLine.startsWith("┌─ ▸ PLAN · FEATURE (RO) ")).toBe(true);
			expect(visibleWidth(planningLine)).toBe(80);

			editor.getPromptLabel = () => formatEditorPlanCaption("plan:feature 2/4");
			const execLine = stripVTControlCharacters(editor.render(80)[0]!);
			expect(execLine.startsWith("┌─ ▸ EXEC · FEATURE 2/4 ")).toBe(true);
			expect(formatEditorPlanCaption(undefined)).toBeUndefined();
		});
	});

	describe("ToolExecutionComponent", () => {
		it("renders transparent Booktabs hairlines with a single semantic status badge per state", () => {
			const fakeTui = { requestRender: () => {} } as unknown as TUI;
			const component = new ToolExecutionComponent(
				"custom_tool",
				"tc-1",
				{ path: "a.ts" },
				{},
				{
					name: "custom_tool",
					label: "custom_tool",
					description: "test",
					parameters: {} as never,
					execute: async () => ({ content: [{ type: "text", text: "ok" }], details: {} }),
					renderCall: () => new Text("custom call", 0, 0),
					renderResult: () => new Text("custom result", 0, 0),
				},
				fakeTui,
				process.cwd(),
			);

			const pending = component.render(80);
			expect(pending.join("\n")).not.toMatch(/\x1b\[48;/);
			const pendingPlain = pending.map((line) => stripVTControlCharacters(line));
			expect(pendingPlain[1]).toMatch(/^── ● RUN ─+$/);
			expect(pendingPlain.at(-1)).toMatch(/^─+$/);
			expect(visibleWidth(pending[1]!)).toBe(80);
			expect(visibleWidth(pending.at(-1)!)).toBe(80);

			component.updateResult({ content: [{ type: "text", text: "ok" }], details: {}, isError: false }, false);
			const ok = component.render(80);
			expect(ok.join("\n")).not.toMatch(/\x1b\[48;/);
			expect(stripVTControlCharacters(ok[1]!)).toMatch(/^── ✓ OK ─+$/);

			component.updateResult({ content: [{ type: "text", text: "boom" }], details: {}, isError: true }, false);
			const err = component.render(80);
			expect(err.join("\n")).not.toMatch(/\x1b\[48;/);
			expect(stripVTControlCharacters(err[1]!)).toMatch(/^── ! ERR ─+$/);
		});

		it("applies transparent hairlines to generic fallback tools without definitions", () => {
			const fakeTui = { requestRender: () => {} } as unknown as TUI;
			const component = new ToolExecutionComponent(
				"unknown_tool",
				"tc-fallback",
				{ key: "val" },
				{},
				undefined,
				fakeTui,
				process.cwd(),
			);
			const lines = component.render(80);
			expect(lines.join("\n")).not.toMatch(/\x1b\[48;/);
			expect(stripVTControlCharacters(lines[1]!)).toMatch(/^── ● RUN ─+$/);
			expect(stripVTControlCharacters(lines.join("\n"))).toContain("unknown_tool");
		});
	});
});
