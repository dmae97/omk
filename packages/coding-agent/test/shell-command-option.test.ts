import { describe, expect, it } from "vitest";
import { curlValue } from "../src/guardrails/shell-command-option.ts";
import { normalizeStaticShell, StaticShellSyntaxError } from "../src/guardrails/shell-command-tokenizer.ts";

describe("curlValue", () => {
	it.each(["--config", "--output", "--upload-file"])("locates the file value of %s", (option) => {
		expect(curlValue(option)).toEqual({ kind: "file", offset: option.length });
		expect(curlValue(`${option}=x`)).toEqual({ kind: "file", offset: option.length + 1 });
	});

	it("locates header values", () => {
		expect(curlValue("--header")).toEqual({ kind: "header", offset: 8 });
		expect(curlValue("--header=X: y")).toEqual({ kind: "header", offset: 9 });
	});

	it("locates short flag values", () => {
		expect(curlValue("-o")).toEqual({ kind: "file", offset: 2 });
		expect(curlValue("-H")).toEqual({ kind: "header", offset: 2 });
	});

	it("locates the offset of values attached to the short option", () => {
		expect(curlValue("-oout.txt")).toEqual({ kind: "file", offset: 2 });
		expect(curlValue("-sSoout.txt")).toEqual({ kind: "file", offset: 4 });
	});

	it("locates values after bundled short flags", () => {
		expect(curlValue("-sSo")).toEqual({ kind: "file", offset: 4 });
		expect(curlValue("-sH")).toEqual({ kind: "header", offset: 3 });
	});

	it("returns undefined when there is no value option", () => {
		expect(curlValue("--silent")).toBeUndefined();
		expect(curlValue("-v")).toBeUndefined();
		expect(curlValue("x")).toBeUndefined();
	});
});

describe("curl attached short-option values in the shell guardrail", () => {
	it("treats the attached file value as the file, not the URL", () => {
		expect(() => normalizeStaticShell("curl -oout.txt https://example.test?reg?on=CANARY")).toThrow(
			StaticShellSyntaxError,
		);
	});
});
