/**
 * Reasoning-router v2 — frozen types, feature vector, weight schema, the
 * V1_COMPAT_WEIGHTS v1-exact oracle (Req 1.4), and the DEFAULT_WEIGHTS
 * calibrated production preset (Goal 004 Lane I5b).
 *
 * Pure, side-effect-free, erasable TypeScript. No runtime imports.
 *
 * ============================================================================
 * WEIGHT PRESETS — V1_COMPAT_WEIGHTS (v1 oracle) + DEFAULT_WEIGHTS (calibrated)
 * ============================================================================
 * The v1 classifier (reasoning-router.ts) is a first-match keyword cascade with
 * FIXED precedence: debug > refactor > review > plan > simple-edit > code-gen,
 * then fence/diff, then length, then lane fallback, then default code-gen.
 *
 * We reproduce that precedence as DIGIT-POSITION weights. The keyword family at
 * precedence rank r contributes exactly 10^(6-r) to ITS OWN class score when its
 * pattern matches (strongKeyword diagonal, 0/1 match indicator):
 *
 *     debug      r=1 -> 10^5 = 100000
 *     refactor   r=2 -> 10^4 = 10000
 *     review     r=3 -> 10^3 = 1000
 *     plan       r=4 -> 10^2 = 100
 *     simple-edit r=5 -> 10^1 = 10
 *     code-gen   r=6 -> 10^0 = 1
 *
 * Why this is exact for v1's keyword step: a higher-precedence family always
 * outscores the SUM of every lower-precedence family (100000 > 10000+1000+100+
 * 10+1 = 11111), so argmax over scoreClass recovers "highest-precedence match
 * wins" with no possibility of ties between matched families.
 *
 * v1 steps 2-6 (fence/diff -> code-gen; len<40 -> trivial; len>=2400 -> plan;
 * lane fallback; default code-gen) are NOT linear in the v2 feature vector
 * (v1 uses hard 40/2400 thresholds; a single lenBucket weight is monotonic and
 * cannot reproduce both). They are therefore reproduced by classifyTaskV2's
 * zero-score cascade: when no keyword and no fence/diff signal fires (every
 * scoreClass term is 0 under DEFAULT_WEIGHTS), classifyTaskV2 applies v1 steps
 * 3-6 verbatim. The fence/diff flags live on the code-gen weight row (boolean
 * weight flag AND feature -> +1) so a fence/diff-only turn still scores code-gen
 * > 0 and is selected by argmax, matching v1 step 2. trivial carries no keyword
 * weight (it is not a keyword family) and is reached only via the cascade.
 *
 * Two presets ship from this encoding (both with thresholds 0, so the
 * sticky / consult / low-margin-judge paths stay INACTIVE):
 *  - V1_COMPAT_WEIGHTS: STRONG-only diagonal, every WEAK coefficient 0. This is
 *    the frozen Req 1.4 oracle — classifyTaskV2(input, V1_COMPAT_WEIGHTS) ===
 *    classifyTask(input) bit-for-bit on the v1 corpus. Do NOT recalibrate it.
 *  - DEFAULT_WEIGHTS: the calibrated production preset. Identical STRONG
 *    diagonal PLUS a constant WEAK diagonal of 1 per keyword class, so an
 *    ambiguous WEAK token (debug "fix", refactor "simplify", review "assess" /
 *    "lgtm", code-gen "add", plan "break down") contributes a small positive
 *    signal to its own class WITHOUT dominating a stronger sibling-class signal
 *    (every STRONG weight >= 1; higher-precedence STRONG weights strictly > 1).
 *    classifyTaskV2(input, DEFAULT_WEIGHTS) is strictly better than v1 on the
 *    gold set (CWA(v2) > CWA(v1)); see laneI5b-calibration.md.
 * ============================================================================
 */

/** Closed set of v2 task classes (same labels as v1 TaskClass). */
export type TaskClassV2 = "trivial" | "simple-edit" | "code-gen" | "debug" | "refactor" | "review" | "plan";

/** Subagent lane types recognized by the v2 classifier and resolver. */
export type ReasoningLaneTypeV2 = "planner" | "security" | "explorer" | "coder" | "reviewer" | "tester";

/** Fixed iteration order over TaskClassV2 (matches the type-declaration order). */
export const TASK_CLASSES_V2: readonly TaskClassV2[] = [
	"trivial",
	"simple-edit",
	"code-gen",
	"debug",
	"refactor",
	"review",
	"plan",
];

