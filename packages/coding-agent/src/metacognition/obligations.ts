/**
 * Algorithm A — missing-condition discovery and obligation generation.
 * Spec: OMK_metacognitive_control_algorithms_2026-09-19.md §4.
 *
 * Change atoms (target + operation + trust boundary + temporal property +
 * external effect + observation source + analyzer coverage) are matched
 * against a versioned host rule set. Host facts promote candidates to
 * required obligations; model hypotheses stay candidates. Model proposals
 * can never remove user or policy obligations.
 */
import { canonical, ensure, finite, integer, lexical, member, text, unique } from "./validation.ts";

export type ObservationSource = "host-observed" | "analyzer-inferred" | "model-hypothesized";
export type Coverage = "covered" | "partial" | "unsupported" | "unknown";

/** §4.2: one observable change atom, not a filename or keyword. */
export interface ChangeAtom {
	readonly id: string;
	readonly targetId: string;
	readonly operation: string;
	readonly trustBoundary: string;
	readonly temporal: "synchronous" | "async" | "concurrent" | "retried" | "none";
	readonly externalEffect: "none" | "read" | "write" | "network" | "payment" | "delete";
	readonly source: ObservationSource;
	readonly analyzerCoverage: Coverage;
}
/** A versioned host rule: when its predicates hold, instantiate obligations. */
export interface ObligationRule {
	readonly ruleId: string;
	readonly ruleVersion: string;
	readonly description: string;
	readonly match: {
		readonly temporal?: readonly ChangeAtom["temporal"][];
		readonly externalEffect?: readonly ChangeAtom["externalEffect"][];
		readonly trustBoundary?: readonly string[];
		readonly operation?: readonly string[];
	};
	/** Obligations instantiated when this rule fires. */
	readonly produce: readonly {
		readonly obligationId: string;
		readonly statement: string;
		readonly kind: "precondition" | "postcondition";
		readonly checkMethodId: string | null;
		readonly required: boolean;
		readonly impact: number;
		readonly minSourceFamilies?: number;
		readonly requiresVersion?: boolean;
	}[];
}
export type ObligationStatus = "candidate" | "required" | "satisfied" | "violated" | "blocked-high-risk";
export interface Obligation {
	readonly id: string;
	readonly atomId: string;
	readonly ruleId: string;
	readonly ruleVersion: string;
	readonly statement: string;
	readonly kind: "precondition" | "postcondition";
	readonly checkMethodId: string | null;
	readonly scope: string;
	readonly triggerObservationIds: readonly string[];
	readonly required: boolean;
	readonly impact: number;
	readonly novelty: number;
	readonly normalizedCost: number;
	readonly coverageFraction: number;
	status: ObligationStatus;
}
export interface ObligationReport {
	readonly required: readonly Obligation[];
	readonly candidates: readonly Obligation[];
	/** Effects/rules we could not map — never claim completeness. */
	readonly unmappedEffects: readonly string[];
	readonly unsupportedSyntax: readonly string[];
	readonly unobservedConsumers: readonly string[];
	readonly coverage: "complete" | "partial" | "unknown";
}

const ATOM_BOUND = 512;
const RULE_BOUND = 256;

export function validateAtom(atom: ChangeAtom): void {
	text(atom.id, "atom id", 128);
	text(atom.targetId, "targetId", 512);
	text(atom.operation, "operation", 128);
	text(atom.trustBoundary, "trustBoundary", 256);
	member(atom.temporal, ["synchronous", "async", "concurrent", "retried", "none"], "temporal");
	member(atom.externalEffect, ["none", "read", "write", "network", "payment", "delete"], "externalEffect");
	member(atom.source, ["host-observed", "analyzer-inferred", "model-hypothesized"], "atom source");
	member(atom.analyzerCoverage, ["covered", "partial", "unsupported", "unknown"], "analyzerCoverage");
}

/**
 * Instantiate host rules over observed atoms. Rules fire only on atoms whose
 * predicates are satisfied; `model-hypothesized` atoms produce candidates,
 * never required obligations. High-risk effects on unverified hypotheses are
 * surfaced as `blocked-high-risk` candidates so the host can gate the effect.
 */
