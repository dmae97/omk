/**
 * Reasoning-router v4 — frozen types and the calibratable weight schema
 * (Goal 009 Wave 1 Lane A, specs/008-reasoning-router-advanced-accuracy).
 *
 * Pure, side-effect-free, erasable TypeScript. No runtime imports. This file
 * mirrors the role `reasoning-router-weights.ts` plays for v2: types + a
 * numeric weight schema + one calibrated default preset. v4 is an opt-in
 * SIBLING of v1/v2/v3 — nothing here is imported by v1/v2/v3/agent-session.ts,
 * and this lane does not edit any of those files.
 *
 * ============================================================================
 * WHY A SEPARATE WEIGHT SCHEMA FROM v2's RouterWeights
 * ============================================================================
 * v2's `RouterWeights` cross-multiplies every (feature, class) pair through a
 * shared `RouterFeatures` shape (see reasoning-router-weights.ts). v3 abandoned
 * that in favor of v1-style contextual boolean features (leadingIntent,
 * localEdit, diagnosticEvidence, reviewScope, planBrief, refactorCue,
 * implementationObject) scored with inline integer literals. v4 restores the
 * "verdict is scored from named weights, not literals" discipline WITHOUT
 * discarding v3's richer contextual feature set: every literal v3 used to bump
 * a score now has a named field here, and `DEFAULT_WEIGHTS_V4` reproduces v3's
 * exact literals (see reasoning-router-v3.ts) so classifyTaskV4's default
 * output matches v3 on the full gold set and focused sentinels (spec 008 Req 2
 * "Default weights produce v3-equivalent behavior unless new governance
 * evidence justifies calibrated changes").
 *
 * `keywordFamily` is the one place this schema is a genuine (class -> weight)
 * table (mirrors v2's per-class rows): every non-trivial class has its own
 * whole-prompt keyword-family pattern (see reasoning-router-v4.ts) scored
 * uniformly at 4 under DEFAULT_WEIGHTS_V4, matching v3's KEYWORD_PATTERNS_V3
 * weight=4 for every family. `trivial` carries weight 0 (no keyword family;
 * trivial is reached only via the zero-score fallback cascade, same as v1/v2/v3).
 *
 * `secondClauseIntent` is new in v4 (spec 008 plan.md "second-clause intent for
 * compound prompts"): a bounded bonus applied when a second, distinct leading
 * verb is found after a short-range conjunction split (see
 * `splitCompoundClauseV4` in reasoning-router-v4.ts). It is INERT for every
 * existing GOLD_SET row (verified: no gold-set prompt produces a non-null
 * second-clause intent that differs from the primary), so enabling it changes
 * no gold-set classification; it only sharpens confidence/margin metadata and
 * gives future calibration lanes a lever without touching the algorithm.
 *
 * `negationWindowChars` bounds v4's negation gating (spec 008 plan.md "bounded
 * negation window"): a keyword-family/contextual-feature match is only
 * suppressed when a closed set of negation cues (don't/doesn't/isn't/never/
 * avoid/skip/without/no need to/...) appears within this many characters
 * immediately BEFORE the match, and only within the same clause (a
 * .,;!? boundary stops the scan). This is intentionally narrow: it fixes
 * concrete false-positive cases (e.g. "don't refactor this, just fix the
 * crash") without touching any pattern that is anchored to the start of the
 * leading clause (those are already negation-immune by construction, since
 * "don't" never matches an anchored "^refactor" test).
 *
 * `lowConfidenceThreshold` / `highConfidenceThreshold` bound the confidence
 * bands (`ClassifierVerdictV4.confidenceBand`) computed from
 * `margin / topScore` in reasoning-router-v4.ts. They are metadata-only: they
 * never change `taskClass`, only how `resolveThinkingLevelV4WithUncertainty`
 * treats an already-decided class (see that function's doc comment — low
 * confidence may only hold or escalate effort, never reduce it below the
 * text-derived base level).
 * ============================================================================
 */

/** Closed set of v4 task classes. Identical union to v1/v2/v3 (spec 008 Req 2: "v4 returns the same class union as v3"). */
export type TaskClassV4 = "trivial" | "simple-edit" | "code-gen" | "debug" | "refactor" | "review" | "plan";

/** Subagent lane types recognized by the v4 classifier and resolvers. Identical union to v1/v2/v3. */
export type ReasoningLaneTypeV4 = "planner" | "security" | "explorer" | "coder" | "reviewer" | "tester";

/** Fixed iteration order over TaskClassV4 (matches the type-declaration order; also v4's argmax tie-break precedence, highest first). */
export const TASK_CLASSES_V4: readonly TaskClassV4[] = [
	"debug",
	"refactor",
	"review",
	"plan",
	"simple-edit",
	"code-gen",
	"trivial",
];