/**
 * Feature vector for one turn, extracted by classifyTaskV2's caller layer.
 *
 * - strongKeyword[c] / weakKeyword[c]: per-class match counts (0 when absent).
 *   For v1-compat, strongKeyword[c] is the 0/1 result of v1's pattern.test.
 * - codeFence / diffHunk: prompt-embedded code-fence / diff-marker booleans.
 * - lenBucket: floor(log2(trimmedLen + 1)) clamped to [0, 7].
 * - multiTurnPrior: most-recent historical class (N=8 ring buffer) or null.
 * - pressureBucket: context-pressure band (0..<0.5, 1..<0.75, 2..<0.9, 3..>=0.9).
 * - judgeVote: optional tier-2 LLM-judge label, or null.
 */
export interface RouterFeatures {
	strongKeyword: Partial<Record<TaskClassV2, number>>;
	weakKeyword: Partial<Record<TaskClassV2, number>>;
	codeFence: boolean;
	diffHunk: boolean;
	lenBucket: number;
	multiTurnPrior: TaskClassV2 | null;
	pressureBucket: number;
	judgeVote: TaskClassV2 | null;
}

/**
 * Tunable weight surface for the v2 router.
 *
 * classWeights[c] is a RouterFeatures-shaped row of per-feature coefficients for
 * class c. stickyThreshold / consultThreshold / marginThreshold steer
 * classifyTaskV2's hysteresis, AdaptOrch consultation, and low-confidence margin
 * gate respectively. laneStep mirrors v1's resolver ladder adjustment per lane.
 */
export interface RouterWeights {
	classWeights: Readonly<Record<TaskClassV2, RouterFeatures>>;
	stickyThreshold: number;
	consultThreshold: number;
	marginThreshold: number;
	laneStep: Readonly<Partial<Record<ReasoningLaneTypeV2, 1 | -1>>>;
}

/**
 * Pure integer-arithmetic scorer. Returns S(c) = sum of weighted features for
 * class c under weights w:
 *  - keyword terms: sum over classes c2 of strong/weak weight * feature count.
 *  - boolean signal terms (codeFence, diffHunk): +1 when both the weight flag
 *    AND the feature are set (magnitude is a unit; the flag gates the class).
 *  - numeric terms (lenBucket, pressureBucket): weight * feature product.
 *  - class-equality terms (multiTurnPrior, judgeVote): +1 on exact match with a
 *    non-null feature.
 *
 * Deterministic: same (c, f, w) -> same number. No clock, randomness, or I/O.
 */
export function scoreClass(c: TaskClassV2, f: RouterFeatures, w: RouterWeights): number {
	const cw = w.classWeights[c];
	let s = 0;
	for (const c2 of TASK_CLASSES_V2) {
		s += (cw.strongKeyword[c2] ?? 0) * (f.strongKeyword[c2] ?? 0);
		s += (cw.weakKeyword[c2] ?? 0) * (f.weakKeyword[c2] ?? 0);
	}
	if (cw.codeFence && f.codeFence) s += 1;
	if (cw.diffHunk && f.diffHunk) s += 1;
	s += cw.lenBucket * f.lenBucket;
	if (f.multiTurnPrior !== null && cw.multiTurnPrior === f.multiTurnPrior) s += 1;
	s += cw.pressureBucket * f.pressureBucket;
	if (f.judgeVote !== null && cw.judgeVote === f.judgeVote) s += 1;
	return s;
}

/**
 * All-neutral feature row (every coefficient inert). Used to build weight rows.
 */
function neutralRow(): RouterFeatures {
	return {
		strongKeyword: {},
		weakKeyword: {},
		codeFence: false,
		diffHunk: false,
		lenBucket: 0,
		multiTurnPrior: null,
		pressureBucket: 0,
		judgeVote: null,
	};
}

/**
 * STRONG-keyword diagonal shared by both presets: family at precedence rank r
 * contributes 10^(6-r) to its own class (see file header). code-gen additionally
 * owns the codeFence/diffHunk flags so v1 step 2 is captured inside scoreClass.
 * Every WEAK / length / prior / pressure / judge coefficient is zero here.
 */
const STRONG_DIAGONAL: Readonly<Record<TaskClassV2, RouterFeatures>> = {
	trivial: neutralRow(),
	"simple-edit": { ...neutralRow(), strongKeyword: { "simple-edit": 10 } },
	"code-gen": {
		...neutralRow(),
		strongKeyword: { "code-gen": 1 },
		codeFence: true,
		diffHunk: true,
	},
	debug: { ...neutralRow(), strongKeyword: { debug: 100000 } },
	refactor: { ...neutralRow(), strongKeyword: { refactor: 10000 } },
	review: { ...neutralRow(), strongKeyword: { review: 1000 } },
	plan: { ...neutralRow(), strongKeyword: { plan: 100 } },
};

