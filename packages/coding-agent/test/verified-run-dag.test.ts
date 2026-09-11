import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dagFixture } from "./verified-run-dag-fixture.ts";

let root: string;
beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "verified-dag-"));
});
afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

describe("static isolated command DAG", () => {
	it("runs two isolated writers and verifies their integrated immutable artifact", async () => {
		const { coordinator, contract, command, approval, workspace } = dagFixture(root);
		const result = await coordinator.start(contract, command, approval);
		expect(result).toMatchObject({ verification: "verified", application: "candidate_ready", modelRequests: 0 });
		expect(coordinator.evidence("dag").receiptFormat).toBe("v3");
		expect(coordinator.artifact("dag", result.candidateDigest ?? "", "joined").toString()).toBe("originalORIGINAL");
		expect(existsSync(join(workspace, "left"))).toBe(false);
		expect(readFileSync(join(workspace, "input"), "utf8")).toBe("original");
	});

	it("keeps a successful branch checkpoint but cannot verify a failed dependency", async () => {
		const { coordinator, contract, command, approval } = dagFixture(root, true);
		const result = await coordinator.start(contract, command, approval);
		expect(result).toMatchObject({
			execution: "paused",
			settlement: "settled",
			candidateDigest: null,
			receiptDigest: null,
			tasks: [
				{ taskId: "left", status: "succeeded", attempt: 1 },
				{ taskId: "right", status: "failed", attempt: 1 },
				{ taskId: "join", status: "pending", attempt: 0 },
			],
		});
		expect(() => coordinator.evidence("dag")).toThrow(/evidence_missing/);
	});
});
