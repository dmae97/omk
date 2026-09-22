import { randomUUID } from "node:crypto";
import {
	closeSync,
	existsSync,
	constants as fsConstants,
	fstatSync,
	fsyncSync,
	ftruncateSync,
	mkdirSync,
	openSync,
	readFileSync,
	renameSync,
	unlinkSync,
	writeSync,
} from "node:fs";
import { dirname, join } from "node:path";
import {
	canonicalClaim,
	claimSetsConflict,
	type ResourceClaimInput,
	sameClaimSet,
} from "../../coordination/resource.ts";
import { type GrantToken, SETTLED_EFFECT_STATES, type Sequence, sequence } from "../../coordination/types.ts";
import { atomicRewriteFileSync } from "../atomic-session-file.ts";
import {
	acquireDurableFileLockSync,
	acquireDurableFileMutationLockSync,
	type DurableFileLock,
	DurableFileLockBusyError,
	inspectDurableFileLockSync,
} from "../durable-file-identity.ts";
import { fsyncDirectorySync, writeExclusiveFileDurablySync } from "../durable-file-io.ts";
import { canonicalJson } from "../run-journal.ts";
import { createAuthorityClock } from "./authority-clock.ts";
import { AuthorityLeaseHeldError, AuthorityStoreError } from "./authority-errors.ts";
import {
	type AuthorityEvent,
	type AuthorityGrantRecord,
	type AuthorityProjection,
	applyAuthorityEvents,
	authorityPendingReconcile,
	parseAuthorityEvent,
	snapshotFromProjection,
} from "./authority-events.ts";
import {
	type AuthorityRecord,
	GENESIS_PREVIOUS,
	materializeRecord,
	type ParsedAuthority,
	parseCommitted,
	recordLine,
} from "./authority-journal.ts";
import { assertSameCommandMeaning, authorizationStillOpen, expiryEvents, sameGrantToken } from "./authority-meaning.ts";

export type { AuthorityRecord } from "./authority-journal.ts";

import type { NamespaceIdentity } from "./namespace-identity.ts";
import { probeNamespace } from "./namespace-identity.ts";
import { readRunClock } from "./recovery-clock.ts";
import { VerifiedRunError } from "./storage.ts";

/**
 * Durable authority store (WP03): the single-writer boundary for supervisor
 * authorization state.
 *
 * Storage is a head-sidecar pair — `authority.events.jsonl` plus
 * `authority.events.jsonl.head` — mirroring `ReplayLedgerStore`: the committed
 * head is the transaction boundary, bytes after `head.size` are uncommitted
 * and get quarantined then truncated on the next open, and every append is an
 * expected-head CAS inside the `"mutation"` lock critical section. Cross-process
 * exclusion is the `"authority"` scope durable-file lease held for the store's
 * lifetime; its owner record (pid+host+token) is the writer identity, and dead
 * owners are reclaimed by the existing reclaim protocol.
 *
 * Authority epoch durability: `open` appends `authority-epoch-advanced` inside
 * the lease critical section — never the in-memory default "1" — and leaves the
 * epoch unreconciled. Only `reconcile()` (termination-witness probes per
 * quarantined effect, then `authority-reconciled`) reopens admission. A crash
 * between the epoch event and reconciliation leaves `pendingReconcile` set;
 * the next open adopts that epoch instead of advancing again.
 */

export { AuthorityLeaseHeldError, AuthorityStoreError } from "./authority-errors.ts";

const AUTHORITY_SCOPE = "authority";

export const authorityStorePath = (root: string): string => join(root, "authority.events.jsonl");

export interface AuthorityHead {
	readonly fileIdentity: { readonly dev: string; readonly ino: string } | null;
	readonly size: number;
	readonly lastSeq: number;
	readonly lastHash: string;
}

const EMPTY_AUTHORITY_HEAD: AuthorityHead = Object.freeze({
	fileIdentity: null,
	size: 0,
	lastSeq: 0,
	lastHash: GENESIS_PREVIOUS,
});

interface CommittedView {
	readonly head: AuthorityHead;
	readonly parsed: ParsedAuthority;
}

function authorityHeadsEqual(left: AuthorityHead, right: AuthorityHead): boolean {
	return (
		left.size === right.size &&
		left.lastSeq === right.lastSeq &&
		left.lastHash === right.lastHash &&
		(left.fileIdentity === null
			? right.fileIdentity === null
			: right.fileIdentity !== null &&
				left.fileIdentity.dev === right.fileIdentity.dev &&
				left.fileIdentity.ino === right.fileIdentity.ino)
	);
}

