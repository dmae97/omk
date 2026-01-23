/**
 * Windsurf (Codeium) Provider
 *
 * Loads configuration from Windsurf's config locations:
 * - User: ~/.codeium/windsurf
 * - Project: .windsurf
 *
 * Supports:
 * - MCP servers from mcp_config.json
 * - Rules from .windsurf/rules/*.md and ~/.codeium/windsurf/memories/global_rules.md
 * - Legacy .windsurfrules file
 */

import { readFile } from "$c/capability/fs";
import { registerProvider } from "$c/capability/index";
import { type MCPServer, mcpCapability } from "$c/capability/mcp";
import { type Rule, ruleCapability } from "$c/capability/rule";
import type { LoadContext, LoadResult } from "$c/capability/types";
import { parseFrontmatter } from "$c/utils/frontmatter";
import {
	createSourceMeta,
	expandEnvVarsDeep,
	getProjectPath,
	getUserPath,
	loadFilesFromDir,
	parseJSON,
} from "./helpers";

const PROVIDER_ID = "windsurf";
const DISPLAY_NAME = "Windsurf";
const PRIORITY = 50;

// =============================================================================
// MCP Servers
// =============================================================================

function parseServerConfig(
	name: string,
	serverConfig: unknown,
	path: string,
	scope: "user" | "project",
): { server?: MCPServer; warning?: string } {
	if (typeof serverConfig !== "object" || serverConfig === null) {
		return { warning: `Invalid server config for "${name}" in ${path}` };
	}

	const server = expandEnvVarsDeep(serverConfig as Record<string, unknown>);
	return {
		server: {
			name,
			command: server.command as string | undefined,
			args: server.args as string[] | undefined,
			env: server.env as Record<string, string> | undefined,
			url: server.url as string | undefined,
			headers: server.headers as Record<string, string> | undefined,
			transport: server.type as "stdio" | "sse" | "http" | undefined,
			_source: createSourceMeta(PROVIDER_ID, path, scope),
		},
	};
}

async function loadMCPServers(ctx: LoadContext): Promise<LoadResult<MCPServer>> {
	const items: MCPServer[] = [];
	const warnings: string[] = [];

	const userPath = getUserPath(ctx, "windsurf", "mcp_config.json");
	const [userContent, projectPath] = await Promise.all([
		userPath ? readFile(userPath) : Promise.resolve(null),
		getProjectPath(ctx, "windsurf", "mcp_config.json"),
	]);

	const projectContent = projectPath ? await readFile(projectPath) : null;

	const configs: Array<{ content: string | null; path: string | null; scope: "user" | "project" }> = [
		{ content: userContent, path: userPath, scope: "user" },
		{ content: projectContent, path: projectPath, scope: "project" },
	];

	for (const { content, path, scope } of configs) {
		if (!content || !path) continue;

		const config = parseJSON<{ mcpServers?: Record<string, unknown> }>(content);
		if (!config?.mcpServers) continue;

		for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
			const result = parseServerConfig(name, serverConfig, path, scope);
			if (result.warning) warnings.push(result.warning);
			if (result.server) items.push(result.server);
		}
	}

	return { items, warnings };
}

// =============================================================================
// Rules
// =============================================================================

async function loadRules(ctx: LoadContext): Promise<LoadResult<Rule>> {
	const items: Rule[] = [];
	const warnings: string[] = [];

	// User-level: ~/.codeium/windsurf/memories/global_rules.md
	const userPath = getUserPath(ctx, "windsurf", "memories/global_rules.md");
	if (userPath) {
		const content = await readFile(userPath);
		if (content) {
			const { frontmatter, body } = parseFrontmatter(content, { source: userPath });

			// Validate and normalize globs
			let globs: string[] | undefined;
			if (Array.isArray(frontmatter.globs)) {
				globs = frontmatter.globs.filter((g): g is string => typeof g === "string");
			} else if (typeof frontmatter.globs === "string") {
				globs = [frontmatter.globs];
			}

			items.push({
				name: "global_rules",
				path: userPath,
				content: body,
				globs,
				alwaysApply: frontmatter.alwaysApply as boolean | undefined,
				description: frontmatter.description as string | undefined,
				ttsrTrigger: typeof frontmatter.ttsr_trigger === "string" ? frontmatter.ttsr_trigger : undefined,
				_source: createSourceMeta(PROVIDER_ID, userPath, "user"),
			});
		}
	}

	// Project-level: .windsurf/rules/*.md
	const projectRulesDir = getProjectPath(ctx, "windsurf", "rules");
	if (projectRulesDir) {
		const result = await loadFilesFromDir<Rule>(ctx, projectRulesDir, PROVIDER_ID, "project", {
			extensions: ["md"],
			transform: (name, content, path, source) => {
				const { frontmatter, body } = parseFrontmatter(content, { source: path });
				const ruleName = name.replace(/\.md$/, "");

				// Validate and normalize globs
				let globs: string[] | undefined;
				if (Array.isArray(frontmatter.globs)) {
					globs = frontmatter.globs.filter((g): g is string => typeof g === "string");
				} else if (typeof frontmatter.globs === "string") {
					globs = [frontmatter.globs];
				}

				return {
					name: ruleName,
					path,
					content: body,
					globs,
					alwaysApply: frontmatter.alwaysApply as boolean | undefined,
					description: frontmatter.description as string | undefined,
					ttsrTrigger: typeof frontmatter.ttsr_trigger === "string" ? frontmatter.ttsr_trigger : undefined,
					_source: source,
				};
			},
		});
		items.push(...result.items);
		if (result.warnings) warnings.push(...result.warnings);
	}

	return { items, warnings };
}

// =============================================================================
// Provider Registration
// =============================================================================

registerProvider<MCPServer>(mcpCapability.id, {
	id: PROVIDER_ID,
	displayName: DISPLAY_NAME,
	description: "Load MCP servers from Windsurf config (mcp_config.json)",
	priority: PRIORITY,
	load: loadMCPServers,
});

registerProvider<Rule>(ruleCapability.id, {
	id: PROVIDER_ID,
	displayName: DISPLAY_NAME,
	description: "Load rules from Windsurf (.windsurf/rules/*.md, memories/global_rules.md, .windsurfrules)",
	priority: PRIORITY,
	load: loadRules,
});
