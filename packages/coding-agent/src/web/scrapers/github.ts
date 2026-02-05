import { $env, ptree } from "@oh-my-pi/pi-utils";
import type { RenderResult, SpecialHandler } from "./types";
import { finalizeOutput, loadPage } from "./types";

interface GitHubUrl {
	type: "blob" | "tree" | "repo" | "issue" | "issues" | "pull" | "pulls" | "discussion" | "discussions" | "other";
	owner: string;
	repo: string;
	ref?: string;
	path?: string;
	number?: number;
}

/**
 * Parse GitHub URL into components
 */
function parseGitHubUrl(url: string): GitHubUrl | null {
	try {
		const parsed = new URL(url);
		if (parsed.hostname !== "github.com") return null;

		const parts = parsed.pathname.split("/").filter(Boolean);
		if (parts.length < 2) return null;

		const [owner, repo, ...rest] = parts;

		if (rest.length === 0) {
			return { type: "repo", owner, repo };
		}

		const [section, ...subParts] = rest;

		switch (section) {
			case "blob":
			case "tree": {
				const [ref, ...pathParts] = subParts;
				return { type: section, owner, repo, ref, path: pathParts.join("/") };
			}
			case "issues":
				if (subParts.length > 0 && /^\d+$/.test(subParts[0])) {
					return { type: "issue", owner, repo, number: parseInt(subParts[0], 10) };
				}
				return { type: "issues", owner, repo };
			case "pull":
				if (subParts.length > 0 && /^\d+$/.test(subParts[0])) {
					return { type: "pull", owner, repo, number: parseInt(subParts[0], 10) };
				}
				return { type: "pulls", owner, repo };
			case "pulls":
				return { type: "pulls", owner, repo };
			case "discussions":
				if (subParts.length > 0 && /^\d+$/.test(subParts[0])) {
					return { type: "discussion", owner, repo, number: parseInt(subParts[0], 10) };
				}
				return { type: "discussions", owner, repo };
			default:
				return { type: "other", owner, repo };
		}
	} catch {
		return null;
	}
}

/**
 * Convert GitHub blob URL to raw URL
 */
function toRawGitHubUrl(gh: GitHubUrl): string {
	return `https://raw.githubusercontent.com/${gh.owner}/${gh.repo}/${gh.ref}/${gh.path}`;
}

/**
 * Fetch from GitHub API
 */
export async function fetchGitHubApi(
	endpoint: string,
	timeout: number,
	signal?: AbortSignal,
): Promise<{ data: unknown; ok: boolean }> {
	try {
		const requestSignal = ptree.combineSignals(signal, timeout * 1000);

		const headers: Record<string, string> = {
			Accept: "application/vnd.github.v3+json",
			"User-Agent": "omp-web-fetch/1.0",
		};

		// Use GITHUB_TOKEN if available
		const token = $env.GITHUB_TOKEN || $env.GH_TOKEN;
		if (token) {
			headers.Authorization = `Bearer ${token}`;
		}

		const response = await fetch(`https://api.github.com${endpoint}`, {
			signal: requestSignal,
			headers,
		});

		if (!response.ok) {
			return { data: null, ok: false };
		}

		return { data: await response.json(), ok: true };
	} catch {
		return { data: null, ok: false };
	}
}

/**
 * Render GitHub issue/PR to markdown
 */
async function renderGitHubIssue(
	gh: GitHubUrl,
	timeout: number,
	signal?: AbortSignal,
): Promise<{ content: string; ok: boolean }> {
	const endpoint =
		gh.type === "pull"
			? `/repos/${gh.owner}/${gh.repo}/pulls/${gh.number}`
			: `/repos/${gh.owner}/${gh.repo}/issues/${gh.number}`;

	const result = await fetchGitHubApi(endpoint, timeout, signal);
	if (!result.ok || !result.data) return { content: "", ok: false };

	const issue = result.data as {
		title: string;
		number: number;
		state: string;
		user: { login: string };
		created_at: string;
		updated_at: string;
		body: string | null;
		labels: Array<{ name: string }>;
		comments: number;
		html_url: string;
	};

	let md = `# ${issue.title}\n\n`;
	md += `**#${issue.number}** · ${issue.state} · opened by @${issue.user.login}\n`;
	md += `Created: ${issue.created_at} · Updated: ${issue.updated_at}\n`;
	if (issue.labels.length > 0) {
		md += `Labels: ${issue.labels.map(l => l.name).join(", ")}\n`;
	}
	md += `\n---\n\n`;
	md += issue.body || "*No description provided.*";
	md += `\n\n---\n\n`;

	// Fetch comments if any
	if (issue.comments > 0) {
		const commentsResult = await fetchGitHubApi(
			`/repos/${gh.owner}/${gh.repo}/issues/${gh.number}/comments?per_page=50`,
			timeout,
			signal,
		);
		if (commentsResult.ok && Array.isArray(commentsResult.data)) {
			md += `## Comments (${issue.comments})\n\n`;
			for (const comment of commentsResult.data as Array<{
				user: { login: string };
				created_at: string;
				body: string;
			}>) {
				md += `### @${comment.user.login} · ${comment.created_at}\n\n`;
				md += `${comment.body}\n\n---\n\n`;
			}
		}
	}

	return { content: md, ok: true };
}