export function instantiateObligations(
	atoms: readonly ChangeAtom[],
	rules: readonly ObligationRule[],
	nowMs: number,
): ObligationReport {
	integer(nowMs, "nowMs");
	ensure(atoms.length <= ATOM_BOUND, "too many atoms");
	ensure(rules.length <= RULE_BOUND, "too many rules");
	unique(
		atoms.map((a) => a.id),
		"atom ids",
	);
	unique(
		rules.map((r) => r.ruleId),
		"rule ids",
	);
	for (const atom of atoms) validateAtom(atom);
	for (const rule of rules) {
		text(rule.ruleVersion, "ruleVersion", 64);
		text(rule.description, "rule description", 512);
		ensure(rule.produce.length > 0 && rule.produce.length <= 32, "rule produce bounds");
	}
	const required: Obligation[] = [];
	const candidates: Obligation[] = [];
	const unmappedEffects: string[] = [];
	const unsupportedSyntax: string[] = [];
	const _unobservedConsumers: string[] = [];
	let sawUnknownCoverage = false;
	for (const atom of atoms) {
		if (atom.analyzerCoverage === "unknown") sawUnknownCoverage = true;
		if (atom.analyzerCoverage === "unsupported") unsupportedSyntax.push(atom.id);
		let matched = false;
		for (const rule of rules) {
			const m = rule.match;
			if (m.temporal && !m.temporal.includes(atom.temporal)) continue;
			if (m.externalEffect && !m.externalEffect.includes(atom.externalEffect)) continue;
			if (m.trustBoundary && !m.trustBoundary.includes(atom.trustBoundary)) continue;
			if (m.operation && !m.operation.includes(atom.operation)) continue;
			matched = true;
			for (const prod of rule.produce) {
				finite(prod.impact, "obligation impact", 1_000_000);
				const novelty = atom.source === "model-hypothesized" ? 1 : 0.5;
				const obligation: Obligation = {
					id: `${rule.ruleId}:${atom.id}:${prod.obligationId}`,
					atomId: atom.id,
					ruleId: rule.ruleId,
					ruleVersion: rule.ruleVersion,
					statement: prod.statement,
					kind: prod.kind,
					checkMethodId: prod.checkMethodId,
					scope: atom.targetId,
					triggerObservationIds: [atom.id],
					required: prod.required,
					impact: prod.impact,
					novelty,
					normalizedCost: 1,
					coverageFraction: 0,
					status:
						atom.source === "model-hypothesized"
							? atom.externalEffect === "write" ||
								atom.externalEffect === "payment" ||
								atom.externalEffect === "delete"
								? "blocked-high-risk"
								: "candidate"
							: prod.required
								? "required"
								: "candidate",
				};
				(atom.source === "model-hypothesized" ? candidates : required).push(obligation);
			}
		}
		if (!matched && atom.externalEffect !== "none") unmappedEffects.push(atom.id);
	}
	const sortObligations = (a: Obligation, b: Obligation): number => b.impact - a.impact || lexical(a.id, b.id);
	required.sort(sortObligations);
	candidates.sort(sortObligations);
	return {
		required: required.filter((o) => o.status === "required"),
		candidates,
		unmappedEffects: unmappedEffects.sort(lexical),
		unsupportedSyntax: unsupportedSyntax.sort(lexical),
		unobservedConsumers: [],
		coverage:
			sawUnknownCoverage || unmappedEffects.length > 0 || unsupportedSyntax.length > 0 ? "unknown" : "partial",
	};
}

/**
 * §4.4 ranking score. NOT a failure probability — an explainable ordering key:
 * J(o) = impact·(1-coverage)·(1+novelty) / (ε + normalizedCost).
 * Priority classes are applied by the caller before this score is consulted.
 */
export function obligationPriority(o: Obligation, epsilon = 0.01): number {
	finite(o.impact, "impact", 1_000_000);
	finite(o.coverageFraction, "coverage", 1);
	finite(o.novelty, "novelty", 1);
	finite(o.normalizedCost, "cost", 1_000_000);
	finite(epsilon, "epsilon", 1);
	return (o.impact * (1 - o.coverageFraction) * (1 + o.novelty)) / (epsilon + o.normalizedCost);
}

/** Close an obligation when its bound check passes; open violations when it fails. */
export function settleObligation(
	obligations: readonly Obligation[],
	obligationId: string,
	checkOutcome: "pass" | "fail" | "unverifiable",
): readonly Obligation[] {
	text(obligationId, "obligationId", 512);
	return obligations.map((o) => {
		if (o.id !== obligationId) return o;
		const status: ObligationStatus =
			checkOutcome === "pass" ? "satisfied" : checkOutcome === "fail" ? "violated" : o.status;
		return { ...o, status };
	});
}

/** Structural fingerprint for de-duplication across checkpoints. */
export function obligationFingerprint(o: Obligation): string {
	return canonical([o.ruleId, o.ruleVersion, o.atomId, o.statement, o.scope]);
}
