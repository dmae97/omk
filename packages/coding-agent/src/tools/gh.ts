import type { AgentTool, AgentToolContext, AgentToolResult, AgentToolUpdateCallback } from "@oh-my-pi/pi-agent-core";
import { abortableSleep, untilAborted } from "@oh-my-pi/pi-utils";
import { type Static, Type } from "@sinclair/typebox";
import { $ } from "bun";
import { renderPromptTemplate } from "../config/prompt-templates";
import ghIssueViewDescription from "../prompts/tools/gh-issue-view.md" with { type: "text" };
import ghPrDiffDescription from "../prompts/tools/gh-pr-diff.md" with { type: "text" };
import ghPrViewDescription from "../prompts/tools/gh-pr-view.md" with { type: "text" };
import ghRepoViewDescription from "../prompts/tools/gh-repo-view.md" with { type: "text" };
import ghRunWatchDescription from "../prompts/tools/gh-run-watch.md" with { type: "text" };
import ghSearchIssuesDescription from "../prompts/tools/gh-search-issues.md" with { type: "text" };
import ghSearchPrsDescription from "../prompts/tools/gh-search-prs.md" with { type: "text" };
import { truncateHead } from "../session/streaming-output";
import type { ToolSession } from ".";
import { isGhAvailable, runGhCommand, runGhJson, runGhText } from "./gh-cli";
import type { OutputMeta } from "./output-meta";
import { ToolError, throwIfAborted } from "./tool-errors";
import { toolResult } from "./tool-result";

const GH_REPO_FIELDS = [
	"nameWithOwner",
	"description",
	"url",
	"defaultBranchRef",
	"homepageUrl",
	"forkCount",
	"isArchived",
	"isFork",
	"primaryLanguage",
	"repositoryTopics",
	"stargazerCount",
	"updatedAt",
	"viewerPermission",
	"visibility",
];
const GH_ISSUE_FIELDS = [
	"author",
	"body",
	"comments",
	"createdAt",
	"labels",
	"number",
	"state",
	"stateReason",
	"title",
	"updatedAt",
	"url",
];
const GH_ISSUE_FIELDS_NO_COMMENTS = [
	"author",
	"body",
	"createdAt",
	"labels",
	"number",
	"state",
	"stateReason",
	"title",
	"updatedAt",
	"url",
];
const GH_PR_FIELDS = [
	"author",
	"baseRefName",
	"body",
	"comments",
	"createdAt",
	"files",
	"headRefName",
	"isDraft",
	"labels",
	"mergeStateStatus",
	"number",
	"reviews",
	"reviewDecision",
	"state",
	"title",
	"updatedAt",
	"url",
];
const GH_PR_FIELDS_NO_COMMENTS = [
	"author",
	"baseRefName",
	"body",
	"createdAt",
	"files",
	"headRefName",
	"isDraft",
	"labels",
	"mergeStateStatus",
	"number",
	"reviews",
	"reviewDecision",
	"state",
	"title",
	"updatedAt",
	"url",
];
const GH_SEARCH_FIELDS = [
	"author",
	"createdAt",
	"labels",
	"number",
	"repository",
	"state",
	"title",
	"updatedAt",
	"url",
];
const SEARCH_LIMIT_DEFAULT = 10;
const SEARCH_LIMIT_MAX = 50;
const FILE_PREVIEW_LIMIT = 50;
const RUN_WATCH_INTERVAL_DEFAULT = 3;
const RUN_WATCH_GRACE_DEFAULT = 5;
const RUN_WATCH_TAIL_DEFAULT = 15;
const RUN_WATCH_TAIL_MAX = 200;
const RUN_JOBS_PAGE_SIZE = 100;
const RUN_URL_PATTERN = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/actions\/runs\/(\d+)(?:\/.*)?$/;
const RUN_SUCCESS_CONCLUSIONS = new Set(["success", "neutral", "skipped"]);
const RUN_FAILURE_CONCLUSIONS = new Set(["failure", "timed_out", "cancelled", "action_required", "startup_failure"]);
const JOB_FAILURE_CONCLUSIONS = new Set(["failure", "timed_out", "cancelled", "action_required"]);

const ghRepoViewSchema = Type.Object({
	repo: Type.Optional(
		Type.String({
			description: "Repository in OWNER/REPO format. Defaults to the current GitHub repository context.",
		}),
	),
	branch: Type.Optional(Type.String({ description: "Branch name to inspect instead of the default branch." })),
});

const ghIssueViewSchema = Type.Object({
	issue: Type.String({ description: "Issue number or full GitHub issue URL." }),
	repo: Type.Optional(
		Type.String({ description: "Repository in OWNER/REPO format. Omit when passing a full issue URL." }),
	),
	comments: Type.Optional(Type.Boolean({ description: "Include issue comments (default: true)." })),
});

const ghPrViewSchema = Type.Object({
	pr: Type.Optional(
		Type.String({
			description:
				"Pull request number, full GitHub pull request URL, or branch name. Defaults to the current branch PR.",
		}),
	),
	repo: Type.Optional(
		Type.String({ description: "Repository in OWNER/REPO format. Omit when passing a full pull request URL." }),
	),
	comments: Type.Optional(Type.Boolean({ description: "Include pull request comments (default: true)." })),
});

const ghPrDiffSchema = Type.Object({
	pr: Type.Optional(
		Type.String({
			description:
				"Pull request number, full GitHub pull request URL, or branch name. Defaults to the current branch PR.",
		}),
	),
	repo: Type.Optional(
		Type.String({ description: "Repository in OWNER/REPO format. Omit when passing a full pull request URL." }),
	),
	nameOnly: Type.Optional(
		Type.Boolean({ description: "Return only changed file names instead of unified diff output." }),
	),
	exclude: Type.Optional(
		Type.Array(Type.String({ description: "Glob pattern for files to exclude from the diff." }), {
			description: "File globs to exclude from the diff output.",
		}),
	),
});

const ghSearchIssuesSchema = Type.Object({
	query: Type.String({ description: "GitHub issue search query. Supports GitHub search syntax." }),
	repo: Type.Optional(Type.String({ description: "Repository in OWNER/REPO format to scope the search." })),
	limit: Type.Optional(Type.Number({ description: "Maximum results to return (default: 10, max: 50)." })),
});

const ghSearchPrsSchema = Type.Object({
	query: Type.String({ description: "GitHub pull request search query. Supports GitHub search syntax." }),
	repo: Type.Optional(Type.String({ description: "Repository in OWNER/REPO format to scope the search." })),
	limit: Type.Optional(Type.Number({ description: "Maximum results to return (default: 10, max: 50)." })),
});

