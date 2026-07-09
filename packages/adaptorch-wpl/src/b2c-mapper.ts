/**
 * Maps OA adjudication + policy flags to B2C {@link VerdictCard} and apply/submit gates.
 */

import type { AdjudicationResult } from "./adjudicator.ts";
import type { AdjudicationReasonCode, VerdictState } from "./adjudicator-registry.ts";
import {
	B2C_VERDICT_SCHEMA_VERSION,
	type UserRiskLevel,
	type UserVerdict,
	type VerdictCard,
	type VerdictLimits,
	type VerdictNextAction,
	type VerificationReceipt,
} from "./b2c-verdict.ts";
import { POLICY_FLAG, type PolicyFlag } from "./policy-wall.ts";

const USER_VERDICT_SEVERITY: UserVerdict[] = ["BLOCKED", "INCONCLUSIVE", "ADVISORY", "PASS"];

function worstUserVerdict(current: UserVerdict, next: UserVerdict): UserVerdict {
	const cur = USER_VERDICT_SEVERITY.indexOf(current);
	const nxt = USER_VERDICT_SEVERITY.indexOf(next);
	return cur <= nxt ? current : next;
}

function verdictFromOa(verdict: VerdictState): UserVerdict {
	switch (verdict) {
		case "CONFIRMED":
			return "PASS";
		case "CORROBORATED-FAILURE":
			return "ADVISORY";
		case "CONTRADICTED":
			return "BLOCKED";
		case "INDETERMINATE":
			return "INCONCLUSIVE";
		case "VERIFIER-ERROR":
			return "INCONCLUSIVE";
	}
}

function riskFromUserVerdict(verdict: UserVerdict, flags: PolicyFlag[]): UserRiskLevel {
	if (verdict === "BLOCKED" || flags.includes(POLICY_FLAG.NON_NEGOTIABLE_BLOCKING)) {
		return "critical";
	}
	if (verdict === "INCONCLUSIVE") return "high";
	if (verdict === "ADVISORY") return "medium";
	return "low";
}

const REASON_CODE_USER: Record<AdjudicationReasonCode, { passed?: string; blocked?: string }> = {
	SCOPE_VIOLATION: { blocked: "Write scope violation detected by outcome adjudication." },
	SCHEMA_DRIFT: { blocked: "Output schema does not match the expected contract." },
	CONTENT_CHECK_FAILED: { blocked: "Content verification failed for one or more artifacts." },
	NO_EVIDENCE_ON_SUCCESS: { blocked: "Run reported success but left no usable evidence." },
	EMPTY_ARTIFACT_CONTENT: { blocked: "An artifact was present but contained no substantive content." },
	TRACE_CHECK_FAILED: { blocked: "Trace verification failed for this run." },
	TRACE_ERROR_SPAN: { blocked: "Error-level spans were found under a reported success." },
	MIN_ACTIONS_UNMET: { blocked: "Fewer actions were recorded than required for this kind." },
	RUN_STATUS_UNPARSEABLE: { blocked: "Run status could not be interpreted." },
	RUN_FETCH_FAILED: { blocked: "Evidence could not be fetched for this run." },
	MALFORMED_REQUEST: { blocked: "Adjudication request was malformed." },
	RUN_NOT_TERMINAL: { blocked: "Run has not reached a terminal status yet." },
	EVIDENCE_EMPTY: { blocked: "Evidence was too thin to reach a confident verdict." },
	FAILURE_REPORTED: { blocked: "The run reported failure and evidence agrees." },
	ALL_CHECKS_PASSED: { passed: "All outcome adjudication checks passed." },
};

function userStringsForReasonCode(code: AdjudicationReasonCode): { passed: string[]; blocked: string[] } {
	const entry = REASON_CODE_USER[code];
	const passed: string[] = [];
	const blocked: string[] = [];
	if (entry.passed) passed.push(entry.passed);
	if (entry.blocked) blocked.push(entry.blocked);
	return { passed, blocked };
}

function userVerdictFromPolicyFlags(flags: PolicyFlag[], previewOnly: boolean): UserVerdict | null {
	let v: UserVerdict = "PASS";
	if (
		flags.includes(POLICY_FLAG.NON_NEGOTIABLE_BLOCKING) ||
		flags.includes(POLICY_FLAG.CANDIDATE_LEAK_SUSPECT) ||
		flags.includes(POLICY_FLAG.SECRET_SUSPECT)
	) {
		v = worstUserVerdict(v, "BLOCKED");
	}
	if (flags.includes(POLICY_FLAG.EVIDENCE_DAG_INCOMPLETE)) {
		v = worstUserVerdict(v, "INCONCLUSIVE");
	}
	if (
		previewOnly &&
		(flags.includes(POLICY_FLAG.REPRO_OVERFIT_SUSPECT) || flags.includes(POLICY_FLAG.LOW_DISCRIMINATION))
	) {
		v = worstUserVerdict(v, "ADVISORY");
	}
	return v === "PASS" && flags.length === 0 ? null : v;
}

export interface MapToB2CInput {
	kind: string;
	packetId?: string;
	dispatchRecordId?: string;
	runIds: string[];
	previewOnly: boolean;
	policyFlags: PolicyFlag[];
	diffPaths: string[];
	adjudication?: AdjudicationResult;
	evaluatedAt?: string;
	repairHints?: string[];
}

export interface MapToB2COutput {
	verdictCard: VerdictCard;
	receipt: VerificationReceipt;
}

