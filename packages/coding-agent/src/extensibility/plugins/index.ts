// Plugin system exports

export { formatDoctorResults, runDoctorChecks } from "./doctor";
export { type GitSource, parseGitUrl } from "./git-url";
export {
	getAllPluginCommandPaths,
	getAllPluginHookPaths,
	getAllPluginToolPaths,
	getEnabledPlugins,
	getPluginSettings,
	resolvePluginCommandPaths,
	resolvePluginHookPaths,
	resolvePluginToolPaths,
} from "./loader";
export { PluginManager, parseSettingValue, validateSetting } from "./manager";
export { extractPackageName, formatPluginSpec, parsePluginSpec } from "./parser";
export type {
	BooleanSetting,
	DoctorCheck,
	DoctorOptions,
	EnumSetting,
	InstalledPlugin,
	InstallOptions,
	NumberSetting,
	PluginFeature,
	PluginManifest,
	PluginRuntimeConfig,
	PluginRuntimeState,
	PluginSettingSchema,
	PluginSettingType,
	ProjectPluginOverrides,
	StringSetting,
} from "./types";
