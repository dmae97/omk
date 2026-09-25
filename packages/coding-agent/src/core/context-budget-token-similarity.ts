// Subword-aware token similarity for context-budget relevance scoring.
//
// User queries inflect — Korean tokens keep their 조사 endings ("배선들을"),
// and Latin tokens drift by stem or plural ("optimize" vs "optimization") —
// so a query token that never appears verbatim still scores when a token
// contains it, it contains a token (stem containment), or the two share
// enough character bigrams. The matched weight is scaled by that
// similarity, so a partial lexical hit can never outscore an exact one.
//
// Extracted from context-budget-relevance.ts to keep both modules under
// the 250-pure-LOC ceiling.

/**
 * Minimum token length for subword matching. Shorter tokens ("ocr", "db")
 * stay exact-only: below this length substring hits are noise-dominated.
 */
export const SUBWORD_MIN_LENGTH = 4;
/** Dice coefficient at which two non-identical tokens count as one lexical hit. */
export const BIGRAM_DICE_THRESHOLD = 0.5;

/**
 * Best weighted partial match for one query token across the item token set.
 * Runs only for tokens that missed the exact lookup, so the common path keeps
 * its O(1)-per-token shape.
 */
export function fuzzyTokenWeight(
	queryToken: string,
	itemTokenSet: ReadonlySet<string>,
	itemTokenWeights: ReadonlyMap<string, number> | undefined,
): number {
	if (queryToken.length < SUBWORD_MIN_LENGTH) {
		return 0;
	}
	let best = 0;
	for (const itemToken of itemTokenSet) {
		const similarity = tokenSimilarity(queryToken, itemToken);
		if (similarity <= 0) {
			continue;
		}
		const weight = (itemTokenWeights?.get(itemToken) ?? 1) * similarity;
		if (weight > best) {
			best = weight;
		}
	}
	return best;
}

/**
 * Similarity in [0, 1] between two distinct tokens: 1 on containment either
 * way, else the character-bigram Dice coefficient when it reaches
 * {@link BIGRAM_DICE_THRESHOLD}. The length-ratio guard rejects pairs whose
 * bigram overlap can mathematically never reach the threshold.
 */
export function tokenSimilarity(queryToken: string, itemToken: string): number {
	if (itemToken.length < SUBWORD_MIN_LENGTH) {
		return 0;
	}
	if (itemToken.includes(queryToken) || queryToken.includes(itemToken)) {
		return 1;
	}
	// Max possible shared bigrams is the shorter side's count; Dice =
	// 2·shared/(bigrams_a + bigrams_b) ≥ threshold requires
	// longer ≤ 3·shorter - 1 for threshold 0.5 (integer bigram counts shift it
	// to -3 under exact counts; the +1 slack keeps the guard conservative).
	const shorter = Math.min(queryToken.length, itemToken.length);
	const longer = Math.max(queryToken.length, itemToken.length);
	if (longer > 3 * shorter) {
		return 0;
	}
	const dice = bigramDice(queryToken, itemToken);
	return dice >= BIGRAM_DICE_THRESHOLD ? dice : 0;
}

/**
 * Character-bigram Dice coefficient: 2·|shared bigrams| / (|a| + |b|).
 * Script-agnostic — it works on Korean syllable runs and Latin words alike,
 * which is exactly what an agglutinative-language query needs.
 */
function bigramDice(a: string, b: string): number {
	if (a.length < 2 || b.length < 2) {
		return 0;
	}
	const bigramsOfB = new Set<string>();
	for (let i = 0; i + 1 < b.length; i++) {
		bigramsOfB.add(b.slice(i, i + 2));
	}
	let shared = 0;
	const seen = new Set<string>();
	for (let i = 0; i + 1 < a.length; i++) {
		const gram = a.slice(i, i + 2);
		if (seen.has(gram)) {
			continue;
		}
		seen.add(gram);
		if (bigramsOfB.has(gram)) {
			shared++;
		}
	}
	return (2 * shared) / (a.length - 1 + (b.length - 1));
}
