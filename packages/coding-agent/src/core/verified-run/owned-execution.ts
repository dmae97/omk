import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { performance } from "node:perf_hooks";
import type { ResourceClaimInput } from "../../coordination/resource.ts";
import type { GrantToken } from "../../coordination/types.ts";
import type { RunAuthority } from "./authority-runtime.ts";
import { executeSandbox, type SandboxOutcome } from "./broker.ts";
import type { VerifiedRunJournal } from "./journal.ts";
import type { NamespaceIdentity } from "./namespace-identity.ts";
import { digestObject, VerifiedRunError } from "./storage.ts";

export interface OwnedRunCommand {
	readonly role: "writer" | "verifier";
	readonly argv: readonly string[];
	readonly workspace: string;
	readonly deadline: number;
	readonly claimId: string | null;
	readonly taskId?: string;
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
function workspaceClaim(
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
	const authority = policy.authority;
	const generation = journal.state.generation;
	const executionId = randomUUID();
	const claims = workspaceClaim(request.workspace, request.role === "writer" ? "write" : "read", generation);
	const timeoutMs = Math.floor(request.deadline - performance.now());
	const admission = authority.store.acquire({
		sessionId: authority.sessionId,
		incarnation: authority.incarnation,
		commandId: executionId,
		intentDigest: digestObject({ argv: request.argv, claims, role: request.role }),
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
	journal.append({
		kind: "dispatch",
		executionId,
		role: request.role,
		claimId: request.claimId,
		...(request.taskId === undefined ? {} : { taskId: request.taskId }),
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
	let result: SandboxOutcome;
	try {
		result = await executeSandbox({
			workspace: request.workspace,
			argv: request.argv,
			writable: request.role === "writer",
			timeoutMs,
			cleanupMs: policy.cleanupMs,
			maxOutputBytes: policy.maxOutputBytes,
			...(policy.signal ? { signal: policy.signal } : {}),
			onReady: (identity: NamespaceIdentity) => {
				if (journal.state.generation !== generation) throw new VerifiedRunError("stale_generation");
				journal.append({ kind: "process_ready", executionId, identity });
				if (!authority.store.effectStarted(token, claims, identity)) throw new VerifiedRunError("authority");
			},
		});
	} catch (error) {
		// Only pre-spawn rejections prove nothing ran; everything else may have
		// a live or dying effect, which stays owned until a witness or a later
		// reconcile settles it.
		if (error instanceof VerifiedRunError && NEVER_SPAWNED.has(error.code)) {
			authority.store.cancel(token);
			authority.store.confirmTerminated(token);
		}
		throw error;
	}
	if (result.failure === "cancelled") authority.store.cancel(token);
	// Resolve means both witnesses fired: the direct child closed and the
	// recorded namespace drained empty. That is the termination-observed event
	// — the grant releases its claims here and nowhere else.
	if (!authority.store.confirmTerminated(token)) throw new VerifiedRunError("authority");
	if (journal.state.generation !== generation) throw new VerifiedRunError("stale_generation");
	journal.append({ kind: "exited", executionId, failure: request.role === "writer" ? result.failure : null });
	return { executionId, result, timeoutMs };
}
