import { types } from "node:util";

/**
 * Byte-bounded LRU of JSON data transfer objects for in-process caches.
 *
 * Each entry is encoded in one pass into an immutable JSON string, so a writer or reader mutating
 * its own object can change neither the cached value nor the byte accounting. Accounting counts
 * UTF-16 code units: `2 * key.length + 2 * json.length + 128` per entry. That bounds the cache's
 * retained strings; it is not a V8 heap measurement and not a process RSS limit.
 *
 * Only plain JSON data is cached. Accessors, `toJSON` (own or inherited, enumerable or not),
 * proxies, cycles, symbol keys, class instances (including `Map`, `Date` and `Array` subclasses),
 * functions, bigints, non-finite numbers, sparse or decorated arrays and `undefined` array elements
 * make the write a miss. Encoding reads each own data property once and never runs caller code, so
 * what is validated is exactly what is stored. A rejected overwrite drops the key rather than
 * serving its previous value.
 */
export interface CacheLimits {
	readonly maxEntries: number;
	readonly maxBytes: number;
	readonly maxEntryBytes: number;
	readonly maxNodes?: number;
	readonly maxDepth?: number;
}

/** Content-free counters for instrumentation; never includes keys or values. */
export interface CacheStats {
	readonly entries: number;
	readonly accountedBytes: number;
	readonly maxBytes: number;
	readonly hits: number;
	readonly misses: number;
	readonly evictions: number;
	readonly rejected: number;
}

interface Cell {
	readonly json: string;
	readonly bytes: number;
}

const ENTRY_OVERHEAD_BYTES = 128;
const DEFAULT_MAX_NODES = 100_000;
const DEFAULT_MAX_DEPTH = 64;

function assertLimit(name: string, value: number, min: number): void {
	if (!Number.isSafeInteger(value) || value < min) throw new RangeError(`${name} must be an integer >= ${min}`);
}

function ownDataValue(container: object, key: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(container, key);
	if (!descriptor || !("value" in descriptor)) throw new TypeError("accessor property");
	return descriptor.value;
}

/** Encode plain JSON data in at most `limitChars` UTF-16 units, or return `undefined`. */
function encodePlainJson(value: unknown, limitChars: number, maxNodes: number, maxDepth: number): string | undefined {
	let nodes = 0;
	let chars = 0;
	const ancestors = new Set<object>();
	const charge = (text: string): string => {
		chars += text.length;
		if (chars > limitChars) throw new RangeError("cache value too large");
		return text;
	};
	const encode = (current: unknown, depth: number): string => {
		nodes++;
		if (nodes > maxNodes || depth > maxDepth) throw new RangeError("cache value too complex");
		if (current === null) return charge("null");
		if (typeof current === "boolean" || typeof current === "string") return charge(JSON.stringify(current));
		if (typeof current === "number") {
			if (!Number.isFinite(current)) throw new TypeError("non-finite number");
			return charge(JSON.stringify(current));
		}
		if (typeof current !== "object") throw new TypeError("not JSON data");
		if (types.isProxy(current)) throw new TypeError("proxy");
		const isArray = Array.isArray(current);
		const prototype: unknown = Object.getPrototypeOf(current);
		const plain = isArray ? prototype === Array.prototype : prototype === Object.prototype || prototype === null;
		if (!plain) throw new TypeError("not plain data");
		// JSON.stringify would call any reachable toJSON, including a non-enumerable or inherited one.
		if ("toJSON" in current) throw new TypeError("custom toJSON");
		if (Object.getOwnPropertySymbols(current).length > 0) throw new TypeError("symbol property");
		if (ancestors.has(current)) throw new TypeError("cycle");
		ancestors.add(current);
		const keys = Object.keys(current);
		const parts: string[] = [];
		if (isArray) {
			// Index keys come first in ascending order, so a hole or an extra named key shows at the end.
			if (keys.length !== current.length || (keys.length > 0 && keys.at(-1) !== String(keys.length - 1))) {
				throw new TypeError("sparse or decorated array");
			}
			for (const key of keys) {
				const element = ownDataValue(current, key);
				if (element === undefined) throw new TypeError("undefined array element");
				parts.push(encode(element, depth + 1));
			}
		} else {
			for (const key of keys) {
				const field = ownDataValue(current, key);
				// JSON omits an undefined object field.
				if (field !== undefined) parts.push(`${charge(`${JSON.stringify(key)}:`)}${encode(field, depth + 1)}`);
			}
		}
		ancestors.delete(current);
		charge(`[]${",".repeat(Math.max(0, parts.length - 1))}`);
		return isArray ? `[${parts.join(",")}]` : `{${parts.join(",")}}`;
	};
	try {
		return encode(value, 0);
	} catch {
		return undefined;
	}
}