/**
 * Named weight schema for the v4 scorer (reasoning-router-v4.ts). Every field
 * is a plain, deterministic integer/ratio; there is no clock, randomness, or
 * I/O anywhere in this file or its consumer.
 */
export interface RouterWeightsV4 {
	/** Bump to "code-gen" when a code fence or diff hunk is present (v3: unconditional +4). */
	readonly codeFenceOrDiff: number;
	/** Bump to the primary leading-clause intent class, if any (v3: unconditional +8). */
	readonly leadingIntent: number;
	/** Bump to a distinct second-clause intent class in a detected compound prompt (v4-new; default half of `leadingIntent`). */
	readonly secondClauseIntent: number;
	/** Bump to "simple-edit" when the composite local-edit feature fires (v3: +7). */
	readonly localEdit: number;
	/** Bump to "debug" when the composite diagnostic-evidence feature fires (v3: +7). */
	readonly diagnosticEvidence: number;
	/** Bump to "review" when the composite review-scope feature fires (v3: +3). */
	readonly reviewScope: number;
	/** Bump to "plan" when the composite plan-brief feature fires (v3: +8). */
	readonly planBrief: number;
	/** Bump to "plan" for release-bound operational runbooks (commit/push/tag/publish/changelog/CI bundles). */
	readonly operationalRunbook: number;
	/** Bump to "refactor" when the refactor-cue pattern matches anywhere in the prompt (v3: +6). */
	readonly refactorCue: number;
	/** Bump to "code-gen" when an implementation-object noun is present (v3: +3). */
	readonly implementationObject: number;
	/** Per-class whole-prompt keyword-family bump (v3 KEYWORD_PATTERNS_V3: uniform +4; trivial has no family, 0). */
	readonly keywordFamily: Readonly<Record<TaskClassV4, number>>;
	/** Bump to "code-gen" for a bare "add" keyword, gated by !localEdit (v3: +1). */
	readonly addKeyword: number;
	/** Bump to the class matching `history[0]`, if supplied (v4-new; 0 under DEFAULT_WEIGHTS_V4, inert until calibrated). */
	readonly multiTurnPrior: number;
	/** Linear per-bucket bump applied to debug/review/plan under context pressure (v4-new; 0 under DEFAULT_WEIGHTS_V4, inert until calibrated). */
	readonly pressureBucket: number;
	/** Bump to the class matching an externally supplied judge vote, if any (v4-new; 0 under DEFAULT_WEIGHTS_V4, inert until calibrated). */
	readonly judgeVote: number;
	/** Bounded look-back window (characters) for negation-cue gating, never crossing a .,;!? boundary. */
	readonly negationWindowChars: number;
	/** confidence <= this value bands as "low" (confidence is margin / topScore, in [0, 1]). */
	readonly lowConfidenceThreshold: number;
	/** confidence >= this value bands as "high". */
	readonly highConfidenceThreshold: number;
}

/**
 * Calibrated default preset (Goal 009 Wave 1 Lane A). Every literal below is
 * copied verbatim from reasoning-router-v3.ts's inline score bumps, so
 * classifyTaskV4(input, DEFAULT_WEIGHTS_V4) reproduces classifyTaskV3(input)
 * on every existing GOLD_SET row and focused sentinel (see
 * test/suite/regressions/013-reasoning-router-v4-accuracy.test.ts). The two
 * v4-new fields (`secondClauseIntent`, `negationWindowChars`) and the three
 * inert extension fields (`multiTurnPrior`, `pressureBucket`, `judgeVote`) are
 * the only behavior deltas from v3, and are proven inert on the current
 * GOLD_SET (see the evidence file for this lane).
 */
export const DEFAULT_WEIGHTS_V4: RouterWeightsV4 = {
	codeFenceOrDiff: 4,
	leadingIntent: 8,
	secondClauseIntent: 4,
	localEdit: 7,
	diagnosticEvidence: 7,
	reviewScope: 3,
	planBrief: 8,
	operationalRunbook: 8,
	refactorCue: 6,
	implementationObject: 3,
	keywordFamily: {
		trivial: 0,
		"simple-edit": 4,
		"code-gen": 4,
		debug: 4,
		refactor: 4,
		review: 4,
		plan: 4,
	},
	addKeyword: 1,
	multiTurnPrior: 0,
	pressureBucket: 0,
	judgeVote: 0,
	negationWindowChars: 24,
	lowConfidenceThreshold: 0.35,
	highConfidenceThreshold: 0.7,
};
