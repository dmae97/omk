/**
 * Deterministic agent → capability router.
 *
 * Classifies an agent (by name + description) into a {@link DomainProfile},
 * derives a baseline capability set (skills / MCP / hooks) from the live
 * {@link CapabilityCatalog}, and audits a declared capability set against the
 * deterministic derivation (Jaccard overlap + drift verdict).
 *
 * Fully deterministic: same inputs always yield same outputs. No LLM calls,
 * no randomness, no I/O. Depends only on {@link DOMAIN_PROFILES} and the
 * passed-in catalog.
 *
 * Classification is **name-weighted vote scoring**: a domain's keywords are
 * tested against the agent name and description; matches inside the name (the
 * strongest identity signal) count triple. The domain with the highest score
 * wins (ties resolved by array order, so specific domains should come first).
 * This is robust to the substring false positives that plague first-match
 * classification (e.g. `chem` matching "s**chem**a", `gis` matching
 * "strate**gis**t"): a single accidental description hit cannot outvote a
 * domain that matches the name.
 *
 * @module agent-capability-router
 */

import type { AgentCapabilities, CapabilityCatalog } from "./capabilities.ts";
import { validateCapabilities } from "./capabilities.ts";
import type { DomainProfile } from "./domain-profiles.ts";
import { DOMAIN_PROFILES } from "./domain-profiles.ts";

/** Maximum number of scored skills to grant. */
const MAX_SKILLS = 6;
/** Number of pool skills granted as a fallback when nothing scores above zero. */
const FALLBACK_SKILLS = 4;
/** Jaccard threshold (inclusive) for a "match" verdict. */
const JACCARD_MATCH = 0.5;
/** Jaccard threshold (inclusive) for a "drift" verdict. */
const JACCARD_DRIFT = 0.15;
/** Weight multiplier when a keyword or skill token matches an agent *name* token. */
const NAME_WEIGHT = 3;

/**
 * Generic role-suffix tokens that carry no domain signal and must not be
 * counted as matches (otherwise e.g. "react-developer" would tie
 * "angular-developer" on the "developer" token). These are stripped before
 * both classification voting and derive scoring.
 */
const GENERIC_ROLE_TOKENS: ReadonlySet<string> = new Set([
	"agent",
	"analyst",
	"architect",
	"auditor",
	"builder",
	"coach",
	"consultant",
	"coordinator",
	"creator",
	"designer",
	"developer",
	"director",
	"editor",
	"engineer",
	"expert",
	"guardian",
	"lead",
	"manager",
	"master",
	"mentor",
	"navigator",
	"officer",
	"operator",
	"planner",
	"producer",
	"reviewer",
	"specialist",
	"steward",
	"strategist",
	"tester",
	"writer",
	"engineers",
	"specialists",
	"managers",
	"developers",
]);

/**
 * Classify an agent by name + description against {@link DOMAIN_PROFILES} using
 * name-weighted vote scoring. Returns the highest-scoring domain (ties resolve
 * to the earliest in {@link DOMAIN_PROFILES}), or `null` when every domain
 * scores zero — the explicit "No direct OMK skill match" sentinel.
 */
export function classifyAgent(name: string, description: string): DomainProfile | null {
	const nameLower = name.toLowerCase();
	const text = `${name} ${description}`.toLowerCase();

	let best: DomainProfile | null = null;
	let bestScore = 0;
	for (const domain of DOMAIN_PROFILES) {
		let score = 0;
		for (const re of domain.keywords) {
			// Boundary-anchored match: a keyword only counts when it lands on a
			// word edge, so bare short keywords ("gin", "gis", "chem") cannot fire
			// inside unrelated words ("engineer", "strategist", "schema").
			if (!keywordHits(re, text)) continue;
			// A keyword that also matches the agent name is a strong identity
			// signal (the name is the most reliable classifier); otherwise it
			// is a weaker description-only hit.
			score += keywordHits(re, nameLower) ? NAME_WEIGHT : 1;
		}
		if (score > bestScore) {
			bestScore = score;
			best = domain;
		}
	}
	return best;
}

