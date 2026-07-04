export interface BangSkillRegistry {
	hasSkill(name: string): boolean;
}

const OMK_INDEX_SKILL = "omk-skills";

interface OmkHubRoute {
	skillName: string;
	aliases: readonly string[];
	keywords: readonly string[];
}

const OMK_HUB_ROUTES: readonly OmkHubRoute[] = [
	{
		skillName: "omk-frontend",
		aliases: ["front", "frontend", "fe", "ui", "ux", "react", "next", "vue", "svelte", "tailwind"],
		keywords: [
			"component",
			"css",
			"html",
			"responsive",
			"a11y",
			"accessibility",
			"visual",
			"browser",
			"design-system",
		],
	},
	{
		skillName: "omk-backend-data",
		aliases: ["back", "backend", "api", "db", "data", "database", "server", "postgres", "supabase", "redis"],
		keywords: ["endpoint", "migration", "schema", "orm", "cache", "queue", "service", "auth", "prisma", "mysql"],
	},
	{
		skillName: "omk-loop",
		aliases: ["loop", "run", "runner", "ralph", "evolve", "orchestrate", "orchestration", "team", "parallel"],
		keywords: ["subagent", "workflow", "pipeline", "goal", "dag", "ouroboros", "adaptorch", "continuous"],
	},
	{
		skillName: "omk-plan",
		aliases: ["plan", "planning", "spec", "prd", "pm", "blueprint", "interview", "requirements"],
		keywords: ["roadmap", "scope", "acceptance", "criteria", "architecture", "proposal", "tasks", "design"],
	},
	{
		skillName: "omk-engineering",
		aliases: ["code", "coding", "engineering", "eng", "debug", "test", "refactor", "review", "ponytail"],
		keywords: ["typescript", "python", "rust", "go", "build", "lint", "bug", "fix", "minimal", "yagni"],
	},
	{
		skillName: "omk-security",
		aliases: ["sec", "security", "audit", "vuln", "vulnerability", "semgrep", "codeql", "reverse"],
		keywords: ["threat", "secret", "supply", "chain", "fuzz", "crypto", "sandbox", "malware"],
	},
	{
		skillName: "omk-devops-release",
		aliases: ["devops", "release", "deploy", "ci", "cd", "github", "gh", "gh-repo", "git", "repo", "pr"],
		keywords: ["docker", "kubernetes", "vercel", "canary", "workflow", "changelog", "version"],
	},
	{
		skillName: "omk-research-docs",
		aliases: ["research", "docs", "doc", "documentation", "report", "pdf", "slides", "paper"],
		keywords: ["citation", "literature", "academic", "write", "summarize", "evidence", "source"],
	},
	{
		skillName: "omk-design-media",
		aliases: ["design", "media", "image", "video", "logo", "icon", "diagram", "asset"],
		keywords: ["brand", "infographic", "svg", "gif", "audio", "poster", "visual", "animation"],
	},
	{
		skillName: "omk-agent-ops",
		aliases: ["agent", "agents", "ops", "mcp", "skill", "skills", "headroom", "context", "memory"],
		keywords: ["omk", "runtime", "hook", "loadout", "prompt", "harness", "adaptorch", "ouroboros"],
	},
	{
		skillName: "omk-product-ops",
		aliases: ["product", "growth", "marketing", "seo", "cro", "analytics", "launch", "pricing"],
		keywords: ["campaign", "content", "conversion", "copy", "sales", "investor", "market"],
	},
	{
		skillName: "omk-workspace-ops",
		aliases: ["workspace", "gmail", "calendar", "drive", "sheets", "chat", "tasks", "email"],
		keywords: ["google", "docs", "slides", "meet", "people", "message", "notification"],
	},
];

export type BangInvocation =
	| { kind: "plain"; prompt: string }
	| { kind: "empty" }
	| { kind: "bash"; command: string; includeContext: boolean }
	| { kind: "skill"; skillName: string; prompt: string; activeSkillNames: readonly string[]; source: "bang" }
	| { kind: "unknownSkill"; skillName: string; prompt: string; source: "bang" };

