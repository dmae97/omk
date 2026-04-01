import { afterEach, describe, expect, it, vi } from "bun:test";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import type { ToolSession } from "@oh-my-pi/pi-coding-agent/tools";
import {
	GhIssueViewTool,
	GhPrDiffTool,
	GhPrViewTool,
	GhRepoViewTool,
	GhRunWatchTool,
	GhSearchIssuesTool,
	GhSearchPrsTool,
} from "@oh-my-pi/pi-coding-agent/tools/gh";
import * as ghCli from "@oh-my-pi/pi-coding-agent/tools/gh-cli";

function createSession(cwd: string = "/tmp/test"): ToolSession {
	return {
		cwd,
		hasUI: false,
		getSessionFile: () => null,
		getSessionSpawns: () => null,
		settings: Settings.isolated({ "github.enabled": true }),
	};
}

function getCurrentHeadSha(): string {
	const result = Bun.spawnSync(["git", "rev-parse", "HEAD"], {
		cwd: "/work/pi",
		stdout: "pipe",
		stderr: "pipe",
	});

	if (result.exitCode !== 0) {
		throw new Error("Failed to resolve current git HEAD for gh_run_watch test.");
	}

	return new TextDecoder().decode(result.stdout).trim();
}

describe("GitHub CLI tools", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("formats repository metadata into readable text", async () => {
		vi.spyOn(ghCli, "runGhJson").mockResolvedValue({
			nameWithOwner: "cli/cli",
			description: "GitHub CLI",
			url: "https://github.com/cli/cli",
			defaultBranchRef: { name: "trunk" },
			homepageUrl: "https://cli.github.com",
			forkCount: 1234,
			isArchived: false,
			isFork: false,
			primaryLanguage: { name: "Go" },
			repositoryTopics: [{ name: "cli" }, { name: "github" }],
			stargazerCount: 4567,
			updatedAt: "2026-04-01T10:00:00Z",
			viewerPermission: "WRITE",
			visibility: "PUBLIC",
		});

		const tool = new GhRepoViewTool(createSession());
		const result = await tool.execute("repo-view", { repo: "cli/cli" });
		const text = result.content[0]?.type === "text" ? result.content[0].text : "";

		expect(text).toContain("# cli/cli");
		expect(text).toContain("GitHub CLI");
		expect(text).toContain("Default branch: trunk");
		expect(text).toContain("Stars: 4567");
		expect(text).toContain("Topics: cli, github");
	});

	it("formats issue comments and omits minimized ones", async () => {
		vi.spyOn(ghCli, "runGhJson").mockResolvedValue({
			number: 42,
			title: "Example issue",
			state: "OPEN",
			stateReason: null,
			author: { login: "octocat" },
			body: "Issue body",
			createdAt: "2026-04-01T09:00:00Z",
			updatedAt: "2026-04-01T10:00:00Z",
			url: "https://github.com/cli/cli/issues/42",
			labels: [{ name: "bug" }],
			comments: [
				{
					author: { login: "reviewer" },
					body: "Visible comment",
					createdAt: "2026-04-01T11:00:00Z",
					url: "https://github.com/cli/cli/issues/42#issuecomment-1",
					isMinimized: false,
				},
				{
					author: { login: "spam" },
					body: "Hidden comment",
					createdAt: "2026-04-01T12:00:00Z",
					url: "https://github.com/cli/cli/issues/42#issuecomment-2",
					isMinimized: true,
					minimizedReason: "SPAM",
				},
			],
		});

		const tool = new GhIssueViewTool(createSession());
		const result = await tool.execute("issue-view", { issue: "42", repo: "cli/cli", comments: true });
		const text = result.content[0]?.type === "text" ? result.content[0].text : "";

		expect(text).toContain("# Issue #42: Example issue");
		expect(text).toContain("Labels: bug");
		expect(text).toContain("### @reviewer · 2026-04-01T11:00:00Z");
		expect(text).toContain("Visible comment");
		expect(text).toContain("Minimized comments omitted: 1.");
		expect(text).not.toContain("Hidden comment");
	});

	it("includes pull request reviews in the discussion context", async () => {
		vi.spyOn(ghCli, "runGhJson").mockResolvedValue({
			number: 12,
			title: "Improve PR context",
			state: "OPEN",
			author: { login: "octocat" },
			body: "PR body",
			baseRefName: "main",
			headRefName: "feature/pr-reviews",
			isDraft: false,
			mergeStateStatus: "CLEAN",
			reviewDecision: "CHANGES_REQUESTED",
			createdAt: "2026-04-01T09:00:00Z",
			updatedAt: "2026-04-01T10:00:00Z",
			url: "https://github.com/cli/cli/pull/12",
			labels: [{ name: "bug" }],
			files: [{ path: "src/file.ts", additions: 3, deletions: 1, changeType: "MODIFIED" }],
			reviews: [
				{
					author: { login: "reviewer" },
					body: "Please add coverage for this path.",
					state: "CHANGES_REQUESTED",
					submittedAt: "2026-04-01T11:00:00Z",
					commit: { oid: "abcdef1234567890" },
				},
			],
			comments: [],
		});

		const tool = new GhPrViewTool(createSession());
		const result = await tool.execute("pr-view", { pr: "12", repo: "cli/cli", comments: true });
		const text = result.content[0]?.type === "text" ? result.content[0].text : "";

		expect(text).toContain("## Reviews (1)");
		expect(text).toContain("### @reviewer - 2026-04-01T11:00:00Z [CHANGES_REQUESTED]");
		expect(text).toContain("Commit: abcdef123456");
		expect(text).toContain("Please add coverage for this path.");
	});

	it("formats pull request search results", async () => {
		vi.spyOn(ghCli, "runGhJson").mockResolvedValue([
			{
				number: 101,
				title: "Add feature",
				state: "OPEN",
				author: { login: "dev1" },
				repository: { nameWithOwner: "owner/repo" },
				labels: [{ name: "feature" }],
				createdAt: "2026-04-01T08:00:00Z",
				updatedAt: "2026-04-01T09:00:00Z",
				url: "https://github.com/owner/repo/pull/101",
			},
			{
				number: 102,
				title: "Fix regression",
				state: "CLOSED",
				author: { login: "dev2" },
				repository: { nameWithOwner: "owner/repo" },
				labels: [],
				createdAt: "2026-03-31T08:00:00Z",
				updatedAt: "2026-03-31T09:00:00Z",
				url: "https://github.com/owner/repo/pull/102",
			},
		]);

		const tool = new GhSearchPrsTool(createSession());
		const result = await tool.execute("search-prs", { query: "feature", repo: "owner/repo", limit: 2 });
		const text = result.content[0]?.type === "text" ? result.content[0].text : "";

		expect(text).toContain("# GitHub pull requests search");
		expect(text).toContain("Query: feature");
		expect(text).toContain("Repository: owner/repo");
		expect(text).toContain("- #101 Add feature");
		expect(text).toContain("  Labels: feature");
		expect(text).toContain("- #102 Fix regression");
	});

	it("passes leading-dash search queries after -- so gh does not parse them as flags", async () => {
		const runGhJsonSpy = vi.spyOn(ghCli, "runGhJson").mockResolvedValue([]);

		const issuesTool = new GhSearchIssuesTool(createSession());
		await issuesTool.execute("search-issues", { query: "-label:bug", repo: "owner/repo", limit: 1 });

		const prsTool = new GhSearchPrsTool(createSession());
		await prsTool.execute("search-prs", { query: "-label:bug", repo: "owner/repo", limit: 1 });

		const issueArgs = runGhJsonSpy.mock.calls[0]?.[1];
		const prArgs = runGhJsonSpy.mock.calls[1]?.[1];

		expect(issueArgs?.slice(0, 2)).toEqual(["search", "issues"]);
		expect(issueArgs?.at(2)).toBe("--limit");
		expect(issueArgs?.at(-2)).toBe("--");
		expect(issueArgs?.at(-1)).toBe("-label:bug");
		expect(prArgs?.slice(0, 2)).toEqual(["search", "prs"]);
		expect(prArgs?.at(2)).toBe("--limit");
		expect(prArgs?.at(-2)).toBe("--");
		expect(prArgs?.at(-1)).toBe("-label:bug");
	});

	it("returns diff output under a stable heading without rewriting patch content", async () => {
		vi.spyOn(ghCli, "runGhText").mockResolvedValue("diff --git a/Makefile b/Makefile\n+\tgo test ./... \n");

		const tool = new GhPrDiffTool(createSession());
		const result = await tool.execute("pr-diff", { pr: "7", repo: "owner/repo" });
		const text = result.content[0]?.type === "text" ? result.content[0].text : "";

		expect(text).toContain("# Pull Request Diff");
		expect(text).toContain("diff --git a/Makefile b/Makefile");
		expect(text).toContain("+\tgo test ./... ");
		expect(text).not.toContain("+    go test ./... ");
	});

	it("watches workflow runs for the current HEAD commit and reports success", async () => {
		const headSha = getCurrentHeadSha();
		vi.spyOn(ghCli, "runGhText").mockResolvedValue("owner/repo");
		const jsonSpy = vi.spyOn(ghCli, "runGhJson").mockImplementation(async (_cwd, args) => {
			const endpoint = args.find(arg => arg.startsWith("/repos/owner/repo/actions"));
			if (endpoint === "/repos/owner/repo/actions/runs/88/jobs") {
				return {
					total_count: 2,
					jobs: [
						{
							id: 101,
							name: "lint",
							status: "completed",
							conclusion: "success",
							started_at: "2026-04-01T09:00:00Z",
							completed_at: "2026-04-01T09:03:00Z",
							html_url: "https://github.com/owner/repo/actions/runs/88/job/101",
						},
						{
							id: 102,
							name: "test",
							status: "completed",
							conclusion: "success",
							started_at: "2026-04-01T09:00:00Z",
							completed_at: "2026-04-01T09:10:00Z",
							html_url: "https://github.com/owner/repo/actions/runs/88/job/102",
						},
					],
				} as never;
			}

			if (endpoint === "/repos/owner/repo/actions/runs") {
				return {
					workflow_runs: [
						{
							id: 88,
							name: "CI",
							display_title: "main build",
							status: "completed",
							conclusion: "success",
							head_branch: "main",
							head_sha: headSha,
							created_at: "2026-04-01T09:00:00Z",
							updated_at: "2026-04-01T09:10:00Z",
							html_url: "https://github.com/owner/repo/actions/runs/88",
						},
					],
				} as never;
			}

			throw new Error(`Unexpected gh json call: ${args.join(" ")}`);
		});

		const updates: string[] = [];
		const tool = new GhRunWatchTool(createSession("/work/pi"));
		const result = await tool.execute(
			"run-watch",
			{ repo: "owner/repo", branch: "main", interval: 0.001 },
			undefined,
			update => {
				const block = update.content[0];
				if (block?.type === "text") {
					updates.push(block.text);
				}
			},
		);
		const text = result.content[0]?.type === "text" ? result.content[0].text : "";
		const runListCalls = jsonSpy.mock.calls.filter(([, args]) => args.includes("/repos/owner/repo/actions/runs"));

		expect(runListCalls[0]?.[1]).toContain(`head_sha=${headSha}`);
		expect(updates.some(update => update.includes(`# Watching GitHub Actions for ${headSha.slice(0, 12)}`))).toBe(
			true,
		);
		expect(updates.some(update => update.includes("Waiting 0.001s to ensure no additional runs appear"))).toBe(true);
		expect(text).toContain(`# GitHub Actions for ${headSha.slice(0, 12)}`);
		expect(text).toContain("Repository: owner/repo");
		expect(text).toContain(`Commit: ${headSha}`);
		expect(text).toContain("All workflow runs for this commit passed.");
	});

	it("tails failed job logs when a watched run fails", async () => {
		vi.spyOn(ghCli, "runGhJson")
			.mockResolvedValueOnce({
				id: 77,
				name: "CI",
				display_title: "PR checks",
				status: "completed",
				conclusion: "failure",
				head_branch: "feature/bugfix",
				created_at: "2026-04-01T08:00:00Z",
				updated_at: "2026-04-01T08:06:00Z",
				html_url: "https://github.com/owner/repo/actions/runs/77",
			})
			.mockResolvedValueOnce({
				total_count: 2,
				jobs: [
					{
						id: 201,
						name: "build",
						status: "completed",
						conclusion: "success",
						started_at: "2026-04-01T08:00:00Z",
						completed_at: "2026-04-01T08:02:00Z",
						html_url: "https://github.com/owner/repo/actions/runs/77/job/201",
					},
					{
						id: 202,
						name: "test",
						status: "completed",
						conclusion: "failure",
						started_at: "2026-04-01T08:00:00Z",
						completed_at: "2026-04-01T08:06:00Z",
						html_url: "https://github.com/owner/repo/actions/runs/77/job/202",
					},
				],
			});
		vi.spyOn(ghCli, "runGhCommand").mockResolvedValue({
			exitCode: 0,
			stdout: "alpha\nbeta\ngamma\ndelta\nepsilon\nzeta",
			stderr: "",
		});

		const tool = new GhRunWatchTool(createSession());
		const result = await tool.execute("run-watch", {
			run: "https://github.com/owner/repo/actions/runs/77",
			grace: 0,
			tail: 3,
		});
		const text = result.content[0]?.type === "text" ? result.content[0].text : "";

		expect(text).toContain("# GitHub Actions Run #77");
		expect(text).toContain("Repository: owner/repo");
		expect(text).toContain("### test [failure]");
		expect(text).toContain("delta");
		expect(text).toContain("epsilon");
		expect(text).toContain("zeta");
		expect(text).not.toContain("alpha");
		expect(text).toContain("Run failed.");
	});
});