function parseHead(raw: unknown): AuthorityHead {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new AuthorityStoreError("corrupt");
	const value = raw as Record<string, unknown>;
	if (Object.keys(value).sort().join(",") !== "fileIdentity,lastHash,lastSeq,size")
		throw new AuthorityStoreError("corrupt");
	let fileIdentity: AuthorityHead["fileIdentity"] = null;
	if (value.fileIdentity !== null) {
		if (typeof value.fileIdentity !== "object" || Array.isArray(value.fileIdentity))
			throw new AuthorityStoreError("corrupt");
		const identity = value.fileIdentity as Record<string, unknown>;
		if (
			Object.keys(identity).sort().join(",") !== "dev,ino" ||
			typeof identity.dev !== "string" ||
			!/^\d+$/.test(identity.dev) ||
			typeof identity.ino !== "string" ||
			!/^\d+$/.test(identity.ino)
		)
			throw new AuthorityStoreError("corrupt");
		fileIdentity = Object.freeze({ dev: identity.dev, ino: identity.ino });
	}
	if (
		!Number.isSafeInteger(value.size) ||
		(value.size as number) < 0 ||
		!Number.isSafeInteger(value.lastSeq) ||
		(value.lastSeq as number) < 0 ||
		typeof value.lastHash !== "string" ||
		(value.lastSeq === 0 ? value.lastHash !== GENESIS_PREVIOUS : !/^[0-9a-f]{64}$/.test(value.lastHash))
	)
		throw new AuthorityStoreError("corrupt");
	return Object.freeze({
		fileIdentity,
		size: value.size as number,
		lastSeq: value.lastSeq as number,
		lastHash: value.lastHash,
	});
}

function fileIdentityOf(stat: {
	dev: number | bigint;
	ino: number | bigint;
}): NonNullable<AuthorityHead["fileIdentity"]> {
	return Object.freeze({ dev: String(stat.dev), ino: String(stat.ino) });
}

function sameFileIdentity(left: AuthorityHead["fileIdentity"], right: AuthorityHead["fileIdentity"]): boolean {
	return left === null ? right === null : right !== null && left.dev === right.dev && left.ino === right.ino;
}

function writeAll(fd: number, bytes: Uint8Array): void {
	let offset = 0;
	while (offset < bytes.byteLength) offset += writeSync(fd, bytes, offset, bytes.byteLength - offset);
}

function appendDurably(path: string, bytes: Uint8Array): void {
	const fd = openSync(path, fsConstants.O_CREAT | fsConstants.O_APPEND | fsConstants.O_WRONLY, 0o600);
	try {
		writeAll(fd, bytes);
		fsyncSync(fd);
	} finally {
		closeSync(fd);
	}
}

export interface AuthorityStoreHooks {
	/** Fires after the events file is fsynced but before the head publishes — the commit crash window. */
	readonly afterLedgerFsync?: () => void;
	/** Fires before a quarantine artifact is fsynced. */
	readonly beforeQuarantineFsync?: () => void;
	/** Fires after GC's atomic rewrite lands but before the new head publishes — the GC crash window. */
	readonly afterAtomicRewrite?: () => void;
	/** Test seam replacing the durable record append. */
	readonly persistRecord?: (path: string, bytes: Uint8Array) => void;
}

export type AuthorityProbe = (grant: AuthorityGrantRecord) => "terminated" | "alive" | "unknown";

export interface OpenAuthorityStoreOptions {
	/** Total admissible weight of concurrently active grants (broker parity). */
	readonly capacity: number;
	readonly hooks?: AuthorityStoreHooks;
	readonly probe?: AuthorityProbe;
	/** Trusted host clock; never supplied by a serialized command. */
	readonly clock?: () => number;
	/** Disable only the parsing cache; disk integrity and durability checks always run. */
	readonly incrementalReplay?: boolean;
}

export interface AuthorityAcquireInput {
	readonly sessionId: string;
	readonly incarnation: Sequence | string;
	/** Idempotency key; unique across grants and tombstones (I08/I31). */
	readonly commandId: string;
	readonly intentDigest: string;
	readonly claims: readonly ResourceClaimInput[];
	readonly now: number;
	readonly ttl: number;
	readonly weight?: number;
}

export type AuthorityAcquireResult =
	| { readonly status: "granted"; readonly token: GrantToken; readonly duplicate: boolean }
	| { readonly status: "blocked" }
	| { readonly status: "result"; readonly resultDigest: string; readonly token: GrantToken }
	| { readonly status: "result-expired" };

export type AuthorityLookup =
	| { readonly status: "pending"; readonly token: GrantToken }
	| { readonly status: "result"; readonly resultDigest: string; readonly token: GrantToken }
	| { readonly status: "result-expired"; readonly token: GrantToken }
	| { readonly status: "unknown" };

/** Committed projection plus the hashed records it was replayed from. */
export interface AuthorityJournalInspection {
	readonly state: AuthorityProjection;
	readonly records: readonly AuthorityRecord[];
	readonly head: AuthorityHead;
}

interface StoreContext {
	readonly path: string;
	readonly headPath: string;
	readonly hooks: AuthorityStoreHooks;
}

