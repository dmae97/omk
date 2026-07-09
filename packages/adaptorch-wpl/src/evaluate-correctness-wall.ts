/**
 * B2C Correctness Wall orchestration — fast wall + optional OA adjudication.
 */

import type { AdaptOrchClient } from "./adaptorch-client.ts";
import { type AdjudicationRequest, adjudicate } from "./adjudicator.ts";
import { createVerifierRegistry, type VerifierRegistryEntry } from "./adjudicator-registry.ts";
import { mapToB2C } from "./b2c-mapper.ts";
import type { VerdictCard, VerificationReceipt } from "./b2c-verdict.ts";
import {
	DEEP_RUNNER_NOT_WIRED,
	DEEP_WALL_UNAVAILABLE,
	type DeepWallRunnerFn,
	isDeepRunnerCompletionAllowed,
	resolveDeepWallPhaseFromEnv,
	runDeepWall,
} from "./deep-wall.ts";
import { runFastWall } from "./policy-wall.ts";
import { signWallReceipt } from "./receipt-signature.ts";
import { deriveRepairHints } from "./repair-loop.ts";
import { buildVerificationDigest } from "./signed-receipt.ts";
import { CORRECTNESS_WALL_VERSION } from "./wall-meta.ts";

export interface EvaluateCorrectnessWallParams {
	kind: string;
	runIds?: string[];
	dispatchRecordId?: string;
	approvedWriteScope?: string[];
	previewOnly?: boolean;
	diffText?: string;
	packetId?: string;
	/** When set with non-empty runIds and previewOnly false, OA adjudication is invoked. */
	client?: AdaptOrchClient;
	registry?: { get(kind: string): VerifierRegistryEntry };
	/** When true, merge deep-wall result into limits / policy flags. */
	deepWall?: boolean;
	/** Wave 4-C3b: injected hermetic runner. Completion gated by `deepWallAllowCompletion` + evidence. */
	deepWallRunner?: DeepWallRunnerFn;
	/** Must be true for a runner to emit `completed`. */
	deepWallAllowCompletion?: boolean;
	/** When set, attach HMAC signed receipt attestation (never log secret). */
	receiptSigningSecret?: string;
}

export interface EvaluateCorrectnessWallResult {
	verdictCard: VerdictCard;
	receipt: VerificationReceipt;
}

export async function evaluateCorrectnessWall(
	params: EvaluateCorrectnessWallParams,
): Promise<EvaluateCorrectnessWallResult> {
	const runIds = params.runIds ?? [];
	const previewOnly = params.previewOnly === true;
	const registry = params.registry ?? createVerifierRegistry([]);

	const wall = runFastWall({
		diffText: params.diffText,
		approvedWriteScope: params.approvedWriteScope,
		runIds,
		previewOnly,
	});

	let adjudication: Awaited<ReturnType<typeof adjudicate>> | undefined;
	const useOa = runIds.length > 0 && !previewOnly && params.client !== undefined;
	if (useOa && params.client !== undefined) {
		const request: AdjudicationRequest = {
			dispatch_record_id: params.dispatchRecordId ?? "b2c-wall",
			kind: params.kind,
			run_ids: runIds,
		};
		adjudication = await adjudicate(request, params.client, registry);
	}

	let policyFlags = wall.flags;
	if (adjudication !== undefined) {
		policyFlags = wall.flags.filter((f) => f !== "EVIDENCE_DAG_INCOMPLETE");
	}

	const provisional = mapToB2C({
		kind: params.kind,
		packetId: params.packetId,
		dispatchRecordId: params.dispatchRecordId,
		runIds,
		previewOnly,
		policyFlags,
		diffPaths: wall.diffPaths,
		adjudication,
	});

	const repairHints = deriveRepairHints({
		userVerdict: provisional.verdictCard.verdict,
		policyFlags,
		adjudicationReasonCode: adjudication?.reason_code,
		previewOnly,
		diffPaths: wall.diffPaths,
	});

	const mapped = mapToB2C({
		kind: params.kind,
		packetId: params.packetId,
		dispatchRecordId: params.dispatchRecordId,
		runIds,
		previewOnly,
		policyFlags,
		diffPaths: wall.diffPaths,
		adjudication,
		repairHints,
	});

	const verificationDigest = buildVerificationDigest({
		patchText: params.diffText,
		evidenceChunks: runIds.length > 0 ? runIds : undefined,
		wallVersion: CORRECTNESS_WALL_VERSION,
	});

	let verdictCard = mapped.verdictCard;
	let receipt: VerificationReceipt = {
		...mapped.receipt,
		verificationDigest,
		wallVersion: CORRECTNESS_WALL_VERSION,
	};

	const signingSecret = params.receiptSigningSecret?.trim();
	if (signingSecret !== undefined && signingSecret.length > 0 && verificationDigest !== undefined) {
		receipt = {
			...receipt,
			signedReceipt: signWallReceipt({
				digest: verificationDigest,
				wallVersion: CORRECTNESS_WALL_VERSION,
				secret: signingSecret,
			}),
		};
	}

	if (params.deepWall === true) {
		const deep = await runDeepWall({
			kind: params.kind,
			runIds,
			packetId: params.packetId,
			phase: resolveDeepWallPhaseFromEnv(),
			runner: params.deepWallRunner,
			allowCompletion: params.deepWallAllowCompletion,
		});
		const policyFlags = [...receipt.policyFlags];
		if (deep.status !== "completed") {
			if (!policyFlags.includes(DEEP_WALL_UNAVAILABLE)) {
				policyFlags.push(DEEP_WALL_UNAVAILABLE);
			}
			if (!isDeepRunnerCompletionAllowed() && !policyFlags.includes(DEEP_RUNNER_NOT_WIRED)) {
				policyFlags.push(DEEP_RUNNER_NOT_WIRED);
			}
		}
		for (const f of deep.runnerFlags ?? []) {
			if (!policyFlags.includes(f as never)) policyFlags.push(f as never);
		}
		const limitsCode = deep.limits?.[0] ?? verdictCard.limits.code;
		verdictCard = {
			...verdictCard,
			limits: {
				...verdictCard.limits,
				requiresHumanReview: deep.status !== "completed",
				code: limitsCode ?? verdictCard.limits.code,
			},
			blocked_reasons: [...new Set([...verdictCard.blocked_reasons, deep.message])],
		};
		receipt = {
			...receipt,
			policyFlags,
			deepWallStatus: deep.status,
			deepWallEvidence: deep.evidence,
		};
	}

	return { verdictCard, receipt };
}
