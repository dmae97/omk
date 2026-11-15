/**
 * Install-command arguments and the lifecycle-script policy for managed package installs
 * (spec 053). Package lifecycle scripts (preinstall/install/postinstall) run arbitrary code
 * with the user's privileges, so managed installs skip them unless the user passes
 * `--allow-scripts` to an explicit `omk install` / `omk update`. Installs that happen on
 * their own (missing packages resolved at startup, `-e npm:...`) never run scripts.
 */

export const ALLOW_SCRIPTS_FLAG = "--allow-scripts";

export type ManagedPackageManagerName = "npm" | "bun" | "pnpm" | string;

/** Arguments for installing `specs` into `installRoot`. Scripts are skipped unless `allowScripts`. */
export function buildNpmInstallArgs(
	packageManagerName: ManagedPackageManagerName,
	specs: readonly string[],
	installRoot: string,
	allowScripts: boolean,
): string[] {
	const scriptArgs = allowScripts ? [] : ["--ignore-scripts"];
	// Extension packages run inside OMK and resolve OMK APIs through loader aliases/virtual modules.
	// Disable peer dependency resolution for managed installs (npm's --legacy-peer-deps, and
	// equivalent bun/pnpm settings) so package managers do not install or solve host-provided
	// omk-agent-core, omk-ai, and omk-tui peers. Stale auto-installed host peers can otherwise block updates.
	if (packageManagerName === "bun") {
		return ["install", ...specs, "--cwd", installRoot, "--omit=peer", ...scriptArgs];
	}
	if (packageManagerName === "pnpm") {
		return [
			"install",
			...specs,
			"--prefix",
			installRoot,
			"--config.auto-install-peers=false",
			"--config.strict-peer-dependencies=false",
			"--config.strict-dep-builds=false",
			...scriptArgs,
		];
	}
	return ["install", ...specs, "--prefix", installRoot, "--legacy-peer-deps", ...scriptArgs];
}

/** Arguments for installing a cloned git package's own dependencies. */
export function buildGitDependencyInstallArgs(hasConfiguredNpmCommand: boolean, allowScripts: boolean): string[] {
	const scriptArgs = allowScripts ? [] : ["--ignore-scripts"];
	return hasConfiguredNpmCommand ? ["install", ...scriptArgs] : ["install", "--omit=dev", ...scriptArgs];
}

// Messages a package produces when the build step its install script would have run never ran:
// node-gyp / prebuild bindings, node-pre-gyp, napi-rs/prebuildify loaders, and missing build output.
const SKIPPED_SCRIPT_SYMPTOMS: readonly RegExp[] = [
	/Could not locate the bindings file/u,
	/No native build was found/u,
	/Cannot find module '[^']*\.node'/u,
	// A node_modules path targets another install tree (often a stale wrapper), not this package's build.
	/Cannot find module '(?![^']*node_modules)[^']*[\\/](?:build|dist|lib|prebuilds)[\\/][^']*'/u,
	/node-pre-gyp/u,
	/was compiled against a different Node\.js version/u,
	/Failed to load native binding/u,
];

/** True when an error looks like the result of a skipped install script. */
export function looksLikeSkippedInstallScript(message: string): boolean {
	return SKIPPED_SCRIPT_SYMPTOMS.some((pattern) => pattern.test(message));
}

/**
 * The hint appended to install and load failures. It names the option, so a user whose
 * native-build package broke because scripts were skipped knows the exact way out.
 */
export function formatAllowScriptsHint(source?: string, command: "install" | "update" = "install"): string {
	const target = source ? ` ${source}` : command === "install" ? " <source>" : "";
	return (
		`Package install scripts are off by default. If this package needs its install script ` +
		`(native build), review it and rerun with: omk ${command} ${ALLOW_SCRIPTS_FLAG}${target}`
	);
}

/** Append the allow-scripts hint when the message looks like a skipped-script failure. */
export function withAllowScriptsHint(message: string, source?: string): string {
	return looksLikeSkippedInstallScript(message) ? `${message}\n${formatAllowScriptsHint(source)}` : message;
}
