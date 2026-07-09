import { describe, expect, it } from "vitest";
import { evaluateCorrectnessWall } from "../src/evaluate-correctness-wall.ts";
import { createInMemoryAdaptOrchClient } from "../src/in-memory-adaptorch.ts";
import { buildVerificationDigest } from "../src/signed-receipt.ts";
import { CORRECTNESS_WALL_VERSION } from "../src/wall-meta.ts";

const inScopeDiff = [
	"--- a/packages/adaptorch-wpl/src/foo.ts",
	"+++ b/packages/adaptorch-wpl/src/foo.ts",
	"@@ -1 +1 @@",
	"+// comment",
].join("\n");

describe("createInMemoryAdaptOrchClient", () => {
	it("serves run, artifacts, and traces for adjudication", async () => {
		const client = createInMemoryAdaptOrchClient({
			"run-mem-1": {
				run: { run_id: "run-mem-1", status: "completed" },
				artifacts: [{ path: "out.md", size_bytes: 1 }],
				traces: [{ kind: "write", level: "info" }],
			},
		});

		const { receipt } = await evaluateCorrectnessWall({
			kind: "code-edit",
			runIds: ["run-mem-1"],
			approvedWriteScope: ["packages/adaptorch-wpl/**"],
			diffText: inScopeDiff,
			previewOnly: false,
			client,
		});

		expect(receipt.adjudicationVerdict).toBe("CONFIRMED");
		expect(receipt.wallVersion).toBe(CORRECTNESS_WALL_VERSION);
		expect(receipt.verificationDigest?.wallVersion).toBe(CORRECTNESS_WALL_VERSION);
		expect(receipt.verificationDigest?.compositeHash).toMatch(/^[a-f0-9]{64}$/);
	});
});

describe("buildVerificationDigest wallVersion", () => {
	it("includes wallVersion in digest and changes compositeHash vs omitting it", () => {
		const base = { patchText: "+x\n", evidenceChunks: ["run-1"] as string[] };
		const without = buildVerificationDigest(base);
		const withWall = buildVerificationDigest({ ...base, wallVersion: CORRECTNESS_WALL_VERSION });
		expect(withWall.wallVersion).toBe(CORRECTNESS_WALL_VERSION);
		expect(withWall.compositeHash).not.toBe(without.compositeHash);
	});
});
