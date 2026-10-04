import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AdaptOrchClient } from "../src/adaptorch-client.ts";
import { FileReviewStore, reviewStoreKey } from "../src/review-store.ts";
import { ReviewWorkflow } from "../src/review-workflow.ts";
import { reviewFixture } from "./review-fixtures.ts";

const directories: string[] = [];
afterEach(async () => {
	for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

describe("actual filesystem review journal", () => {
	it("persists binding, admission and retry counter across new store/workflow instances", async () => {
		const directory = await mkdtemp(join(tmpdir(), "omk-review-test-"));
		directories.push(directory);
		let calls = 0;
		const client = new AdaptOrchClient({
			callTool: async (name) => {
				if (name === "adaptorch_run") return { run_id: `run-${++calls}` };
				return { run_id: "run-1", status: "SUCCEEDED" };
			},
		});
		await new ReviewWorkflow({ client, store: new FileReviewStore(directory) }).submit(reviewFixture());
		const restored = new ReviewWorkflow({ client, store: new FileReviewStore(directory) });
		expect(await restored.submit(reviewFixture())).toMatchObject({ runId: "run-1" });
		expect(calls).toBe(1);
		const key = reviewStoreKey("synthetic-packet", "spec-v1");
		const journal = await new FileReviewStore(directory).read(key);
		expect(journal).toMatchObject({ retryCount: 0, attempts: [{ state: "submitted", runId: "run-1" }] });
		expect(await readFile(join(directory, `${key}.json`), "utf8")).not.toContain("npm test");
	});
	it("fails closed on corrupted journals rather than resetting to a new paid run", async () => {
		const directory = await mkdtemp(join(tmpdir(), "omk-review-test-"));
		directories.push(directory);
		const key = reviewStoreKey("synthetic-packet", "spec-v1");
		await writeFile(join(directory, `${key}.json`), JSON.stringify({ version: 1, retryCount: -1 }));
		await expect(new FileReviewStore(directory).read(key)).rejects.toThrow("Invalid");
	});
	it("rejects traversal keys", async () => {
		await expect(new FileReviewStore("/tmp").read("../something")).rejects.toThrow("key");
	});
});

describe("filesystem admission concurrency", () => {
	it("allows at most one submission across independently constructed stores", async () => {
		const directory = await mkdtemp(join(tmpdir(), "omk-review-test-"));
		directories.push(directory);
		let calls = 0;
		const client = new AdaptOrchClient({ callTool: async () => ({ run_id: `r${++calls}` }) });
		const workflows = Array.from(
			{ length: 8 },
			() => new ReviewWorkflow({ client, store: new FileReviewStore(directory) }),
		);
		await Promise.allSettled(workflows.map((workflow) => workflow.submit(reviewFixture())));
		expect(calls).toBe(1);
		await new ReviewWorkflow({ client, store: new FileReviewStore(directory) }).submit(reviewFixture());
		expect(calls).toBe(1);
	});
});