function publishHead(context: StoreContext, head: AuthorityHead): void {
	const temp = `${context.headPath}.${randomUUID()}.tmp`;
	const fd = openSync(temp, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY, 0o600);
	try {
		writeAll(fd, Buffer.from(`${JSON.stringify(head)}\n`, "utf8"));
		fsyncSync(fd);
	} finally {
		closeSync(fd);
	}
	try {
		renameSync(temp, context.headPath);
		fsyncDirectorySync(dirname(context.headPath));
	} catch (error) {
		if (existsSync(temp)) unlinkSync(temp);
		throw error;
	}
}

function quarantineSuffix(context: StoreContext, bytes: Buffer): void {
	context.hooks.beforeQuarantineFsync?.();
	writeExclusiveFileDurablySync(`${context.path}.quarantine-${randomUUID()}`, bytes);
}

/**
 * Load committed state. With `repair`, an uncommitted suffix is quarantined
 * and truncated; a file whose identity no longer matches its head is accepted
 * only when it begins with exactly the GC snapshot continuation of that head
 * (the GC rename-landed/head-publish-crashed window), otherwise the store is
 * tampered and opens refuse. Without `repair` the suffix is left untouched
 * and simply not part of committed state.
 */
function loadCommitted(context: StoreContext, repair: boolean, cached?: CommittedView): CommittedView {
	const fileExists = existsSync(context.path);
	const headExists = existsSync(context.headPath);
	const empty: CommittedView = {
		head: EMPTY_AUTHORITY_HEAD,
		parsed: parseCommitted(Buffer.alloc(0)),
	};
	if (!fileExists && !headExists) return empty;
	if (fileExists && !headExists) {
		const fd = openSync(context.path, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
		try {
			const stat = fstatSync(fd);
			if (!stat.isFile() || stat.size !== 0) throw new AuthorityStoreError("corrupt");
		} finally {
			closeSync(fd);
		}
		if (!repair) return empty;
		unlinkSync(context.path);
		fsyncDirectorySync(dirname(context.path));
		return empty;
	}
	if (!fileExists) throw new AuthorityStoreError("corrupt");
	let head: AuthorityHead;
	try {
		head = parseHead(JSON.parse(readFileSync(context.headPath, "utf8")));
	} catch (error) {
		if (error instanceof AuthorityStoreError || error instanceof VerifiedRunError) throw error;
		throw new AuthorityStoreError("corrupt");
	}
	const fd = openSync(context.path, fsConstants.O_RDWR | (fsConstants.O_NOFOLLOW ?? 0));
	try {
		const before = fstatSync(fd);
		const bytes = readFileSync(fd);
		const after = fstatSync(fd);
		if (
			!before.isFile() ||
			!after.isFile() ||
			before.size !== after.size ||
			before.ctimeMs !== after.ctimeMs ||
			after.size !== bytes.byteLength
		)
			throw new AuthorityStoreError("tampered");
		const actual = fileIdentityOf(after);
		if (!sameFileIdentity(head.fileIdentity, actual)) {
			head = healGarbageCollect(context, head, bytes, actual, repair);
		}
		if (head.size > after.size) throw new AuthorityStoreError("tampered");
		const committed = Buffer.from(bytes.subarray(0, head.size));
		const prefix =
			cached &&
			sameFileIdentity(cached.head.fileIdentity, actual) &&
			head.size >= cached.head.size &&
			head.lastSeq >= cached.head.lastSeq
				? cached.parsed
				: undefined;
		const parsed = parseCommitted(committed, prefix);
		if (parsed.lastSeq !== head.lastSeq || parsed.lastHash !== head.lastHash)
			throw new AuthorityStoreError("tampered");
		if (head.size < after.size && repair) {
			quarantineSuffix(context, bytes.subarray(head.size));
			ftruncateSync(fd, head.size);
			fsyncSync(fd);
			fsyncDirectorySync(dirname(context.path));
		}
		return { head, parsed };
	} finally {
		closeSync(fd);
	}
}

/**
 * The only legal file whose identity differs from its head: an atomic GC
 * rewrite that landed but whose head publish never committed. Its first
 * record must be exactly the snapshot continuing `head`; the healed head
 * covers just that record, and any bytes after it are uncommitted suffix.
 */
function healGarbageCollect(
	context: StoreContext,
	head: AuthorityHead,
	bytes: Buffer,
	actual: NonNullable<AuthorityHead["fileIdentity"]>,
	repair: boolean,
): AuthorityHead {
	if (!repair) throw new AuthorityStoreError("tampered");
	let healed: AuthorityHead | null = null;
	try {
		const newline = bytes.indexOf(10);
		if (newline > 0) {
			const first = bytes.subarray(0, newline + 1);
			const raw: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(first).slice(0, -1));
			const event =
				typeof raw === "object" && raw !== null && "event" in raw
					? parseAuthorityEvent((raw as { event: unknown }).event)
					: null;
			if (event?.kind === "authority-snapshot") {
				const record = materializeRecord(event.archivedThroughSequence + 1, event.continuesHash, event);
				// Only the snapshot line itself must be proven: any bytes after it
				// (including a torn tail) are uncommitted suffix and go to quarantine.
				if (
					canonicalJson(raw) === canonicalJson(record) &&
					event.archivedThroughSequence === head.lastSeq &&
					event.continuesHash === head.lastHash
				) {
					healed = Object.freeze({
						fileIdentity: actual,
						size: first.byteLength,
						lastSeq: record.seq,
						lastHash: record.hash,
					});
				}
			}
		}
	} catch (error) {
		if (!(error instanceof AuthorityStoreError || error instanceof VerifiedRunError)) throw error;
	}
	if (!healed) throw new AuthorityStoreError("tampered");
	publishHead(context, healed);
	return healed;
}

