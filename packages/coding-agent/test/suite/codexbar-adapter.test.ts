import { describe, expect, it } from "vitest";
import {
	CodexBarJsonError,
	CodexBarUnsafeOutputError,
	hasSecretLikeValue,
	parseCodexBarCostJson,
	parseCodexBarUsageJson,
	redactCodexBarJson,
} from "../../src/core/codexbar-adapter.ts";

describe("codexbar adapter", () => {
	it("returns a usage summary without account PII when usage JSON includes dashboard fields", () => {
		// Given
		const stdout = JSON.stringify({
			provider: "codex",
			source: "web",
			status: {
				indicator: "ok",
				description: "Operational",
				url: "https://status.openai.com",
			},
			usage: {
				updatedAt: "2026-07-07T01:02:03Z",
				primary: {
					usedPercent: 42,
					resetsAt: "2026-07-07T12:00:00Z",
				},
				secondary: {
					usedPercent: 7,
					resetsAt: "2026-07-08T12:00:00Z",
				},
				identity: {
					accountEmail: "alice@example.com",
					accountOrganization: "Acme Private Org",
				},
				accountEmail: "alice@example.com",
				accountOrganization: "Acme Private Org",
			},
			credits: {
				remaining: 123.45,
				updatedAt: "2026-07-07T01:02:04Z",
			},
			openaiDashboard: {
				signedInEmail: "alice@example.com",
				creditEvents: [{ id: "evt_1", service: "codex", creditsUsed: 1 }],
				dailyBreakdown: [{ day: "2026-07-07", totalCreditsUsed: 1 }],
			},
		});

		// When
		const summary = parseCodexBarUsageJson(stdout);

		// Then
		expect(summary).toEqual({
			provider: "codex",
			source: "web",
			primary: {
				usedPercent: 42,
				resetsAt: "2026-07-07T12:00:00Z",
			},
			secondary: {
				usedPercent: 7,
				resetsAt: "2026-07-08T12:00:00Z",
			},
			creditsRemaining: 123.45,
			updatedAt: "2026-07-07T01:02:03Z",
			status: {
				indicator: "ok",
				description: "Operational",
				url: "https://status.openai.com",
			},
		});
		expect(JSON.stringify(summary)).not.toContain("alice@example.com");
		expect(JSON.stringify(summary)).not.toContain("Acme Private Org");
	});

	it("returns cost totals without project names or paths when cost JSON includes projects", () => {
		// Given
		const stdout = JSON.stringify([
			{
				provider: "codex",
				source: "cli",
				updatedAt: "2026-07-07T02:03:04Z",
				sessionCostUSD: 1.23,
				last30DaysCostUSD: 12.34,
				projects: [
					{
						name: "secret-product-rewrite",
						path: "/Users/alice/work/secret-product-rewrite",
						totalTokens: 1000,
						totalCost: 4.56,
					},
				],
				totals: {
					totalTokens: 98765,
					totalCost: 45.67,
				},
			},
		]);

		// When
		const summaries = parseCodexBarCostJson(stdout);

		// Then
		expect(summaries).toEqual([
			{
				provider: "codex",
				source: "cli",
				sessionCostUSD: 1.23,
				last30DaysCostUSD: 12.34,
				totalCostUSD: 45.67,
				totalTokens: 98765,
				updatedAt: "2026-07-07T02:03:04Z",
			},
		]);
		expect(JSON.stringify(summaries)).not.toContain("/Users/alice/work");
		expect(JSON.stringify(summaries)).not.toContain("secret-product-rewrite");
	});

	it("throws CodexBarJsonError when stdout is invalid JSON", () => {
		// Given
		const stdout = "{not json";

		// When / Then
		expect(() => parseCodexBarUsageJson(stdout)).toThrow(CodexBarJsonError);
	});

	it("throws CodexBarUnsafeOutputError when a nested value looks like a credential", () => {
		// Given
		const marker = `${"Bear"}${"er"} ${"s"}${"k"}-test-redacted-fixture`;
		const stdout = JSON.stringify({
			provider: "codex",
			usage: {
				primary: {
					usedPercent: 1,
				},
			},
			debug: {
				header: marker,
			},
		});

		// When / Then
		expect(() => parseCodexBarUsageJson(stdout)).toThrow(CodexBarUnsafeOutputError);
		expect(hasSecretLikeValue({ nested: marker })).toBe(true);
	});

	it("tolerates minimal usage and cost schemas", () => {
		// Given
		const usageStdout = JSON.stringify({ provider: "codex", usage: {} });
		const costStdout = JSON.stringify([{ provider: "codex", totals: {} }]);

		// When
		const usageSummary = parseCodexBarUsageJson(usageStdout);
		const costSummary = parseCodexBarCostJson(costStdout);

		// Then
		expect(usageSummary).toEqual({ provider: "codex" });
		expect(costSummary).toEqual([{ provider: "codex" }]);
	});

	it("redacts sensitive CodexBar fields from arbitrary JSON", () => {
		// Given
		const value = {
			accountEmail: "alice@example.com",
			accountOrganization: "Acme Private Org",
			openaiDashboard: {
				signedInEmail: "alice@example.com",
				creditEvents: [{ id: "evt_1" }],
				dailyBreakdown: [{ day: "2026-07-07" }],
			},
			projects: [{ name: "secret-project", path: "/Users/alice/secret-project", totalTokens: 100 }],
		};

		// When
		const redacted = redactCodexBarJson(value);

		// Then
		expect(redacted).toEqual({
			openaiDashboard: {},
			projects: [{ totalTokens: 100 }],
		});
	});
});

