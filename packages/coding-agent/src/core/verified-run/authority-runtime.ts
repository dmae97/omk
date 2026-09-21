import { basename, dirname, resolve } from "node:path";
import type { Sequence } from "../../coordination/types.ts";
import type { AuthorityGrantRecord } from "./authority-events.ts";
import {
	type AuthorityJournalInspection,
	type AuthorityProbe,
	AuthorityStore,
	type AuthorityStoreHooks,
	authorityStorePath,
} from "./authority-store.ts";
import { probeNamespace } from "./namespace-identity.ts";
import { type AuthorityStatus, deriveAuthorityStatus } from "./run-status.ts";

/**
 * Runtime bridge between the verified-run execution path and the durable
 * `AuthorityStore` (WP03 §8 wiring).
 *
 * `RunAuthority` is the handle the dispatch boundary needs: the open store
 * plus the session identity grants are minted under. `openRunAuthorityStore`
 * is the restart boundary — it advances (or adopts) the durable epoch and
 * finishes reconciliation before any new dispatch may be admitted. The
 * `RunAuthorityPool` keeps one open store per coordinator while work is in
 * flight, because the `"authority"` scope lease is fail-fast: two
 * `AuthorityStore.open` calls on the same state root can never coexist, and a
 * synchronous lock wait cannot be used inside one process.
 */

/**
 * Reconcile probe for the verified-run boundary. A recorded
 * `NamespaceIdentity` is probed against the real execution boundary. A
 * missing identity is not a termination witness: a lost writer lease does
 * not prove a Git child or hook has exited, and the ref outbox is not that
 * proof either. Those grants stay `"unknown"` until a supervisor witness
 * settles them (F07).
 */
export function runAuthorityProbe(grant: AuthorityGrantRecord): ReturnType<AuthorityProbe> {
	if (!grant.identity) return "unknown";
	const result = probeNamespace(grant.identity);
	if (result === "gone") return "terminated";
	if (result === "alive") return "alive";
	return "unknown";
}

/** Total admissible weight of concurrently unsettled grants for one state root. */
export const RUN_AUTHORITY_CAPACITY = 16;

export interface OpenRunAuthorityStoreOptions {
	readonly capacity?: number;
	readonly hooks?: AuthorityStoreHooks;
	readonly probe?: AuthorityProbe;
}

/**
 * Open the state root's authority store and reconcile it before returning.
 * The caller owns the store and must `release()` it; `acquire` stays refused
 * (`reconcile_pending`) until this function has run.
 */
export function openRunAuthorityStore(runPath: string, options: OpenRunAuthorityStoreOptions = {}): AuthorityStore {
	const store = AuthorityStore.open(authorityStorePath(dirname(runPath)), {
		capacity: options.capacity ?? RUN_AUTHORITY_CAPACITY,
		probe: options.probe ?? runAuthorityProbe,
		...(options.hooks ? { hooks: options.hooks } : {}),
	});
	try {
		store.reconcile();
	} catch (error) {
		try {
			store.release();
		} catch (releaseError) {
			throw new AggregateError(
				[error, releaseError instanceof Error ? releaseError : new Error(String(releaseError))],
				"Authority store reconcile cleanup failed",
			);
		}
		throw error;
	}
	return store;
}

/** Handle the dispatch boundary records through. */
export interface RunAuthority {
	readonly store: AuthorityStore;
	readonly sessionId: string;
	readonly incarnation: Sequence;
}

/** Read-only view of the durable authority store under a state root. */
export interface AuthorityStoreView {
	readonly path: string;
	readonly status: AuthorityStatus;
	readonly records: AuthorityJournalInspection["records"];
}

/**
 * The durable authority store under this state root: which grant holds
 * which claims, why it is quarantined, and whether termination was
 * witnessed. Read-only; a missing store reads as an empty projection.
 */
export function inspectRunAuthority(stateRoot: string): AuthorityStoreView {
	const path = authorityStorePath(resolve(stateRoot));
	const inspection = AuthorityStore.inspectJournal(path);
	return Object.freeze({
		path,
		status: deriveAuthorityStatus(
			inspection.state,
			inspection.records.map((record) => record.event),
		),
		records: inspection.records,
	});
}

/** Standalone open+reconcile+register for entry points without a pool (publish, tests). */
export function openRunAuthority(runPath: string, options: OpenRunAuthorityStoreOptions = {}): RunAuthority {
	const store = openRunAuthorityStore(runPath, options);
	const sessionId = basename(runPath);
	try {
		return Object.freeze({ store, sessionId, incarnation: store.register(sessionId) });
	} catch (error) {
		try {
			store.release();
		} catch (releaseError) {
			throw new AggregateError(
				[error, releaseError instanceof Error ? releaseError : new Error(String(releaseError))],
				"Authority session cleanup failed",
			);
		}
		throw error;
	}
}

/**
 * One open store per coordinator, ref-counted across in-flight operations.
 * The authority lease is fail-fast and cross-process, so a coordinator-level
 * pool is what lets concurrent operations share the single-writer boundary:
 * the first operation opens (restart reconcile runs there), the last one
 * releases. Session incarnations are registered once per run id per open
 * lifetime — a later operation under a new epoch re-registers and fences the
 * previous incarnation's tokens.
 */
export class RunAuthorityPool {
	private readonly options: OpenRunAuthorityStoreOptions;
	private tail: Promise<void> = Promise.resolve();
	private store: AuthorityStore | null = null;
	private users = 0;
	private readonly incarnations = new Map<string, Sequence>();

	constructor(options: OpenRunAuthorityStoreOptions = {}) {
		this.options = options;
	}

	private step<T>(fn: () => T): Promise<T> {
		const run = this.tail.then(fn);
		this.tail = run.then(
			() => {},
			() => {},
		);
		return run;
	}

	private async enter(runPath: string, sessionId: string): Promise<RunAuthority> {
		return this.step(() => {
			if (this.users === 0) {
				this.store = openRunAuthorityStore(runPath, this.options);
				this.incarnations.clear();
			}
			try {
				let incarnation = this.incarnations.get(sessionId);
				if (!incarnation) {
					if (!this.store) throw new Error("authority store missing");
					incarnation = this.store.register(sessionId);
					this.incarnations.set(sessionId, incarnation);
				}
				const store = this.store;
				if (!store) throw new Error("authority store missing");
				this.users += 1;
				return { store, sessionId, incarnation };
			} catch (error) {
				if (this.users === 0 && this.store) {
					try {
						this.store.release();
					} finally {
						this.store = null;
						this.incarnations.clear();
					}
				}
				throw error;
			}
		});
	}

	private async exit(): Promise<void> {
		await this.step(() => {
			if (this.users > 0) this.users -= 1;
			if (this.users === 0 && this.store) {
				const store = this.store;
				this.store = null;
				this.incarnations.clear();
				store.release();
			}
		});
	}

	/** Run `work` while holding one shared store slot; the slot releases when every user exits. */
	async run<T>(runPath: string, sessionId: string, work: (authority: RunAuthority) => T | Promise<T>): Promise<T> {
		const authority = await this.enter(runPath, sessionId);
		try {
			return await work(authority);
		} finally {
			await this.exit();
		}
	}
}
