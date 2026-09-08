import { describe, expect, it } from "vitest";
import { redactSensitiveTextForced } from "../src/core/redaction.ts";

/**
 * The credential name pattern (`token`, `api_key`, `secret`, ...) matches a
 * declaration as readily as an assignment, so source the agent was reading came
 * back mangled: `access_token: string` became `access_token: [REDACTED]`, and
 * `api_key: os.environ["API_KEY"]` became `api_key: [REDACTED]"API_KEY"]` —
 * broken syntax around a value that was never a secret.
 *
 * Reading a credential from the environment is the correct pattern; masking it
 * hides nothing and corrupts the file.
 */

// Written as a concatenation so the source never contains a literal `${`,
// which Biome flags as a template-literal mistake. The test data is a shell
// placeholder, not an interpolation.
const BRACED_ENV_PLACEHOLDER = `client_secret: $${"{CLIENT_SECRET}"}`;

describe("values that cannot be secrets are left alone", () => {
	const preserved = [
		"interface Auth { access_token: string; refresh_token: string }",
		"type T = { token: number }",
		"class C { private secret?: string }",
		"const API_KEY = process.env.API_KEY",
		'api_key: os.environ["API_KEY"]',
		"token = os.getenv('GITHUB_TOKEN')",
		"const key = import.meta.env.VITE_API_KEY",
		"api_key: $API_KEY",
		BRACED_ENV_PLACEHOLDER,
		"password: <your-password-here>",
		"access_token: null",
		"token: undefined",
	];

	for (const source of preserved) {
		it(`preserves: ${source.slice(0, 46)}`, () => {
			expect(redactSensitiveTextForced(source)).toBe(source);
		});
	}

	it("never leaves broken syntax behind", () => {
		// The old unquoted pattern stopped at the quote and emitted a dangling
		// `"API_KEY"]`, which reads like a bug for the agent to fix.
		const source = 'api_key: os.environ["API_KEY"]';
		expect(redactSensitiveTextForced(source)).not.toContain("[REDACTED]");
	});
});

describe("real credentials are still masked", () => {
	// The security property. Relaxing false positives must not relax this.
	const alphabet = ["abcd", "efgh", "ijkl", "mnop", "qrst", "uvwx", "yz"].join("");
	const chars = (...codes: readonly number[]) => String.fromCharCode(...codes);
	const masked: readonly (readonly [string, string])[] = [
		["openai key", `const k = "${[chars(115, 107), `${alphabet}123456`].join("-")}"`],
		["google key", `key=${["AI", "zaSyA", "1234567890", alphabet, "stu"].join("")}`],
		["github pat", `token: ${["ghp", `${alphabet}0123456789`].join("_")}`],
		["slack token", ["xoxb", "1234567890", alphabet].join("-")],
		["stripe key", [chars(115, 107), chars(108, 105, 118, 101), `${alphabet.slice(0, 16)}1234`].join("_")],
		[
			"jwt",
			`Authorization: Bearer ${[
				["eyJh", "bGci", "OiJI", "UzI1", "NiJ9"].join(""),
				["eyJz", "dWIi", "OiIx", "In0"].join(""),
				alphabet.slice(0, 11),
			].join(".")}`,
		],
		["literal password", `password = ${["hunter", "2"].join("")}`],
		["quoted API credential", `${chars(97, 112, 105, 95, 107, 101, 121)}: "${alphabet.slice(0, 18)}"`],
	];

	for (const [label, source] of masked) {
		it(`masks ${label}`, () => {
			expect(redactSensitiveTextForced(source)).toContain("[REDACTED]");
		});
	}

	it("masks a real value even when a non-secret sits beside it", () => {
		const key = [chars(115, 107), `${alphabet}123456`].join("-");
		const source = `interface A { token: string }\nconst live = "${key}"`;
		const result = redactSensitiveTextForced(source);

		expect(result).toContain("token: string");
		expect(result).toContain("[REDACTED]");
		expect(result).not.toContain(key);
	});
});

describe("forced redaction ignores the input opt-out", () => {
	it("still masks at a persistence boundary", () => {
		// `redactSensitiveTextForced` is what writes session files, compaction
		// summaries and doctor reports. It must not consult the env switch.
		const alphabet = ["abcd", "efgh", "ijkl", "mnop", "qrst", "uvwx", "yz"].join("");
		const key = [String.fromCharCode(115, 107), `${alphabet}123456`].join("-");
		expect(redactSensitiveTextForced(`api_key: "${key}"`)).toContain("[REDACTED]");
	});
});
