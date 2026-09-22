import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { join } from "node:path";
import type { RunContract } from "omk-protocol";
import type { EvidenceReceipt } from "../../types/evidence.ts";
import { canonicalJson } from "../run-journal.ts";
import { type CandidateManifest, loadCandidate } from "./candidate.ts";
import { readCheckReceipts } from "./check-receipt.ts";
import { type CheckObservation, closesRunClaims, parseCheckObservations } from "./evidence-binding.ts";
import type { JournalSnapshot } from "./journal.ts";
import { digestObject, publishBytes, publishObject, readJson, readRegularFile, VerifiedRunError } from "./storage.ts";

export type { CheckObservation } from "./evidence-binding.ts";

interface Attestation {
	readonly version: 1 | 2 | 3;
	readonly runId: string;
	readonly generation: number;
	readonly contractDigest: string;
	readonly candidateDigest: string;
	readonly environmentDigest: string;
	readonly verifierDigest: string;
	readonly checks: readonly CheckObservation[];
	readonly verified: boolean;
}
export interface VerifiedRunEvidence {
	readonly candidateDigest: string;
	readonly manifest: CandidateManifest;
	readonly receiptDigest: string;
	readonly verified: boolean;
	readonly checks: readonly CheckObservation[];
	readonly receiptFormat: "v3" | "legacy";
	readonly receipts: readonly EvidenceReceipt[];
	readonly environmentDigest: string;
}

export function createRunIssuer(runPath: string): void {
	// Recovery must never replace a missing key and re-sign old evidence.
	publishBytes(join(runPath, "issuer.key"), randomBytes(32));
}

function tag(runPath: string, receipt: unknown): Buffer {
	const key = readRegularFile(join(runPath, "issuer.key"), 32);
	if (key.length !== 32) throw new VerifiedRunError("integrity");
	return createHmac("sha256", key).update("omk.verified-run.attestation.v1\0").update(canonicalJson(receipt)).digest();
}

export function issueRunEvidence(
	runPath: string,
	contract: RunContract,
	material: {
		readonly generation: number;
		readonly candidateDigest: string;
		readonly environmentDigest: string;
		readonly checks: readonly CheckObservation[];
	},
): { readonly digest: string; readonly verified: boolean } {
	const checks = parseCheckObservations(material.checks, true);
	const candidate = loadCandidate(runPath, material.candidateDigest, contract.budget);
	readCheckReceipts(runPath, contract, { manifest: candidate.manifest, checks });
	const receipt: Attestation = {
		version: 3,
		runId: contract.runId,
		generation: material.generation,
		contractDigest: digestObject(contract),
		candidateDigest: material.candidateDigest,
		environmentDigest: material.environmentDigest,
		verifierDigest: digestObject(contract.checks),
		checks,
		verified: closesRunClaims(contract, {
			candidate: material.candidateDigest,
			environment: material.environmentDigest,
			checks,
		}),
	};
	const envelope = { receipt, authenticationTag: tag(runPath, receipt).toString("hex") };
	const digest = digestObject(envelope);
	publishObject(join(runPath, "attestations", `${digest}.json`), envelope);
	return { digest, verified: receipt.verified };
}

export interface EvidenceRead {
	readonly authenticity: "valid" | "invalid" | "unverifiable";
	readonly verification: "passed" | "failed" | "incomplete";
	readonly currentEnvironmentEligibility: "matching" | "different" | "unsupported" | "unknown";
	readonly evidence: VerifiedRunEvidence | null;
}

/** Historical authenticity is separate from whether this machine can rerun the receipt. */
export function classifyEvidenceRead(
	runPath: string,
	journal: JournalSnapshot,
	currentEnvironment?: string | { readonly status: "unsupported" | "unknown" },
): EvidenceRead {
	try {
		const evidence = readRunEvidence(runPath, journal);
		const currentEnvironmentEligibility =
			typeof currentEnvironment === "string"
				? evidence.environmentDigest === currentEnvironment
					? "matching"
					: "different"
				: (currentEnvironment?.status ?? "unknown");
		return {
			authenticity: "valid",
			verification: evidence.verified
				? "passed"
				: evidence.checks.some((check) => check.exitCode === null)
					? "incomplete"
					: "failed",
			currentEnvironmentEligibility,
			evidence,
		};
	} catch (error) {
		if (error instanceof VerifiedRunError) {
			return {
				authenticity: error.code === "evidence_missing" ? "unverifiable" : "invalid",
				verification: "incomplete",
				currentEnvironmentEligibility: "unknown",
				evidence: null,
			};
		}
		if (error instanceof Error && "code" in error && ["ENOENT", "EACCES", "EIO"].includes(String(error.code)))
			return {
				authenticity: "unverifiable",
				verification: "incomplete",
				currentEnvironmentEligibility: "unknown",
				evidence: null,
			};
		throw error;
	}
}

