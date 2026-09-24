import { stripVTControlCharacters } from "node:util";
import fc from "fast-check";
import { beforeAll, describe, expect, it } from "vitest";
import type { AgentSession } from "../src/core/agent-session.ts";
import type { ReadonlyFooterDataProvider } from "../src/core/footer-data-provider.ts";
import { FooterComponent } from "../src/modes/interactive/components/footer.ts";
import { initTheme, theme } from "../src/modes/interactive/theme/theme.ts";

// Session and footer-data fakes follow test/footer-width.test.ts, with the context percentage as the input.
function createSession(percent: number | null): AgentSession {
	const session = {
		state: {
			model: { id: "test-model", provider: "test", contextWindow: 200_000, reasoning: false },
			thinkingLevel: "off",
		},
		sessionManager: {
			getEntries: () => [],
			getSessionName: () => "",
			getCwd: () => "/tmp/project",
		},
		getContextUsage: () => ({ contextWindow: 200_000, percent }),
		modelRegistry: { isUsingOAuth: () => false },
	};
	return session as unknown as AgentSession;
}

function createFooterData(): ReadonlyFooterDataProvider {
	return {
		getGitBranch: () => "main",
		getExtensionStatuses: () => new Map<string, string>(),
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

function renderFooter(percent: number | null): string {
	return new FooterComponent(createSession(percent), createFooterData()).render(120).join("\n");
}

/** Independent spec of the colour bands: 70 and 90 are inclusive lower bounds. */
function band(percent: number): "error" | "warning" | "none" {
	if (percent >= 90) return "error";
	return percent >= 70 ? "warning" : "none";
}

function colourOf(output: string, display: string): "error" | "warning" | "none" {
	if (output.includes(theme.fg("error", display))) return "error";
	return output.includes(theme.fg("warning", display)) ? "warning" : "none";
}

describe("footer context percentage pressure", () => {
	beforeAll(() => {
		initTheme(undefined, false);
	});

	it("uses distinct colour sequences, so the colour assertions are not vacuous", () => {
		const text = "70.0%/200k (auto)";
		expect(theme.fg("warning", text)).not.toBe(text);
		expect(theme.fg("error", text)).not.toBe(text);
		expect(theme.fg("warning", text)).not.toBe(theme.fg("error", text));
	});

	it("floors 69.96% to 69.9% and leaves it uncoloured", () => {
		const output = renderFooter(69.96);
		expect(output).toContain("69.9%/200k (auto)");
		expect(output).not.toContain("70.0%");
		expect(colourOf(output, "69.9%/200k (auto)")).toBe("none");
	});

	// The largest doubles below each threshold must not display the threshold itself.
	it.each([
		[69.99999999999999, "69.9%/200k (auto)", "none"],
		[89.99999999999999, "89.9%/200k (auto)", "warning"],
	] as const)("keeps %s below its threshold as %s", (percent, display, colour) => {
		const output = renderFooter(percent);
		expect(stripVTControlCharacters(output)).toContain(display);
		expect(colourOf(output, display)).toBe(colour);
	});

	it("shows 70% as 70.0% in the warning colour", () => {
		expect(renderFooter(70)).toContain(theme.fg("warning", "70.0%/200k (auto)"));
	});

	it("shows 90% as 90.0% in the error colour", () => {
		expect(renderFooter(90)).toContain(theme.fg("error", "90.0%/200k (auto)"));
	});

	it("leaves 42.5% uncoloured", () => {
		const output = renderFooter(42.5);
		expect(output).toContain("42.5%/200k (auto)");
		expect(colourOf(output, "42.5%/200k (auto)")).toBe("none");
	});

	it("keeps an unknown percentage as an uncoloured ?", () => {
		const output = renderFooter(null);
		expect(output).toContain("?/200k (auto)");
		expect(colourOf(output, "?/200k (auto)")).toBe("none");
	});

	it("never shows a number in a higher band than its colour", () => {
		const nearThreshold = fc
			.tuple(fc.constantFrom(70, 90), fc.integer({ min: -20, max: 20 }))
			.map(([threshold, hundredths]) => (threshold * 100 + hundredths) / 100);
		const percent = fc.oneof(nearThreshold, fc.double({ min: 0, max: 100, noNaN: true }));
		fc.assert(
			fc.property(percent, (value) => {
				const output = renderFooter(value);
				const shown = /(\d+\.\d)%\/200k/.exec(stripVTControlCharacters(output))?.[1];
				if (shown === undefined) throw new Error(`no context percentage rendered for ${value}`);
				expect(band(Number(shown))).toBe(band(value));
				expect(colourOf(output, `${shown}%/200k (auto)`)).toBe(band(value));
			}),
		);
	});
});
