import { describe, expect, it } from "vitest";
import { type FirstRunInput, planFirstRun } from "../src/modes/interactive/first-run.ts";

const input = (overrides: Partial<FirstRunInput> & { source?: "stored" | "environment" } = {}): FirstRunInput => ({
	session: {
		model: undefined,
		modelRegistry: { authStorage: { getAuthStatus: () => ({ source: overrides.source }) } },
	},
	settings: { getDefaultProvider: () => undefined },
	initialMessage: undefined,
	env: { HOME: "/home/dev" },
	exists: () => false,
	...overrides,
});

describe("first-run plan", () => {
	it("opens sign-in when no model is usable", () => {
		const plan = planFirstRun(input());
		expect(plan.openLogin).toBe(true);
		expect(plan.notices[0]).toMatch(/First run/);
	});

	it("treats the session's unknown-model sentinel as no model", () => {
		const plan = planFirstRun(
			input({
				session: {
					model: { provider: "unknown", id: "unknown" },
					modelRegistry: { authStorage: { getAuthStatus: () => ({}) } },
				},
			}),
		);
		expect(plan.openLogin).toBe(true);
	});

	it("names adoptable logins by checking existence only", () => {
		const seen: string[] = [];
		const plan = planFirstRun(
			input({
				env: { CLAUDE_CONFIG_DIR: "/home/dev/.claude" },
				exists: (path) => {
					seen.push(path);
					return path === "/home/dev/.claude/.credentials.json";
				},
			}),
		);
		expect(plan.notices.some((notice) => notice.includes("omk provider adopt anthropic"))).toBe(true);
		expect(seen).toContain("/home/dev/.claude/.credentials.json");
	});

	it("does not hijack a launch that already carries a prompt", () => {
		expect(planFirstRun(input({ initialMessage: "fix the build" }))).toEqual({ openLogin: false, notices: [] });
	});

	it("explains a default chosen from ambient AWS credentials", () => {
		const plan = planFirstRun(
			input({
				session: {
					model: { provider: "amazon-bedrock", id: "us.anthropic.claude-opus-4-6-v1" },
					modelRegistry: { authStorage: { getAuthStatus: () => ({ source: undefined }) } },
				},
				env: { AWS_ACCESS_KEY_ID: "x", AWS_SECRET_ACCESS_KEY: "y" },
			}),
		);
		expect(plan.openLogin).toBe(false);
		expect(plan.notices[0]).toContain("AWS_ACCESS_KEY_ID");
		expect(plan.notices[0]).not.toContain("AWS_SECRET_ACCESS_KEY");
	});

	it("stays quiet when the ambient provider was chosen deliberately", () => {
		const bedrockSession = {
			model: { provider: "amazon-bedrock", id: "us.anthropic.claude-opus-4-6-v1" },
			modelRegistry: { authStorage: { getAuthStatus: () => ({ source: "stored" as const }) } },
		};
		expect(planFirstRun(input({ session: bedrockSession })).notices).toEqual([]);
		expect(
			planFirstRun(
				input({
					session: { ...bedrockSession, modelRegistry: { authStorage: { getAuthStatus: () => ({}) } } },
					settings: { getDefaultProvider: () => "amazon-bedrock" },
				}),
			).notices,
		).toEqual([]);
	});

	it("stays quiet for providers that use their own key", () => {
		expect(
			planFirstRun(
				input({
					session: {
						model: { provider: "anthropic", id: "claude-opus-4-8" },
						modelRegistry: { authStorage: { getAuthStatus: () => ({ source: "environment" }) } },
					},
				}),
			),
		).toEqual({ openLogin: false, notices: [] });
	});
});
