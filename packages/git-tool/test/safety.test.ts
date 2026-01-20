import { createTempDirSync } from "@oh-my-pi/pi-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkSafety } from "../src/safety/guards";
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

describe("git-tool safety", () => {
	it("blocks force push to protected branch", async () => {
		repo.writeFile("init.txt", "init");
		repo.run("add", ".");
		repo.run("commit", "-m", "init");
		repo.run("branch", "-M", "main");
		const result = await checkSafety("push", { force: true });
		expect(result.blocked).toBe(true);
	});

	it("warns on discard changes", async () => {
		const result = await checkSafety("restore", { worktree: true });
		expect(result.blocked).toBe(false);
		expect(result.confirm).toBe(false);
		expect(result.warnings.length).toBeGreaterThan(0);
	});

	it("warns on branch delete", async () => {
		const result = await checkSafety("branch", { action: "delete" });
		expect(result.blocked).toBe(false);
		expect(result.confirm).toBe(false);
		expect(result.warnings.length).toBeGreaterThan(0);
	});

	it("blocks amend when HEAD is pushed", async () => {
		repo.run("branch", "-M", "main");
		repo.writeFile("file.txt", "hello");
		repo.run("add", "file.txt");
		repo.run("commit", "-m", "initial");

		const remoteDir = createTempDirSync("@git-tool-remote-");
		Bun.spawnSync(["git", "init", "--bare"], { cwd: remoteDir.path });
		repo.run("remote", "add", "origin", remoteDir.path);
		repo.run("push", "-u", "origin", "main");

		const result = await checkSafety("commit", { amend: true });
		expect(result.blocked).toBe(true);
	});

	it("blocks rebase when HEAD is pushed", async () => {
		repo.run("branch", "-M", "main");
		repo.writeFile("file.txt", "hello");
		repo.run("add", "file.txt");
		repo.run("commit", "-m", "initial");

		const remoteDir = createTempDirSync("@git-tool-remote-");
		Bun.spawnSync(["git", "init", "--bare"], { cwd: remoteDir.path });
		repo.run("remote", "add", "origin", remoteDir.path);
		repo.run("push", "-u", "origin", "main");

		const result = await checkSafety("rebase", {});
		expect(result.blocked).toBe(true);
	});
});