const ghRunWatchSchema = Type.Object({
	run: Type.Optional(
		Type.String({
			description:
				"GitHub Actions run ID or full run URL. Omitting this watches the workflow runs for the current HEAD commit on the selected branch.",
		}),
	),
	repo: Type.Optional(
		Type.String({
			description:
				"Repository in OWNER/REPO format. Defaults to the current GitHub repository context or the run URL.",
		}),
	),
	branch: Type.Optional(
		Type.String({
			description: "Branch to inspect when omitting `run`. Defaults to the current checked-out git branch.",
		}),
	),
	interval: Type.Optional(
		Type.Number({ description: "Polling interval in seconds while the run is still active (default: 3)." }),
	),
	grace: Type.Optional(
		Type.Number({
			description:
				"Extra seconds to wait after the first detected failure before fetching logs, to capture concurrent failures (default: 5).",
		}),
	),
	tail: Type.Optional(
		Type.Number({ description: "Number of log lines to include per failed job (default: 15, max: 200)." }),
	),
});

type GhRepoViewInput = Static<typeof ghRepoViewSchema>;
type GhIssueViewInput = Static<typeof ghIssueViewSchema>;
type GhPrViewInput = Static<typeof ghPrViewSchema>;
type GhPrDiffInput = Static<typeof ghPrDiffSchema>;
type GhSearchIssuesInput = Static<typeof ghSearchIssuesSchema>;
type GhSearchPrsInput = Static<typeof ghSearchPrsSchema>;
type GhRunWatchInput = Static<typeof ghRunWatchSchema>;

export interface GhToolDetails {
	meta?: OutputMeta;
	repo?: string;
	branch?: string;
	headSha?: string;
	runId?: number;
	runIds?: number[];
	status?: string;
	conclusion?: string;
	failedJobs?: string[];
}

interface GhUser {
	login?: string;
	name?: string | null;
}

interface GhLabel {
	name?: string;
}

interface GhComment {
	author?: GhUser | null;
	body?: string;
	createdAt?: string;
	url?: string;
	isMinimized?: boolean;
	minimizedReason?: string | null;
}

interface GhRepoTopic {
	name?: string;
	topic?: { name?: string };
}

interface GhRepoLanguage {
	name?: string;
}

interface GhRepoBranch {
	name?: string;
}

interface GhRepoViewData {
	nameWithOwner?: string;
	description?: string | null;
	url?: string;
	defaultBranchRef?: GhRepoBranch | null;
	homepageUrl?: string | null;
	forkCount?: number;
	isArchived?: boolean;
	isFork?: boolean;
	primaryLanguage?: GhRepoLanguage | null;
	repositoryTopics?: GhRepoTopic[];
	stargazerCount?: number;
	updatedAt?: string;
	viewerPermission?: string | null;
	visibility?: string | null;
}

interface GhIssueViewData {
	author?: GhUser | null;
	body?: string | null;
	comments?: GhComment[];
	createdAt?: string;
	labels?: GhLabel[];
	number?: number;
	state?: string;
	stateReason?: string | null;
	title?: string;
	updatedAt?: string;
	url?: string;
}

interface GhPrFile {
	path?: string;
	additions?: number;
	deletions?: number;
	changeType?: string;
}

interface GhPrViewData extends GhIssueViewData {
	baseRefName?: string;
	files?: GhPrFile[];
	headRefName?: string;
	isDraft?: boolean;
	mergeStateStatus?: string;
	reviews?: GhPrReview[];
	reviewDecision?: string;
}

interface GhPrReviewCommit {
	oid?: string | null;
}

interface GhPrReview {
	author?: GhUser | null;
	body?: string | null;
	commit?: GhPrReviewCommit | null;
	state?: string | null;
	submittedAt?: string | null;
}

interface GhSearchRepository {
	nameWithOwner?: string;
}

interface GhSearchResult {
	author?: GhUser | null;
	createdAt?: string;
	labels?: GhLabel[];
	number?: number;
	repository?: GhSearchRepository | null;
	state?: string;
	title?: string;
	updatedAt?: string;
	url?: string;
}

interface GhRunReference {
	repo?: string;
	runId?: number;
}

interface GhActionsRunListResponse {
	workflow_runs?: GhActionsRunApi[];
}

interface GhActionsRunApi {
	id?: number;
	name?: string | null;
	display_title?: string | null;
	status?: string | null;
	conclusion?: string | null;
	head_branch?: string | null;
	head_sha?: string | null;
	created_at?: string | null;
	updated_at?: string | null;
	html_url?: string | null;
}

interface GhActionsJobsResponse {
	total_count?: number;
	jobs?: GhActionsJobApi[];
}

interface GhActionsJobApi {
	id?: number;
	name?: string | null;
	status?: string | null;
	conclusion?: string | null;
	started_at?: string | null;
	completed_at?: string | null;
	html_url?: string | null;
}

interface GhRunJobSnapshot {
	id: number;
	name: string;
	status?: string;
	conclusion?: string;
	startedAt?: string;
	completedAt?: string;
	url?: string;
}

interface GhRunSnapshot {
	id: number;
	workflowName?: string;
	displayTitle?: string;
	status?: string;
	conclusion?: string;
	branch?: string;
	headSha?: string;
	createdAt?: string;
	updatedAt?: string;
	url?: string;
	jobs: GhRunJobSnapshot[];
}

interface GhFailedJobLog {
	run: GhRunSnapshot;
	job: GhRunJobSnapshot;
	tail?: string;
	available: boolean;
}

function normalizeText(value: string | null | undefined): string {
	return (value ?? "").replaceAll("\r\n", "\n").replaceAll("\r", "\n").replaceAll("\t", "    ").trim();
}

function normalizeBlock(value: string | null | undefined): string {
	return (value ?? "").replaceAll("\r\n", "\n").replaceAll("\r", "\n").replaceAll("\t", "    ").trimEnd();
}

function looksLikeGitHubUrl(value: string | undefined): boolean {
	return value?.startsWith("https://github.com/") ?? false;
}

function normalizeOptionalString(value: string | null | undefined): string | undefined {
	const normalized = value?.trim();
	return normalized ? normalized : undefined;
}

function formatShortSha(value: string | undefined): string | undefined {
	if (!value) {
		return undefined;
	}

	return value.slice(0, 12);
}

function requireNonEmpty(value: string | null | undefined, label: string): string {
	const normalized = normalizeOptionalString(value);
	if (!normalized) {
		throw new ToolError(`${label} must not be empty`);
	}
	return normalized;
}

function resolveSearchLimit(value: number | undefined): number {
	if (value === undefined) {
		return SEARCH_LIMIT_DEFAULT;
	}

	if (!Number.isFinite(value) || value <= 0) {
		throw new ToolError("limit must be a positive number");
	}

	return Math.min(Math.floor(value), SEARCH_LIMIT_MAX);
}

function resolvePositiveSeconds(value: number | undefined, label: string, defaultValue: number): number {
	if (value === undefined) {
		return defaultValue;
	}

	if (!Number.isFinite(value) || value <= 0) {
		throw new ToolError(`${label} must be a positive number`);
	}

	return value;
}

function resolveNonNegativeSeconds(value: number | undefined, label: string, defaultValue: number): number {
	if (value === undefined) {
		return defaultValue;
	}

	if (!Number.isFinite(value) || value < 0) {
		throw new ToolError(`${label} must be zero or a positive number`);
	}

	return value;
}