/**
 * v1-compat oracle weight preset (Goal 004 Req 1.4 regression oracle).
 *
 * STRONG-only diagonal (10^(6-r), see file header); every WEAK coefficient is 0
 * so WEAK keywords are inert. code-gen owns the codeFence/diffHunk flags so v1
 * step 2 is captured inside scoreClass. Every length / prior / pressure / judge
 * coefficient is zero (v1 has no linear length signal, no history, no
 * context-pressure input, no judge). Thresholds are 0 so classifyTaskV2 never
 * enters the sticky / consult / low-margin-judge paths.
 *
 * classifyTaskV2(input, V1_COMPAT_WEIGHTS) === classifyTask(input) bit-for-bit
 * on the v1 corpus. Kept frozen as the oracle; do NOT recalibrate this preset.
 */
export const V1_COMPAT_WEIGHTS: RouterWeights = {
	classWeights: {
		trivial: { ...STRONG_DIAGONAL.trivial },
		"simple-edit": { ...STRONG_DIAGONAL["simple-edit"] },
		"code-gen": { ...STRONG_DIAGONAL["code-gen"] },
		debug: { ...STRONG_DIAGONAL.debug },
		refactor: { ...STRONG_DIAGONAL.refactor },
		review: { ...STRONG_DIAGONAL.review },
		plan: { ...STRONG_DIAGONAL.plan },
	},
	stickyThreshold: 0,
	consultThreshold: 0,
	marginThreshold: 0,
	laneStep: { planner: 1, security: 1, explorer: -1 },
};

/**
 * Calibrated production preset (Goal 004 Lane I5b). Extends V1_COMPAT_WEIGHTS
 * with a constant WEAK-keyword diagonal of 1 per keyword class.
 *
 * Weighting invariant:
 *  - STRONG keyword in class C: 10^(6-rank(C)) (unchanged from V1_COMPAT).
 *  - WEAK keyword in class C: 1 (constant, identical across classes).
 *
 * Because every STRONG weight (min 1 for code-gen) is >= the constant WEAK
 * weight 1, and higher-precedence STRONG weights (>=10) strictly exceed it, a
 * single STRONG hit in ANY class always beats or ties a lone WEAK hit, while two
 * STRONG hits resolve by the precedence diagonal (10^(6-r)). Concrete
 * consequences on the gold set:
 *  - "fix the typo": WEAK-debug(1) + STRONG-simple-edit(10) -> simple-edit wins
 *    (the Req 1.3 regression fix; v1 wrongly routed to debug).
 *  - "fix the race condition": WEAK-debug(1) alone -> debug beats the zero
 *    default (no len>=40 cascade to code-gen; v1 was already correct here, the
 *    STRONG-only oracle had regressed it).
 *  - "simplify the nested if-else": WEAK-refactor(1) alone -> refactor.
 *  - "lgtm, just double-check the tests": WEAK-review(1) alone -> review.
 *  - "crash the typo": STRONG-debug(100000) + STRONG-simple-edit(10) -> debug
 *    (a crash-dominated prompt stays debug; precedence diagonal preserved).
 *
 * classifyTaskV2(input, DEFAULT_WEIGHTS) is STRICTLY BETTER than v1 on the gold
 * set (CWA(v2) > CWA(v1)); see .omk/goals/004-reasoning-router-v2-impl/
 * laneI5b-calibration.md. Thresholds stay 0 so hysteresis/consult/margin paths
 * remain inactive (Phase A).
 */
export const DEFAULT_WEIGHTS: RouterWeights = {
	classWeights: {
		trivial: { ...STRONG_DIAGONAL.trivial },
		"simple-edit": { ...STRONG_DIAGONAL["simple-edit"] },
		"code-gen": { ...STRONG_DIAGONAL["code-gen"], weakKeyword: { "code-gen": 1 } },
		debug: { ...STRONG_DIAGONAL.debug, weakKeyword: { debug: 1 } },
		refactor: { ...STRONG_DIAGONAL.refactor, weakKeyword: { refactor: 1 } },
		review: { ...STRONG_DIAGONAL.review, weakKeyword: { review: 1 } },
		plan: { ...STRONG_DIAGONAL.plan, weakKeyword: { plan: 1 } },
	},
	stickyThreshold: 0,
	consultThreshold: 0,
	marginThreshold: 0,
	laneStep: { planner: 1, security: 1, explorer: -1 },
};
