import { describe, expect, it } from "vitest";
import { isPackageCliCommand, PACKAGE_COMMANDS, resolvePackageCommand } from "../src/cli/package-commands.ts";

// main.ts routes on this list before lazily importing package-manager-cli.ts, and
// package-manager-cli parses with the same resolver, so the two cannot drift.
describe("package CLI command list", () => {
	it("routes every package command, the uninstall alias and config", () => {
		expect([...PACKAGE_COMMANDS]).toEqual(["install", "remove", "update", "list"]);
		for (const command of PACKAGE_COMMANDS) {
			expect(resolvePackageCommand(command)).toBe(command);
			expect(isPackageCliCommand(command)).toBe(true);
		}
		expect(resolvePackageCommand("uninstall")).toBe("remove");
		expect(isPackageCliCommand("uninstall")).toBe(true);
		expect(isPackageCliCommand("config")).toBe(true);
		expect(resolvePackageCommand("config")).toBeUndefined();
	});

	it("leaves other argv words to the main CLI", () => {
		for (const word of [undefined, "", "-p", "--help", "doctor", "Install", "toString", "constructor"]) {
			expect(isPackageCliCommand(word)).toBe(false);
		}
	});
});
