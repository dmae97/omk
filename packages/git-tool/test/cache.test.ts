import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { gitTool } from "../src/git-tool";
import type { StatusResult, ToolResult } from "../src/types";
import { createTestRepo, type TestRepo } from "./helpers";

let repo: TestRepo;
let previousCwd: string;

beforeEach(() => {
	previousCwd = process.cwd();
	repo = createTestRepo();
	process.chdir(repo.path);
});

afterEach(() => {
	process.chdir(previousCwd);
	repo.remove();
});

describe("git-tool cache", () => {
	it("invalidates status cache on write operations", async () => {
		repo.writeFile("file.txt", "hello");
		repo.run("add", "file.txt");
		repo.run("commit", "-m", "initial");

		repo.writeFile("file.txt", "hello world");

		const status1 = (await gitTool({ operation: "status" })) as ToolResult<StatusResult>;
		expect(status1.data.modified.map((file) => file.path)).toContain("file.txt");

		await gitTool({ operation: "add", paths: ["file.txt"] });

		const status2 = (await gitTool({ operation: "status" })) as ToolResult<StatusResult>;
		expect(status2.data.staged.map((file) => file.path)).toContain("file.txt");
		expect(status2.data.modified.map((file) => file.path)).not.toContain("file.txt");
	});
});