/**
 * Formal regression obligations from algorithm-codexbar-redaction-invariant.md §7 (PB1–PB4).
 * Connector opt-in (C1) lives in codexbar-cli.ts only — not asserted here (adapter N/A).
 */
describe("algorithm-codexbar-redaction-invariant", () => {
	const usagePiiEmail = "invariant-pii-nested@example.com";
	const usagePiiOrg = "Invariant Org Secret";
	const projectPath = "/Users/invariant/secret/repo";
	const projectName = "invariant-secret-project";

	it("PB2 / I_proj: usage.identity.accountEmail absent from σ(parseCodexBarUsageJson)", () => {
		const stdout = JSON.stringify({
			provider: "codex",
			usage: {
				primary: { usedPercent: 10 },
				identity: {
					accountEmail: usagePiiEmail,
					accountOrganization: usagePiiOrg,
				},
			},
		});

		const summary = parseCodexBarUsageJson(stdout);
		const serialized = JSON.stringify(summary);

		expect(serialized).not.toContain(usagePiiEmail);
		expect(serialized).not.toContain(usagePiiOrg);
		expect(summary).toEqual({
			provider: "codex",
			primary: { usedPercent: 10 },
		});
	});

	it("PB2 / I_proj: openaiDashboard nested PII absent from usage summary σ(Σ_usage)", () => {
		const stdout = JSON.stringify({
			provider: "codex",
			usage: { primary: { usedPercent: 5 } },
			openaiDashboard: {
				signedInEmail: usagePiiEmail,
				creditEvents: [{ id: "evt_invariant", creditsUsed: 9 }],
				dailyBreakdown: [{ day: "2026-07-08", totalCreditsUsed: 9 }],
			},
		});

		const summary = parseCodexBarUsageJson(stdout);
		const serialized = JSON.stringify(summary);

		expect(serialized).not.toContain(usagePiiEmail);
		expect(serialized).not.toContain("evt_invariant");
		expect(serialized).not.toContain("2026-07-08");
		expect(summary).toEqual({
			provider: "codex",
			primary: { usedPercent: 5 },
		});
	});

	it("PB3 / I_proj: projects[].path and projects[].name absent from σ(parseCodexBarCostJson)", () => {
		const stdout = JSON.stringify([
			{
				provider: "codex",
				projects: [
					{
						name: projectName,
						path: projectPath,
						totalTokens: 42,
						totalCost: 1.11,
					},
				],
				totals: { totalTokens: 42, totalCost: 1.11 },
			},
		]);

		const summaries = parseCodexBarCostJson(stdout);
		const serialized = JSON.stringify(summaries);

		expect(serialized).not.toContain(projectPath);
		expect(serialized).not.toContain(projectName);
		expect(summaries).toEqual([
			{
				provider: "codex",
				totalCostUSD: 1.11,
				totalTokens: 42,
			},
		]);
	});

	it("PB4: redactCodexBarJson mirrors Π omission for F_PII and projects path/name", () => {
		const value = {
			usage: {
				identity: { accountEmail: usagePiiEmail },
			},
			openaiDashboard: {
				signedInEmail: usagePiiEmail,
				creditEvents: [{ id: "x" }],
			},
			projects: [{ name: projectName, path: projectPath, totalCost: 1 }],
		};

		const redacted = redactCodexBarJson(value);
		const serialized = JSON.stringify(redacted);

		expect(serialized).not.toContain(usagePiiEmail);
		expect(serialized).not.toContain(projectPath);
		expect(serialized).not.toContain(projectName);
		expect(redacted).toEqual({
			usage: { identity: {} },
			openaiDashboard: {},
			projects: [{ totalCost: 1 }],
		});
	});

	it("PB1 / I_sec: parseCodexBarUsageJson rejects P_sec-matching leaves before emit", () => {
		const marker = `${"Bear"}${"er"} ${"s"}${"k"}-invariant-pb1-gate`;
		const stdout = JSON.stringify({
			provider: "codex",
			usage: { primary: { usedPercent: 1, resetsAt: marker } },
		});

		expect(() => parseCodexBarUsageJson(stdout)).toThrow(CodexBarUnsafeOutputError);
	});
});
