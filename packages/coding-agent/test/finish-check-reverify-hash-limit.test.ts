import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const reads = vi.hoisted(() => ({ active: 0, peak: 0 }));

vi.mock("node:fs/promises", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs/promises")>();
	return {
		...actual,
		stat: async (...args: Parameters<typeof actual.stat>) => {
			reads.active++;
			reads.peak = Math.max(reads.peak, reads.active);
			try {
				await new Promise((resolve) => setTimeout(resolve, 5));
				return await actual.stat(...args);
			} finally {
				reads.active--;
			}
		},
	};
});

const { FINISH_CHECK_REVERIFY_HASH_CONCURRENCY, hashDeliverables } = await import(
	"../src/core/finish-check-reverify-hash.ts"
);

describe("finish-check reverify hashing concurrency", () => {
	let cwd: string;
	beforeEach(async () => {
		cwd = await mkdtemp(join(tmpdir(), "omk-hash-limit-"));
		reads.active = 0;
		reads.peak = 0;
	});
	afterEach(async () => {
		await rm(cwd, { recursive: true, force: true });
	});

	it("reads at most 4 deliverables at a time and keeps every result", async () => {
		const paths = Array.from({ length: 30 }, (_, i) => `f${i}.txt`);
		await Promise.all(paths.map((path, i) => writeFile(join(cwd, path), `content ${i}`)));
		const hashes = await hashDeliverables(paths, cwd);
		expect(FINISH_CHECK_REVERIFY_HASH_CONCURRENCY).toBe(4);
		expect(reads.peak).toBe(4);
		expect(Object.keys(hashes)).toEqual(paths);
		expect(Object.values(hashes).every((value) => /^\d+:[0-9a-f]{64}$/.test(value))).toBe(true);
	});
});
