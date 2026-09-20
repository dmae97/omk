/**
 * Deterministic observation views with a coverage gate — U1/U3.
 *
 * A view is a projection of a stored raw observation, never a rewrite of it.
 * `chooseView` refuses any candidate that drops a required fact atom: a cheap
 * representation is admissible only if it preserves the decision-relevant
 * facts the current obligations need. `coverageStatus` is `unknown` when the
 * input carries no required fact set — never silently "covered".
 */

import { ensure, integer, text } from "../metacognition/validation.ts";
import { viewDigestOf } from "./identity.ts";
import type { ObservationCoverageStatus, ObservationView, ObservationViewKind, RawObservation } from "./types.ts";

const CHARS_PER_TOKEN = 4;
/** Per-atom-class occurrence cap. Four classes stay well under any global bound. */
const MAX_FACTS_PER_ID = 32;
const MAX_VIEW_TEXT = 32_768;

export function estimateViewTokens(text: string): number {
	return Math.max(1, Math.ceil(text.length / CHARS_PER_TOKEN));
}

/** A host-verifiable fact atom extracted from raw bytes, e.g. exitCode=1. */
export interface FactAtom {
	readonly id: string;
	/** The verbatim text that must appear in a view for the atom to count as covered. */
	readonly evidence: string;
	readonly byteOffset: number;
	readonly byteLength: number;
}

const FACT_PATTERNS: readonly { readonly id: string; readonly re: RegExp }[] = [
	{ id: "exit-code", re: /exit code[:\s]+(-?\d+)|exitCode\s*[=:]\s*(-?\d+)/i },
	{ id: "test-failure", re: /FAIL[:\s]+([A-Za-z0-9_.\-/]+)|✗\s*([A-Za-z0-9_.\-/]+)/ },
	{ id: "permission-denied", re: /permission[ _-]?denied|EACCES/i },
	{ id: "error-marker", re: /(?:error|errno|exception|traceback)[:\s]/i },
];

/**
 * Extract host-verifiable fact atoms from raw bytes. `requiredFactIds` limits
 * extraction to the caller's obligation set; when omitted, all recognized
 * atoms are returned so a view can advertise what it preserves.
 */
