import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createFallbackTokenCounter } from "../src/core/context-budget-token-counter.ts";
import { prepareMemoryRecord } from "../src/core/verified-memory-record.ts";
import { selectMemoryContext } from "../src/core/verified-memory-selection.ts";
import { memoryWorkspace } from "../src/core/verified-memory-source.ts";

it("selects exact validated source quotes only when the complete pair fits", () => {
	const root = mkdtempSync(join(tmpdir(), "omk-memory-selection-"));
	try {
		writeFileSync(join(root, "note.ts"), "alpha source quote\n");
		const record = prepareMemoryRecord(root, memoryWorkspace(root).id, { path: "note.ts", startLine: 1, endLine: 1 });
		const counter = createFallbackTokenCounter();
		expect(selectMemoryContext([record], 4096, "zebra", counter, "fixture").selected).toBe(0);
		const selected = selectMemoryContext([record], 4096, "alpha", counter, "fixture");
		expect(selected.selected).toBe(1);
		const cost = counter.countText(JSON.stringify(selected.messages), "fixture").tokens;
		expect(selectMemoryContext([record], cost - 1, "alpha", counter, "fixture").selected).toBe(0);
		expect(selectMemoryContext([record], 4096, "alpha", counter, "fixture", () => false).selected).toBe(0);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