function resolveTailLimit(value: number | undefined): number {
	if (value === undefined) {
		return RUN_WATCH_TAIL_DEFAULT;
	}

	if (!Number.isFinite(value) || value <= 0) {
		throw new ToolError("tail must be a positive number");
	}

	return Math.min(Math.floor(value), RUN_WATCH_TAIL_MAX);
}

function appendRepoFlag(args: string[], repo: string | undefined, identifier?: string): void {
	if (!repo || looksLikeGitHubUrl(identifier)) {
		return;
	}

	args.push("--repo", repo);
}

function buildGhSearchArgs(
	command: "issues" | "prs",
	query: string,
	limit: number,
	repo: string | undefined,
): string[] {
	const args = ["search", command, "--limit", String(limit), "--json", GH_SEARCH_FIELDS.join(",")];
	appendRepoFlag(args, repo);
	args.push("--", query);
	return args;
}

function formatAuthor(author: GhUser | null | undefined): string | undefined {
	if (!author) return undefined;
	if (author.login) return `@${author.login}`;
	if (author.name) return author.name;
	return undefined;
}

function formatLabels(labels: GhLabel[] | undefined): string | undefined {
	const names = labels?.map(label => label.name).filter((value): value is string => Boolean(value)) ?? [];
	if (names.length === 0) return undefined;
	return names.join(", ");
}

function pushLine(lines: string[], label: string, value: string | number | boolean | undefined): void {
	if (value === undefined || value === "") return;
	lines.push(`${label}: ${value}`);
}

function parseRunReference(value: string | undefined): GhRunReference {
	const run = normalizeOptionalString(value);
	if (!run) {
		return {};
	}

	if (/^\d+$/.test(run)) {
		return { runId: Number(run) };
	}

	const match = run.match(RUN_URL_PATTERN);
	if (!match) {
		throw new ToolError("run must be a numeric workflow run ID or a full GitHub Actions run URL");
	}

	return {
		repo: match[1],
		runId: Number(match[2]),
	};
}

function normalizeRunJob(job: GhActionsJobApi): GhRunJobSnapshot | null {
	if (typeof job.id !== "number") {
		return null;
	}

	return {
		id: job.id,
		name: normalizeOptionalString(job.name) ?? `job-${job.id}`,
		status: normalizeOptionalString(job.status),
		conclusion: normalizeOptionalString(job.conclusion),
		startedAt: normalizeOptionalString(job.started_at),
		completedAt: normalizeOptionalString(job.completed_at),
		url: normalizeOptionalString(job.html_url),
	};
}

function normalizeRunSnapshot(run: GhActionsRunApi, jobs: GhRunJobSnapshot[]): GhRunSnapshot {
	if (typeof run.id !== "number") {
		throw new ToolError("GitHub Actions run response did not include a run ID.");
	}

	return {
		id: run.id,
		workflowName: normalizeOptionalString(run.name),
		displayTitle: normalizeOptionalString(run.display_title),
		status: normalizeOptionalString(run.status),
		conclusion: normalizeOptionalString(run.conclusion),
		branch: normalizeOptionalString(run.head_branch),
		headSha: normalizeOptionalString(run.head_sha),
		createdAt: normalizeOptionalString(run.created_at),
		updatedAt: normalizeOptionalString(run.updated_at),
		url: normalizeOptionalString(run.html_url),
		jobs,
	};
}

function getRunOutcome(value: string | undefined): "success" | "failure" | "pending" {
	if (!value) {
		return "pending";
	}

	if (RUN_SUCCESS_CONCLUSIONS.has(value)) {
		return "success";
	}

	if (RUN_FAILURE_CONCLUSIONS.has(value)) {
		return "failure";
	}

	return "pending";
}

function getRunSnapshotOutcome(run: GhRunSnapshot): "success" | "failure" | "pending" {
	if (run.status !== "completed") {
		return "pending";
	}

	return getRunOutcome(run.conclusion);
}

function getRunCollectionOutcome(runs: GhRunSnapshot[]): "success" | "failure" | "pending" {
	if (runs.length === 0) {
		return "pending";
	}

	let pending = false;
	for (const run of runs) {
		const outcome = getRunSnapshotOutcome(run);
		if (outcome === "failure") {
			return "failure";
		}
		if (outcome === "pending") {
			pending = true;
		}
	}

	return pending ? "pending" : "success";
}

function getRunCollectionSignature(runs: GhRunSnapshot[]): string {
	return runs
		.map(run => run.id)
		.sort((left, right) => left - right)
		.join(",");
}

function isFailedJob(job: GhRunJobSnapshot): boolean {
	return job.conclusion !== undefined && JOB_FAILURE_CONCLUSIONS.has(job.conclusion);
}

function formatJobState(job: GhRunJobSnapshot): string {
	return job.conclusion ?? job.status ?? "unknown";
}

function renderJobsSection(jobs: GhRunJobSnapshot[]): string[] {
	if (jobs.length === 0) {
		return ["## Jobs", "", "No jobs reported yet."];
	}

	const lines: string[] = [`## Jobs (${jobs.length})`, ""];
	for (const job of jobs) {
		lines.push(`- [${formatJobState(job)}] ${job.name}`);
		if (job.startedAt) {
			pushLine(lines, "  Started", job.startedAt);
		}
		if (job.completedAt) {
			pushLine(lines, "  Completed", job.completedAt);
		}
		if (job.url) {
			pushLine(lines, "  URL", job.url);
		}
	}

	return lines;
}

function renderFailedJobLogs(failedJobLogs: GhFailedJobLog[], tail: number): string[] {
	if (failedJobLogs.length === 0) {
		return [];
	}

	const lines: string[] = ["## Failed Jobs", ""];
	for (const entry of failedJobLogs) {
		lines.push(`### ${entry.job.name} [${entry.job.conclusion ?? "failed"}]`);
		pushLine(lines, "Run", `#${entry.run.id}`);
		pushLine(lines, "Workflow", entry.run.workflowName ?? undefined);
		if (entry.job.startedAt) {
			pushLine(lines, "Started", entry.job.startedAt);
		}
		if (entry.job.completedAt) {
			pushLine(lines, "Completed", entry.job.completedAt);
		}
		if (entry.job.url) {
			pushLine(lines, "URL", entry.job.url);
		}
		lines.push("");
		if (entry.available && entry.tail) {
			lines.push(`Last ${tail} log lines:`);
			lines.push("```text");
			lines.push(entry.tail);
			lines.push("```");
		} else {
			lines.push("Log tail unavailable.");
		}
		lines.push("");
	}

	return lines;
}

function renderRunSection(run: GhRunSnapshot): string[] {
	const label = run.workflowName ? `### Run #${run.id} - ${run.workflowName}` : `### Run #${run.id}`;
	const lines: string[] = [label, ""];
	pushLine(lines, "Title", run.displayTitle ?? undefined);
	pushLine(lines, "Branch", run.branch ?? undefined);
	pushLine(lines, "Commit", formatShortSha(run.headSha));
	pushLine(lines, "Status", run.status);
	pushLine(lines, "Conclusion", run.conclusion ?? undefined);
	pushLine(lines, "Created", run.createdAt);
	pushLine(lines, "Updated", run.updatedAt);
	pushLine(lines, "URL", run.url);
	lines.push("");
	lines.push(...renderJobsSection(run.jobs));
	return lines;
}

