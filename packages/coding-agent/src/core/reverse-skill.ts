// Thin re-export shim. The canonical reverse-skill router/generator lives in
// omk-agent-core (packages/agent/src/harness/reverse-skill.ts). This module
// previously held a byte-identical ~779-line copy; it now re-exports the single
// implementation so the two packages cannot drift. Explicit named re-exports
// (not `export *`) so tsgo fails loudly if the canonical public surface changes.
export {
	extractReverseSkillFactsFromMarkdown,
	formatReverseSkillFromSource,
	formatReverseSkillMarkdown,
	formatReverseSkillRouteDecision,
	getReverseSkillToolAliases,
	normalizeReverseSkillName,
	normalizeReverseSkillText,
	planReverseSkillToolChecks,
	REVERSE_SKILL_ROUTES,
	type ReverseSkillPlatform,
	type ReverseSkillRisk,
	type ReverseSkillRoute,
	type ReverseSkillRouteDecision,
	type ReverseSkillRouteInput,
	type ReverseSkillRouteScore,
	type ReverseSkillSourceFacts,
	type ReverseSkillSourceInput,
	type ReverseSkillSpecInput,
	routeReverseSkill,
} from "omk-agent-core";