function defaultProbe(grant: AuthorityGrantRecord): "terminated" | "alive" | "unknown" {
	if (!grant.identity) return "unknown";
	const result = probeNamespace(grant.identity);
	return result === "gone" ? "terminated" : result === "alive" ? "alive" : "unknown";
}

function nextSequenceValue(value: Sequence): Sequence {
	return sequence(String(BigInt(value) + 1n));
}

function assertNonNegativeInteger(value: number, label: string): void {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
		throw new TypeError(`${label} must be a nonnegative safe integer`);
}

/** The durable single-writer authority boundary. */
export class AuthorityStore {
	private readonly context: StoreContext;
	private readonly capacity: number;
	private readonly probe: AuthorityProbe;
	private readonly lease: DurableFileLock;
	private accepted: CommittedView;
	private released = false;
	private readonly now: () => number;
	private readonly incrementalReplay: boolean;

	private constructor(
		context: StoreContext,
		lease: DurableFileLock,
		accepted: CommittedView,
		options: OpenAuthorityStoreOptions,
	) {
		this.context = context;
		this.lease = lease;
		this.accepted = accepted;
		this.capacity = options.capacity;
		this.probe = options.probe ?? defaultProbe;
		this.now = createAuthorityClock(options.clock);
		this.incrementalReplay = options.incrementalReplay !== false;
	}

	/**
	 * Take the `"authority"` scope lease and advance the persisted epoch.
	 * When the previous epoch never reconciled, this restart adopts it — the
	 * pending reconciliation must finish before new admission, and the epoch
	 * is not bumped again (review §5 fault row).
	 */
	static open(path: string, options: OpenAuthorityStoreOptions): AuthorityStore {
		assertNonNegativeInteger(options.capacity, "capacity");
		mkdirSync(dirname(path), { recursive: true });
		const context: StoreContext = { path, headPath: `${path}.head`, hooks: options.hooks ?? {} };
		const mutation = acquireDurableFileMutationLockSync(path);
		let lease: DurableFileLock;
		try {
			lease = acquireDurableFileLockSync(path, AUTHORITY_SCOPE, { timeoutMs: 0 });
		} catch (error) {
			const failure =
				error instanceof DurableFileLockBusyError
					? new AuthorityLeaseHeldError(inspectDurableFileLockSync(path, AUTHORITY_SCOPE))
					: error;
			try {
				mutation.release();
			} catch (cleanupError) {
				throw new AggregateError(
					[failure, cleanupError instanceof Error ? cleanupError : new Error(String(cleanupError))],
					"Authority lease acquisition cleanup failed",
				);
			}
			throw failure;
		}
		let store: AuthorityStore;
		try {
			store = new AuthorityStore(context, lease, loadCommitted(context, true), options);
		} catch (error) {
			try {
				lease.release();
			} catch (releaseError) {
				throw new AggregateError(
					[error, releaseError instanceof Error ? releaseError : new Error(String(releaseError))],
					"Authority store open cleanup failed",
				);
			}
			throw error;
		} finally {
			mutation.release();
		}
		try {
			if (store.state.epoch === null || !authorityPendingReconcile(store.state)) {
				// Fresh store or fully reconciled previous epoch: this restart
				// durably advances the epoch. A pending epoch is adopted, not bumped.
				store.commitEpochAdvance();
			}
		} catch (error) {
			try {
				store.release();
			} catch (releaseError) {
				throw new AggregateError(
					[error, releaseError instanceof Error ? releaseError : new Error(String(releaseError))],
					"Authority store open cleanup failed",
				);
			}
			throw error;
		}
		return store;
	}

	/** Read-only committed projection; performs no repair and writes nothing. */
	static inspect(path: string): AuthorityProjection {
		const context: StoreContext = { path, headPath: `${path}.head`, hooks: {} };
		return loadCommitted(context, false).parsed.state;
	}

