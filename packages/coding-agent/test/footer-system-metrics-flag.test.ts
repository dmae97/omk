import { describe, expect, it } from "vitest";
import type { AgentSession } from "../src/core/agent-session.ts";
import type { ReadonlyFooterDataProvider } from "../src/core/footer-data-provider.ts";
import { FooterComponent } from "../src/modes/interactive/components/footer.ts";

function createSession(): AgentSession {
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
		getContextUsage: () => ({ contextWindow: 200_000, percent: 10 }),
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

describe("FooterComponent system metrics flag", () => {
	it("reports whether live CPU/MEM metrics are enabled", () => {
		const footer = new FooterComponent(createSession(), createFooterData());
		expect(footer.isShowingSystemMetrics()).toBe(false);
		footer.setShowSystemMetrics(true);
		expect(footer.isShowingSystemMetrics()).toBe(true);
		footer.setShowSystemMetrics(false);
		expect(footer.isShowingSystemMetrics()).toBe(false);
	});
});
