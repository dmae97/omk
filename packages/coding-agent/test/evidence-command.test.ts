import { describe, expect, it } from "vitest";
import { EvidenceCommandError, parseEvidenceCommandShape } from "../src/guardrails/evidence-command.ts";

// Built at runtime so secret scanners do not flag the fixture as a real credential.
const SYNTHETIC_AUTH_HEADER = ["Author", "ization: Bearer ", "synthetic-raw-token"].join("");

describe("parseEvidenceCommandShape", () => {
	it("parses argv and shell descriptors without inspecting credential content", () => {
		const argv = parseEvidenceCommandShape({
			kind: "argv",
			executable: "curl",
			argv: ["--token", "synthetic-raw-token", "https://example.test"],
		});
		expect(argv).toEqual({
			kind: "argv",
			executable: "curl",
			argv: ["--token", "synthetic-raw-token", "https://example.test"],
		});
		expect(Object.isFrozen(argv)).toBe(true);

		const shell = parseEvidenceCommandShape({
			kind: "shell",
			shell: "/bin/sh",
			script: `curl -H '${SYNTHETIC_AUTH_HEADER}' https://example.test`,
		});
		expect(shell).toEqual({
			kind: "shell",
			shell: "/bin/sh",
			script: `curl -H '${SYNTHETIC_AUTH_HEADER}' https://example.test`,
		});
		expect(Object.isFrozen(shell)).toBe(true);
	});

	it("rejects malformed descriptors with a typed error", () => {
		for (const value of [
			null,
			[],
			{ kind: "pipe" },
			{ kind: "argv", executable: "node" },
			{ kind: "argv", executable: "node", argv: ["ok", 1] },
			{ kind: "argv", executable: "node", argv: ["bad\0arg"] },
			{ kind: "shell", shell: "/bin/sh", script: "" },
			{ kind: "shell", shell: "/bin/sh", script: "bad\0script" },
		]) {
			expect(() => parseEvidenceCommandShape(value)).toThrow(EvidenceCommandError);
		}
	});

	it("rejects accessor properties without invoking them", () => {
		let getterInvoked = false;
		const command: Record<string, unknown> = { kind: "argv", executable: "node", argv: ["--version"] };
		delete command.executable;
		Object.defineProperty(command, "executable", {
			enumerable: true,
			get: () => {
				getterInvoked = true;
				return "node";
			},
		});
		expect(() => parseEvidenceCommandShape(command)).toThrow(/invalid key set/);
		expect(getterInvoked).toBe(false);
	});
});