	/**
	 * Read-only committed journal: projection plus the hashed records it was
	 * replayed from, so callers can see transition causes (cancel-requested vs
	 * authorization-expired vs epoch restart) and termination witnesses — the
	 * projection alone intentionally does not restate them.
	 */
	static inspectJournal(path: string): AuthorityJournalInspection {
		const context: StoreContext = { path, headPath: `${path}.head`, hooks: {} };
		const committed = loadCommitted(context, false);
		return Object.freeze({
			state: committed.parsed.state,
			records: committed.parsed.records,
			head: committed.head,
		});
	}

	get path(): string {
		return this.context.path;
	}

	get head(): AuthorityHead {
		return this.accepted.head;
	}

	get state(): AuthorityProjection {
		return structuredClone(this.accepted.parsed.state);
	}

	get lastReplay(): ParsedAuthority["replay"] {
		return this.accepted.parsed.replay;
	}

	get pendingReconcile(): boolean {
		return authorityPendingReconcile(this.state);
	}

	private writerId(): string {
		try {
			return `${readRunClock().bootId}:${process.pid}`;
		} catch {
			return `unknown:${process.pid}`;
		}
	}

	/**
	 * Commit events as one transaction: mutation lock → committed-head CAS →
	 * reducer pre-validation → append+fsync → head publish → re-read
	 * verification. The head CAS is the fencing boundary — a store whose lease
	 * was reclaimed and taken by another writer sees a changed head and fails
	 * closed instead of authorizing. Persist failures never mint in-memory
	 * state (docs/04: no memory-only authorization after storage failure).
	 */
	private commit(events: readonly AuthorityEvent[]): void {
		if (this.released) throw new AuthorityStoreError("stale_owner");
		const mutation = acquireDurableFileMutationLockSync(this.context.path);
		try {
			const current = loadCommitted(this.context, true, this.incrementalReplay ? this.accepted : undefined);
			if (!authorityHeadsEqual(current.head, this.accepted.head)) throw new AuthorityStoreError("stale_head");
			if (events.length === 0) {
				this.accepted = current;
				return;
			}
			// Every event must be accepted by the deterministic reducer before a
			// single byte reaches disk.
			applyAuthorityEvents(current.parsed.state, events);
			const lines: string[] = [];
			let seq = current.parsed.lastSeq;
			let previous = current.parsed.lastHash;
			for (const event of events) {
				seq += 1;
				const record = materializeRecord(seq, previous, event);
				lines.push(recordLine(record));
				previous = record.hash;
			}
			const payload = Buffer.from(lines.join(""), "utf8");
			(this.context.hooks.persistRecord ?? appendDurably)(this.context.path, payload);
			const fd = openSync(this.context.path, fsConstants.O_RDWR | (fsConstants.O_NOFOLLOW ?? 0));
			let head: AuthorityHead;
			try {
				const stat = fstatSync(fd);
				// CAS on the file itself: for an established store the inode must be
				// the one the committed head names; for genesis the append must have
				// produced exactly the expected size. Anything else is a replaced or
				// foreign file and commits must not bless it.
				if (
					stat.size !== current.head.size + payload.byteLength ||
					(current.head.fileIdentity !== null &&
						!sameFileIdentity(current.head.fileIdentity, fileIdentityOf(stat)))
				)
					throw new AuthorityStoreError("stale_head");
				head = Object.freeze({
					fileIdentity: fileIdentityOf(stat),
					size: stat.size,
					lastSeq: seq,
					lastHash: previous,
				});
			} finally {
				closeSync(fd);
			}
			this.context.hooks.afterLedgerFsync?.();
			publishHead(this.context, head);
			const verified = loadCommitted(this.context, false, this.incrementalReplay ? current : undefined);
			if (verified.parsed.lastSeq !== head.lastSeq || verified.parsed.lastHash !== head.lastHash)
				throw new AuthorityStoreError("corrupt");
			this.accepted = verified;
		} finally {
			mutation.release();
		}
	}

	private commitEpochAdvance(): void {
		const state = this.state;
		const epoch = nextSequenceValue(state.epoch ?? sequence("0"));
		const transitions = [...state.grants.values()]
			.filter((grant) => !SETTLED_EFFECT_STATES.has(grant.state))
			.map((grant) =>
				Object.freeze({
					grantSequence: grant.token.grantSequence,
					outcome: grant.effectLive ? ("quarantined" as const) : ("cancelled" as const),
				}),
			);
		this.commit([
			{ kind: "authority-epoch-advanced", authorityEpoch: epoch, writerId: this.writerId(), transitions },
		]);
	}

	/** Announce a session incarnation (S2); the counter survives restarts durably. */
	register(sessionId: string): Sequence {
		if (typeof sessionId !== "string" || sessionId.length === 0)
			throw new TypeError("sessionId must be a non-empty string");
		const current = this.state.incarnations.get(sessionId) ?? sequence("0");
		const incarnation = nextSequenceValue(current);
		this.commit([{ kind: "session-registered", sessionId, incarnation }]);
		return incarnation;
	}