export function readRunEvidence(runPath: string, journal: JournalSnapshot, environment?: string): VerifiedRunEvidence {
	const first = journal.records[0]?.event;
	const { candidateDigest, receiptDigest } = journal.state;
	if (first?.kind !== "created" || !candidateDigest || !receiptDigest) throw new VerifiedRunError("evidence_missing");
	const raw = readJson(join(runPath, "attestations", `${receiptDigest}.json`));
	if (
		digestObject(raw) !== receiptDigest ||
		typeof raw !== "object" ||
		raw === null ||
		!("receipt" in raw) ||
		!("authenticationTag" in raw) ||
		typeof raw.authenticationTag !== "string" ||
		!/^[a-f0-9]{64}$/.test(raw.authenticationTag) ||
		!timingSafeEqual(tag(runPath, raw.receipt), Buffer.from(raw.authenticationTag, "hex"))
	)
		throw new VerifiedRunError("integrity");
	const receipt = raw.receipt;
	if (
		typeof receipt !== "object" ||
		receipt === null ||
		!("checks" in receipt) ||
		!("version" in receipt) ||
		(receipt.version !== 1 && receipt.version !== 2 && receipt.version !== 3)
	)
		throw new VerifiedRunError("integrity");
	if (
		!("environmentDigest" in receipt) ||
		typeof receipt.environmentDigest !== "string" ||
		!/^[a-f0-9]{64}$/.test(receipt.environmentDigest)
	)
		throw new VerifiedRunError("integrity");
	const storedEnvironment = receipt.environmentDigest;
	if (journal.state.environmentDigest !== null && journal.state.environmentDigest !== storedEnvironment)
		throw new VerifiedRunError("integrity");
	if (environment !== undefined && environment !== storedEnvironment)
		throw new VerifiedRunError("environment_mismatch");
	const checks = parseCheckObservations(receipt.checks, receipt.version !== 1);
	const contract = first.contract;
	const dispatches = journal.records.flatMap(({ event, generation }) =>
		generation === journal.state.generation && event.kind === "dispatch" && event.role === "verifier" ? [event] : [],
	);
	if (
		checks.length !== contract.checks.length ||
		checks.length !== dispatches.length ||
		new Set(checks.map((check) => check.claimId)).size !== checks.length ||
		checks.some(
			(check) =>
				!dispatches.some((event) => event.executionId === check.executionId && event.claimId === check.claimId),
		)
	)
		throw new VerifiedRunError("integrity");
	const verified = closesRunClaims(contract, { candidate: candidateDigest, environment: storedEnvironment, checks });
	const expected: Attestation = {
		version: receipt.version,
		runId: contract.runId,
		generation: journal.state.generation,
		contractDigest: digestObject(contract),
		candidateDigest,
		environmentDigest: storedEnvironment,
		verifierDigest: digestObject(contract.checks),
		checks,
		verified,
	};
	if (canonicalJson(receipt) !== canonicalJson(expected) || verified !== (journal.state.verification === "verified"))
		throw new VerifiedRunError("integrity");
	const candidate = loadCandidate(runPath, candidateDigest, contract.budget);
	const receipts =
		receipt.version !== 1
			? readCheckReceipts(runPath, contract, { manifest: candidate.manifest, checks })
			: Object.freeze([]);
	return Object.freeze({
		candidateDigest,
		manifest: candidate.manifest,
		receiptDigest,
		verified,
		checks,
		receiptFormat: receipt.version !== 1 ? "v3" : "legacy",
		receipts,
		environmentDigest: storedEnvironment,
	});
}
