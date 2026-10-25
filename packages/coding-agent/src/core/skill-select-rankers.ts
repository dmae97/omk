/**
 * Spec 058 R2–R4: the two skill rankers behind `skill_search` and the task-start candidates.
 *
 * Loaded only with `skill-search.ts` (first search or candidate computation, never at startup). Both modes are
 * local pure functions: `bm25` uses the shared corpus ranking; `metacon` narrows with BM25 and picks a covering set
 * with `planSkills`. Neither imports `omk-adaptorch-wpl` or any network client (AC 6).
 */
import { createHash } from "node:crypto";
import { type CorpusDocument, rankCorpus, retrievalTokens } from "../metacognition/retrieval.ts";
import { type CapabilityNeed, planSkills, type SkillDescriptor, type SkillPlan } from "../metacognition/skills.ts";

export type SkillSelectRankMode = "bm25" | "metacon";
/** Where a result slot came from (R7): BM25 order, a metacon pick, or a BM25 fill after the metacon picks. */
export type SkillRankSource = "bm25" | "metacon" | "bm25-fill";

export interface RankDoc {
	readonly name: string;
	readonly description: string;
	readonly location: string;
	/** sha256 of the SKILL.md from the current `loadSkills()` result; same value = same skill (R2). */
	readonly contentHash?: string;
}

export interface RankedSkill extends RankDoc {
	readonly score: number;
	readonly source: SkillRankSource;
}

export interface MetaconStats {
	readonly prefilter: number;
	readonly algorithm?: SkillPlan["algorithm"];
	readonly state?: SkillPlan["state"];
	readonly needs: number;
	readonly coveredNeeds: number;
	readonly rejected: Readonly<Record<string, number>>;
	readonly phase: string;
	readonly phaseSource: "todo" | "default";
	readonly planMs: number;
	readonly overBudget?: true;
	readonly fallback?: "metacon-error";
}

export interface RankOptions {
	readonly limit: number;
	/** Names never returned, along with their content-identical aliases (already offered skills). */
	readonly exclude?: ReadonlySet<string>;
	/** `!skill` / `/skill:` names of this prompt (R4 `explicitSkills`). */
	readonly explicit?: readonly string[];
	/** 049 `activeTodoKind()` when it exists; `undefined` means the `"task"` default (R4). */
	readonly phase?: string;
}

export interface RankResult {
	readonly hits: readonly RankedSkill[];
	/** Distinct skills with a positive BM25 score (capped at {@link BM25_MATCH_CAP}). */
	readonly matchCount: number;
	readonly metacon?: MetaconStats;
}

/** Distinct eligible BM25 candidate cap, after de-duplication and exclusions. */
export const BM25_MATCH_CAP = 64;
/** R4.1: metacon plans over the BM25 top 64 (`planSkills` takes at most 500). */
export const METACON_PREFILTER = 64;
/** R4.3: token budget per requested result. */
export const METACON_TOKENS_PER_SLOT = 160;
/** R4.6: logged budget, not a cut-off (`planSkills` is synchronous). */
export const METACON_PLAN_BUDGET_MS = 50;
export const METACON_PHASES = ["task", "plan", "explore", "edit", "debug", "verify"] as const;
const MAX_QUERY_CHARS = 4096;
const MAX_CAPABILITIES = 128;

const STOP_WORDS = new Set(
	"a an and are as at be by can do for from in into is it its me my now of on or our please so that the then this to up us we with you your".split(
		" ",
	),
);

/** Content words: tokens longer than one character that are not stop words, de-duplicated in order. */
export function contentTokens(value: string): string[] {
	return [...new Set(retrievalTokens(value).filter((token) => token.length > 1 && !STOP_WORDS.has(token)))];
}

export function rankSkills(
	mode: SkillSelectRankMode,
	query: string,
	docs: readonly RankDoc[],
	options: RankOptions,
): RankResult {
	const pool = bm25Pool(query, docs, options.exclude);
	if (mode === "bm25") {
		return { hits: pool.slice(0, options.limit).map((hit) => ({ ...hit, source: "bm25" })), matchCount: pool.length };
	}
	return { ...metacon(query, docs, pool, options), matchCount: pool.length };
}

const corpusDocuments = new WeakMap<RankDoc, CorpusDocument>();

function corpusDocument(doc: RankDoc): CorpusDocument {
	const cached = corpusDocuments.get(doc);
	const body = `${doc.name} ${doc.description}`;
	if (cached?.id === doc.name && cached.uri === doc.location && cached.body === body) return cached;
	const document = { id: doc.name, uri: doc.location, body };
	corpusDocuments.set(doc, document);
	return document;
}

/** Preserve BM25 scores/order, then remove aliases and exclusions before capping distinct candidates. */
function bm25Pool(
	query: string,
	docs: readonly RankDoc[],
	exclude?: ReadonlySet<string>,
): Omit<RankedSkill, "source">[] {
	const bounded = query.slice(0, MAX_QUERY_CHARS);
	if (bounded.trim() === "" || docs.length === 0) return [];
	const byName = new Map(docs.map((doc) => [doc.name, doc]));
	const excludedHashes = new Set(
		docs.filter((doc) => exclude?.has(doc.name) && doc.contentHash).map((doc) => doc.contentHash),
	);
	const seen = new Set<string>();
	const corpus = [...byName.values()].map(corpusDocument);
	const pool: Omit<RankedSkill, "source">[] = [];
	for (const hit of rankCorpus(bounded, corpus)) {
		const doc = byName.get(hit.id);
		if (!doc || exclude?.has(doc.name) || (doc.contentHash && excludedHashes.has(doc.contentHash))) continue;
		const key = doc.contentHash ?? `name:${doc.name}`;
		if (seen.has(key)) continue;
		seen.add(key);
		pool.push({ ...doc, score: hit.score });
		if (pool.length === BM25_MATCH_CAP) break;
	}
	return pool;
}

