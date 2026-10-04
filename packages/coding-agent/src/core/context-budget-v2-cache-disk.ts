/**
 * Workspace-layer disk persistence for the context-budget-v2 representation
 * cache.
 *
 * The in-memory provider (`context-budget-v2-cache-provider.ts`) dies with the
 * process, so every new session re-renders and re-compresses context it already
 * paid for. This provider keeps the same synchronous
 * `ContextBudgetCacheProviderV2` contract and adds a bounded, atomically
 * written JSON snapshot on disk.
 *
 * Scope: representation entries and negative entries only. Plan entries stay in
 * memory on purpose — a plan is session-scoped (its key folds in the
 * invalidation snapshot), so persisting it would only ever store misses.
 *
 * Safety: reads go through the same validator as the memory provider
 * (`validateContextBudgetRepresentationCacheEntryV2`), which re-checks source
 * hash, representation fingerprint, model, tokenizer, policy version and TTL.
 * A corrupt, truncated, oversized, or schema-mismatched snapshot is discarded
 * and the cache simply starts empty; a cache is never load-bearing for
 * correctness.
 */

import fs from "node:fs";
import path from "node:path";
import { containsCredentialShape } from "./compaction/transaction.ts";
import {
	type ContextCacheInvalidationSnapshot,
	createContextCacheInvalidationSnapshot,
} from "./context-budget-v2-cache-invalidation.ts";
import {
	type ContextBudgetCacheMemoryUsageV2,
	type ContextBudgetCacheStoresV2,
	contextBudgetCacheMemoryUsageV2,
	createContextBudgetCacheStoresV2,
} from "./context-budget-v2-cache-provider.ts";
import type {
	ContextBudgetCacheLayerV2,
	ContextBudgetCacheProviderV2,
	ContextBudgetNegativeCacheEntryV2,
	ContextBudgetPlanCacheEntryV2,
	ContextBudgetPlanCacheReadV2,
	ContextBudgetRepresentationCacheEntryV2,
	ContextBudgetRepresentationCacheReadV2,
} from "./context-budget-v2-types.ts";
import type { BoundedJsonLru } from "./performance-upgrade/bounded-json-lru.ts";

export const CONTEXT_BUDGET_DISK_CACHE_SCHEMA_VERSION = "context-budget-v2-diskcache-1" as const;

/** Default cap on persisted representation entries. */
export const DEFAULT_DISK_CACHE_MAX_ENTRIES = 2048;
/** Default cap on the persisted snapshot size. Oversized snapshots are dropped on load. */
export const DEFAULT_DISK_CACHE_MAX_BYTES = 32 * 1024 * 1024;
/** Default write-behind debounce. Collapses a burst of writes into a single flush. */
export const DEFAULT_DISK_CACHE_FLUSH_DEBOUNCE_MS = 750;
/** Default cap on a single persisted representation's text length. */
export const DEFAULT_DISK_CACHE_MAX_ENTRY_TEXT_LENGTH = 512 * 1024;

export interface DiskContextBudgetCacheOptionsV2 {
	/** Directory holding the snapshot file. Created on first flush. */
	readonly dir: string;
	/** Cache layer reported on reads. Defaults to `workspace`. */
	readonly layer?: ContextBudgetCacheLayerV2;
	/** Max persisted representation entries (LRU). */
	readonly maxEntries?: number;
	/** Max accepted snapshot size in bytes. */
	readonly maxBytes?: number;
	/** Max persisted text length for a single entry. */
	readonly maxEntryTextLength?: number;
	/** Write-behind debounce in ms. `0` flushes synchronously on every write. */
	readonly flushDebounceMs?: number;
	/** Injectable clock, for tests. */
	readonly now?: () => number;
	/** Accounted-byte caps of the in-memory stores, independent of the snapshot's `maxBytes`. */
	readonly representationMemoryBytes?: number;
	readonly planMemoryBytes?: number;
	readonly negativeMemoryBytes?: number;
}