/** Split lowercased text into identity tokens: non-word boundaries, length >= 2. */
function tokenize(lowerText: string): string[] {
	const tokens: string[] = [];
	for (const raw of lowerText.split(/[^a-z0-9+#]+/)) {
		if (raw.length >= 2) tokens.push(raw);
	}
	return tokens;
}

/** Identity tokens with generic role suffixes removed. */
function identityTokens(lowerText: string): string[] {
	return tokenize(lowerText).filter((t) => !GENERIC_ROLE_TOKENS.has(t));
}

/**
 * Boundary-anchored keyword test. A keyword must start at a left word edge
 * (start-of-text or a non-`[a-z0-9]` neighbor). A **right** boundary is added
 * only for short, all-alphabetic keywords (length <= 4, e.g. "gin", "gis",
 * "chem", "seo"): those are the ones that cause substring false positives
 * ("gin" -> "engineer", "gis" -> "strategist", "chem" -> "schema"). Longer and
 * pattern keywords ("react", "3d-", "smart-?contract", "document-?generat")
 * use prefix semantics (left edge only) so intentional prefix/partial matches
 * still fire. Node >= 10 supports lookbehind.
 */
function keywordHits(re: RegExp, text: string): boolean {
	const src = re.source;
	const shortBare = src.length <= 4 && /^[a-z]+$/i.test(src);
	const right = shortBare ? "(?![a-z0-9])" : "";
	return new RegExp(`(?<![a-z0-9])${src}${right}`, "i").test(text);
}

/**
 * Score a candidate skill against the agent's name and description tokens.
 * The skill's **first** `-`-split token is the technology word (e.g. "react"
 * in "react-patterns") and is weighted heaviest; a match in the agent name is
 * worth {@link NAME_WEIGHT}x a description match. Generic tokens are skipped.
 */
function skillMatchScore(
	skill: string,
	nameTokens: ReadonlySet<string>,
	descTokens: ReadonlySet<string>,
	nameLower: string,
	descLower: string,
): number {
	const parts = skill.split("-");
	let score = 0;
	for (let i = 0; i < parts.length; i++) {
		const part = parts[i];
		if (part.length === 0 || GENERIC_ROLE_TOKENS.has(part)) continue;
		const isTech = i === 0; // first token = the technology word
		const nameHit = nameTokens.has(part);
		const descHit = descTokens.has(part);
		if (nameHit) score += (isTech ? 5 : 2) * NAME_WEIGHT;
		else if (descHit) score += isTech ? 5 : 2;
	}
	// Full skill string appearing verbatim in name or description is a strong signal.
	if (nameLower.includes(skill)) score += 3 * NAME_WEIGHT;
	else if (descLower.includes(skill)) score += 3;
	return score;
}

/** Dedupe a list preserving first-seen order. */
function dedupe(items: readonly string[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const item of items) {
		if (seen.has(item)) continue;
		seen.add(item);
		out.push(item);
	}
	return out;
}

/**
 * Deterministically derive a baseline capability set for an agent. When no
 * domain matches, all three lists are empty. Otherwise skills are picked from
 * the domain's pool by name/description relevance (top {@link MAX_SKILLS} with
 * a positive score, falling back to the first {@link FALLBACK_SKILLS} pool
 * entries when nothing scores above zero), and MCP/hooks are the domain
 * defaults intersected with the live catalog.
 */
export function deriveCapabilities(name: string, description: string, catalog: CapabilityCatalog): AgentCapabilities {
	const domain = classifyAgent(name, description);
	if (domain === null) return { skills: [], mcp: [], hooks: [] };

	const nameLower = name.toLowerCase();
	const descLower = description.toLowerCase();
	const nameTokens = new Set(identityTokens(nameLower));
	const descTokens = new Set(identityTokens(`${nameLower} ${descLower}`));

	const candidates = domain.skillPool.filter((s) => catalog.skills.has(s));
	const scored = candidates.map((skill) => ({
		skill,
		score: skillMatchScore(skill, nameTokens, descTokens, nameLower, descLower),
	}));
	const positive = scored.filter((x) => x.score > 0);

	let selected: string[];
	if (positive.length > 0) {
		positive.sort((a, b) => {
			if (a.score !== b.score) return b.score - a.score;
			if (a.skill < b.skill) return -1;
			if (a.skill > b.skill) return 1;
			return 0;
		});
		selected = positive.slice(0, MAX_SKILLS).map((x) => x.skill);
	} else {
		selected = candidates.slice(0, FALLBACK_SKILLS);
	}

	const mcp = domain.defaultMcp.filter((m) => catalog.mcp.has(m));
	const hooks = domain.defaultHooks.filter((h) => catalog.hooks.has(h));

	return { skills: dedupe(selected), mcp, hooks };
}

/** Result of comparing a declared capability set against the deterministic derivation. */
export interface CapabilityAudit {
	/** Jaccard overlap of declared vs derived skill sets, 0..1 (1.0 when both empty). */
	readonly jaccard: number;
	/** Skills declared but not in the live catalog (from {@link validateCapabilities}). */
	readonly declaredUnknownSkills: readonly string[];
	readonly skillsOnlyInDeclared: readonly string[];
	readonly skillsOnlyInDerived: readonly string[];
	/** "match" (jaccard >= 0.5), "drift" (0.15 <= jaccard < 0.5), "divergent" (jaccard < 0.15). */
	readonly verdict: "match" | "drift" | "divergent";
}

/**
 * Compare a declared (e.g. LLM-assigned or embedded) capability set against the
 * deterministic derivation. The Jaccard coefficient is over the two skill lists
 * treated as sets; both-empty is defined as 1.0.
 */
export function auditCapabilities(
	declared: AgentCapabilities,
	derived: AgentCapabilities,
	catalog: CapabilityCatalog,
): CapabilityAudit {
	const declaredSet = new Set(declared.skills);
	const derivedSet = new Set(derived.skills);

	let intersection = 0;
	for (const s of declaredSet) if (derivedSet.has(s)) intersection++;
	const unionSize = new Set([...declaredSet, ...derivedSet]).size;
	const jaccard = unionSize === 0 ? 1.0 : intersection / unionSize;

	const declaredUnknownSkills = validateCapabilities(declared, catalog).unknownSkills;

	const skillsOnlyInDeclared: string[] = [];
	for (const s of declaredSet) if (!derivedSet.has(s)) skillsOnlyInDeclared.push(s);
	const skillsOnlyInDerived: string[] = [];
	for (const s of derivedSet) if (!declaredSet.has(s)) skillsOnlyInDerived.push(s);

	const verdict: "match" | "drift" | "divergent" =
		jaccard >= JACCARD_MATCH ? "match" : jaccard >= JACCARD_DRIFT ? "drift" : "divergent";

	return { jaccard, declaredUnknownSkills, skillsOnlyInDeclared, skillsOnlyInDerived, verdict };
}