export function parseBangInvocation(input: string, registry: BangSkillRegistry): BangInvocation {
	if (!input.startsWith("!")) {
		return { kind: "plain", prompt: input };
	}

	if (input.startsWith("!!")) {
		const command = input.slice(2).trim();
		return command ? { kind: "bash", command, includeContext: false } : { kind: "empty" };
	}

	const second = input[1];
	if (second === undefined) {
		return { kind: "plain", prompt: input };
	}

	if (/\s/.test(second)) {
		const command = input.slice(2).trim();
		return command ? { kind: "bash", command, includeContext: true } : { kind: "empty" };
	}

	const body = input.slice(1);
	const omkInvocation = parseOmkBangInvocation(body, registry);
	if (omkInvocation) {
		return omkInvocation;
	}

	if (body.startsWith("skill:")) {
		const explicit = body.slice("skill:".length);
		const { token: skillName, rest } = splitFirstToken(explicit);
		if (!skillName) {
			return { kind: "plain", prompt: input };
		}
		if (!registry.hasSkill(skillName)) {
			return { kind: "unknownSkill", skillName, prompt: rest, source: "bang" };
		}
		return {
			kind: "skill",
			skillName,
			prompt: rest,
			activeSkillNames: [skillName],
			source: "bang",
		};
	}

	const { token: skillName, rest } = splitFirstToken(body);
	if (!skillName) {
		return { kind: "plain", prompt: input };
	}
	if (registry.hasSkill(skillName)) {
		return {
			kind: "skill",
			skillName,
			prompt: rest,
			activeSkillNames: [skillName],
			source: "bang",
		};
	}

	const command = body.trim();
	return command ? { kind: "bash", command, includeContext: true } : { kind: "empty" };
}

function parseOmkBangInvocation(body: string, registry: BangSkillRegistry): BangInvocation | null {
	const { token, rest } = splitFirstToken(body);
	if (normalizeOmkToken(token) !== "omk") {
		return null;
	}

	const route = resolveOmkHubRoute(rest);
	const skillName = availableOmkSkillName(route.skillName, registry);
	if (!skillName) {
		return { kind: "unknownSkill", skillName: route.skillName, prompt: route.prompt, source: "bang" };
	}

	return {
		kind: "skill",
		skillName,
		prompt: route.prompt,
		activeSkillNames: activeOmkSkillNames(skillName, registry),
		source: "bang",
	};
}

function resolveOmkHubRoute(prompt: string): { skillName: string; prompt: string } {
	const { token, rest } = splitFirstToken(prompt);
	const normalizedToken = normalizeOmkToken(token);
	if (normalizedToken) {
		const exactRoute = OMK_HUB_ROUTES.find((route) => route.aliases.includes(normalizedToken));
		if (exactRoute) {
			return { skillName: exactRoute.skillName, prompt: rest };
		}
	}

	const scored = OMK_HUB_ROUTES.map((route, index) => ({ route, index, score: scoreOmkRoute(route, prompt) }))
		.filter((entry) => entry.score > 0)
		.sort((a, b) => b.score - a.score || a.index - b.index);

	const best = scored[0];
	if (best) {
		return { skillName: best.route.skillName, prompt: prompt.trimStart() };
	}

	return { skillName: OMK_INDEX_SKILL, prompt: prompt.trimStart() };
}

function availableOmkSkillName(skillName: string, registry: BangSkillRegistry): string | null {
	if (registry.hasSkill(skillName)) {
		return skillName;
	}
	if (skillName !== OMK_INDEX_SKILL && registry.hasSkill(OMK_INDEX_SKILL)) {
		return OMK_INDEX_SKILL;
	}
	return null;
}

function activeOmkSkillNames(skillName: string, registry: BangSkillRegistry): readonly string[] {
	if (skillName !== OMK_INDEX_SKILL && registry.hasSkill(OMK_INDEX_SKILL)) {
		return [OMK_INDEX_SKILL, skillName];
	}
	return [skillName];
}

function scoreOmkRoute(route: OmkHubRoute, prompt: string): number {
	const tokens = new Set(
		prompt
			.split(/[^\p{L}\p{N}-]+/u)
			.map(normalizeOmkToken)
			.filter(Boolean),
	);
	let score = 0;
	for (const alias of route.aliases) {
		if (tokens.has(alias)) {
			score += 4;
		}
	}
	for (const keyword of route.keywords) {
		if (tokens.has(keyword)) {
			score += 2;
		}
	}
	return score;
}

function normalizeOmkToken(token: string): string {
	return token.trim().toLowerCase().replace(/^omk-/, "").replace(/_/g, "-");
}

function splitFirstToken(input: string): { token: string; rest: string } {
	const trimmed = input.trimStart();
	const match = /^([^\s]+)(?:\s+([\s\S]*))?$/.exec(trimmed);
	if (!match) {
		return { token: "", rest: "" };
	}
	return { token: match[1] ?? "", rest: match[2]?.trimStart() ?? "" };
}