export const BATCH1_NO_DOCKER_RUNNER = "BATCH1_NO_DOCKER_RUNNER" as const;

function buildNextActions(verdict: UserVerdict, previewOnly: boolean, canApply: boolean): VerdictNextAction[] {
	if (verdict === "BLOCKED") {
		return ["Regenerate"];
	}
	if (verdict === "INCONCLUSIVE") {
		return previewOnly ? ["Deep Check", "Regenerate"] : ["Deep Check"];
	}
	if (verdict === "ADVISORY") {
		return previewOnly ? ["Deep Check", "Apply"] : ["Apply"];
	}
	if (canApply) {
		return ["Apply"];
	}
	return ["Deep Check"];
}

function buildLimitsCode(previewOnly: boolean): string | undefined {
	return previewOnly ? BATCH1_NO_DOCKER_RUNNER : undefined;
}

function buildDisclaimer(previewOnly: boolean, limitsCode: string | undefined): string | undefined {
	if (!previewOnly) {
		return undefined;
	}
	const code = limitsCode ?? BATCH1_NO_DOCKER_RUNNER;
	return `Preview-only evaluation (${code}): no docker runner; apply and submit gates are conservative.`;
}

export function mapToB2C(input: MapToB2CInput): MapToB2COutput {
	const evaluatedAt = input.evaluatedAt ?? new Date().toISOString();
	let userVerdict: UserVerdict = "INCONCLUSIVE";
	const passed_checks: string[] = [];
	const blocked_reasons: string[] = [];

	if (input.diffPaths.length === 0 && input.adjudication === undefined) {
		userVerdict = "INCONCLUSIVE";
		blocked_reasons.push("No changed paths were found in the diff; cannot assess write scope.");
	} else {
		userVerdict = "PASS";
	}

	const policyVerdict = userVerdictFromPolicyFlags(input.policyFlags, input.previewOnly);
	if (policyVerdict !== null) {
		userVerdict = worstUserVerdict(userVerdict, policyVerdict);
	}

	if (input.policyFlags.includes(POLICY_FLAG.SECRET_SUSPECT)) {
		blocked_reasons.push("Diff lines may contain secrets or credentials; remove before proceeding.");
	}
	if (input.policyFlags.includes(POLICY_FLAG.CANDIDATE_LEAK_SUSPECT)) {
		blocked_reasons.push("One or more changed paths fall outside the approved write scope.");
	}
	if (input.policyFlags.includes(POLICY_FLAG.EVIDENCE_DAG_INCOMPLETE)) {
		blocked_reasons.push("Run evidence is required but was not evaluated in this receipt.");
	}
	if (input.previewOnly && input.policyFlags.includes(POLICY_FLAG.LOW_DISCRIMINATION)) {
		blocked_reasons.push("Preview-only mode: discrimination against production evidence is limited.");
	}

	if (input.adjudication !== undefined) {
		const fromOa = verdictFromOa(input.adjudication.verdict);
		userVerdict = worstUserVerdict(userVerdict, fromOa);
		const strings = userStringsForReasonCode(input.adjudication.reason_code);
		passed_checks.push(...strings.passed);
		blocked_reasons.push(...strings.blocked);
	} else if (userVerdict === "PASS" && input.diffPaths.length > 0) {
		passed_checks.push("Changed paths are within approved write scope (fast wall).");
	}

	const limitsCode = buildLimitsCode(input.previewOnly);
	const limits: VerdictLimits = {
		requiresHumanReview: userVerdict === "BLOCKED" || userVerdict === "INCONCLUSIVE",
		previewOnly: input.previewOnly,
		code: limitsCode,
	};

	const canApply =
		userVerdict === "PASS" &&
		!input.policyFlags.includes(POLICY_FLAG.NON_NEGOTIABLE_BLOCKING) &&
		!input.policyFlags.includes(POLICY_FLAG.CANDIDATE_LEAK_SUSPECT) &&
		!input.policyFlags.includes(POLICY_FLAG.SECRET_SUSPECT) &&
		(input.adjudication === undefined || input.adjudication.verdict === "CONFIRMED");

	const shouldSubmit = userVerdict !== "BLOCKED" && !input.policyFlags.includes(POLICY_FLAG.NON_NEGOTIABLE_BLOCKING);

	const disclaimer = buildDisclaimer(input.previewOnly, limitsCode);

	const verdictCard: VerdictCard = {
		schemaVersion: B2C_VERDICT_SCHEMA_VERSION,
		verdict: userVerdict,
		risk: riskFromUserVerdict(userVerdict, input.policyFlags),
		limits,
		passed_checks,
		blocked_reasons: [...new Set(blocked_reasons)],
		next_actions: buildNextActions(userVerdict, input.previewOnly, canApply),
		repairHints: input.repairHints !== undefined && input.repairHints.length > 0 ? input.repairHints : undefined,
		packetId: input.packetId,
		kind: input.kind,
	};

	const receipt: VerificationReceipt = {
		schemaVersion: B2C_VERDICT_SCHEMA_VERSION,
		evaluatedAt,
		kind: input.kind,
		packetId: input.packetId,
		dispatchRecordId: input.dispatchRecordId,
		runIds: input.runIds,
		previewOnly: input.previewOnly,
		canApply,
		shouldSubmit,
		policyFlags: [...input.policyFlags],
		adjudicationVerdict: input.adjudication?.verdict,
		adjudicationReasonCode: input.adjudication?.reason_code,
		diffPaths: input.diffPaths,
		disclaimer,
	};

	return { verdictCard, receipt };
}
