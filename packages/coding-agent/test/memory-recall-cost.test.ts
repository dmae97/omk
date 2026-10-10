import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFallbackTokenCounter } from "../src/core/context-budget-token-counter.ts";
import { prepareMemoryRecord } from "../src/core/verified-memory-record.ts";
import { selectMemoryContext } from "../src/core/verified-memory-selection.ts";
import { MAX_MEMORY_SOURCE_BYTES, memoryWorkspace, readMemorySource } from "../src/core/verified-memory-source.ts";
import { VerifiedMemoryStore } from "../src/core/verified-memory-store.ts";

let root: string;
beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "omk-memory-recall-cost-"));
});
afterEach(() => {
	vi.restoreAllMocks();
	rmSync(root, { recursive: true, force: true });
});

describe("bounded memory recall work", () => {
	it.each([1, 512, MAX_MEMORY_SOURCE_BYTES])("allocates a source-sized bounded read buffer for %i bytes", (size) => {
		writeFileSync(join(root, "facts.txt"), "x".repeat(size));
		const alloc = vi.spyOn(Buffer, "alloc");
		if (size > 2048) expect(() => readMemorySource(root, "facts.txt", 1, 1)).toThrow(/quote size/);
		else expect(readMemorySource(root, "facts.txt", 1, 1).quote).toHaveLength(size);
		expect(alloc.mock.calls.map(([bytes]) => bytes)).toEqual([size + 1]);
	});

	it("still refuses a source that grows between its stat and bounded read", () => {
		const file = join(root, "facts.txt");
		writeFileSync(file, "alpha");
		const original = Buffer.alloc;
		vi.spyOn(Buffer, "alloc").mockImplementationOnce((size) => {
			appendFileSync(file, " new content");
			return original(size);
		});
		expect(() => readMemorySource(root, "facts.txt", 1, 1)).toThrow(/changed during read/);
	});

	it("does not price records with no lexical match and still prices the complete pair", () => {
		writeFileSync(join(root, "facts.txt"), "alpha storage\nzebra habitats\n");
		const workspace = memoryWorkspace(root);
		const records = [1, 2].map((line) =>
			prepareMemoryRecord(root, workspace.id, { path: "facts.txt", startLine: line, endLine: line }),
		);
		const fallback = createFallbackTokenCounter();
		const countText = vi.fn(fallback.countText.bind(fallback));
		const counter = { ...fallback, countText };
		const result = selectMemoryContext(records, 4096, "alpha", counter, "fixture");
		expect(result.selected).toBe(1);
		expect(JSON.stringify(result.messages)).toContain("alpha storage");
		expect(JSON.stringify(result.messages)).not.toContain("zebra habitats");
		expect(countText.mock.calls.some(([text]) => text.includes("zebra habitats"))).toBe(false);
		expect(countText.mock.calls.some(([text]) => text === JSON.stringify(result.messages))).toBe(true);
		countText.mockClear();
		expect(selectMemoryContext(records, 4096, "unmatched", counter, "fixture").selected).toBe(0);
		expect(countText).not.toHaveBeenCalled();
	});
	it.skipIf(process.platform === "win32")(
		"bounds record buffers to the published bytes while recalling actual storage",
		() => {
			writeFileSync(join(root, "facts.txt"), "alpha storage");
			const store = new VerifiedMemoryStore(root);
			const admission = store.remember({ path: "facts.txt", startLine: 1, endLine: 1 });
			if (admission.verdict !== "accept") throw new Error("fixture admission");
			const record = join(root, ".omk", "verified-memory", `${admission.recordId}.json`);
			const size = readFileSync(record).length;
			const alloc = vi.spyOn(Buffer, "alloc");
			expect(store.retrieve().records).toHaveLength(1);
			expect(alloc.mock.calls.map(([bytes]) => bytes)).toEqual([size + 1, 14]);
		},
	);
	it.skipIf(process.platform === "win32")("refuses a record that grows during its bounded read", () => {
		writeFileSync(join(root, "facts.txt"), "alpha storage");
		const store = new VerifiedMemoryStore(root);
		const admission = store.remember({ path: "facts.txt", startLine: 1, endLine: 1 });
		if (admission.verdict !== "accept") throw new Error("fixture admission");
		const record = join(root, ".omk", "verified-memory", `${admission.recordId}.json`);
		const original = Buffer.alloc;
		vi.spyOn(Buffer, "alloc").mockImplementationOnce((size) => {
			appendFileSync(record, " ");
			return original(size);
		});
		expect(() => store.retrieve()).toThrow(/record changed/);
	});
});
