/**
 * Discovery Module
 *
 * Auto-registers all providers by importing them.
 * Import this module to ensure all providers are registered with the capability registry.
 */

// Import capability definitions (ensures capabilities are defined before providers register)
import "../capability/context-file";
import "../capability/extension";
import "../capability/extension-module";
import "../capability/hook";
import "../capability/instruction";
import "../capability/mcp";
import "../capability/prompt";
import "../capability/rule";
import "../capability/settings";
import "../capability/skill";
import "../capability/slash-command";
import "../capability/system-prompt";
import "../capability/ssh";
import "../capability/tool";

// Import providers (each registers itself on import)
import "./builtin";
import "./claude";
import "./codex";
import "./gemini";
import "./cursor";
import "./windsurf";
import "./cline";
import "./github";
import "./vscode";
import "./agents-md";
import "./mcp-json";
import "./ssh";

export type { ContextFile } from "@oh-my-pi/pi-coding-agent/capability/context-file";
export type { Extension, ExtensionManifest } from "@oh-my-pi/pi-coding-agent/capability/extension";
export type { ExtensionModule } from "@oh-my-pi/pi-coding-agent/capability/extension-module";
export type { Hook } from "@oh-my-pi/pi-coding-agent/capability/hook";
// Re-export the main API from capability registry
export {
	cacheStats,
	// Provider management
	disableProvider,
	enableProvider,
	getAllCapabilitiesInfo,
	getAllProvidersInfo,
	// Introspection
	getCapability,
	getCapabilityInfo,
	getDisabledProviders,
	getProviderInfo,
	// Initialization
	initializeWithSettings,
	invalidate,
	isProviderEnabled,
	listCapabilities,
	// Loading API
	loadCapability,
	// Cache management
	reset,
	setDisabledProviders,
} from "@oh-my-pi/pi-coding-agent/capability/index";
export type { Instruction } from "@oh-my-pi/pi-coding-agent/capability/instruction";
// Re-export capability item types
export type { MCPServer } from "@oh-my-pi/pi-coding-agent/capability/mcp";
export type { Prompt } from "@oh-my-pi/pi-coding-agent/capability/prompt";
export type { Rule, RuleFrontmatter } from "@oh-my-pi/pi-coding-agent/capability/rule";
export type { Settings } from "@oh-my-pi/pi-coding-agent/capability/settings";
export type { Skill, SkillFrontmatter } from "@oh-my-pi/pi-coding-agent/capability/skill";
export type { SlashCommand } from "@oh-my-pi/pi-coding-agent/capability/slash-command";
export type { SSHHost } from "@oh-my-pi/pi-coding-agent/capability/ssh";
export type { SystemPrompt } from "@oh-my-pi/pi-coding-agent/capability/system-prompt";
export type { CustomTool } from "@oh-my-pi/pi-coding-agent/capability/tool";
// Re-export types
export type {
	Capability,
	CapabilityInfo,
	CapabilityResult,
	LoadContext,
	LoadOptions,
	LoadResult,
	Provider,
	ProviderInfo,
	SourceMeta,
} from "@oh-my-pi/pi-coding-agent/capability/types";
