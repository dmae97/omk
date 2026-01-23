/**
 * Plugin loader - discovers and loads tools/hooks from installed plugins.
 *
 * Reads enabled plugins from the runtime config and loads their tools/hooks
 * based on manifest entries and enabled features.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { isEnoent } from "@oh-my-pi/pi-utils";
import {
	getAllProjectPluginOverridePaths,
	getPluginsLockfile,
	getPluginsNodeModules,
	getPluginsPackageJson,
} from "./paths";
import type { InstalledPlugin, PluginManifest, PluginRuntimeConfig, ProjectPluginOverrides } from "./types";

// =============================================================================
// Runtime Config Loading
// =============================================================================

/**
 * Load plugin runtime config from lock file.
 */
async function loadRuntimeConfig(): Promise<PluginRuntimeConfig> {
	const lockPath = getPluginsLockfile();
	try {
		return await Bun.file(lockPath).json();
	} catch (err) {
		if (isEnoent(err)) return { plugins: {}, settings: {} };
		throw err;
	}
}

/**
 * Load project-local plugin overrides (checks .omp and .pi directories).
 */
async function loadProjectOverrides(cwd: string): Promise<ProjectPluginOverrides> {
	for (const overridesPath of getAllProjectPluginOverridePaths(cwd)) {
		try {
			return await Bun.file(overridesPath).json();
		} catch (err) {
			if (isEnoent(err)) continue;
			// JSON parse error - continue to next path
		}
	}
	return {};
}

// =============================================================================
// Plugin Discovery
// =============================================================================

/**
 * Get list of enabled plugins with their resolved configurations.
 * Respects both global runtime config and project overrides.
 */
export async function getEnabledPlugins(cwd: string): Promise<InstalledPlugin[]> {
	const pkgJsonPath = getPluginsPackageJson();
	let pkg: { dependencies?: Record<string, string> };
	try {
		pkg = await Bun.file(pkgJsonPath).json();
	} catch (err) {
		if (isEnoent(err)) return [];
		throw err;
	}

	const nodeModulesPath = getPluginsNodeModules();
	if (!fs.existsSync(nodeModulesPath)) {
		return [];
	}

	const deps = pkg.dependencies || {};
	const runtimeConfig = await loadRuntimeConfig();
	const projectOverrides = await loadProjectOverrides(cwd);
	const plugins: InstalledPlugin[] = [];

	for (const [name] of Object.entries(deps)) {
		const pluginPkgPath = path.join(nodeModulesPath, name, "package.json");
		let pluginPkg: { version: string; omp?: PluginManifest; pi?: PluginManifest };
		try {
			pluginPkg = await Bun.file(pluginPkgPath).json();
		} catch (err) {
			if (isEnoent(err)) continue;
			throw err;
		}

		const manifest: PluginManifest | undefined = pluginPkg.omp || pluginPkg.pi;

		if (!manifest) {
			// Not an omp plugin, skip
			continue;
		}

		manifest.version = pluginPkg.version;

		const runtimeState = runtimeConfig.plugins[name];

		// Check if disabled globally
		if (runtimeState && !runtimeState.enabled) {
			continue;
		}

		// Check if disabled in project
		if (projectOverrides.disabled?.includes(name)) {
			continue;
		}

		// Resolve enabled features (project overrides take precedence)
		const enabledFeatures = projectOverrides.features?.[name] ?? runtimeState?.enabledFeatures ?? null;

		plugins.push({
			name,
			version: pluginPkg.version,
			path: path.join(nodeModulesPath, name),
			manifest,
			enabledFeatures,
			enabled: true,
		});
	}

	return plugins;
}

// =============================================================================
// Path Resolution
// =============================================================================

/**
 * Resolve tool entry points for a plugin based on manifest and enabled features.
 * Returns absolute paths to tool modules.
 */
export function resolvePluginToolPaths(plugin: InstalledPlugin): string[] {
	const paths: string[] = [];
	const manifest = plugin.manifest;

	// Base tools entry (always included if exists)
	if (manifest.tools) {
		const toolPath = path.join(plugin.path, manifest.tools);
		if (fs.existsSync(toolPath)) {
			paths.push(toolPath);
		}
	}

	// Feature-specific tools
	if (manifest.features && plugin.enabledFeatures) {
		const enabledSet = new Set(plugin.enabledFeatures);

		for (const [featName, feat] of Object.entries(manifest.features)) {
			if (!enabledSet.has(featName)) continue;

			if (feat.tools) {
				for (const toolEntry of feat.tools) {
					const toolPath = path.join(plugin.path, toolEntry);
					if (fs.existsSync(toolPath)) {
						paths.push(toolPath);
					}
				}
			}
		}
	} else if (manifest.features && plugin.enabledFeatures === null) {
		// null means use defaults - enable features with default: true
		for (const [_featName, feat] of Object.entries(manifest.features)) {
			if (!feat.default) continue;

			if (feat.tools) {
				for (const toolEntry of feat.tools) {
					const toolPath = path.join(plugin.path, toolEntry);
					if (fs.existsSync(toolPath)) {
						paths.push(toolPath);
					}
				}
			}
		}
	}

	return paths;
}

