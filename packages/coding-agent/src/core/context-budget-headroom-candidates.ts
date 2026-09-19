import {
	type ContextBudgetItemV2,
	type ContextRepresentationCandidateV2,
	type ContextSourceRefV2,
	DEFAULT_HEADROOM_QUALITY_POLICY,
	fnv1aHex,
	fullTextTokens,
	type HeadroomQualityPolicyV2,
	heuristicTokenCount,
} from "./context-budget-headroom-types.ts";

const SUMMARY_HEAD_CHARS = 160;
const HEADROOM_HEAD_CHARS = 120;

/** Prices one materialized representation string; must be the counter that produced the item's full-text cost. */
export type RepresentationTokenCounter = (text: string) => number;

/**
 * Derive the representations the selector may choose for one item.
 *
 * Every non-full candidate is priced by counting the string it actually
 * materializes with `countTokens` — the same counter that priced the full
 * text — so the cost the selector checks against the budget is the cost of
 * the text that would be sent. A compression ratio is never a cost: a summary
 * that returns its source unchanged saves nothing, and a representation whose
 * materialized text is not cheaper than the full text is not offered at all.
 * Pass the counter that produced `item.tokenEstimate`; mixing an exact
 * tokenizer for the full text with the heuristic for its alternatives makes
 * the candidates incomparable.
 */
export function deriveRepresentationCandidates(
	item: ContextBudgetItemV2,
	policy: HeadroomQualityPolicyV2 = DEFAULT_HEADROOM_QUALITY_POLICY,
	countTokens: RepresentationTokenCounter = heuristicTokenCount,
): readonly ContextRepresentationCandidateV2[] {
	const full = fullTextTokens(item);
	const sourceRef = item.sourceRef;
	const retrievable = sourceRef?.retrievable === true;
	const candidates: ContextRepresentationCandidateV2[] = [];
	const offerIfCheaper = (candidate: ContextRepresentationCandidateV2): void => {
		if (candidate.text !== item.text && candidate.estimatedTokens < full) candidates.push(candidate);
	};

	candidates.push({
		kind: "full",
		text: item.text,
		estimatedTokens: full,
		fidelity: item.tokenEstimate !== undefined ? "exact" : "bounded",
		sourceRef,
	});

	if (retrievable && sourceRef) {
		const pointerText = formatPointer(sourceRef);
		offerIfCheaper({
			kind: "pointer",
			text: pointerText,
			estimatedTokens: countTokens(pointerText),
			fidelity: "bounded",
			sourceRef,
		});
	}

	if (isSummaryEligible(item, full, policy)) {
		const summaryText = summarizeText(item.text);
		offerIfCheaper({
			kind: "summary",
			text: summaryText,
			estimatedTokens: countTokens(summaryText),
			fidelity: "lossy",
			summaryHash: fnv1aHex(item.text),
		});
	}

	if (full > policy.headroomThresholdTokens && retrievable) {
		const headroomText = formatHeadroom(item.text, sourceRef);
		// The shadow compressor's reversible payload is larger than the visible
		// head, so its price keeps a floor above the counted head text.
		offerIfCheaper({
			kind: "headroom-compressed",
			text: headroomText,
			estimatedTokens: Math.max(Math.ceil(full * 0.35) + 16, countTokens(headroomText)),
			fidelity: "reversible",
			sourceRef,
			compressorId: "headroom-shadow",
		});
	}

	if (policy.allowOmit) {
		candidates.push({
			kind: "omit",
			text: "",
			estimatedTokens: 0,
			fidelity: "lossy",
			sourceRef,
		});
	}

	return candidates;
}

function isSummaryEligible(item: ContextBudgetItemV2, fullTokens: number, policy: HeadroomQualityPolicyV2): boolean {
	return (
		item.tier === "history" ||
		item.tier === "evidence" ||
		item.tier === "scratch" ||
		(item.ageTurns ?? 0) >= policy.summaryMaxAgeTurns ||
		fullTokens > policy.headroomThresholdTokens
	);
}

function formatPointer(ref: ContextSourceRefV2): string {
	const parts: string[] = [`uri="${escapeMetadataValue(ref.uri)}"`];
	if (ref.symbol) parts.push(`symbol="${escapeMetadataValue(ref.symbol)}"`);
	if (ref.range) parts.push(`lines="${ref.range.startLine}-${ref.range.endLine}"`);
	parts.push(`hash="${escapeMetadataValue(ref.contentHash)}"`);
	return `<pointer ${parts.join(" ")} />`;
}

function summarizeText(text: string): string {
	if (text.length <= SUMMARY_HEAD_CHARS) {
		return text;
	}
	return `${text.slice(0, SUMMARY_HEAD_CHARS)} …[summary]`;
}

function formatHeadroom(text: string, ref?: ContextSourceRefV2): string {
	const head = text.slice(0, HEADROOM_HEAD_CHARS);
	const hash = fnv1aHex(text);
	const where = ref ? ` uri="${escapeMetadataValue(ref.uri)}"` : "";
	return `${head} …[headroom-compressed${where} hash="${hash}"]`;
}

function escapeMetadataValue(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}