/**
 * Render GitHub issues list to markdown
 */
async function renderGitHubIssuesList(
	gh: GitHubUrl,
	timeout: number,
	signal?: AbortSignal,
): Promise<{ content: string; ok: boolean }> {
	const result = await fetchGitHubApi(`/repos/${gh.owner}/${gh.repo}/issues?state=open&per_page=30`, timeout, signal);
	if (!result.ok || !Array.isArray(result.data)) return { content: "", ok: false };

	const issues = result.data as Array<{
		number: number;
		title: string;
		state: string;
		user: { login: string };
		created_at: string;
		comments: number;
		labels: Array<{ name: string }>;
		pull_request?: unknown;
	}>;

	let md = `# ${gh.owner}/${gh.repo} - Open Issues\n\n`;

	for (const issue of issues) {
		if (issue.pull_request) continue; // Skip PRs in issues list
		const labels = issue.labels.length > 0 ? ` [${issue.labels.map(l => l.name).join(", ")}]` : "";
		md += `- **#${issue.number}** ${issue.title}${labels}\n`;
		md += `  by @${issue.user.login} · ${issue.comments} comments · ${issue.created_at}\n\n`;
	}

	return { content: md, ok: true };
}

/**
 * Render GitHub tree (directory) to markdown
 */
async function renderGitHubTree(
	gh: GitHubUrl,
	timeout: number,
	signal?: AbortSignal,
): Promise<{ content: string; ok: boolean }> {
	// Fetch repo info first to get default branch if ref not specified
	const repoResult = await fetchGitHubApi(`/repos/${gh.owner}/${gh.repo}`, timeout, signal);
	if (!repoResult.ok) return { content: "", ok: false };

	const repo = repoResult.data as {
		full_name: string;
		default_branch: string;
	};

	const ref = gh.ref || repo.default_branch;
	const dirPath = gh.path || "";

	let md = `# ${repo.full_name}/${dirPath || "(root)"}\n\n`;
	md += `**Branch:** ${ref}\n\n`;

	// Fetch directory contents
	const contentsResult = await fetchGitHubApi(
		`/repos/${gh.owner}/${gh.repo}/contents/${dirPath}?ref=${ref}`,
		timeout,
		signal,
	);

	if (contentsResult.ok && Array.isArray(contentsResult.data)) {
		const items = contentsResult.data as Array<{
			name: string;
			type: "file" | "dir" | "symlink" | "submodule";
			size?: number;
			path: string;
		}>;

		// Sort: directories first, then files, alphabetically
		items.sort((a, b) => {
			if (a.type === "dir" && b.type !== "dir") return -1;
			if (a.type !== "dir" && b.type === "dir") return 1;
			return a.name.localeCompare(b.name);
		});

		md += `## Contents\n\n`;
		md += "```\n";
		for (const item of items) {
			const prefix = item.type === "dir" ? "[dir] " : "      ";
			const size = item.size ? ` (${item.size} bytes)` : "";
			md += `${prefix}${item.name}${item.type === "file" ? size : ""}\n`;
		}
		md += "```\n\n";

		// Look for README in this directory
		const readmeFile = items.find(item => item.type === "file" && /^readme\.md$/i.test(item.name));
		if (readmeFile) {
			const readmePath = dirPath ? `${dirPath}/${readmeFile.name}` : readmeFile.name;
			const rawUrl = `https://raw.githubusercontent.com/${gh.owner}/${gh.repo}/${ref}/${readmePath}`;
			const readmeResult = await loadPage(rawUrl, { timeout, signal });
			if (readmeResult.ok) {
				md += `---\n\n## README\n\n${readmeResult.content}`;
			}
		}
	}

	return { content: md, ok: true };
}

/**
 * Render GitHub repo to markdown (file list + README)
 */
