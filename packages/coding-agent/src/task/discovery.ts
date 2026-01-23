/**
 * Agent discovery from filesystem.
 *
 * Discovers agent definitions from:
 *   - ~/.omp/agent/agents/*.md (user-level, primary)
 *   - ~/.pi/agent/agents/*.md (user-level, legacy)
 *   - ~/.claude/agents/*.md (user-level, legacy)
 *   - .omp/agents/*.md (project-level, primary)
 *   - .pi/agents/*.md (project-level, legacy)
 *   - .claude/agents/*.md (project-level, legacy)
 *
 * Agent files use markdown with YAML frontmatter.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { findAllNearestProjectConfigDirs, getConfigDirs } from "$c/config";
import { parseAgentFields } from "$c/discovery/helpers";
import { parseFrontmatter } from "$c/utils/frontmatter";
import { loadBundledAgents } from "./agents";
import type { AgentDefinition, AgentSource } from "./types";

/** Result of agent discovery */
export interface DiscoveryResult {
	agents: AgentDefinition[];
	projectAgentsDir: string | null;
}

/**
 * Load agents from a directory.
 */
function loadAgentsFromDir(dir: string, source: AgentSource): AgentDefinition[] {
	const agents: AgentDefinition[] = [];

	if (!fs.existsSync(dir)) {
		return agents;
	}

	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return agents;
	}

	for (const entry of entries) {
		if (!entry.name.endsWith(".md")) continue;

		const filePath = path.resolve(dir, entry.name);

		// Handle both regular files and symlinks
		try {
			if (!fs.statSync(filePath).isFile()) continue;
		} catch {
			continue;
		}

		let content: string;
		try {
			content = fs.readFileSync(filePath, "utf-8");
		} catch {
			continue;
		}

		const { frontmatter, body } = parseFrontmatter(content, { source: filePath });
		const fields = parseAgentFields(frontmatter);

		if (!fields) {
			continue;
		}

		agents.push({
			...fields,
			systemPrompt: body,
			source,
			filePath,
		});
	}

	return agents;
}

/**
 * Discover agents from filesystem and merge with bundled agents.
 *
 * Precedence (highest wins): .omp > .pi > .claude (project before user), then bundled
 *
 * @param cwd - Current working directory for project agent discovery
 */
export async function discoverAgents(cwd: string): Promise<DiscoveryResult> {
	const resolvedCwd = path.resolve(cwd);
	const agentSources = Array.from(new Set(getConfigDirs("", { project: false }).map((entry) => entry.source)));

	// Get user directories (priority order: .omp, .pi, .claude, ...)
	const userDirs = getConfigDirs("agents", { project: false })
		.filter((entry) => agentSources.includes(entry.source))
		.map((entry) => ({
			...entry,
			path: path.resolve(entry.path),
		}));

	// Get project directories by walking up from cwd (priority order)
	const projectDirs = (await findAllNearestProjectConfigDirs("agents", resolvedCwd))
		.filter((entry) => agentSources.includes(entry.source))
		.map((entry) => ({
			...entry,
			path: path.resolve(entry.path),
		}));

	const orderedSources = agentSources.filter(
		(source) =>
			userDirs.some((entry) => entry.source === source) || projectDirs.some((entry) => entry.source === source),
	);

	const orderedDirs: Array<{ dir: string; source: AgentSource }> = [];
	for (const source of orderedSources) {
		const project = projectDirs.find((entry) => entry.source === source);
		if (project) orderedDirs.push({ dir: project.path, source: "project" });
		const user = userDirs.find((entry) => entry.source === source);
		if (user) orderedDirs.push({ dir: user.path, source: "user" });
	}

	const agents: AgentDefinition[] = [];
	const seen = new Set<string>();

	for (const { dir, source } of orderedDirs) {
		for (const agent of loadAgentsFromDir(dir, source)) {
			if (seen.has(agent.name)) continue;
			agents.push(agent);
			seen.add(agent.name);
		}
	}

	for (const agent of loadBundledAgents()) {
		if (seen.has(agent.name)) continue;
		agents.push(agent);
		seen.add(agent.name);
	}

	const projectAgentsDir = projectDirs.length > 0 ? projectDirs[0].path : null;

	return { agents, projectAgentsDir };
}

/**
 * Get an agent by name from discovered agents.
 */
export function getAgent(agents: AgentDefinition[], name: string): AgentDefinition | undefined {
	return agents.find((a) => a.name === name);
}
