import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { dirname } from "node:path";
import { performance } from "node:perf_hooks";
import type { ResourceClaimInput } from "../../coordination/resource.ts";
import type { GrantToken } from "../../coordination/types.ts";
import type { RunAuthority } from "./authority-runtime.ts";
import { executeSandbox, type SandboxOutcome } from "./broker.ts";
import type { VerifiedRunJournal } from "./journal.ts";
import type { NamespaceIdentity } from "./namespace-identity.ts";
import { discardNativeWitness, nativeWitnessDir } from "./native-witness.ts";
import { reattachRustExecution } from "./rust-host-reattach.ts";
import { discardRustExecutionRecord, nativeExecutionDir, nativeRequestId } from "./rust-host-record.ts";
import { digestObject, VerifiedRunError } from "./storage.ts";

export interface OwnedRunCommand {
	readonly role: "writer" | "verifier";
	readonly argv: readonly string[];
	readonly workspace: string;
	readonly deadline: number;
	readonly claimId: string | null;
	readonly taskId?: string;
	readonly detachable?: true;
}
export interface OwnedRunResult {
	readonly executionId: string;
	readonly result: SandboxOutcome;
	readonly timeoutMs: number;
}

/**
 * The filesystem claim a dispatched process is authorized for: exactly the
 * workspace bind it receives inside the namespace — nothing wider. Keys are
 * the resolved absolute path minus the leading slash so prefix containment
 * matches real tree containment; `realpathSync` keeps two spellings of the
 * same directory one claim.
 */
export function workspaceClaim(
	workspace: string,
	access: "read" | "write",
	generation: number,
): readonly ResourceClaimInput[] {
	let root: string;
	try {
		root = realpathSync(workspace);
	} catch {
		throw new VerifiedRunError("authority_claim");
	}
	return Object.freeze([
		{
			namespace: "filesystem",
			instanceId: "verified-run",
			canonicalKey: root.replace(/^\/+/, ""),
			access,
			generation: String(generation),
		},
	]);
}

/** Rejection codes that can only be produced before the supervisor spawned. */
const NEVER_SPAWNED = new Set(["cancelled", "deadline", "unsupported_boundary"]);

/**
 * Mandatory durable dispatch intent, shared by command and AgentSession
 * writers. There is no ungated execution lane: a journal without an anchored
 * budget cannot commit a process identity, so the supervisor boundary would
 * be unprovable and must refuse dispatch. Every dispatch now also crosses the
 * durable authority boundary — grant → intent → start → termination witness
 * — so a restart can reconcile effects the journal alone cannot settle.
 */