function formatRunWatchSnapshot(
	repo: string,
	run: GhRunSnapshot,
	pollCount: number,
	note?: string,
	includeOutcome: boolean = false,
): string {
	const failedJobs = run.jobs.filter(isFailedJob);
	const lines: string[] = [`# Watching GitHub Actions Run #${run.id}`, ""];
	pushLine(lines, "Repository", repo);
	pushLine(lines, "Workflow", run.workflowName ?? undefined);
	pushLine(lines, "Title", run.displayTitle ?? undefined);
	pushLine(lines, "Branch", run.branch ?? undefined);
	pushLine(lines, "Status", run.status);
	pushLine(lines, "Conclusion", run.conclusion ?? undefined);
	pushLine(lines, "Created", run.createdAt);
	pushLine(lines, "Updated", run.updatedAt);
	pushLine(lines, "URL", run.url);
	pushLine(lines, "Poll", pollCount);
	pushLine(lines, "Failed jobs", failedJobs.length || undefined);

	if (note) {
		lines.push("");
		lines.push(`Note: ${note}`);
	}

	lines.push("");
	lines.push(...renderJobsSection(run.jobs));

	if (includeOutcome) {
		lines.push("");
		lines.push(failedJobs.length > 0 ? "Failures detected." : "All jobs passed.");
	}

	return lines.join("\n").trim();
}

function formatRunWatchResult(repo: string, run: GhRunSnapshot, failedJobLogs: GhFailedJobLog[], tail: number): string {
	const failedJobs = run.jobs.filter(isFailedJob);
	const lines: string[] = [`# GitHub Actions Run #${run.id}`, ""];
	pushLine(lines, "Repository", repo);
	pushLine(lines, "Workflow", run.workflowName ?? undefined);
	pushLine(lines, "Title", run.displayTitle ?? undefined);
	pushLine(lines, "Branch", run.branch ?? undefined);
	pushLine(lines, "Status", run.status);
	pushLine(lines, "Conclusion", run.conclusion ?? undefined);
	pushLine(lines, "Created", run.createdAt);
	pushLine(lines, "Updated", run.updatedAt);
	pushLine(lines, "URL", run.url);
	lines.push("");
	lines.push(...renderJobsSection(run.jobs));

	if (failedJobs.length > 0) {
		lines.push("");
		lines.push(...renderFailedJobLogs(failedJobLogs, tail));
		lines.push("Run failed.");
	} else if (getRunOutcome(run.conclusion) === "success") {
		lines.push("");
		lines.push("All jobs passed.");
	} else {
		lines.push("");
		lines.push("Run completed without successful jobs, but no failed job logs were available.");
	}

	return lines.join("\n").trim();
}

function formatCommitRunWatchSnapshot(
	repo: string,
	headSha: string,
	branch: string | undefined,
	runs: GhRunSnapshot[],
	pollCount: number,
	note?: string,
): string {
	const failedJobs = runs.flatMap(run => run.jobs.filter(isFailedJob));
	const completedRuns = runs.filter(run => run.status === "completed").length;
	const lines: string[] = [`# Watching GitHub Actions for ${formatShortSha(headSha) ?? headSha}`, ""];
	pushLine(lines, "Repository", repo);
	pushLine(lines, "Branch", branch);
	pushLine(lines, "Commit", headSha);
	pushLine(lines, "Poll", pollCount);
	pushLine(lines, "Runs", runs.length);
	pushLine(lines, "Completed runs", `${completedRuns}/${runs.length}`);
	pushLine(lines, "Failed jobs", failedJobs.length || undefined);

	if (note) {
		lines.push("");
		lines.push(`Note: ${note}`);
	}

	if (runs.length === 0) {
		lines.push("");
		lines.push("Waiting for workflow runs for this commit.");
		return lines.join("\n").trim();
	}

	for (const run of runs) {
		lines.push("");
		lines.push(...renderRunSection(run));
	}

	return lines.join("\n").trim();
}

function formatCommitRunWatchResult(
	repo: string,
	headSha: string,
	branch: string | undefined,
	runs: GhRunSnapshot[],
	failedJobLogs: GhFailedJobLog[],
	tail: number,
): string {
	const outcome = getRunCollectionOutcome(runs);
	const lines: string[] = [`# GitHub Actions for ${formatShortSha(headSha) ?? headSha}`, ""];
	pushLine(lines, "Repository", repo);
	pushLine(lines, "Branch", branch);
	pushLine(lines, "Commit", headSha);
	pushLine(lines, "Runs", runs.length);

	for (const run of runs) {
		lines.push("");
		lines.push(...renderRunSection(run));
	}

	if (failedJobLogs.length > 0) {
		lines.push("");
		lines.push(...renderFailedJobLogs(failedJobLogs, tail));
		lines.push("Workflow runs for this commit failed.");
	} else if (outcome === "success") {
		lines.push("");
		lines.push("All workflow runs for this commit passed.");
	} else {
		lines.push("");
		lines.push("Workflow runs for this commit did not complete successfully.");
	}

	return lines.join("\n").trim();
}

function buildGhDetails(repo: string, run: GhRunSnapshot): GhToolDetails {
	return {
		repo,
		branch: run.branch,
		headSha: run.headSha,
		runId: run.id,
		runIds: [run.id],
		status: run.status,
		conclusion: run.conclusion,
		failedJobs: run.jobs.filter(isFailedJob).map(job => job.name),
	};
}

function buildGhRunCollectionDetails(
	repo: string,
	headSha: string,
	branch: string | undefined,
	runs: GhRunSnapshot[],
): GhToolDetails {
	const outcome = getRunCollectionOutcome(runs);
	return {
		repo,
		branch,
		headSha,
		runIds: runs.map(run => run.id),
		status: runs.length > 0 && runs.every(run => run.status === "completed") ? "completed" : "in_progress",
		conclusion: outcome,
		failedJobs: runs.flatMap(run =>
			run.jobs.filter(isFailedJob).map(job => `${run.workflowName ?? `run ${run.id}`}: ${job.name}`),
		),
	};
}

async function resolveCurrentGitBranch(cwd: string, signal?: AbortSignal): Promise<string> {
	return untilAborted(signal, async () => {
		throwIfAborted(signal);
		const result = await $`git symbolic-ref --short HEAD`.cwd(cwd).quiet().nothrow();
		throwIfAborted(signal);

		if (result.exitCode !== 0) {
			throw new ToolError("Current git branch is unavailable. Pass `branch` or `run` explicitly.");
		}

		const branch = normalizeOptionalString(result.text());
		if (!branch) {
			throw new ToolError("Current git branch is unavailable. Pass `branch` or `run` explicitly.");
		}

		return branch;
	});
}

