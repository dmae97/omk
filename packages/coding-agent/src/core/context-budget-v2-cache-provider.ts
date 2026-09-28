import {
	type ContextCacheInvalidationSnapshot,
	createContextCacheInvalidationSnapshot,
} from "./context-budget-v2-cache-invalidation.ts";
import type {
	ContextBudgetCacheLayerV2,
	ContextBudgetCacheProviderV2,
	ContextBudgetNegativeCacheEntryV2,
	ContextBudgetPlanCacheEntryV2,
	ContextBudgetPlanCacheReadV2,
	ContextBudgetRepresentationCacheEntryV2,
	ContextBudgetRepresentationCacheReadV2,
} from "./context-budget-v2-types.ts";
import { BoundedJsonLru, type CacheStats } from "./performance-upgrade/bounded-json-lru.ts";

const DEFAULT_MAX_ENTRIES_PER_CACHE = 256;
const MIB = 1024 * 1024;

/** Accounted-byte caps per store; see `BoundedJsonLru` for what the accounting covers. */
export interface ContextBudgetCacheMemoryLimitsV2 {
	readonly representationBytes?: number;
	readonly planBytes?: number;
	readonly negativeBytes?: number;
}

export type ContextBudgetCacheMemoryUsageV2 = Readonly<Record<"representations" | "negatives" | "plans", CacheStats>>;

/** The three bounded in-memory stores every provider keeps. */
export interface ContextBudgetCacheStoresV2 {
	readonly representations: BoundedJsonLru<ContextBudgetRepresentationCacheEntryV2>;
	readonly negatives: BoundedJsonLru<ContextBudgetNegativeCacheEntryV2>;
	readonly plans: BoundedJsonLru<ContextBudgetPlanCacheEntryV2>;
}

/**
 * Stores capped by entry count and accounted bytes. A plan carries every selected representation's
 * text, so one plan may use its whole store; representation and negative entries have fixed caps.
 */
export function createContextBudgetCacheStoresV2(
	maxEntries: number,
	bytes: Required<ContextBudgetCacheMemoryLimitsV2>,
): ContextBudgetCacheStoresV2 {
	return {
		representations: new BoundedJsonLru({ maxEntries, maxBytes: bytes.representationBytes, maxEntryBytes: 2 * MIB }),
		negatives: new BoundedJsonLru({ maxEntries, maxBytes: bytes.negativeBytes, maxEntryBytes: 16 * 1024 }),
		plans: new BoundedJsonLru({ maxEntries, maxBytes: bytes.planBytes, maxEntryBytes: bytes.planBytes }),
	};
}

/** Content-free counters per store, for instrumentation. */
export function contextBudgetCacheMemoryUsageV2(stores: ContextBudgetCacheStoresV2): ContextBudgetCacheMemoryUsageV2 {
	return {
		representations: stores.representations.stats(),
		negatives: stores.negatives.stats(),
		plans: stores.plans.stats(),
	};
}

export function createMemoryContextBudgetCacheProviderV2(
	layer: ContextBudgetCacheLayerV2 = "turn",
): ContextBudgetCacheProviderV2 {
	return new MemoryContextBudgetCacheProviderV2(layer);
}

/**
 * In-process cache bounded by entry count and by accounted bytes per store. Entries are held as
 * immutable JSON, so callers always receive a copy and cannot corrupt a later read.
 */
export class MemoryContextBudgetCacheProviderV2 implements ContextBudgetCacheProviderV2 {
	private readonly stores: ContextBudgetCacheStoresV2;
	private readonly layer: ContextBudgetCacheLayerV2;
	private invalidationSnapshot: ContextCacheInvalidationSnapshot | undefined;

	constructor(
		layer: ContextBudgetCacheLayerV2,
		maxEntries = DEFAULT_MAX_ENTRIES_PER_CACHE,
		limits: ContextBudgetCacheMemoryLimitsV2 = {},
	) {
		this.layer = layer;
		this.stores = createContextBudgetCacheStoresV2(maxEntries, {
			representationBytes: limits.representationBytes ?? 8 * MIB,
			planBytes: limits.planBytes ?? 2 * MIB,
			negativeBytes: limits.negativeBytes ?? MIB / 4,
		});
	}

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
		this.stores.representations.set(input.key, input.entry);
	}

	deleteRepresentation(key: string): void {
		this.stores.representations.delete(key);
	}

	readNegativeRepresentation(key: string): ContextBudgetNegativeCacheEntryV2 | undefined {
		return this.stores.negatives.get(key);
	}

	writeNegativeRepresentation(input: { readonly key: string; readonly reason: string }): void {
		this.stores.negatives.set(input.key, { reason: input.reason, createdAtEpochMs: Date.now(), layer: this.layer });
	}

	deleteNegativeRepresentation(key: string): void {
		this.stores.negatives.delete(key);
	}

	readPlan(key: string): ContextBudgetPlanCacheReadV2 | undefined {
		const entry = this.stores.plans.get(key);
		return entry ? { entry, layer: this.layer } : undefined;
	}

	writePlan(input: { readonly key: string; readonly entry: ContextBudgetPlanCacheEntryV2 }): void {
		this.stores.plans.set(input.key, input.entry);
	}

	deletePlan(key: string): void {
		this.stores.plans.delete(key);
	}
}