export function extractFacts(raw: Uint8Array, requiredFactIds?: readonly string[]): FactAtom[] {
	const decoded = new TextDecoder("utf-8", { fatal: false }).decode(raw);
	const encoder = new TextEncoder();
	const wanted = requiredFactIds === undefined ? undefined : new Set(requiredFactIds);
	const facts: FactAtom[] = [];
	for (const { id, re } of FACT_PATTERNS) {
		if (wanted !== undefined && !wanted.has(id)) continue;
		// Per-id cap, not a shared running total: a log that repeats one atom
		// thousands of times must not starve a later pattern out of extraction
		// entirely, or a required atom silently disappears from every view.
		let perId = 0;
		for (const match of decoded.matchAll(new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`))) {
			if (perId >= MAX_FACTS_PER_ID) break;
			const evidence = match[0];
			const byteOffset = encoder.encode(decoded.slice(0, match.index ?? 0)).length;
			facts.push({
				id,
				evidence,
				byteOffset,
				byteLength: encoder.encode(evidence).length,
			});
			perId += 1;
		}
	}
	return facts;
}

/**
 * Collapse repeated identical atoms into one line that keeps the occurrence
 * count. Without this the evidence view of a log that repeats one failure is
 * larger than the raw text it was supposed to shrink, and the selector
 * correctly but uselessly falls back to full text.
 */
function dedupeFacts(facts: readonly FactAtom[]): readonly { readonly fact: FactAtom; readonly count: number }[] {
	const byKey = new Map<string, { fact: FactAtom; count: number }>();
	for (const fact of facts) {
		const key = `${fact.id}\u0000${fact.evidence}`;
		const existing = byKey.get(key);
		if (existing === undefined) byKey.set(key, { fact, count: 1 });
		else existing.count += 1;
	}
	return [...byKey.values()];
}

function viewText(raw: Uint8Array, facts: readonly FactAtom[], kind: ObservationViewKind): string {
	const decoded = new TextDecoder("utf-8", { fatal: false }).decode(raw);
	switch (kind) {
		case "full":
			return decoded;
		case "excerpt": {
			if (decoded.length <= MAX_VIEW_TEXT) return decoded;
			const head = decoded.slice(0, Math.floor(MAX_VIEW_TEXT / 2));
			const tail = decoded.slice(-Math.floor(MAX_VIEW_TEXT / 2));
			return `${head}\n…[omitted ${decoded.length - MAX_VIEW_TEXT} chars]…\n${tail}`;
		}
		case "evidence":
			return facts.length === 0
				? ""
				: dedupeFacts(facts)
						.map(({ fact, count }) =>
							count === 1
								? `${fact.id} @${fact.byteOffset}: ${fact.evidence}`
								: `${fact.id} @${fact.byteOffset} \u00d7${count}: ${fact.evidence}`,
						)
						.join("\n")
						.slice(0, MAX_VIEW_TEXT);
		case "pointer":
			return `[observation ${raw.length} bytes; digest-bound; read via handle]`;
	}
}

function coverageFor(
	covered: readonly string[],
	required: readonly string[],
): { status: ObservationCoverageStatus; missing: readonly string[] } {
	if (required.length === 0) return { status: "unknown", missing: [] };
	const coveredSet = new Set(covered);
	const missing = required.filter((id) => !coveredSet.has(id));
	return { status: missing.length === 0 ? "complete" : "partial", missing };
}

/**
 * Build the candidate views for one observation. Every view records which
 * fact atoms it preserves and which required atoms it would drop, so the
 * selector can gate on coverage rather than token density alone.
 */
export function makeViews(
	observation: RawObservation,
	requiredFactIds: readonly string[] = [],
): readonly ObservationView[] {
	text(observation.observationId, "observationId", 128);
	for (const id of requiredFactIds) text(id, "requiredFactId", 256);
	const facts = extractFacts(observation.bytes);
	const coveredByKind: Record<ObservationViewKind, readonly string[]> = {
		full: facts.map((f) => f.id),
		excerpt: facts.map((f) => f.id), // excerpt keeps head+tail; see note
		evidence: facts.map((f) => f.id),
		pointer: [],
	};
	const kinds: readonly ObservationViewKind[] = ["full", "excerpt", "evidence", "pointer"];
	return kinds.map((kind) => {
		const body = viewText(observation.bytes, facts, kind);
		const covered = coveredByKind[kind].filter(
			(id) => body.includes(id) || kind !== "evidence" || facts.some((f) => f.id === id),
		);
		const { status, missing } = coverageFor(covered, requiredFactIds);
		return Object.freeze({
			viewKind: kind,
			observationId: observation.observationId,
			parentDigest: observation.rawDigest,
			transformationDigest: viewDigestOf({
				observationId: observation.observationId,
				viewKind: kind,
				params: `req:${[...requiredFactIds].sort().join(",")}`,
			}),
			text: body,
			estimatedTokens: estimateViewTokens(body),
			coveredFactIds: covered,
			missingRequiredFactIds: missing,
			coverageStatus: status,
			taskVerdict: "not-assessed" as const,
		});
	});
}

/**
 * Coverage-gated deterministic selection: the smallest view that preserves
 * every required fact within budget. Returns null (infeasible) rather than
 * silently dropping a required atom — the caller must widen the budget or keep
 * the raw observation.
 */
export function chooseView(
	views: readonly ObservationView[],
	budgetTokens: number,
	requiredFactIds: readonly string[] = [],
): ObservationView | null {
	integer(budgetTokens, "budgetTokens");
	ensure(views.length > 0, "views must be nonempty");
	for (const id of requiredFactIds) text(id, "requiredFactId", 256);
	const admissible = views.filter(
		(v) => v.estimatedTokens <= budgetTokens && requiredFactIds.every((id) => v.coveredFactIds.includes(id)),
	);
	if (admissible.length === 0) return null;
	// Smallest tokens wins; break ties toward the higher-fidelity kind.
	const rank: Record<ObservationViewKind, number> = { full: 0, excerpt: 1, evidence: 2, pointer: 3 };
	let best: ObservationView | undefined;
	for (const view of admissible) {
		if (
			best === undefined ||
			view.estimatedTokens < best.estimatedTokens ||
			(view.estimatedTokens === best.estimatedTokens && rank[view.viewKind] < rank[best.viewKind])
		) {
			best = view;
		}
	}
	return best ?? null;
}