	/**
	 * Admit an authorization: claim-overlap check, capacity check, idempotency
	 * replay, and the `grant-reserved` record in one lease/mutation-locked
	 * critical section — the check and the record are one transaction (docs/04).
	 * The lease is held for the store's lifetime, so committed state cannot
	 * move between the check and the append; the head CAS in commit() is the
	 * backstop if it ever could.
	 */
	acquire(input: AuthorityAcquireInput): AuthorityAcquireResult {
		assertNonNegativeInteger(input.now, "now");
		const weight = input.weight ?? 1;
		assertNonNegativeInteger(weight, "weight");
		if (!Number.isSafeInteger(input.ttl) || input.ttl <= 0)
			throw new TypeError("ttl must be a positive safe integer");
		const authorizationDeadline = input.now + input.ttl;
		if (!Number.isSafeInteger(authorizationDeadline)) throw new RangeError("authorization deadline overflow");
		const incarnation = sequence(input.incarnation);
		if (this.state.incarnations.get(input.sessionId) !== incarnation)
			throw new AuthorityStoreError("stale_incarnation");
		if (!/^[a-f0-9]{64}$/.test(input.intentDigest)) throw new TypeError("intentDigest must be a sha256 hex digest");
		if (!Array.isArray(input.claims) || input.claims.length === 0)
			throw new TypeError("an unknown scope must not be admitted as an empty scope");
		const claims = Object.freeze(Array.from(input.claims, (claim) => canonicalClaim(claim)));

		// Idempotency (I08): replayed commands return their recorded disposition
		// without re-executing. A live tombstone returns the result; an expired
		// one reports expiry; an in-flight grant is a duplicate only when the
		// full intent matches — otherwise it is an ID collision (I09/I20).
		const tombstone = this.state.tombstones.get(input.commandId);
		if (tombstone) {
			const grant = this.state.grants.get(tombstone.grantSequence);
			if (!grant) throw new AuthorityStoreError("corrupt");
			assertSameCommandMeaning(grant, {
				intentDigest: input.intentDigest,
				sessionId: input.sessionId,
				incarnation,
				claims,
				weight,
			});
			if (tombstone.expiresAtMs <= input.now) return { status: "result-expired" };
			return { status: "result", resultDigest: tombstone.resultDigest, token: grant.token };
		}
		for (const grant of this.state.grants.values()) {
			if (grant.commandId !== input.commandId) continue;
			assertSameCommandMeaning(grant, {
				intentDigest: input.intentDigest,
				sessionId: input.sessionId,
				incarnation,
				claims,
				weight,
			});
			return { status: "granted", token: grant.token, duplicate: true };
		}

		if (this.pendingReconcile) throw new AuthorityStoreError("reconcile_pending");
		const epoch = this.state.epoch;
		if (epoch === null) throw new AuthorityStoreError("corrupt");

		const expired = expiryEvents(this.state, input.now, epoch);
		const settledState = expired.length ? applyAuthorityEvents(this.state, expired) : this.state;
		const active = [...settledState.grants.values()].filter((grant) => !SETTLED_EFFECT_STATES.has(grant.state));
		const used = active.reduce((sum, grant) => sum + grant.weight, 0);
		if (weight > this.capacity - used) return { status: "blocked" };
		if (active.some((grant) => claimSetsConflict([...claims], [...grant.claims]))) return { status: "blocked" };

		const grantSequence = nextSequenceValue(this.state.grantCounter);
		const grant: AuthorityGrantRecord = Object.freeze({
			token: Object.freeze({
				authorityEpoch: epoch,
				grantSequence,
				sessionId: input.sessionId,
				sessionIncarnation: incarnation,
				authorizationDeadline,
			}),
			commandId: input.commandId,
			intentDigest: input.intentDigest,
			claims,
			weight,
			state: "reserved",
			effectLive: false,
			dispatchId: null,
			actualClaims: null,
			identity: null,
		});
		this.commit([...expired, { kind: "grant-reserved", grant }]);
		return { status: "granted", token: grant.token, duplicate: false };
	}

	private resolveToken(token: GrantToken, authoritative: boolean): AuthorityGrantRecord | undefined {
		const grant = this.state.grants.get(token.grantSequence);
		if (!grant || !sameGrantToken(grant.token, token)) return undefined;
		if (authoritative) {
			if (
				token.authorityEpoch !== this.state.epoch ||
				this.state.incarnations.get(token.sessionId) !== token.sessionIncarnation ||
				SETTLED_EFFECT_STATES.has(grant.state)
			)
				return undefined;
		} else if (SETTLED_EFFECT_STATES.has(grant.state)) return undefined;
		return grant;
	}