export class BoundedJsonLru<T> {
	private readonly cells = new Map<string, Cell>();
	private readonly limits: Required<CacheLimits>;
	private bytes = 0;
	private hits = 0;
	private misses = 0;
	private evictions = 0;
	private rejected = 0;

	constructor(limits: CacheLimits) {
		this.limits = {
			maxEntries: limits.maxEntries,
			maxBytes: limits.maxBytes,
			maxEntryBytes: limits.maxEntryBytes,
			maxNodes: limits.maxNodes ?? DEFAULT_MAX_NODES,
			maxDepth: limits.maxDepth ?? DEFAULT_MAX_DEPTH,
		};
		assertLimit("maxEntries", this.limits.maxEntries, 0);
		assertLimit("maxBytes", this.limits.maxBytes, 0);
		assertLimit("maxEntryBytes", this.limits.maxEntryBytes, 0);
		assertLimit("maxNodes", this.limits.maxNodes, 1);
		assertLimit("maxDepth", this.limits.maxDepth, 1);
	}

	get size(): number {
		return this.cells.size;
	}

	/** A fresh copy of the value, promoted to most recently used. */
	get(key: string): T | undefined {
		const cell = this.cells.get(key);
		if (!cell) {
			this.misses++;
			return undefined;
		}
		this.cells.delete(key);
		this.cells.set(key, cell);
		this.hits++;
		return JSON.parse(cell.json) as T;
	}

	/** Store an immutable copy of `value`; returns `false` (and drops `key`) when it is rejected. */
	set(key: string, value: T): boolean {
		const limitBytes = Math.min(this.limits.maxEntryBytes, this.limits.maxBytes);
		const keyBytes = 2 * key.length + ENTRY_OVERHEAD_BYTES;
		const json =
			this.limits.maxEntries > 0 && keyBytes < limitBytes
				? encodePlainJson(
						value,
						Math.floor((limitBytes - keyBytes) / 2),
						this.limits.maxNodes,
						this.limits.maxDepth,
					)
				: undefined;
		this.delete(key);
		if (json === undefined) {
			this.rejected++;
			return false;
		}
		const bytes = keyBytes + 2 * json.length;
		for (const oldest of this.cells.keys()) {
			if (this.cells.size < this.limits.maxEntries && this.bytes + bytes <= this.limits.maxBytes) break;
			this.delete(oldest);
			this.evictions++;
		}
		this.cells.set(key, { json, bytes });
		this.bytes += bytes;
		return true;
	}

	delete(key: string): boolean {
		const cell = this.cells.get(key);
		if (!cell) return false;
		this.bytes -= cell.bytes;
		return this.cells.delete(key);
	}

	/**
	 * Fresh copies from least to most recently used, taken when called. A snapshot rather than a
	 * live iterator: `get` re-inserts the key it promotes, which a live Map iterator would revisit.
	 */
	entries(): [string, T][] {
		return Array.from(this.cells, ([key, cell]): [string, T] => [key, JSON.parse(cell.json) as T]);
	}

	stats(): CacheStats {
		return {
			entries: this.cells.size,
			accountedBytes: this.bytes,
			maxBytes: this.limits.maxBytes,
			hits: this.hits,
			misses: this.misses,
			evictions: this.evictions,
			rejected: this.rejected,
		};
	}
}
