import { describe, expect, it } from "vitest";
import { BoundedJsonLru } from "../src/core/performance-upgrade/bounded-json-lru.ts";

/** 32-bit LCG in exact integer arithmetic (a float multiply would round away the low bits). */
function seeded(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
		return state / 4294967296;
	};
}

describe("BoundedJsonLru", () => {
	it("holds the entry, byte and single-entry limits under a generated workload", () => {
		const random = seeded(20260928);
		const limits = { maxEntries: 12, maxBytes: 6_000, maxEntryBytes: 2_500 };
		const cache = new BoundedJsonLru<{ readonly text: string; readonly n: number }>(limits);
		const model = new Map<string, { readonly text: string; readonly n: number }>();
		for (let step = 0; step < 2_000; step++) {
			const key = `k${Math.floor(random() * 30)}`;
			if (random() < 0.6) {
				const value = { text: "v".repeat(Math.floor(random() * 1_400)), n: step };
				cache.set(key, value);
				model.set(key, value);
			} else {
				const read = cache.get(key);
				// A hit is always the last value written for that key, never a stale or foreign one.
				if (read) expect(read).toEqual(model.get(key));
			}
			const stats = cache.stats();
			expect(stats.entries).toBeLessThanOrEqual(limits.maxEntries);
			expect(stats.accountedBytes).toBeLessThanOrEqual(limits.maxBytes);
		}
		const cellBytes = cache.entries().map(([key, value]) => 2 * key.length + 128 + 2 * JSON.stringify(value).length);
		for (const bytes of cellBytes) expect(bytes).toBeLessThanOrEqual(limits.maxEntryBytes);
		expect(cache.stats().accountedBytes).toBe(cellBytes.reduce((sum, bytes) => sum + bytes, 0));
		expect(cache.stats().hits).toBeGreaterThan(0);
		expect(cache.stats().rejected).toBeGreaterThan(0);
	});

	it("returns a snapshot from entries() so reading through it cannot loop", () => {
		const cache = new BoundedJsonLru<number>({ maxEntries: 3, maxBytes: 10_000, maxEntryBytes: 1_000 });
		cache.set("a", 1);
		cache.set("b", 2);
		cache.set("c", 3);

		const seen = cache.entries().map(([key]) => [key, cache.get(key)]);

		expect(seen).toEqual([
			["a", 1],
			["b", 2],
			["c", 3],
		]);
	});

	it("prices array elements by their JSON text, not by their index keys", () => {
		// 300 zeros serialize to 600 characters; counting "0".."299" as keys would add 790 more.
		const cache = new BoundedJsonLru<number[]>({ maxEntries: 1, maxBytes: 1_500, maxEntryBytes: 1_500 });
		cache.set(
			"k",
			Array.from({ length: 300 }, () => 0),
		);

		expect(cache.get("k")).toHaveLength(300);
	});

	it("evicts least-recently-used entries first", () => {
		const cache = new BoundedJsonLru<number>({ maxEntries: 2, maxBytes: 10_000, maxEntryBytes: 1_000 });
		cache.set("a", 1);
		cache.set("b", 2);
		cache.get("a");
		cache.set("c", 3);

		expect(cache.entries().map(([key]) => key)).toEqual(["a", "c"]);
		expect(cache.stats().evictions).toBe(1);
	});

	it("rejects exotic, cyclic, sparse and oversized values", () => {
		const cache = new BoundedJsonLru<unknown>({ maxEntries: 8, maxBytes: 10_000, maxEntryBytes: 1_000 });
		const cyclic: { self?: unknown } = {};
		cyclic.self = cyclic;
		const sparse: unknown[] = [];
		sparse[3] = 1;
		// Same key count as length: one hole plus one named key.
		const holedAndNamed: unknown[] = [];
		holedAndNamed[1] = 1;
		Object.assign(holedAndNamed, { named: true });
		const rejected: unknown[] = [
			cyclic,
			sparse,
			holedAndNamed,
			[undefined],
			new Date(0),
			{ fn: () => 1 },
			{ big: 1n },
			{ nested: { value: Number.POSITIVE_INFINITY } },
			{ text: "x".repeat(1_000) },
			Object.assign([1], { extra: true }),
			{ [Symbol("s")]: 1 },
		];
		rejected.forEach((value, index) => {
			cache.set(`r${index}`, value);
		});

		expect(cache.size).toBe(0);
		expect(cache.stats().rejected).toBe(rejected.length);
	});

	it("never runs caller code while validating: toJSON, accessors and proxies are misses", () => {
		const cache = new BoundedJsonLru<unknown>({ maxEntries: 8, maxBytes: 64 * 1024, maxEntryBytes: 16 * 1024 });
		let calls = 0;
		const hiddenToJson = { text: "validated" };
		Object.defineProperty(hiddenToJson, "toJSON", {
			enumerable: false,
			value: () => {
				calls++;
				return { text: "never validated" };
			},
		});
		const hiddenToJsonGetter = { text: "validated" };
		Object.defineProperty(hiddenToJsonGetter, "toJSON", {
			enumerable: false,
			get: () => {
				calls++;
				return undefined;
			},
		});
		const proxy = new Proxy(
			{ text: "short" },
			{
				get: (target, key) => {
					calls++;
					return Reflect.get(target, key);
				},
			},
		);
		class Tagged extends Array<number> {}

		cache.set("toJSON", hiddenToJson);
		cache.set("toJSON-getter", hiddenToJsonGetter);
		cache.set("proxy", proxy);
		cache.set("nested-proxy", { inner: proxy });
		cache.set("array-subclass", { list: Tagged.from([1, 2]) });

		expect(calls).toBe(0);
		expect(cache.size).toBe(0);
		expect(cache.stats().rejected).toBe(5);
	});

	it("stores exactly what JSON.stringify would produce and accounts its exact length", () => {
		const random = seeded(7);
		const pick = <V>(values: readonly V[]): V => values[Math.floor(random() * values.length)] as V;
		const scalar = (): unknown =>
			pick<() => unknown>([
				() => null,
				() => random() < 0.5,
				() => pick([0, -0, 1.5, -2, 1e21, 5e-324, Number.MAX_SAFE_INTEGER]),
				() => pick(["", "plain", 'quote " and \\ slash', "line\nbreak", "\u0000ctl", "한글", "😀", "\ud800 lone"]),
			])();
		const value = (depth: number): unknown => {
			if (depth > 3 || random() < 0.4) return scalar();
			if (random() < 0.5) return Array.from({ length: Math.floor(random() * 4) }, () => value(depth + 1));
			const object: Record<string, unknown> = {};
			const fields = Math.floor(random() * 4);
			for (let index = 0; index < fields; index++) {
				object[pick(["a", "key", "__proto__x", "한", 'k"q'])] = random() < 0.15 ? undefined : value(depth + 1);
			}
			return object;
		};
		for (let run = 0; run < 300; run++) {
			const cache = new BoundedJsonLru<unknown>({ maxEntries: 1, maxBytes: 64 * 1024, maxEntryBytes: 64 * 1024 });
			const input = value(0);
			cache.set("k", input);
			const json = JSON.stringify(input);
			expect(cache.get("k")).toEqual(JSON.parse(json));
			expect(cache.stats().accountedBytes).toBe(2 * "k".length + 128 + 2 * json.length);
		}
	});

	it("omits undefined object fields like JSON and returns independent copies", () => {
		const cache = new BoundedJsonLru<{ a: number; b?: string | undefined; list: number[] }>({
			maxEntries: 2,
			maxBytes: 10_000,
			maxEntryBytes: 1_000,
		});
		const value = { a: 1, b: undefined, list: [1, 2] };
		cache.set("k", value);
		value.list.push(3);
		const first = cache.get("k");
		first?.list.push(4);

		expect(cache.get("k")).toEqual({ a: 1, list: [1, 2] });
		expect(Object.hasOwn(cache.get("k") ?? {}, "b")).toBe(false);
	});

	it("validates its limits", () => {
		expect(() => new BoundedJsonLru({ maxEntries: -1, maxBytes: 1, maxEntryBytes: 1 })).toThrow(RangeError);
		expect(() => new BoundedJsonLru({ maxEntries: 1, maxBytes: Number.NaN, maxEntryBytes: 1 })).toThrow(RangeError);
		const disabled = new BoundedJsonLru<number>({ maxEntries: 0, maxBytes: 1_000, maxEntryBytes: 1_000 });
		disabled.set("k", 1);
		expect(disabled.get("k")).toBeUndefined();
	});
});
