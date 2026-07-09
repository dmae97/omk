import { describe, expect, it } from "vitest";
import { compactionEmitWillRetry } from "../src/core/compaction/resume-policy.ts";

describe("compactionEmitWillRetry", () => {
	it("keeps overflow willRetry true", () => {
		expect(compactionEmitWillRetry(true, false)).toBe(true);
	});

	it("sets willRetry when threshold compaction has queued agent messages", () => {
		expect(compactionEmitWillRetry(false, true)).toBe(true);
	});

	it("stays false when threshold compaction has no queue", () => {
		expect(compactionEmitWillRetry(false, false)).toBe(false);
	});
});