async function renderGitHubRepo(
	gh: GitHubUrl,
	timeout: number,
	signal?: AbortSignal,
): Promise<{ content: string; ok: boolean }> {
	// Fetch repo info
	const repoResult = await fetchGitHubApi(`/repos/${gh.owner}/${gh.repo}`, timeout, signal);
	if (!repoResult.ok) return { content: "", ok: false };

	const repo = repoResult.data as {
		full_name: string;
		description: string | null;
		stargazers_count: number;
		forks_count: number;
		open_issues_count: number;
		default_branch: string;
		language: string | null;
		license: { name: string } | null;
	};

	let md = `# ${repo.full_name}\n\n`;
	if (repo.description) md += `${repo.description}\n\n`;
	md += `Stars: ${repo.stargazers_count} · Forks: ${repo.forks_count} · Issues: ${repo.open_issues_count}\n`;
	if (repo.language) md += `Language: ${repo.language}\n`;
	if (repo.license) md += `License: ${repo.license.name}\n`;
	md += `\n---\n\n`;

	// Fetch file tree
	const treeResult = await fetchGitHubApi(
		`/repos/${gh.owner}/${gh.repo}/git/trees/${repo.default_branch}?recursive=1`,
		timeout,
		signal,
	);
	if (treeResult.ok && treeResult.data) {
		const tree = (treeResult.data as { tree: Array<{ path: string; type: string }> }).tree;
		md += `## Files\n\n`;
		md += "```\n";
		for (const item of tree.slice(0, 100)) {
			const prefix = item.type === "tree" ? "[dir] " : "      ";
			md += `${prefix}${item.path}\n`;
		}
		if (tree.length > 100) {
			md += `... and ${tree.length - 100} more files\n`;
		}
		md += "```\n\n";
	}

	// Fetch README
	const readmeResult = await fetchGitHubApi(`/repos/${gh.owner}/${gh.repo}/readme`, timeout, signal);
	if (readmeResult.ok && readmeResult.data) {
		const readme = readmeResult.data as { content: string; encoding: string };
		if (readme.encoding === "base64") {
			const decoded = Buffer.from(readme.content, "base64").toString("utf-8");
			md += `## README\n\n${decoded}`;
		}
	}

	return { content: md, ok: true };
}

/**
 * Handle GitHub URLs specially
 */
export const handleGitHub: SpecialHandler = async (
	url: string,
	timeout: number,
	signal?: AbortSignal,
): Promise<RenderResult | null> => {
	const gh = parseGitHubUrl(url);
	if (!gh) return null;

	const fetchedAt = new Date().toISOString();
	const notes: string[] = [];

	switch (gh.type) {
		case "blob": {
			// Convert to raw URL and fetch
			const rawUrl = toRawGitHubUrl(gh);
			notes.push(`Fetched raw: ${rawUrl}`);
			const result = await loadPage(rawUrl, { timeout, signal });
			if (result.ok) {
				const output = finalizeOutput(result.content);
				return {
					url,
					finalUrl: rawUrl,
					contentType: "text/plain",
					method: "github-raw",
					content: output.content,
					fetchedAt,
					truncated: output.truncated,
					notes,
				};
			}
			break;
		}

		case "tree": {
			notes.push(`Fetched via GitHub API`);
			const result = await renderGitHubTree(gh, timeout, signal);
			if (result.ok) {
				const output = finalizeOutput(result.content);
				return {
					url,
					finalUrl: url,
					contentType: "text/markdown",
					method: "github-tree",
					content: output.content,
					fetchedAt,
					truncated: output.truncated,
					notes,
				};
			}
			break;
		}

		case "issue":
		case "pull": {
			notes.push(`Fetched via GitHub API`);
			const result = await renderGitHubIssue(gh, timeout, signal);
			if (result.ok) {
				const output = finalizeOutput(result.content);
				return {
					url,
					finalUrl: url,
					contentType: "text/markdown",
					method: gh.type === "pull" ? "github-pr" : "github-issue",
					content: output.content,
					fetchedAt,
					truncated: output.truncated,
					notes,
				};
			}
			break;
		}

		case "issues": {
			notes.push(`Fetched via GitHub API`);
			const result = await renderGitHubIssuesList(gh, timeout, signal);
			if (result.ok) {
				const output = finalizeOutput(result.content);
				return {
					url,
					finalUrl: url,
					contentType: "text/markdown",
					method: "github-issues",
					content: output.content,
					fetchedAt,
					truncated: output.truncated,
					notes,
				};
			}
			break;
		}

		case "repo": {
			notes.push(`Fetched via GitHub API`);
			const result = await renderGitHubRepo(gh, timeout, signal);
			if (result.ok) {
				const output = finalizeOutput(result.content);
				return {
					url,
					finalUrl: url,
					contentType: "text/markdown",
					method: "github-repo",
					content: output.content,
					fetchedAt,
					truncated: output.truncated,
					notes,
				};
			}
			break;
		}
	}

	// Fall back to null (let normal rendering handle it)
	return null;
};