interface DiskSnapshotFileV2 {
	readonly schemaVersion: typeof CONTEXT_BUDGET_DISK_CACHE_SCHEMA_VERSION;
	readonly representations: readonly (readonly [string, ContextBudgetRepresentationCacheEntryV2])[];
	readonly negatives: readonly (readonly [string, ContextBudgetNegativeCacheEntryV2])[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function containsCredentialShapeInValue(value: unknown): boolean {
	const pending: unknown[] = [value];
	const seen = new Set<object>();
	while (pending.length > 0) {
		const current = pending.pop();
		if (typeof current === "string") {
			if (containsCredentialShape(current)) return true;
			continue;
		}
		if (typeof current !== "object" || current === null || seen.has(current)) continue;
		seen.add(current);
		if (Array.isArray(current)) {
			pending.push(...current);
			continue;
		}
		for (const [key, nested] of Object.entries(current)) {
			if (containsCredentialShape(key)) return true;
			pending.push(nested);
		}
	}
	return false;
}

function isPersistableRepresentation(
	value: unknown,
	maxEntryTextLength: number,
): value is ContextBudgetRepresentationCacheEntryV2 {
	if (!isRecord(value)) return false;
	if (typeof value.kind !== "string") return false;
	if (typeof value.text !== "string" || value.text.length > maxEntryTextLength) return false;
	if (containsCredentialShapeInValue(value)) return false;
	const estimated = value.estimatedTokens;
	if (typeof estimated !== "number" || !Number.isFinite(estimated) || estimated < 0) return false;
	if (typeof value.fidelity !== "string") return false;
	if (typeof value.sourceHash !== "string" || value.sourceHash.length === 0) return false;
	if (typeof value.representationFingerprint !== "string") return false;
	if (typeof value.modelId !== "string") return false;
	if (typeof value.tokenizerId !== "string") return false;
	if (typeof value.policyVersion !== "string") return false;
	return true;
}

function isPersistableNegative(value: unknown): value is ContextBudgetNegativeCacheEntryV2 {
	return isRecord(value) && typeof value.reason === "string" && !containsCredentialShapeInValue(value);
}

/** Resident entries a snapshot may hold: a key without credential shape and a persistable value. */
function persistedEntries<T>(store: BoundedJsonLru<T>, persistable: (entry: T) => boolean): [string, T][] {
	return store.entries().filter(([key, entry]) => !containsCredentialShape(key) && persistable(entry));
}

/** Drop the least recently used half of a persisted list from the list and its store. */
function evictOldestHalf<T>(persisted: (readonly [string, T])[], store: BoundedJsonLru<T>): void {
	for (const [key] of persisted.splice(0, Math.ceil(persisted.length / 2))) store.delete(key);
}

/**
 * Create a disk backed workspace cache provider. Loading is synchronous and
 * best-effort: any failure yields an empty in-memory cache rather than throwing,
 * because a cache miss is always a legal outcome.
 */
export function createDiskContextBudgetCacheProviderV2(
	options: DiskContextBudgetCacheOptionsV2,
): DiskContextBudgetCacheProviderV2 {
	return new DiskContextBudgetCacheProviderV2(options);
}

export class DiskContextBudgetCacheProviderV2 implements ContextBudgetCacheProviderV2 {
	/**
	 * Resident stores. Only representations and negatives are persisted: plan keys are
	 * session-scoped, so persisting plans would store only misses.
	 */
	private readonly stores: ContextBudgetCacheStoresV2;
	private readonly layer: ContextBudgetCacheLayerV2;
	private readonly maxEntries: number;
	private readonly maxBytes: number;
	private readonly maxEntryTextLength: number;
	private readonly flushDebounceMs: number;
	private readonly now: () => number;
	private readonly snapshotPath: string;
	private invalidationSnapshot: ContextCacheInvalidationSnapshot | undefined;
	private dirty = false;
	private flushTimer: ReturnType<typeof setTimeout> | undefined;
	private loadError: string | undefined;

	constructor(options: DiskContextBudgetCacheOptionsV2) {
		this.layer = options.layer ?? "workspace";
		this.maxEntries = Math.max(1, options.maxEntries ?? DEFAULT_DISK_CACHE_MAX_ENTRIES);
		this.maxBytes = Math.max(1024, options.maxBytes ?? DEFAULT_DISK_CACHE_MAX_BYTES);
		this.maxEntryTextLength = Math.max(1, options.maxEntryTextLength ?? DEFAULT_DISK_CACHE_MAX_ENTRY_TEXT_LENGTH);
		this.flushDebounceMs = Math.max(0, options.flushDebounceMs ?? DEFAULT_DISK_CACHE_FLUSH_DEBOUNCE_MS);
		for (const limit of [this.maxEntries, this.maxBytes, this.maxEntryTextLength, this.flushDebounceMs]) {
			if (!Number.isSafeInteger(limit)) throw new RangeError("disk cache limits must be safe integers");
		}
		this.stores = createContextBudgetCacheStoresV2(this.maxEntries, {
			representationBytes: options.representationMemoryBytes ?? 16 * 1024 * 1024,
			planBytes: options.planMemoryBytes ?? 4 * 1024 * 1024,
			negativeBytes: options.negativeMemoryBytes ?? 512 * 1024,
		});
		this.now = options.now ?? Date.now;
		this.snapshotPath = path.join(options.dir, "representations.json");
		this.load();
	}

	/** Absolute path of the persisted snapshot. */
	get snapshotFilePath(): string {
		return this.snapshotPath;
	}

	/** Reason the on-disk snapshot was rejected, if it was. `undefined` on a clean load or a cold start. */
	get lastLoadError(): string | undefined {
		return this.loadError;
	}

	/** Number of representation entries currently held. */
	get size(): number {
		return this.stores.representations.size;
	}

	private load(): void {
		let raw: string;
		try {
			const stat = fs.statSync(this.snapshotPath);
			if (stat.size > this.maxBytes) {
				this.loadError = `snapshot exceeds maxBytes (${stat.size} > ${this.maxBytes})`;
				return;
			}
			raw = fs.readFileSync(this.snapshotPath, "utf8");
		} catch {
			// Cold start: no snapshot yet, or it is unreadable. Both are normal.
			return;
		}

		let parsed: unknown;
		try {
			parsed = JSON.parse(raw);
		} catch {
			this.loadError = "snapshot is not valid JSON";
			return;
		}
		if (!isRecord(parsed) || parsed.schemaVersion !== CONTEXT_BUDGET_DISK_CACHE_SCHEMA_VERSION) {
			this.loadError = "snapshot schema mismatch";
			return;
		}

		if (containsCredentialShapeInValue(parsed)) {
			this.loadError = "snapshot contains credential-shaped text";
			try {
				fs.rmSync(this.snapshotPath, { force: true });
			} catch {
				// The unsafe snapshot remains unreadable to this provider.
			}
			return;
		}

		const representations = Array.isArray(parsed.representations) ? parsed.representations : [];
		for (const pair of representations) {
			if (!Array.isArray(pair) || pair.length !== 2) continue;
			const [key, entry] = pair as [unknown, unknown];
			if (typeof key !== "string" || key.length === 0) continue;
			if (!isPersistableRepresentation(entry, this.maxEntryTextLength)) continue;
			this.stores.representations.set(key, entry);
		}

		const negatives = Array.isArray(parsed.negatives) ? parsed.negatives : [];
		for (const pair of negatives) {
			if (!Array.isArray(pair) || pair.length !== 2) continue;
			const [key, entry] = pair as [unknown, unknown];
			if (typeof key !== "string" || key.length === 0) continue;
			if (!isPersistableNegative(entry)) continue;
			this.stores.negatives.set(key, entry);
		}
	}

	private markDirty(): void {
		this.dirty = true;
		if (this.flushDebounceMs === 0) {
			this.flush();
			return;
		}
		if (this.flushTimer !== undefined) return;
		this.flushTimer = setTimeout(() => {
			this.flushTimer = undefined;
			this.flush();
		}, this.flushDebounceMs);
		this.flushTimer.unref?.();
	}

	/**
	 * Write the snapshot to disk atomically (temp file + rename). Best-effort:
	 * a failed flush leaves the previous snapshot intact and keeps the entries
	 * in memory. Returns `true` when a snapshot was written.
	 */
	flush(): boolean {
		if (this.flushTimer !== undefined) {
			clearTimeout(this.flushTimer);
			this.flushTimer = undefined;
		}
		if (!this.dirty) return false;
		const representations = persistedEntries(this.stores.representations, (entry) =>
			isPersistableRepresentation(entry, this.maxEntryTextLength),
		);
		const negatives = persistedEntries(this.stores.negatives, isPersistableNegative);
		let serialized: string;
		for (;;) {
			const snapshot: DiskSnapshotFileV2 = {
				schemaVersion: CONTEXT_BUDGET_DISK_CACHE_SCHEMA_VERSION,
				representations,
				negatives,
			};
			try {
				serialized = JSON.stringify(snapshot);
			} catch {
				return false;
			}
			if (Buffer.byteLength(serialized, "utf8") <= this.maxBytes) break;
			// Shrink iteratively: oldest persisted representations first, then negatives, so an
			// overflow of negative entries alone still converges instead of failing every flush.
			if (representations.length > 0) evictOldestHalf(representations, this.stores.representations);
			else if (negatives.length > 0) evictOldestHalf(negatives, this.stores.negatives);
			else return false;
		}
		const tempPath = `${this.snapshotPath}.${process.pid}.tmp`;
		try {
			fs.mkdirSync(path.dirname(this.snapshotPath), { recursive: true });
			fs.writeFileSync(tempPath, serialized, { encoding: "utf8", mode: 0o600 });
			fs.renameSync(tempPath, this.snapshotPath);
			this.dirty = false;
			return true;
		} catch {
			try {
				fs.rmSync(tempPath, { force: true });
			} catch {
				// The temp file is unlinkable; nothing further to do.
			}
			return false;
		}
	}

	/** Cancel any pending flush and persist immediately. Safe to call more than once. */
	close(): void {
		this.flush();
	}

	/** Content-free counters of the in-memory stores, for instrumentation. */
	getMemoryUsageSnapshot(): ContextBudgetCacheMemoryUsageV2 {
		return contextBudgetCacheMemoryUsageV2(this.stores);
	}

	getInvalidationSnapshot(): ContextCacheInvalidationSnapshot | undefined {
		return this.invalidationSnapshot;
	}

	setInvalidationSnapshot(snapshot: ContextCacheInvalidationSnapshot): void {
		this.invalidationSnapshot = createContextCacheInvalidationSnapshot({
			forkId: snapshot.forkId,
			worktreeFingerprint: snapshot.worktreeFingerprint,
			activeModelId: snapshot.activeModelId,
			compactionModelId: snapshot.compactionModelId,
			globalEpoch: snapshot.globalEpoch,
			transcriptRepair: snapshot.counters.transcriptRepair,
			toolResultDisposition: snapshot.counters.toolResultDisposition,
			evidenceReceipt: snapshot.counters.evidenceReceipt,
			userSteering: snapshot.counters.userSteering,
			settings: snapshot.counters.settings,
		});
	}

	readRepresentation(key: string): ContextBudgetRepresentationCacheReadV2 | undefined {
		const entry = this.stores.representations.get(key);
		return entry ? { entry, layer: this.layer } : undefined;
	}

	writeRepresentation(input: { readonly key: string; readonly entry: ContextBudgetRepresentationCacheEntryV2 }): void {
		// Only an accepted entry is plain data, so only then can it be inspected without running caller code.
		const persistable =
			this.stores.representations.set(input.key, input.entry) &&
			!containsCredentialShape(input.key) &&
			isPersistableRepresentation(input.entry, this.maxEntryTextLength);
		if (persistable || fs.existsSync(this.snapshotPath)) this.markDirty();
	}

	deleteRepresentation(key: string): void {
		if (this.stores.representations.delete(key)) this.markDirty();
	}

	readNegativeRepresentation(key: string): ContextBudgetNegativeCacheEntryV2 | undefined {
		return this.stores.negatives.get(key);
	}

	writeNegativeRepresentation(input: { readonly key: string; readonly reason: string }): void {
		this.stores.negatives.set(input.key, { reason: input.reason, createdAtEpochMs: this.now(), layer: this.layer });
		this.markDirty();
	}

	deleteNegativeRepresentation(key: string): void {
		if (this.stores.negatives.delete(key)) this.markDirty();
	}

	readPlan(key: string): ContextBudgetPlanCacheReadV2 | undefined {
		const entry = this.stores.plans.get(key);
		return entry ? { entry, layer: "session" } : undefined;
	}

	writePlan(input: { readonly key: string; readonly entry: ContextBudgetPlanCacheEntryV2 }): void {
		this.stores.plans.set(input.key, input.entry);
	}

	deletePlan(key: string): void {
		this.stores.plans.delete(key);
	}
}