	/**
	 * Persisted dispatch intent. A committed intent whose spawn was never
	 * witnessed cannot be assumed un-run; on restart it quarantines like any
	 * other possibly-live effect (I01/I02).
	 */
	dispatchIntent(token: GrantToken, dispatchId: string, now = this.now()): boolean {
		if (!/^[A-Za-z0-9_-]{1,128}$/.test(dispatchId)) throw new TypeError("dispatchId is invalid");
		const grant = this.resolveToken(token, true);
		if (!grant || grant.state !== "reserved") return false;
		const epoch = this.state.epoch;
		if (epoch === null) return false;
		if (!authorizationStillOpen(now, grant.token.authorizationDeadline)) {
			this.expire(now);
			return false;
		}
		this.commit([
			{ kind: "dispatch-intent", grantSequence: grant.token.grantSequence, authorityEpoch: epoch, dispatchId },
		]);
		return true;
	}

	/** Bind an effect to its reservation; actual claims must equal the reserved set exactly. */
	effectStarted(
		token: GrantToken,
		actualClaims: readonly ResourceClaimInput[],
		identity?: NamespaceIdentity,
		now = this.now(),
	): boolean {
		const grant = this.resolveToken(token, true);
		if (!grant || (grant.state !== "reserved" && grant.state !== "starting")) return false;
		if (!authorizationStillOpen(now, grant.token.authorizationDeadline)) {
			this.expire(now);
			return false;
		}
		if (!Array.isArray(actualClaims)) throw new TypeError("actualClaims must be an array");
		const claims = Object.freeze(Array.from(actualClaims, (entry) => canonicalClaim(entry)));
		if (!sameClaimSet([...claims], [...grant.claims])) return false;
		const epoch = this.state.epoch;
		if (epoch === null) return false;
		this.commit([
			{
				kind: "effect-started",
				grantSequence: grant.token.grantSequence,
				authorityEpoch: epoch,
				actualClaims: claims,
				...(identity ? { identity } : {}),
			},
		]);
		return true;
	}

	/** Revalidate a running effect before its next irreversible boundary, without starting it again. */
	effectAuthorized(token: GrantToken, actualClaims: readonly ResourceClaimInput[]): boolean {
		const now = this.now();
		const grant = this.resolveToken(token, true);
		if (!grant || grant.state !== "running") return false;
		if (!authorizationStillOpen(now, token.authorizationDeadline)) {
			this.expire(now);
			return false;
		}
		return sameClaimSet(
			Array.from(actualClaims, (claim) => canonicalClaim(claim)),
			grant.claims,
		);
	}

	/** Requested cancellation is not observed termination; live effects quarantine. */
	cancel(token: GrantToken): boolean {
		const grant = this.resolveToken(token, false);
		if (!grant) return false;
		const epoch = this.state.epoch;
		if (epoch === null) return false;
		this.commit([
			{
				kind: "cancel-requested",
				grantSequence: grant.token.grantSequence,
				authorityEpoch: epoch,
				outcome: grant.effectLive ? "quarantined" : "cancelled",
			},
		]);
		return true;
	}

	/** Settle lapsed authorizations; never evicts a live effect. */
	expire(now: number): void {
		assertNonNegativeInteger(now, "now");
		const epoch = this.state.epoch;
		if (epoch === null) return;
		const events = expiryEvents(this.state, now, epoch);
		if (events.length) this.commit(events);
	}

	/**
	 * Trusted supervisor witness: this exact effect is gone. Accepted across
	 * superseded epochs so a restarted authority can settle what the previous
	 * one started, never to authorize new work.
	 */
	confirmTerminated(token: GrantToken): boolean {
		const grant = this.resolveToken(token, false);
		if (!grant) return false;
		const epoch = this.state.epoch;
		if (epoch === null) return false;
		this.commit([{ kind: "termination-observed", grantSequence: grant.token.grantSequence, authorityEpoch: epoch }]);
		return true;
	}

	/** Retain the final result as an idempotency tombstone (S3, docs/04). */
	retainResult(commandId: string, resultDigest: string, now: number, retentionMs: number): void {
		assertNonNegativeInteger(now, "now");
		if (!Number.isSafeInteger(retentionMs) || retentionMs <= 0)
			throw new TypeError("retentionMs must be a positive safe integer");
		if (!/^[a-f0-9]{64}$/.test(resultDigest)) throw new TypeError("resultDigest must be a sha256 hex digest");
		const grant = [...this.state.grants.values()].find((entry) => entry.commandId === commandId);
		if (!grant) throw new AuthorityStoreError("unknown_command");
		if (!SETTLED_EFFECT_STATES.has(grant.state)) throw new AuthorityStoreError("unsettled");
		if (this.state.tombstones.has(commandId)) throw new AuthorityStoreError("duplicate");
		this.commit([
			{
				kind: "result-retained",
				commandId,
				grantSequence: grant.token.grantSequence,
				resultDigest,
				retainedAtMs: now,
				expiresAtMs: now + retentionMs,
			},
		]);
	}

