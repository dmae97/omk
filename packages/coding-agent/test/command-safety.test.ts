import { describe, expect, it } from "vitest";
import { classifyShellCommand } from "../src/core/command-safety.ts";

describe("command safety secret-path classification", () => {
	it("allows an rg pattern that resembles a secret file path", () => {
		expect(classifyShellCommand('rg -- "secret.read_path" packages/coding-agent/src')).toMatchObject({
			risk: "allow",
		});
	});

	it("allows a grep pattern that resembles a credential file path", () => {
		expect(classifyShellCommand('grep -- "auth.json" packages/coding-agent/src')).toMatchObject({
			risk: "allow",
		});
	});

	it("keeps secret file operands protected", () => {
		expect(classifyShellCommand("rg -- needle .env")).toMatchObject({
			risk: "confirm",
			rule: "secret.read_path",
		});
	});

	it("keeps grep pattern-file operands protected", () => {
		expect(classifyShellCommand("grep -f .env needle")).toMatchObject({
			risk: "confirm",
			rule: "secret.read_path",
		});
	});
});