export async function executeRunCommand(
	journal: VerifiedRunJournal,
	request: OwnedRunCommand,
	policy: {
		readonly cleanupMs: number;
		readonly maxOutputBytes: number;
		readonly authority: RunAuthority;
		readonly signal?: AbortSignal;
	},
): Promise<OwnedRunResult> {
	if (Math.floor(request.deadline - performance.now()) <= 0) throw new VerifiedRunError("deadline");
	if (policy.signal?.aborted) throw new VerifiedRunError("cancelled");
	// The supervisor boundary only exists once a budget (and therefore the
	// gated driver) is anchored. Dispatching without it would run code whose
	// termination cannot be witnessed — refuse rather than degrade.
	if (!journal.state.budget) throw new VerifiedRunError("unsupported_boundary");
	const phaseDeadlineMs =
		request.role === "writer" ? journal.state.budget.workDeadlineMs : journal.state.verificationDeadlineMs;
	if (phaseDeadlineMs === null) throw new VerifiedRunError("unsupported_boundary");
	const phaseDeadline = { bootId: journal.state.budget.bootId, deadlineMs: phaseDeadlineMs };
	const authority = policy.authority;
	const generation = journal.state.generation;
	const executionId = randomUUID();
	const claims = workspaceClaim(request.workspace, request.role === "writer" ? "write" : "read", generation);
	const timeoutMs = Math.floor(request.deadline - performance.now());
	const intentDigest = digestObject({
		argv: request.argv,
		claims,
		role: request.role,
		...(request.detachable && request.role === "verifier"
			? { timeoutMs, claimId: request.claimId, candidateDigest: journal.state.candidateDigest }
			: {}),
	});
	const admission = authority.store.acquire({
		sessionId: authority.sessionId,
		incarnation: authority.incarnation,
		commandId: executionId,
		intentDigest,
		claims,
		now: Date.now(),
		ttl: timeoutMs + policy.cleanupMs + 30000,
	});
	if (admission.status !== "granted") {
		// A fresh executionId can only collide with a conflicting or wedged
		// claim — quarantined effects hold theirs until witnessed (fail closed).
		throw new VerifiedRunError("authority_blocked");
	}
	const token: GrantToken = admission.token;
	let supervisorInvoked = false;
	let readyObserved = false;
	let observedIdentity: NamespaceIdentity | undefined;
	const stateRoot = dirname(authority.store.path);
	const witnessDir = nativeWitnessDir(stateRoot);
	const recordDir = nativeExecutionDir(stateRoot);
	let result: SandboxOutcome;
	try {
		journal.append({
			kind: "dispatch",
			executionId,
			role: request.role,
			claimId: request.claimId,
			...(request.taskId === undefined ? {} : { taskId: request.taskId }),
			...(request.detachable && request.role === "verifier" ? { timeoutMs } : {}),
		});
		if (timeoutMs <= 0 || policy.signal?.aborted) {
			const failure = policy.signal?.aborted ? "cancelled" : "deadline";
			// Provably pre-spawn: the intent never reached the adapter, so the grant
			// settles immediately instead of wedging as an unwitnessed live effect.
			authority.store.cancel(token);
			authority.store.confirmTerminated(token);
			journal.append({ kind: "exited", executionId, failure });
			throw new VerifiedRunError(failure);
		}
		// The intent commits before the adapter is invoked: from this record on,
		// the effect may be live and a crash must quarantine it, never assume
		// it did not run.
		if (!authority.store.dispatchIntent(token, executionId)) throw new VerifiedRunError("authority");
		supervisorInvoked = true;
		result = await executeSandbox({
			workspace: request.workspace,
			argv: request.argv,
			writable: request.role === "writer",
			timeoutMs: Math.floor(request.deadline - performance.now()),
			cleanupMs: policy.cleanupMs,
			maxOutputBytes: policy.maxOutputBytes,
			phaseDeadline,
			witnessDir,
			recordDir,
			requestId: nativeRequestId(executionId),
			bindingDigest: digestObject({
				token,
				generation,
				executionId,
				intentDigest,
			}),
			...(request.detachable ? { detachable: true as const } : {}),
			...(policy.signal ? { signal: policy.signal } : {}),
			onReady: (identity: NamespaceIdentity) => {
				readyObserved = true;
				observedIdentity = identity;
				if (journal.state.generation !== generation) throw new VerifiedRunError("stale_generation");
				journal.append({ kind: "process_ready", executionId, identity });
				if (!authority.store.effectStarted(token, claims, identity)) throw new VerifiedRunError("authority");
			},
		});
	} catch (error) {
		// Only pre-spawn rejections prove nothing ran; everything else may have
		// a live or dying effect, which stays owned until a witness or a later
		// reconcile settles it.
		try {
			authority.store.cancel(token);
			if (
				!supervisorInvoked ||
				(!readyObserved && error instanceof VerifiedRunError && NEVER_SPAWNED.has(error.code))
			) {
				authority.store.confirmTerminated(token);
				// The intent provably never reached a process: journal the exit the same
				// way the pre-spawn timeout branch does, or the run quarantines forever
				// on an open executionId — the slow-runner flake where the second
				// deadline evaluation crosses zero between dispatch and spawn.
				if (journal.state.activeExecutionIds.includes(executionId)) {
					journal.append({
						kind: "exited",
						executionId,
						failure: error instanceof VerifiedRunError ? error.code : "execution_failed",
					});
				}
			}
		} catch (cleanupError) {
			throw new AggregateError([error, cleanupError], "Execution ownership cleanup failed");
		}
		throw error;
	}
	if (result.failure === "cancelled") authority.store.cancel(token);
	// Resolve means both witnesses fired: the direct child closed and the
	// recorded namespace drained empty. That is the termination-observed event
	// — the grant releases its claims here and nowhere else.
	if (!authority.store.confirmTerminated(token)) throw new VerifiedRunError("authority");
	if (observedIdentity) discardNativeWitness(witnessDir, observedIdentity);
	if (journal.state.generation !== generation) throw new VerifiedRunError("stale_generation");
	journal.append({ kind: "exited", executionId, failure: request.role === "writer" ? result.failure : null });
	// Stable native timestamps make receipt publication replayable across a parent crash.
	if (request.detachable && request.role === "verifier")
		result = await reattachRustExecution(stateRoot, executionId, {
			...policy,
			deadline: request.deadline,
			assertBinding(record) {
				if (
					record.bindingDigest !== digestObject({ token, generation, executionId, intentDigest }) ||
					digestObject(record.phaseDeadline) !== digestObject(phaseDeadline) ||
					digestObject(record.identity) !== digestObject(observedIdentity)
				)
					throw new VerifiedRunError("native_binding");
				return undefined;
			},
		});
	if (!request.detachable) discardRustExecutionRecord(recordDir, nativeRequestId(executionId));
	return { executionId, result, timeoutMs };
}