	/** Command disposition without re-execution (I08/I31). */
	lookup(commandId: string, now: number): AuthorityLookup {
		assertNonNegativeInteger(now, "now");
		const tombstone = this.state.tombstones.get(commandId);
		if (tombstone) {
			const grant = this.state.grants.get(tombstone.grantSequence);
			if (!grant) throw new AuthorityStoreError("corrupt");
			return tombstone.expiresAtMs <= now
				? { status: "result-expired", token: grant.token }
				: { status: "result", resultDigest: tombstone.resultDigest, token: grant.token };
		}
		for (const grant of this.state.grants.values())
			if (grant.commandId === commandId) return { status: "pending", token: grant.token };
		return { status: "unknown" };
	}

	/**
	 * Finish the restart reconciliation: every quarantined effect is compared
	 * against the real execution boundary — only an observed termination
	 * settles it ("gone"); "alive"/"unknown" stay quarantined and keep their
	 * claims (docs/04, review §6). Ends with `authority-reconciled` for the
	 * current epoch; the reconciled scope only then admits new work.
	 */
	reconcile(probe?: AuthorityProbe): void {
		const state = this.state;
		const epoch = state.epoch;
		if (epoch === null) throw new AuthorityStoreError("corrupt");
		if (!authorityPendingReconcile(state)) return;
		const check = probe ?? this.probe;
		const events: AuthorityEvent[] = [];
		for (const grant of state.grants.values()) {
			if (grant.state !== "quarantined") continue;
			if (check(grant) === "terminated") {
				events.push({
					kind: "termination-observed",
					grantSequence: grant.token.grantSequence,
					authorityEpoch: epoch,
				});
			}
		}
		events.push({ kind: "authority-reconciled", authorityEpoch: epoch });
		this.commit(events);
	}

	/**
	 * GC (review §7): fold droppable state into an `authority-snapshot` and
	 * atomically rewrite the log to that snapshot. Retained: the epoch pair,
	 * incarnation counters, the grant counter (I31 — sequences never reissue),
	 * every unsettled grant, every settled grant still referenced by an
	 * unexpired tombstone, and the unexpired tombstones themselves. A crash
	 * between the atomic rewrite and head publish self-heals on next open via
	 * the snapshot continuation check.
	 */
	compact(now: number): { readonly dropped: number } {
		assertNonNegativeInteger(now, "now");
		if (this.released) throw new AuthorityStoreError("stale_owner");
		const mutation = acquireDurableFileMutationLockSync(this.context.path);
		try {
			const current = loadCommitted(this.context, true);
			if (!authorityHeadsEqual(current.head, this.accepted.head)) throw new AuthorityStoreError("stale_head");
			const state = current.parsed.state;
			if (state.epoch === null) return { dropped: 0 };
			const keepGrant = new Set<Sequence>();
			const keepTombstone = new Set<string>();
			for (const tombstone of state.tombstones.values()) {
				if (tombstone.expiresAtMs > now) {
					keepTombstone.add(tombstone.commandId);
					keepGrant.add(tombstone.grantSequence);
				}
			}
			const grants = [...state.grants.values()].filter(
				(grant) => !SETTLED_EFFECT_STATES.has(grant.state) || keepGrant.has(grant.token.grantSequence),
			);
			const tombstones = [...state.tombstones.values()].filter((stone) => keepTombstone.has(stone.commandId));
			const dropped = state.grants.size - grants.length + (state.tombstones.size - tombstones.length);
			if (dropped === 0) return { dropped: 0 };
			const snapshot = snapshotFromProjection({
				...state,
				grants: new Map(grants.map((grant) => [grant.token.grantSequence, grant])),
				tombstones: new Map(tombstones.map((stone) => [stone.commandId, stone])),
			});
			const record = materializeRecord(current.parsed.lastSeq + 1, current.parsed.lastHash, {
				kind: "authority-snapshot",
				archivedThroughSequence: current.parsed.lastSeq,
				continuesHash: current.parsed.lastHash,
				state: snapshot,
			});
			atomicRewriteFileSync(this.context.path, recordLine(record));
			this.context.hooks.afterAtomicRewrite?.();
			const fd = openSync(this.context.path, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
			let head: AuthorityHead;
			try {
				const stat = fstatSync(fd);
				head = Object.freeze({
					fileIdentity: fileIdentityOf(stat),
					size: stat.size,
					lastSeq: record.seq,
					lastHash: record.hash,
				});
			} finally {
				closeSync(fd);
			}
			publishHead(this.context, head);
			this.accepted = loadCommitted(this.context, false);
			return { dropped };
		} finally {
			mutation.release();
		}
	}

	/** Release the authority lease; further commits fail closed. */
	release(): void {
		if (this.released) return;
		this.released = true;
		this.lease.release();
	}
}
