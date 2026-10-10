/**
 * Top-level CLI words owned by package-manager-cli.ts and package-doctor-cli.ts.
 *
 * main.ts routes on these before importing either module (package-manager-cli
 * pulls omk-tui, the package manager and glob), so they live in this
 * dependency-free module and both sides read the same check.
 */

export const CONFIG_COMMAND = "config";

export const PACKAGE_COMMANDS = ["install", "remove", "update", "list"] as const;

export type PackageCommand = (typeof PACKAGE_COMMANDS)[number];

const PACKAGE_COMMAND_ALIASES: Readonly<Record<string, PackageCommand>> = { uninstall: "remove" };

/** Canonical package command for a CLI word (aliases included), or undefined. */
export function resolvePackageCommand(word: string | undefined): PackageCommand | undefined {
	if (word === undefined) return undefined;
	if ((PACKAGE_COMMANDS as readonly string[]).includes(word)) return word as PackageCommand;
	return Object.hasOwn(PACKAGE_COMMAND_ALIASES, word) ? PACKAGE_COMMAND_ALIASES[word] : undefined;
}

/** Whether main.ts must hand this CLI word to package-manager-cli.ts. */
export function isPackageCliCommand(word: string | undefined): boolean {
	return word === CONFIG_COMMAND || resolvePackageCommand(word) !== undefined;
}

/** Whether main.ts must hand this argv to commands/package-doctor-cli.ts. */
export function isPackageDoctorCommand(args: readonly string[]): boolean {
	return args[0] === "package" && args[1] === "doctor";
}
