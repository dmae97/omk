import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Both switches are read once at module load, so each case runs in its own
 * process. Reading them at call time instead would let a mid-session env change
 * silently alter what gets written to disk.
 */

const REDACTION_MODULE = fileURLToPath(new URL("../src/core/redaction.ts", import.meta.url));
const SECRET = "sk-abcdefghijklmnopqrstuvwxyz123456";

function redactUnder(env: NodeJS.ProcessEnv): { input: string; forced: string } {
	const probe = `
import { redactSensitiveText, redactSensitiveTextForced } from ${JSON.stringify(REDACTION_MODULE)};
const s = 'api_key: "${SECRET}"';
console.log(JSON.stringify({ input: redactSensitiveText(s), forced: redactSensitiveTextForced(s) }));
`;
	const stdout = execFileSync(process.execPath, ["--input-type=module", "-e", probe], {
		env: { ...process.env, PI_DISABLE_INPUT_REDACTION: undefined, OMK_DISABLE_REDACTION: undefined, ...env },
		encoding: "utf8",
		timeout: 60_000,
	});
	try {
		return JSON.parse(stdout.trim());
	} catch (error) {
		if (error instanceof SyntaxError) throw new Error("Redaction fixture returned invalid JSON");
		throw error;
	}
}

describe("redaction disable switches", () => {
	it("masks both surfaces by default", () => {
		const result = redactUnder({});

		expect(result.input).not.toContain(SECRET);
		expect(result.forced).not.toContain(SECRET);
	});

	it("PI_DISABLE_INPUT_REDACTION frees the model/session path but not disk", () => {
		// The name says input, so it must not change what a session file holds.
		const result = redactUnder({ PI_DISABLE_INPUT_REDACTION: "1" });

		expect(result.input).toContain(SECRET);
		expect(result.forced).not.toContain(SECRET);
	});

	it("OMK_DISABLE_REDACTION aliases only the input opt-out, never forced redaction", () => {
		const result = redactUnder({ OMK_DISABLE_REDACTION: "1" });

		expect(result.input).toContain(SECRET);
		expect(result.forced).not.toContain(SECRET);
	});

	it("accepts truthy spellings without weakening forced redaction", () => {
		for (const value of ["1", "true", "yes", "on", "TRUE"]) {
			const result = redactUnder({ OMK_DISABLE_REDACTION: value });
			expect(result.input, value).toContain(SECRET);
			expect(result.forced, value).not.toContain(SECRET);
		}
	});

	it("keeps an explicit primary setting ahead of the alias", () => {
		const result = redactUnder({ PI_DISABLE_INPUT_REDACTION: "0", OMK_DISABLE_REDACTION: "1" });
		expect(result.input).not.toContain(SECRET);
		expect(result.forced).not.toContain(SECRET);
	});

	it("treats anything else as off, so a typo keeps masking", () => {
		// Failing closed matters more here than convenience: a misspelled value
		// must not silently start writing credentials to disk.
		for (const value of ["0", "false", "no", "off", "", "maybe", "2"]) {
			const result = redactUnder({ OMK_DISABLE_REDACTION: value });
			expect(result.input, value).not.toContain(SECRET);
			expect(result.forced, value).not.toContain(SECRET);
		}
	});
});
