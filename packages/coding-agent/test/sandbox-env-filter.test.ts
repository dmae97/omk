import { describe, expect, it } from "vitest";
import { filterSandboxEnv } from "../src/core/sandbox/env.ts";

describe("filterSandboxEnv", () => {
	it("strips loader-injection vars, secret-like names case-insensitively, and undefined entries", () => {
		const filtered = filterSandboxEnv({
			PATH: "/bin",
			HOME: "/h",
			OPENAI_API_KEY: "k",
			LD_PRELOAD: "x",
			DYLD_INSERT_LIBRARIES: "y",
			MY_TOKEN: "t",
			GH_TOKEN: "g",
			AWS_ACCESS_KEY_ID: "a",
			DB_PASSWORD: "p",
			UNDEF: undefined,
			TOKENIZER: "ok",
			my_api_key: "lower",
		});

		expect(filtered).toEqual({
			PATH: "/bin",
			HOME: "/h",
			TOKENIZER: "ok",
		});
	});

	it("strips all configured secret suffixes and exact secret variable names", () => {
		const secretKeys = [
			"SERVICE_API_KEY",
			"SERVICE_API_TOKEN",
			"OAUTH_ACCESS_TOKEN",
			"CLIENT_SECRET",
			"APP_SECRET_KEY",
			"SSH_PRIVATE_KEY",
			"USER_PASSWORD",
			"ROOT_PASSWD",
			"AUTH_TOKEN",
			"NPM_TOKEN",
			"NODE_AUTH_TOKEN",
			"GITHUB_TOKEN",
			"GH_TOKEN",
			"GITLAB_TOKEN",
			"OPENAI_API_KEY",
			"ANTHROPIC_API_KEY",
			"GOOGLE_API_KEY",
			"AZURE_API_KEY",
			"AWS_ACCESS_KEY_ID",
			"AWS_SECRET_ACCESS_KEY",
		];

		const input: NodeJS.ProcessEnv = { SAFE_VAR: "keep" };
		for (const key of secretKeys) {
			input[key] = "secret-value";
		}

		expect(filterSandboxEnv(input)).toEqual({ SAFE_VAR: "keep" });
	});

	it("preserves secret-named variables when explicitly allowlisted", () => {
		expect(filterSandboxEnv({ OPENAI_API_KEY: "k", PATH: "/bin" }, { allowlist: ["OPENAI_API_KEY"] })).toEqual({
			OPENAI_API_KEY: "k",
			PATH: "/bin",
		});
	});

	it("does not allow allowlist to override loader-injection variables", () => {
		expect(
			filterSandboxEnv(
				{ LD_PRELOAD: "x", DYLD_INSERT_LIBRARIES: "y" },
				{ allowlist: ["LD_PRELOAD", "DYLD_INSERT_LIBRARIES"] },
			),
		).toEqual({});
	});

	it("strips variables listed in extraBlocklist even if allowlisted", () => {
		expect(
			filterSandboxEnv({ FOO: "1", BAR: "2", PATH: "/bin" }, { extraBlocklist: ["FOO", "BAR"], allowlist: ["BAR"] }),
		).toEqual({ PATH: "/bin" });
	});

	it("keeps empty string values", () => {
		expect(filterSandboxEnv({ EMPTY: "" })).toEqual({ EMPTY: "" });
	});

	it("does not mutate the input env object", () => {
		const input: NodeJS.ProcessEnv = {
			PATH: "/bin",
			OPENAI_API_KEY: "k",
			LD_PRELOAD: "x",
			UNDEF: undefined,
		};
		const snapshot = { ...input };

		const filtered = filterSandboxEnv(input, {
			allowlist: ["PATH"],
			extraBlocklist: ["NONEXISTENT"],
		});

		expect(filtered).toEqual({ PATH: "/bin" });
		expect(input).toEqual(snapshot);
		expect("UNDEF" in input).toBe(true);
	});
});