async function resolveCurrentGitHead(cwd: string, signal?: AbortSignal): Promise<string> {
	return untilAborted(signal, async () => {
		throwIfAborted(signal);
		const result = await $`git rev-parse HEAD`.cwd(cwd).quiet().nothrow();
		throwIfAborted(signal);

		if (result.exitCode !== 0) {
			throw new ToolError("Current git HEAD is unavailable. Pass `run` explicitly.");
		}

		const headSha = normalizeOptionalString(result.text());
		if (!headSha) {
			throw new ToolError("Current git HEAD is unavailable. Pass `run` explicitly.");
		}

		return headSha;
	});
}

async function resolveGitHubRepo(
	cwd: string,
	repo: string | undefined,
	runRepo: string | undefined,
	signal?: AbortSignal,
): Promise<string> {
	if (repo && runRepo && repo !== runRepo) {
		throw new ToolError("run URL repository does not match the provided repo");
	}

	if (repo) {
		return repo;
	}

	if (runRepo) {
		return runRepo;
	}

	const resolved = await runGhText(cwd, ["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"], signal);
	return requireNonEmpty(resolved, "repo");
}

async function fetchRunsForCommit(
	cwd: string,
	repo: string,
	headSha: string,
	branch: string | undefined,
	signal?: AbortSignal,
): Promise<GhRunSnapshot[]> {
	const response = await runGhJson<GhActionsRunListResponse>(
		cwd,
		[
			"api",
			"--method",
			"GET",
			`/repos/${repo}/actions/runs`,
			"-F",
			`head_sha=${headSha}`,
			"-F",
			`per_page=${RUN_JOBS_PAGE_SIZE}`,
			...(branch ? ["-F", `branch=${branch}`] : []),
		],
		signal,
		{ repoProvided: true },
	);

	return Promise.all(
		(response.workflow_runs ?? [])
			.filter((run): run is GhActionsRunApi & { id: number } => typeof run.id === "number")
			.map(async run => {
				const jobs = await fetchRunJobs(cwd, repo, run.id, signal);
				return normalizeRunSnapshot(run, jobs);
			}),
	);
}

async function fetchRunJobs(
	cwd: string,
	repo: string,
	runId: number,
	signal?: AbortSignal,
): Promise<GhRunJobSnapshot[]> {
	const jobs: GhRunJobSnapshot[] = [];
	let page = 1;

	while (true) {
		const response = await runGhJson<GhActionsJobsResponse>(
			cwd,
			[
				"api",
				"--method",
				"GET",
				`/repos/${repo}/actions/runs/${runId}/jobs`,
				"-F",
				`per_page=${RUN_JOBS_PAGE_SIZE}`,
				"-F",
				`page=${page}`,
			],
			signal,
			{ repoProvided: true },
		);
		const pageJobs = (response.jobs ?? [])
			.map(job => normalizeRunJob(job))
			.filter((job): job is GhRunJobSnapshot => job !== null);
		jobs.push(...pageJobs);

		if (pageJobs.length < RUN_JOBS_PAGE_SIZE) {
			break;
		}

		if ((response.total_count ?? 0) <= jobs.length) {
			break;
		}

		page += 1;
	}

	return jobs;
}

async function fetchRunSnapshot(
	cwd: string,
	repo: string,
	runId: number,
	signal?: AbortSignal,
): Promise<GhRunSnapshot> {
	const [run, jobs] = await Promise.all([
		runGhJson<GhActionsRunApi>(cwd, ["api", "--method", "GET", `/repos/${repo}/actions/runs/${runId}`], signal, {
			repoProvided: true,
		}),
		fetchRunJobs(cwd, repo, runId, signal),
	]);

	return normalizeRunSnapshot(run, jobs);
}

function tailLogLines(log: string, tail: number): string | undefined {
	const normalized = normalizeBlock(log);
	if (!normalized) {
		return undefined;
	}

	const lines = normalized.split("\n");
	return lines.slice(-tail).join("\n").trimEnd();
}

async function fetchFailedJobLogs(
	cwd: string,
	repo: string,
	failedJobs: Array<{ run: GhRunSnapshot; job: GhRunJobSnapshot }>,
	tail: number,
	signal?: AbortSignal,
): Promise<GhFailedJobLog[]> {
	return Promise.all(
		failedJobs.map(async entry => {
			const result = await runGhCommand(cwd, ["api", `/repos/${repo}/actions/jobs/${entry.job.id}/logs`], signal);
			const logTail = result.exitCode === 0 ? tailLogLines(result.stdout, tail) : undefined;
			return {
				run: entry.run,
				job: entry.job,
				tail: logTail,
				available: Boolean(logTail),
			};
		}),
	);
}

function formatCommentsSection(comments: GhComment[] | undefined): string[] {
	if (!comments || comments.length === 0) {
		return [];
	}

	const visible = comments.filter(comment => !comment.isMinimized);
	const hiddenCount = comments.length - visible.length;
	const lines: string[] = ["## Comments", ""];

	if (visible.length === 0) {
		lines.push(`No visible comments. Minimized comments omitted: ${hiddenCount}.`);
		return lines;
	}

	lines[0] = `## Comments (${visible.length})`;

	for (const comment of visible) {
		const author = formatAuthor(comment.author) ?? "unknown";
		const createdAt = comment.createdAt ? ` · ${comment.createdAt}` : "";
		lines.push(`### ${author}${createdAt}`);
		lines.push("");
		lines.push(normalizeText(comment.body) || "No comment body.");
		if (comment.url) {
			lines.push("");
			lines.push(`URL: ${comment.url}`);
		}
		lines.push("");
	}

	if (hiddenCount > 0) {
		lines.push(`Minimized comments omitted: ${hiddenCount}.`);
	}

	return lines;
}

function formatReviewsSection(reviews: GhPrReview[] | undefined): string[] {
	if (!reviews || reviews.length === 0) {
		return [];
	}

	const lines: string[] = [`## Reviews (${reviews.length})`, ""];
	for (const review of reviews) {
		const author = formatAuthor(review.author) ?? "unknown";
		const submittedAt = review.submittedAt ? ` - ${review.submittedAt}` : "";
		const state = review.state ? ` [${review.state}]` : "";
		lines.push(`### ${author}${submittedAt}${state}`);
		if (review.commit?.oid) {
			lines.push("");
			lines.push(`Commit: ${formatShortSha(review.commit.oid)}`);
		}
		lines.push("");
		lines.push(normalizeText(review.body) || "No review body.");
		lines.push("");
	}

	return lines;
}