function metacon(
	query: string,
	docs: readonly RankDoc[],
	pool: readonly Omit<RankedSkill, "source">[],
	options: RankOptions,
): Omit<RankResult, "matchCount"> {
	const phase = options.phase ?? "task";
	const phaseSource = options.phase === undefined ? "default" : "todo";
	const bm25Hits = (): RankedSkill[] =>
		pool.slice(0, options.limit).map((hit) => ({ ...hit, source: "bm25" as const }));
	const prefilter = pool.slice(0, METACON_PREFILTER);
	// R4.3: dedupe the query words first, then cut to 128 (`planSkills` rejects duplicate needs).
	const words = contentTokens(query.slice(0, MAX_QUERY_CHARS)).slice(0, MAX_CAPABILITIES);
	const base = { prefilter: prefilter.length, needs: words.length, phase, phaseSource } as const;
	if (prefilter.length === 0) {
		return { hits: [], metacon: { ...base, coveredNeeds: 0, rejected: {}, planMs: 0 } };
	}
	const started = performance.now();
	let plan: SkillPlan;
	try {
		const idf = inverseDocumentFrequency(docs);
		const needs: CapabilityNeed[] = words.map((word) => ({
			capability: word,
			weight: Math.max(1, idf.get(word) ?? 1),
			required: false,
		}));
		const catalog = prefilter.map(descriptor);
		const names = new Set(catalog.map((skill) => skill.id));
		plan = planSkills({
			phase,
			needs,
			catalog,
			approvedHashes: Object.fromEntries(catalog.map((skill) => [skill.id, skill.contentHash])),
			installedVersions: {},
			allowedPermissions: [],
			explicitSkills: [...new Set(options.explicit ?? [])].filter((name) => names.has(name)),
			tokenBudget: options.limit * METACON_TOKENS_PER_SLOT,
			maxSkills: options.limit,
		});
	} catch {
		// R4.5: only an error falls back, so a slow run still returns the same ranking (stable evaluation).
		const planMs = round3(performance.now() - started);
		return {
			hits: bm25Hits(),
			metacon: { ...base, coveredNeeds: 0, rejected: {}, planMs, fallback: "metacon-error" },
		};
	}
	const planMs = round3(performance.now() - started);
	const selected = new Set(plan.selected);
	// R4.4: metacon picks in BM25 order (ties by name), then BM25 fills the remaining slots.
	const picks: RankedSkill[] = prefilter
		.filter((hit) => selected.has(hit.name))
		.map((hit) => ({ ...hit, source: "metacon" as const }));
	const fill: RankedSkill[] = pool
		.filter((hit) => !selected.has(hit.name))
		.slice(0, Math.max(0, options.limit - picks.length))
		.map((hit) => ({ ...hit, source: "bm25-fill" as const }));
	const rejected: Record<string, number> = {};
	for (const reason of Object.values(plan.rejected)) rejected[reason] = (rejected[reason] ?? 0) + 1;
	return {
		hits: [...picks.slice(0, options.limit), ...fill],
		metacon: {
			...base,
			algorithm: plan.algorithm,
			state: plan.state,
			coveredNeeds: plan.covered.length,
			rejected,
			planMs,
			...(planMs > METACON_PLAN_BUDGET_MS ? { overBudget: true as const } : {}),
		},
	};
}

/** R4.2: one `SkillDescriptor` per prefiltered skill, from the loaded skill only. */
function descriptor(doc: RankDoc): SkillDescriptor {
	return {
		id: doc.name,
		contentHash: doc.contentHash ?? sha256(`${doc.name}\n${doc.description}`),
		capabilities: contentTokens(`${doc.name} ${doc.description}`).slice(0, MAX_CAPABILITIES),
		// Skills carry no phase, so every phase is allowed and the phase filter removes nothing (R4).
		phases: [...METACON_PHASES],
		tokenCost: Math.ceil((doc.description.length + doc.location.length) / 4),
		dependencies: [],
		conflicts: [],
		permissions: [],
		explicitOnly: false,
		packages: {},
	};
}

const idfCache = new WeakMap<readonly RankDoc[], Map<string, number>>();

/** BM25-style IDF of each content word over the searched corpus (cached per index). */
function inverseDocumentFrequency(docs: readonly RankDoc[]): Map<string, number> {
	const cached = idfCache.get(docs);
	if (cached) return cached;
	const df = new Map<string, number>();
	for (const doc of docs) {
		for (const token of contentTokens(`${doc.name} ${doc.description}`)) df.set(token, (df.get(token) ?? 0) + 1);
	}
	const idf = new Map<string, number>();
	const n = docs.length;
	for (const [token, count] of df) idf.set(token, Math.log((n - count + 0.5) / (count + 0.5) + 1));
	idfCache.set(docs, idf);
	return idf;
}

function sha256(value: string): string {
	return createHash("sha256").update(value, "utf8").digest("hex");
}

function round3(value: number): number {
	return Math.round(value * 1000) / 1000;
}