/**
 * Resolve hook entry points for a plugin based on manifest and enabled features.
 * Returns absolute paths to hook modules.
 */
export function resolvePluginHookPaths(plugin: InstalledPlugin): string[] {
	const paths: string[] = [];
	const manifest = plugin.manifest;

	// Base hooks entry (always included if exists)
	if (manifest.hooks) {
		const hookPath = path.join(plugin.path, manifest.hooks);
		if (fs.existsSync(hookPath)) {
			paths.push(hookPath);
		}
	}

	// Feature-specific hooks
	if (manifest.features && plugin.enabledFeatures) {
		const enabledSet = new Set(plugin.enabledFeatures);

		for (const [featName, feat] of Object.entries(manifest.features)) {
			if (!enabledSet.has(featName)) continue;

			if (feat.hooks) {
				for (const hookEntry of feat.hooks) {
					const hookPath = path.join(plugin.path, hookEntry);
					if (fs.existsSync(hookPath)) {
						paths.push(hookPath);
					}
				}
			}
		}
	} else if (manifest.features && plugin.enabledFeatures === null) {
		// null means use defaults - enable features with default: true
		for (const [_featName, feat] of Object.entries(manifest.features)) {
			if (!feat.default) continue;

			if (feat.hooks) {
				for (const hookEntry of feat.hooks) {
					const hookPath = path.join(plugin.path, hookEntry);
					if (fs.existsSync(hookPath)) {
						paths.push(hookPath);
					}
				}
			}
		}
	}

	return paths;
}

/**
 * Resolve command file paths for a plugin based on manifest and enabled features.
 * Returns absolute paths to command files (.md).
 */
export function resolvePluginCommandPaths(plugin: InstalledPlugin): string[] {
	const paths: string[] = [];
	const manifest = plugin.manifest;

	// Base commands (always included if exists)
	if (manifest.commands) {
		for (const cmdEntry of manifest.commands) {
			const cmdPath = path.join(plugin.path, cmdEntry);
			if (fs.existsSync(cmdPath)) {
				paths.push(cmdPath);
			}
		}
	}

	// Feature-specific commands
	if (manifest.features && plugin.enabledFeatures) {
		const enabledSet = new Set(plugin.enabledFeatures);

		for (const [featName, feat] of Object.entries(manifest.features)) {
			if (!enabledSet.has(featName)) continue;

			if (feat.commands) {
				for (const cmdEntry of feat.commands) {
					const cmdPath = path.join(plugin.path, cmdEntry);
					if (fs.existsSync(cmdPath)) {
						paths.push(cmdPath);
					}
				}
			}
		}
	} else if (manifest.features && plugin.enabledFeatures === null) {
		// null means use defaults - enable features with default: true
		for (const [_featName, feat] of Object.entries(manifest.features)) {
			if (!feat.default) continue;

			if (feat.commands) {
				for (const cmdEntry of feat.commands) {
					const cmdPath = path.join(plugin.path, cmdEntry);
					if (fs.existsSync(cmdPath)) {
						paths.push(cmdPath);
					}
				}
			}
		}
	}

	return paths;
}

// =============================================================================
// Aggregated Discovery
// =============================================================================

/**
 * Get all tool paths from all enabled plugins.
 */
export async function getAllPluginToolPaths(cwd: string): Promise<string[]> {
	const plugins = await getEnabledPlugins(cwd);
	const paths: string[] = [];

	for (const plugin of plugins) {
		paths.push(...resolvePluginToolPaths(plugin));
	}

	return paths;
}

/**
 * Get all hook paths from all enabled plugins.
 */
export async function getAllPluginHookPaths(cwd: string): Promise<string[]> {
	const plugins = await getEnabledPlugins(cwd);
	const paths: string[] = [];

	for (const plugin of plugins) {
		paths.push(...resolvePluginHookPaths(plugin));
	}

	return paths;
}

/**
 * Get all command paths from all enabled plugins.
 */
export async function getAllPluginCommandPaths(cwd: string): Promise<string[]> {
	const plugins = await getEnabledPlugins(cwd);
	const paths: string[] = [];

	for (const plugin of plugins) {
		paths.push(...resolvePluginCommandPaths(plugin));
	}

	return paths;
}

/**
 * Get plugin settings for use in tool/hook contexts.
 * Merges global settings with project overrides.
 */
export async function getPluginSettings(pluginName: string, cwd: string): Promise<Record<string, unknown>> {
	const runtimeConfig = await loadRuntimeConfig();
	const projectOverrides = await loadProjectOverrides(cwd);

	const global = runtimeConfig.settings[pluginName] || {};
	const project = projectOverrides.settings?.[pluginName] || {};

	return { ...global, ...project };
}