function formatRepoView(data: GhRepoViewData, input: GhRepoViewInput): string {
	const lines: string[] = [];
	const name = data.nameWithOwner ?? input.repo ?? "GitHub Repository";
	lines.push(`# ${name}`);
	lines.push("");
	lines.push(normalizeText(data.description) || "No description provided.");
	lines.push("");
	pushLine(lines, "URL", data.url);
	pushLine(lines, "Default branch", data.defaultBranchRef?.name);
	pushLine(lines, "Branch", normalizeOptionalString(input.branch));
	pushLine(lines, "Visibility", data.visibility ?? undefined);
	pushLine(lines, "Viewer permission", data.viewerPermission ?? undefined);
	pushLine(lines, "Primary language", data.primaryLanguage?.name);
	pushLine(lines, "Stars", data.stargazerCount);
	pushLine(lines, "Forks", data.forkCount);
	pushLine(lines, "Archived", data.isArchived);
	pushLine(lines, "Fork", data.isFork);
	pushLine(lines, "Updated", data.updatedAt);
	pushLine(lines, "Homepage", data.homepageUrl ?? undefined);
	const topics = data.repositoryTopics
		?.map(topic => topic.name ?? topic.topic?.name)
		.filter((value): value is string => Boolean(value))
		.join(", ");
	pushLine(lines, "Topics", topics || undefined);
	return lines.join("\n").trim();
}

function formatIssueView(data: GhIssueViewData, input: GhIssueViewInput): string {
	const lines: string[] = [];
	const issueNumber = data.number ?? input.issue;
	lines.push(`# Issue #${issueNumber}: ${data.title ?? "Untitled"}`);
	lines.push("");
	pushLine(lines, "State", data.state);
	pushLine(lines, "State reason", data.stateReason ?? undefined);
	pushLine(lines, "Author", formatAuthor(data.author));
	pushLine(lines, "Created", data.createdAt);
	pushLine(lines, "Updated", data.updatedAt);
	pushLine(lines, "Labels", formatLabels(data.labels));
	pushLine(lines, "URL", data.url);
	lines.push("");
	lines.push("## Body");
	lines.push("");
	lines.push(normalizeText(data.body) || "No description provided.");

	if ((input.comments ?? true) && data.comments) {
		const commentSection = formatCommentsSection(data.comments);
		if (commentSection.length > 0) {
			lines.push("");
			lines.push(...commentSection);
		}
	}

	return lines.join("\n").trim();
}

function formatPrFiles(files: GhPrFile[] | undefined): string[] {
	if (!files || files.length === 0) return [];

	const lines: string[] = [`## Files (${files.length})`, ""];
	for (const file of files.slice(0, FILE_PREVIEW_LIMIT)) {
		const changeType = file.changeType ?? "CHANGED";
		const additions = file.additions ?? 0;
		const deletions = file.deletions ?? 0;
		lines.push(`- ${file.path ?? "(unknown file)"} [${changeType}] (+${additions} -${deletions})`);
	}

	if (files.length > FILE_PREVIEW_LIMIT) {
		lines.push(`- ... ${files.length - FILE_PREVIEW_LIMIT} more files`);
	}

	return lines;
}

function formatPrView(data: GhPrViewData, input: GhPrViewInput): string {
	const lines: string[] = [];
	const prIdentifier = data.number ?? input.pr ?? "current";
	lines.push(`# Pull Request #${prIdentifier}: ${data.title ?? "Untitled"}`);
	lines.push("");
	pushLine(lines, "State", data.state);
	pushLine(lines, "Draft", data.isDraft);
	pushLine(lines, "Author", formatAuthor(data.author));
	pushLine(lines, "Base", data.baseRefName);
	pushLine(lines, "Head", data.headRefName);
	pushLine(lines, "Review decision", data.reviewDecision ?? undefined);
	pushLine(lines, "Merge state", data.mergeStateStatus);
	pushLine(lines, "Created", data.createdAt);
	pushLine(lines, "Updated", data.updatedAt);
	pushLine(lines, "Labels", formatLabels(data.labels));
	pushLine(lines, "URL", data.url);
	lines.push("");
	lines.push("## Body");
	lines.push("");
	lines.push(normalizeText(data.body) || "No description provided.");

	const fileSection = formatPrFiles(data.files);
	if (fileSection.length > 0) {
		lines.push("");
		lines.push(...fileSection);
	}

	if ((input.comments ?? true) && data.reviews) {
		const reviewSection = formatReviewsSection(data.reviews);
		if (reviewSection.length > 0) {
			lines.push("");
			lines.push(...reviewSection);
		}
	}

	if ((input.comments ?? true) && data.comments) {
		const commentSection = formatCommentsSection(data.comments);
		if (commentSection.length > 0) {
			lines.push("");
			lines.push(...commentSection);
		}
	}

	return lines.join("\n").trim();
}

function formatSearchResults(
	kind: "issues" | "pull requests",
	query: string,
	repo: string | undefined,
	items: GhSearchResult[],
): string {
	const lines: string[] = [`# GitHub ${kind} search`, "", `Query: ${query}`];
	pushLine(lines, "Repository", repo);
	pushLine(lines, "Results", items.length);

	if (items.length === 0) {
		lines.push("");
		lines.push(`No ${kind} found.`);
		return lines.join("\n").trim();
	}

	for (const item of items) {
		lines.push("");
		lines.push(`- #${item.number ?? "?"} ${item.title ?? "Untitled"}`);
		pushLine(lines, "  Repo", item.repository?.nameWithOwner);
		pushLine(lines, "  State", item.state);
		pushLine(lines, "  Author", formatAuthor(item.author));
		pushLine(lines, "  Labels", formatLabels(item.labels));
		pushLine(lines, "  Created", item.createdAt);
		pushLine(lines, "  Updated", item.updatedAt);
		pushLine(lines, "  URL", item.url);
	}

	return lines.join("\n").trim();
}

function buildTextResult(text: string, sourceUrl?: string, details?: GhToolDetails): AgentToolResult<GhToolDetails> {
	const truncation = truncateHead(text);
	const builder = toolResult<GhToolDetails>(details).text(truncation.content);
	if (sourceUrl) {
		builder.sourceUrl(sourceUrl);
	}
	if (truncation.truncated) {
		builder.truncation(truncation, { direction: "head" });
	}
	return builder.done();
}

export class GhRepoViewTool implements AgentTool<typeof ghRepoViewSchema, GhToolDetails> {
	readonly name = "gh_repo_view";
	readonly label = "GitHub Repo";
	readonly description = renderPromptTemplate(ghRepoViewDescription);
	readonly parameters = ghRepoViewSchema;
	readonly strict = true;

	constructor(private readonly session: ToolSession) {}

	static createIf(session: ToolSession): GhRepoViewTool | null {
		if (!isGhAvailable()) return null;
		return new GhRepoViewTool(session);
	}

	async execute(
		_toolCallId: string,
		params: GhRepoViewInput,
		signal?: AbortSignal,
		_onUpdate?: AgentToolUpdateCallback<GhToolDetails>,
		_context?: AgentToolContext,
	): Promise<AgentToolResult<GhToolDetails>> {
		return untilAborted(signal, async () => {
			const repo = normalizeOptionalString(params.repo);
			const branch = normalizeOptionalString(params.branch);
			const args = ["repo", "view"];
			if (repo) {
				args.push(repo);
			}
			if (branch) {
				args.push("--branch", branch);
			}
			args.push("--json", GH_REPO_FIELDS.join(","));

			const data = await runGhJson<GhRepoViewData>(this.session.cwd, args, signal, { repoProvided: Boolean(repo) });
			return buildTextResult(formatRepoView(data, { repo, branch }), data.url);
		});
	}
}

