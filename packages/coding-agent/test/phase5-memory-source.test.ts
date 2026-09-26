import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createMemorySourceBatch, readMemorySource } from "../src/core/verified-memory-source.ts";

it("recall-local snapshot refuses source changes and a new recall reads them", () => {
	const root = mkdtempSync(join(tmpdir(), "omk-memory-source-"));
	try {
		const file = join(root, "source.ts");
		writeFileSync(file, "alpha\nbeta\n");
		const read = createMemorySourceBatch(root);
		expect(read("source.ts", 1, 1).quote).toBe("alpha");
		expect(read("source.ts", 2, 2).quote).toBe("beta");
		writeFileSync(file, "replacement of a different size\n");
		expect(() => read("source.ts", 1, 1)).toThrow();
		expect(readMemorySource(root, "source.ts", 1, 1).quote).toBe("replacement of a different size");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
