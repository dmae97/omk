export type ReverseSkillPlatform = "windows" | "linux" | "macos" | "kali" | "unknown";

export type ReverseSkillRisk = "passive-analysis" | "local-tooling" | "active-security" | "exploit-development";

export interface ReverseSkillRoute {
	id: string;
	label: string;
	skillPath: string;
	targetPatterns: string[];
	intentPatterns: string[];
	toolPatterns: string[];
	keywords: string[];
	requiredTools: string[];
	optionalTools: string[];
	skillHints: string[];
	mcpHints: string[];
	hookHints: string[];
	acceptance: string[];
	firstActions: string[];
	risk: ReverseSkillRisk;
}

export interface ReverseSkillRouteInput {
	query: string;
	targetType?: string;
	intent?: string;
	toolchain?: string;
	platform?: ReverseSkillPlatform;
	maxAlternatives?: number;
}

export interface ReverseSkillRouteScore {
	route: ReverseSkillRoute;
	score: number;
	confidence: number;
	matched: {
		target: string[];
		intent: string[];
		toolchain: string[];
		keywords: string[];
	};
	missingDimensions: string[];
}

export interface ReverseSkillRouteDecision {
	query: string;
	platform: ReverseSkillPlatform;
	normalizedQuery: string;
	primary?: ReverseSkillRouteScore;
	alternatives: ReverseSkillRouteScore[];
	unmatched: boolean;
	nextAction: string;
}

export interface ReverseSkillSpecInput {
	name: string;
	description?: string;
	triggerSummary: string;
	routeIds?: string[];
	workflowSteps?: string[];
	tools?: string[];
	mcpServers?: string[];
	hooks?: string[];
	acceptance?: string[];
	references?: string[];
	safetyNotes?: string[];
}

export interface ReverseSkillSourceFacts {
	headings: string[];
	skillPaths: string[];
	scriptPaths: string[];
	tools: string[];
	mcpServers: string[];
	triggerTerms: string[];
}

export interface ReverseSkillSourceInput {
	name?: string;
	description?: string;
	sourceText: string;
	triggerSummary?: string;
}
