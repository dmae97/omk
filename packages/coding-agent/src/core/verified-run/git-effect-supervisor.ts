import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { canonicalClaim, type ResourceClaimInput, sameClaimSet } from "../../coordination/resource.ts";
import type { GrantToken } from "../../coordination/types.ts";
import { sameGrantToken } from "./authority-meaning.ts";
import type { RunAuthority } from "./authority-runtime.ts";
import { executeSandbox, type SandboxOutcome } from "./broker.ts";
import type { GitOperationBudget } from "./git-execution.ts";
import { OMK_ACCEPTED_REF, resolveRef, type SealCandidateInput } from "./git-plumbing.ts";
import { type GitWorkerNotice, readGitNotice, writeGitControl } from "./git-worker-protocol.ts";
import { type GitWorkerRuntime, type GitWorkerStage, prepareGitWorker } from "./git-worker-runtime.ts";
import type { NamespaceIdentity } from "./namespace-identity.ts";
import { VerifiedRunError } from "./storage.ts";
import { loadSupervisorBackend, probeOwnedNamespace } from "./supervisor-adapter.ts";

export interface OwnedGitPublication {
	readonly workspace: string;
	readonly input: SealCandidateInput;
	readonly authority: RunAuthority;
	readonly token: GrantToken;
	readonly claims: readonly ResourceClaimInput[];
	readonly runtime: GitWorkerRuntime;
	readonly budget: GitOperationBudget;
	readonly deadlineNs: string;
	readonly cleanupMs: number;
	readonly signal?: AbortSignal;
	readonly onPrepared: (candidateOid: string) => void | Promise<void>;
	readonly afterCas?: () => void | Promise<void>;
}

/** One owner for staging, durable dispatch, seal/CAS gates, namespace drain and grant settlement. */
export async function executeOwnedGitPublication(request: OwnedGitPublication): Promise<GitWorkerNotice> {
	const authority = request.authority.store.state;
	const reservation = authority.grants.get(request.token.grantSequence);
	if (
		!reservation ||
		reservation.state !== "reserved" ||
		reservation.effectLive ||
		!sameGrantToken(reservation.token, request.token) ||
		authority.epoch !== request.token.authorityEpoch ||
		authority.incarnations.get(request.token.sessionId) !== request.token.sessionIncarnation ||
		!sameClaimSet(
			Array.from(request.claims, (claim) => canonicalClaim(claim)),
			reservation.claims,
		)
	)
		throw new VerifiedRunError("authority");
	loadSupervisorBackend();
	const controller = new AbortController();
	const cancel = () => controller.abort();
	request.signal?.addEventListener("abort", cancel, { once: true });
	if (request.signal?.aborted) cancel();
	let stage: GitWorkerStage | undefined;
	let identity: NamespaceIdentity | undefined;
	let completion: Promise<void> | undefined;
	let finished = false;
	let outcome: SandboxOutcome | undefined;
	let executionFailure: unknown;
	let failure: unknown;
	let result: GitWorkerNotice | undefined;
	let preparedOid: string | undefined;
	let terminationObserved = false;
	let afterCasCalled = false;
	let callbackFailed = false;
	const { store } = request.authority;
	const waitNotice = async (name: string): Promise<GitWorkerNotice> => {
		if (!stage) throw new VerifiedRunError("git_worker_protocol");
		const path = join(stage.root, name);
		while (!existsSync(path)) {
			if (finished) throw executionFailure ?? new VerifiedRunError(outcome?.failure ?? "git_worker_failed");
			request.budget.remaining();
			await delay(5);
		}
		return readGitNotice(path);
	};
	try {
		request.budget.remaining();
		stage = prepareGitWorker(request.workspace, request.runtime, {
			input: request.input,
			timeoutMs: Math.min(60_000, request.budget.remainingWorkMs()),
			deadlineNs: request.deadlineNs,
		});
		request.budget.remaining();
		if (!store.dispatchIntent(request.token, stage.dispatchId)) throw new VerifiedRunError("authority");
		completion = executeSandbox({
			workspace: request.workspace,
			writable: false,
			gitPublication: true,
			argv: ["/omk-node", "--experimental-strip-types", stage.worker, stage.request],
			timeoutMs: request.budget.remainingWorkMs(),
			cleanupMs: request.cleanupMs,
			maxOutputBytes: 8192,
			signal: controller.signal,
			onReady: (ready) => {
				identity = ready;
				if (!store.effectStarted(request.token, request.claims, ready)) throw new VerifiedRunError("authority");
			},
		}).then(
			(value) => {
				outcome = value;
				terminationObserved = true;
				finished = true;
			},
			(error: unknown) => {
				executionFailure = error;
				finished = true;
			},
		);
		const prepared = await waitNotice("prepared.json");
		if (prepared.kind !== "prepared") throw new VerifiedRunError("git_worker_protocol");
		preparedOid = prepared.candidateOid;
		try {
			await request.onPrepared(preparedOid);
		} catch (error) {
			callbackFailed = true;
			throw error;
		}
		request.budget.remaining();
		if (!store.effectAuthorized(request.token, request.claims)) throw new VerifiedRunError("authority");
		writeGitControl(join(stage.root, "cas-go.json"), {
			...prepared,
			authorizationDeadline: request.token.authorizationDeadline,
		});
		result = await waitNotice("result.json");
		if (result.kind === "prepared" || result.candidateOid !== preparedOid)
			throw new VerifiedRunError("git_worker_protocol");
		if (result.kind === "committed") {
			afterCasCalled = true;
			try {
				await request.afterCas?.();
			} catch (error) {
				callbackFailed = true;
				throw error;
			}
		}
		writeGitControl(join(stage.root, "finish.json"), result);
	} catch (error) {
		failure = error;
		controller.abort();
	} finally {
		await completion;
		request.signal?.removeEventListener("abort", cancel);
		// A callback error may reject the broker even after drain. Re-observe, never infer it.
		if (!terminationObserved && identity) terminationObserved = probeOwnedNamespace(identity) === "terminated";
		const neverStarted =
			completion === undefined ||
			(!identity &&
				executionFailure instanceof VerifiedRunError &&
				["cancelled", "deadline", "unsupported_boundary"].includes(executionFailure.code));
		try {
			if (terminationObserved || neverStarted) store.confirmTerminated(request.token);
			else store.cancel(request.token);
		} catch (error) {
			failure =
				failure === undefined ? error : new AggregateError([failure, error], "Git authority settlement failed");
		}
		if (stage && (terminationObserved || neverStarted)) {
			try {
				rmSync(stage.root, { recursive: true, force: true });
			} catch (error) {
				failure =
					failure === undefined ? error : new AggregateError([failure, error], "Git staging cleanup failed");
			}
		}
	}
	if (!terminationObserved && completion !== undefined)
		throw failure ?? executionFailure ?? new VerifiedRunError("git_effect_unsettled");
	// An abort racing the CAS cannot erase a ref that is already committed.
	if (
		!callbackFailed &&
		failure instanceof VerifiedRunError &&
		["cancelled", "deadline", "git_worker_failed"].includes(failure.code) &&
		preparedOid &&
		resolveRef(request.workspace, OMK_ACCEPTED_REF) === preparedOid
	) {
		if (!afterCasCalled) await request.afterCas?.();
		return { kind: "committed", candidateOid: preparedOid };
	}
	if (failure !== undefined) throw failure;
	if (executionFailure !== undefined) throw executionFailure;
	if (!result) throw new VerifiedRunError("git_worker_failed");
	return result;
}
