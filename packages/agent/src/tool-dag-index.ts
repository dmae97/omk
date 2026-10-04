/**
 * Conservative candidate index for the existing source-directed conflict graph.
 * This changes neither the authoritative predicate nor the graph's edges.
 * POSIX lexical/real paths use a prefix trie. Other path forms use a broad bucket.
 * Every candidate is checked by the caller's existing conflict predicate.
 */
import { canonicalizeLexicalPath } from "./path-segments.ts";
import type { ToolClaimResolution, ToolResourceClaim } from "./tool-resource-claims.ts";

interface Entry {
	readonly resolution: ToolClaimResolution;
}
interface Bucket {
	readonly reads: Set<number>;
	readonly writes: Set<number>;
}
interface Trie {
	readonly exact: Bucket;
	readonly subtree: Bucket;
	readonly children: Map<string, Trie>;
}
export interface DagIndexStats {
	readonly predicateCalls: number;
	readonly memberships: number;
	readonly fallback: boolean;
}
export interface DagIndexOptions {
	/** Memory proxy, counting distinct index memberships. Zero selects the oracle. */
	readonly maxMemberships?: number;
}
const bucket = (): Bucket => ({ reads: new Set(), writes: new Set() });
const trie = (): Trie => ({ exact: bucket(), subtree: bucket(), children: new Map() });
class IndexCapacityExceeded extends Error {}

/** Only index path forms for which prefix equivalence is proved by path-segments.ts. */
function posixParts(raw: string): string[] | undefined {
	if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\") || raw.length > 131_072) return undefined;
	const canonical = canonicalizeLexicalPath(raw);
	if (canonical === null) return undefined;
	const parts = canonical.split("/").filter(Boolean);
	return parts.length > 4096 ? undefined : parts.map((part) => part.toLowerCase());
}

export function buildIndexedDagDependencies<T extends Entry>(
	entries: readonly T[],
	conflicts: (earlier: T, current: T) => boolean,
	options: DagIndexOptions = {},
): { dependencies: number[][]; stats: DagIndexStats } {
	const maxMemberships = options.maxMemberships ?? 131_072;
	if (!Number.isSafeInteger(maxMemberships) || maxMemberships < 0) throw new RangeError("Invalid DAG index budget");
	let predicateCalls = 0;
	let memberships = 0;
	const check = (a: number, b: number): boolean => {
		predicateCalls++;
		return conflicts(entries[a], entries[b]);
	};
	const oracle = (): number[][] =>
		entries.map((_, current) => {
			const blockers: number[] = [];
			for (let earlier = 0; earlier < current; earlier++) if (check(earlier, current)) blockers.push(earlier);
			return blockers;
		});
	if (
		entries.every(
			({ resolution }) => resolution.kind === "claims" && resolution.claims.every((c) => c.access === "read"),
		)
	) {
		return { dependencies: entries.map(() => []), stats: { predicateCalls, memberships, fallback: false } };
	}
	if (maxMemberships === 0) return { dependencies: oracle(), stats: { predicateCalls, memberships, fallback: true } };

	const roots = trie();
	const allPaths = bucket();
	const broadPaths = bucket();
	const inodes = new Map<string, Bucket>();
	const exact = new Map<string, Map<string, Bucket>>();
	const exclusive = new Set<number>();
	const add = (set: Set<number>, index: number): void => {
		if (set.has(index)) return;
		if (memberships >= maxMemberships) throw new IndexCapacityExceeded();
		set.add(index);
		memberships++;
	};
	const put = (where: Bucket, access: string, index: number): void =>
		add(access === "read" ? where.reads : where.writes, index);
	const collect = (where: Bucket | undefined, access: string, into: Set<number>): void => {
		if (!where) return;
		for (const id of where.writes) into.add(id);
		if (access !== "read") for (const id of where.reads) into.add(id);
	};
	const queryPath = (parts: string[], access: string, into: Set<number>): void => {
		let node = roots;
		collect(node.exact, access, into);
		for (const part of parts) {
			const child = node.children.get(part);
			if (!child) return;
			node = child;
			collect(node.exact, access, into);
		}
		collect(node.subtree, access, into);
	};
	const insertPath = (parts: string[], access: string, index: number): void => {
		let node = roots;
		put(node.subtree, access, index);
		for (const part of parts) {
			let child = node.children.get(part);
			if (!child) {
				if (memberships >= maxMemberships) throw new IndexCapacityExceeded();
				child = trie();
				node.children.set(part, child);
			}
			node = child;
			put(node.subtree, access, index);
		}
		put(node.exact, access, index);
	};
	const pathKeys = (claim: Extract<ToolResourceClaim, { kind: "path" }>): string[] =>
		claim.realKey === undefined || claim.realKey === claim.key ? [claim.key] : [claim.key, claim.realKey];
	const dependencies: number[][] = [];
	try {
		for (let current = 0; current < entries.length; current++) {
			const resolution = entries[current].resolution;
			const isExclusive = resolution.kind === "exclusive" || resolution.claims.some((c) => c.access === "exclusive");
			const candidates = new Set(exclusive);
			if (isExclusive) {
				for (let earlier = 0; earlier < current; earlier++) candidates.add(earlier);
			} else if (resolution.kind === "claims") {
				for (const claim of resolution.claims) {
					if (claim.kind !== "path") {
						collect(exact.get(claim.kind)?.get(claim.key), claim.access, candidates);
						continue;
					}
					const parts = pathKeys(claim).map(posixParts);
					if (parts.some((p) => p === undefined)) collect(allPaths, claim.access, candidates);
					else {
						collect(broadPaths, claim.access, candidates);
						for (const p of parts) if (p) queryPath(p, claim.access, candidates);
					}
					if (claim.inodeKey !== undefined) collect(inodes.get(claim.inodeKey), claim.access, candidates);
				}
			}
			dependencies.push([...candidates].sort((a, b) => a - b).filter((earlier) => check(earlier, current)));
			if (isExclusive) {
				add(exclusive, current);
				continue;
			}
			if (resolution.kind !== "claims") continue;
			for (const claim of resolution.claims) {
				if (claim.kind !== "path") {
					let kind = exact.get(claim.kind);
					if (!kind) {
						kind = new Map();
						exact.set(claim.kind, kind);
					}
					let values = kind.get(claim.key);
					if (!values) {
						values = bucket();
						kind.set(claim.key, values);
					}
					put(values, claim.access, current);
					continue;
				}
				put(allPaths, claim.access, current);
				const parts = pathKeys(claim).map(posixParts);
				if (parts.some((p) => p === undefined)) put(broadPaths, claim.access, current);
				else for (const p of parts) if (p) insertPath(p, claim.access, current);
				if (claim.inodeKey !== undefined) {
					let values = inodes.get(claim.inodeKey);
					if (!values) {
						values = bucket();
						inodes.set(claim.inodeKey, values);
					}
					put(values, claim.access, current);
				}
			}
		}
		return { dependencies, stats: { predicateCalls, memberships, fallback: false } };
	} catch (error) {
		if (!(error instanceof IndexCapacityExceeded)) throw error;
		// No partial graph escapes. Deterministic recomputation uses the original predicate.
		return { dependencies: oracle(), stats: { predicateCalls, memberships, fallback: true } };
	}
}
