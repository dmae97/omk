import { resetCapabilitiesCache, setCapabilities } from "omk-tui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Counts how often highlight.js is evaluated. A static import in
// syntax-highlight.ts would evaluate it as soon as theme.ts is imported, which
// puts it on every headless `omk -p` worker's import graph.
const loads = vi.hoisted(() => ({ hljs: 0 }));

vi.mock("highlight.js/lib/index.js", async (importOriginal) => {
	loads.hljs++;
	return importOriginal();
});

describe("syntax highlighter lazy import", () => {
	beforeEach(() => {
		// theme.ts no longer statically imports omk-tui; drive truecolor via COLORTERM
		// (same hint omk-tui uses) so headless cold paths stay clear of the TUI package.
		process.env.COLORTERM = "truecolor";
		setCapabilities({ images: null, trueColor: true, hyperlinks: false });
	});

	afterEach(() => {
		delete process.env.COLORTERM;
		resetCapabilitiesCache();
	});

	it("does not load highlight.js until highlighting is requested", async () => {
		const { highlightCode, initTheme } = await import("../src/modes/interactive/theme/theme.ts");
		const { __readyListenerCountForTest, loadSyntaxHighlighter, onSyntaxHighlighterReady, supportsLanguage } =
			await import("../src/utils/syntax-highlight.ts");
		initTheme("dark");
		expect(loads.hljs).toBe(0);
		const { onThemedOutputStale } = await import("../src/modes/interactive/startup-deps.ts");
		const ready = vi.fn();
		const unsubscribed = vi.fn();
		// Interactive mode registers its theme-change refresh (ui.invalidate + requestRender) here.
		const unsubscribeStale = onThemedOutputStale(ready);
		expect(__readyListenerCountForTest()).toBe(1);
		// Dispose/teardown must drop the late-load listener so finished sessions do not stay alive.
		unsubscribeStale();
		expect(__readyListenerCountForTest()).toBe(0);
		onThemedOutputStale(ready);
		expect(__readyListenerCountForTest()).toBe(1);
		onSyntaxHighlighterReady(unsubscribed)();
		expect(__readyListenerCountForTest()).toBe(1);

		// Before the highlighter settles, code renders as plain code-block text instead of throwing.
		expect(highlightCode("const value = 1", "typescript")).toEqual(["\x1b[38;2;181;189;104mconst value = 1\x1b[39m"]);

		expect(ready).not.toHaveBeenCalled();

		await loadSyntaxHighlighter();
		await loadSyntaxHighlighter();
		expect(loads.hljs).toBe(1);
		expect(__readyListenerCountForTest()).toBe(0);
		// Plain output rendered before the load may be cached, so owners refresh exactly once.
		expect(ready).toHaveBeenCalledTimes(1);
		expect(unsubscribed).not.toHaveBeenCalled();
		const late = vi.fn();
		onSyntaxHighlighterReady(late);
		await loadSyntaxHighlighter();
		expect(late).not.toHaveBeenCalled();
		expect(supportsLanguage("typescript")).toBe(true);
		expect(highlightCode("const value = 1", "typescript")[0]).toContain("\x1b[38;2;86;156;214mconst\x1b[39m");
	});
});
