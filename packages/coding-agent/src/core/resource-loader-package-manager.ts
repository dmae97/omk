import type { DefaultPackageManager } from "./package-manager.ts";
import type { SettingsManager } from "./settings-manager.ts";

export type PackageManagerFactoryOptions = {
	cwd: string;
	agentDir: string;
	settingsManager: SettingsManager;
};

export async function loadResourcePackageManager(
	existing: DefaultPackageManager | undefined,
	options: PackageManagerFactoryOptions,
): Promise<DefaultPackageManager> {
	if (existing) return existing;
	const { DefaultPackageManager: PM } = await import("./package-manager.ts");
	return new PM(options);
}

/** Resolve installed package paths using a lazily constructed package manager. */
export async function resolveResourcePackagePaths(
	existing: DefaultPackageManager | undefined,
	options: PackageManagerFactoryOptions,
	additionalExtensionPaths: string[],
): Promise<{
	packageManager: DefaultPackageManager;
	resolvedPaths: Awaited<ReturnType<DefaultPackageManager["resolve"]>>;
	cliExtensionPaths: Awaited<ReturnType<DefaultPackageManager["resolveExtensionSources"]>>;
}> {
	const packageManager = await loadResourcePackageManager(existing, options);
	const resolvedPaths = await packageManager.resolve();
	const cliExtensionPaths = await packageManager.resolveExtensionSources(additionalExtensionPaths, {
		temporary: true,
	});
	return { packageManager, resolvedPaths, cliExtensionPaths };
}