export class GhIssueViewTool implements AgentTool<typeof ghIssueViewSchema, GhToolDetails> {
	readonly name = "gh_issue_view";
	readonly label = "GitHub Issue";
	readonly description = renderPromptTemplate(ghIssueViewDescription);
	readonly parameters = ghIssueViewSchema;
	readonly strict = true;

	constructor(private readonly session: ToolSession) {}

	static createIf(session: ToolSession): GhIssueViewTool | null {
		if (!isGhAvailable()) return null;
		return new GhIssueViewTool(session);
	}

	async execute(
		_toolCallId: string,
		params: GhIssueViewInput,
		signal?: AbortSignal,
		_onUpdate?: AgentToolUpdateCallback<GhToolDetails>,
		_context?: AgentToolContext,
	): Promise<AgentToolResult<GhToolDetails>> {
		return untilAborted(signal, async () => {
			const issue = requireNonEmpty(params.issue, "issue");
			const repo = normalizeOptionalString(params.repo);
			const includeComments = params.comments ?? true;
			const args = ["issue", "view", issue];
			appendRepoFlag(args, repo, issue);
			args.push("--json", (includeComments ? GH_ISSUE_FIELDS : GH_ISSUE_FIELDS_NO_COMMENTS).join(","));

			const data = await runGhJson<GhIssueViewData>(this.session.cwd, args, signal, { repoProvided: Boolean(repo) });
			return buildTextResult(formatIssueView(data, { issue, repo, comments: includeComments }), data.url);
		});
	}
}

export class GhPrViewTool implements AgentTool<typeof ghPrViewSchema, GhToolDetails> {
	readonly name = "gh_pr_view";
	readonly label = "GitHub PR";
	readonly description = renderPromptTemplate(ghPrViewDescription);
	readonly parameters = ghPrViewSchema;
	readonly strict = true;

	constructor(private readonly session: ToolSession) {}

	static createIf(session: ToolSession): GhPrViewTool | null {
		if (!isGhAvailable()) return null;
		return new GhPrViewTool(session);
	}

	async execute(
		_toolCallId: string,
		params: GhPrViewInput,
		signal?: AbortSignal,
		_onUpdate?: AgentToolUpdateCallback<GhToolDetails>,
		_context?: AgentToolContext,
	): Promise<AgentToolResult<GhToolDetails>> {
		return untilAborted(signal, async () => {
			const pr = normalizeOptionalString(params.pr);
			const repo = normalizeOptionalString(params.repo);
			const includeComments = params.comments ?? true;
			const args = ["pr", "view"];
			if (pr) {
				args.push(pr);
			}
			appendRepoFlag(args, repo, pr);
			args.push("--json", (includeComments ? GH_PR_FIELDS : GH_PR_FIELDS_NO_COMMENTS).join(","));

			const data = await runGhJson<GhPrViewData>(this.session.cwd, args, signal, { repoProvided: Boolean(repo) });
			return buildTextResult(formatPrView(data, { pr, repo, comments: includeComments }), data.url);
		});
	}
}

export class GhPrDiffTool implements AgentTool<typeof ghPrDiffSchema, GhToolDetails> {
	readonly name = "gh_pr_diff";
	readonly label = "GitHub PR Diff";
	readonly description = renderPromptTemplate(ghPrDiffDescription);
	readonly parameters = ghPrDiffSchema;
	readonly strict = true;

	constructor(private readonly session: ToolSession) {}

	static createIf(session: ToolSession): GhPrDiffTool | null {
		if (!isGhAvailable()) return null;
		return new GhPrDiffTool(session);
	}

	async execute(
		_toolCallId: string,
		params: GhPrDiffInput,
		signal?: AbortSignal,
		_onUpdate?: AgentToolUpdateCallback<GhToolDetails>,
		_context?: AgentToolContext,
	): Promise<AgentToolResult<GhToolDetails>> {
		return untilAborted(signal, async () => {
			const pr = normalizeOptionalString(params.pr);
			const repo = normalizeOptionalString(params.repo);
			const args = ["pr", "diff"];
			if (pr) {
				args.push(pr);
			}
			appendRepoFlag(args, repo, pr);
			args.push("--color", "never");
			if (params.nameOnly) {
				args.push("--name-only");
			}
			for (const pattern of params.exclude ?? []) {
				const normalizedPattern = requireNonEmpty(pattern, "exclude pattern");
				args.push("--exclude", normalizedPattern);
			}

			const output = await runGhText(this.session.cwd, args, signal, {
				repoProvided: Boolean(repo),
				trimOutput: false,
			});
			const title = params.nameOnly ? "# Pull Request Files" : "# Pull Request Diff";
			const body = output.length > 0 ? output : params.nameOnly ? "No changed files." : "No diff output.";
			return buildTextResult(`${title}\n\n${body}`);
		});
	}
}

export class GhSearchIssuesTool implements AgentTool<typeof ghSearchIssuesSchema, GhToolDetails> {
	readonly name = "gh_search_issues";
	readonly label = "GitHub Issue Search";
	readonly description = renderPromptTemplate(ghSearchIssuesDescription);
	readonly parameters = ghSearchIssuesSchema;
	readonly strict = true;

	constructor(private readonly session: ToolSession) {}

	static createIf(session: ToolSession): GhSearchIssuesTool | null {
		if (!isGhAvailable()) return null;
		return new GhSearchIssuesTool(session);
	}

	async execute(
		_toolCallId: string,
		params: GhSearchIssuesInput,
		signal?: AbortSignal,
		_onUpdate?: AgentToolUpdateCallback<GhToolDetails>,
		_context?: AgentToolContext,
	): Promise<AgentToolResult<GhToolDetails>> {
		return untilAborted(signal, async () => {
			const query = requireNonEmpty(params.query, "query");
			const repo = normalizeOptionalString(params.repo);
			const limit = resolveSearchLimit(params.limit);
			const args = buildGhSearchArgs("issues", query, limit, repo);

			const items = await runGhJson<GhSearchResult[]>(this.session.cwd, args, signal, {
				repoProvided: Boolean(repo),
			});
			return buildTextResult(formatSearchResults("issues", query, repo, items));
		});
	}
}

export class GhSearchPrsTool implements AgentTool<typeof ghSearchPrsSchema, GhToolDetails> {
	readonly name = "gh_search_prs";
	readonly label = "GitHub PR Search";
	readonly description = renderPromptTemplate(ghSearchPrsDescription);
	readonly parameters = ghSearchPrsSchema;
	readonly strict = true;

	constructor(private readonly session: ToolSession) {}

	static createIf(session: ToolSession): GhSearchPrsTool | null {
		if (!isGhAvailable()) return null;
		return new GhSearchPrsTool(session);
	}

	async execute(
		_toolCallId: string,
		params: GhSearchPrsInput,
		signal?: AbortSignal,
		_onUpdate?: AgentToolUpdateCallback<GhToolDetails>,
		_context?: AgentToolContext,
	): Promise<AgentToolResult<GhToolDetails>> {
		return untilAborted(signal, async () => {
			const query = requireNonEmpty(params.query, "query");
			const repo = normalizeOptionalString(params.repo);
			const limit = resolveSearchLimit(params.limit);
			const args = buildGhSearchArgs("prs", query, limit, repo);

			const items = await runGhJson<GhSearchResult[]>(this.session.cwd, args, signal, {
				repoProvided: Boolean(repo),
			});
			return buildTextResult(formatSearchResults("pull requests", query, repo, items));
		});
	}
}

export class GhRunWatchTool implements AgentTool<typeof ghRunWatchSchema, GhToolDetails> {
	readonly name = "gh_run_watch";
	readonly label = "GitHub Run Watch";
	readonly description = renderPromptTemplate(ghRunWatchDescription);
	readonly parameters = ghRunWatchSchema;
	readonly strict = true;

	constructor(private readonly session: ToolSession) {}

	static createIf(session: ToolSession): GhRunWatchTool | null {
		if (!isGhAvailable()) return null;
		return new GhRunWatchTool(session);
	}

	async execute(
		_toolCallId: string,
		params: GhRunWatchInput,
		signal?: AbortSignal,
		onUpdate?: AgentToolUpdateCallback<GhToolDetails>,
		_context?: AgentToolContext,
	): Promise<AgentToolResult<GhToolDetails>> {
		return untilAborted(signal, async () => {
			const repoInput = normalizeOptionalString(params.repo);
			const branchInput = normalizeOptionalString(params.branch);
			const runReference = parseRunReference(params.run);
			const repo = await resolveGitHubRepo(this.session.cwd, repoInput, runReference.repo, signal);
			const intervalSeconds = resolvePositiveSeconds(params.interval, "interval", RUN_WATCH_INTERVAL_DEFAULT);
			const graceSeconds = resolveNonNegativeSeconds(params.grace, "grace", RUN_WATCH_GRACE_DEFAULT);
			const tail = resolveTailLimit(params.tail);
			if (runReference.runId !== undefined) {
				const runId = runReference.runId;
				let pollCount = 0;

				while (true) {
					throwIfAborted(signal);
					pollCount += 1;

					let run = await fetchRunSnapshot(this.session.cwd, repo, runId, signal);
					const details = buildGhDetails(repo, run);
					onUpdate?.({
						content: [{ type: "text", text: formatRunWatchSnapshot(repo, run, pollCount) }],
						details,
					});

					const failedJobs = run.jobs.filter(isFailedJob);
					const runCompleted = run.status === "completed";

					if (failedJobs.length > 0) {
						if (!runCompleted && graceSeconds > 0) {
							onUpdate?.({
								content: [
									{
										type: "text",
										text: formatRunWatchSnapshot(
											repo,
											run,
											pollCount,
											`Failure detected. Waiting ${graceSeconds}s to capture concurrent failures before fetching logs.`,
										),
									},
								],
								details,
							});
							await abortableSleep(graceSeconds * 1000, signal);
							run = await fetchRunSnapshot(this.session.cwd, repo, runId, signal);
						}

						const finalDetails = buildGhDetails(repo, run);
						const failedJobLogs = await fetchFailedJobLogs(
							this.session.cwd,
							repo,
							run.jobs.filter(isFailedJob).map(job => ({ run, job })),
							tail,
							signal,
						);
						return buildTextResult(formatRunWatchResult(repo, run, failedJobLogs, tail), run.url, finalDetails);
					}

					if (runCompleted) {
						const finalDetails = buildGhDetails(repo, run);
						return buildTextResult(formatRunWatchResult(repo, run, [], tail), run.url, finalDetails);
					}

					await abortableSleep(intervalSeconds * 1000, signal);
				}
			}

			if (repoInput) {
				const currentRepo = await resolveGitHubRepo(this.session.cwd, undefined, undefined, signal);
				if (currentRepo !== repo) {
					throw new ToolError(
						"Watching without `run` requires the current checkout to match `repo`. Pass a run ID or run the tool inside that repository.",
					);
				}
			}

			const branch = branchInput ?? (await resolveCurrentGitBranch(this.session.cwd, signal));
			const headSha = await resolveCurrentGitHead(this.session.cwd, signal);
			let pollCount = 0;
			let settledSuccessSignature: string | undefined;

			while (true) {
				throwIfAborted(signal);
				pollCount += 1;

				let runs = await fetchRunsForCommit(this.session.cwd, repo, headSha, branch, signal);
				const details = buildGhRunCollectionDetails(repo, headSha, branch, runs);
				onUpdate?.({
					content: [{ type: "text", text: formatCommitRunWatchSnapshot(repo, headSha, branch, runs, pollCount) }],
					details,
				});

				const outcome = getRunCollectionOutcome(runs);
				if (outcome === "failure") {
					if (graceSeconds > 0) {
						onUpdate?.({
							content: [
								{
									type: "text",
									text: formatCommitRunWatchSnapshot(
										repo,
										headSha,
										branch,
										runs,
										pollCount,
										`Failure detected. Waiting ${graceSeconds}s to capture concurrent failures before fetching logs.`,
									),
								},
							],
							details,
						});
						await abortableSleep(graceSeconds * 1000, signal);
						runs = await fetchRunsForCommit(this.session.cwd, repo, headSha, branch, signal);
					}

					const finalDetails = buildGhRunCollectionDetails(repo, headSha, branch, runs);
					const failedJobLogs = await fetchFailedJobLogs(
						this.session.cwd,
						repo,
						runs.flatMap(run => run.jobs.filter(isFailedJob).map(job => ({ run, job }))),
						tail,
						signal,
					);
					return buildTextResult(
						formatCommitRunWatchResult(repo, headSha, branch, runs, failedJobLogs, tail),
						undefined,
						finalDetails,
					);
				}

				if (outcome === "success") {
					const signature = getRunCollectionSignature(runs);
					if (signature === settledSuccessSignature) {
						const finalDetails = buildGhRunCollectionDetails(repo, headSha, branch, runs);
						return buildTextResult(
							formatCommitRunWatchResult(repo, headSha, branch, runs, [], tail),
							undefined,
							finalDetails,
						);
					}

					settledSuccessSignature = signature;
					onUpdate?.({
						content: [
							{
								type: "text",
								text: formatCommitRunWatchSnapshot(
									repo,
									headSha,
									branch,
									runs,
									pollCount,
									`All known workflow runs completed successfully. Waiting ${intervalSeconds}s to ensure no additional runs appear for this commit.`,
								),
							},
						],
						details,
					});
					await abortableSleep(intervalSeconds * 1000, signal);
					continue;
				}

				settledSuccessSignature = undefined;
				await abortableSleep(intervalSeconds * 1000, signal);
			}
		});
	}
}
