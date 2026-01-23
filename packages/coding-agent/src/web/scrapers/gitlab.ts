import {
	finalizeOutput,
	formatCount,
	htmlToBasicMarkdown,
	loadPage,
	type RenderResult,
	type SpecialHandler,
} from "./types";

interface GitLabUrl {
	namespace: string;
	project: string;
	type: "repo" | "blob" | "tree" | "issue" | "merge_request";
	ref?: string;
	path?: string;
	id?: number;
}

/**
 * Parse GitLab URL into structured data
 */
function parseGitLabUrl(url: string): GitLabUrl | null {
	try {
		const parsed = new URL(url);
		if (parsed.hostname !== "gitlab.com") return null;

		const segments = parsed.pathname.split("/").filter(Boolean);
		if (segments.length < 2) return null;

		const [namespace, project, ...rest] = segments;

		// Repo root
		if (rest.length === 0) {
			return { namespace, project, type: "repo" };
		}

		// Skip - prefix
		if (rest[0] !== "-") return null;

		const [, type, ...remaining] = rest;

		// File: gitlab.com/{ns}/{proj}/-/blob/{ref}/{path}
		if (type === "blob" && remaining.length >= 2) {
			const [ref, ...pathParts] = remaining;
			return {
				namespace,
				project,
				type: "blob",
				ref,
				path: pathParts.join("/"),
			};
		}

		// Directory: gitlab.com/{ns}/{proj}/-/tree/{ref}/{path}
		if (type === "tree" && remaining.length >= 1) {
			const [ref, ...pathParts] = remaining;
			return {
				namespace,
				project,
				type: "tree",
				ref,
				path: pathParts.length > 0 ? pathParts.join("/") : undefined,
			};
		}

		// Issue: gitlab.com/{ns}/{proj}/-/issues/{id}
		if (type === "issues" && remaining.length === 1) {
			const id = parseInt(remaining[0], 10);
			if (Number.isNaN(id)) return null;
			return { namespace, project, type: "issue", id };
		}

		// MR: gitlab.com/{ns}/{proj}/-/merge_requests/{id}
		if (type === "merge_requests" && remaining.length === 1) {
			const id = parseInt(remaining[0], 10);
			if (Number.isNaN(id)) return null;
			return { namespace, project, type: "merge_request", id };
		}

		return null;
	} catch {
		return null;
	}
}

/**
 * Get project ID from namespace/project path
 */
async function getProjectId(gl: GitLabUrl, timeout: number, signal?: AbortSignal): Promise<number | null> {
	const encodedPath = encodeURIComponent(`${gl.namespace}/${gl.project}`);
	const apiUrl = `https://gitlab.com/api/v4/projects/${encodedPath}`;

	const result = await loadPage(apiUrl, { timeout, signal });
	if (!result.ok) return null;

	try {
		const data = JSON.parse(result.content) as { id: number };
		return data.id;
	} catch {
		return null;
	}
}

/**
 * Render GitLab repository
 */
async function renderGitLabRepo(
	gl: GitLabUrl,
	timeout: number,
	signal?: AbortSignal,
): Promise<{ content: string; ok: boolean }> {
	const encodedPath = encodeURIComponent(`${gl.namespace}/${gl.project}`);
	const apiUrl = `https://gitlab.com/api/v4/projects/${encodedPath}`;

	const result = await loadPage(apiUrl, { timeout, signal });
	if (!result.ok) return { content: "", ok: false };

	try {
		const repo = JSON.parse(result.content) as {
			name: string;
			description?: string;
			star_count: number;
			forks_count: number;
			open_issues_count: number;
			default_branch: string;
			visibility: string;
			created_at: string;
			last_activity_at: string;
			topics?: string[];
			readme_url?: string;
		};

		let md = `# ${repo.name}\n\n`;
		if (repo.description) md += `${repo.description}\n\n`;
		md += `**Stars:** ${formatCount(repo.star_count)} · **Forks:** ${formatCount(repo.forks_count)} · **Issues:** ${formatCount(repo.open_issues_count)}\n`;
		md += `**Visibility:** ${repo.visibility} · **Default Branch:** ${repo.default_branch}\n`;
		if (repo.topics && repo.topics.length > 0) {
			md += `**Topics:** ${repo.topics.join(", ")}\n`;
		}
		md += `**Created:** ${new Date(repo.created_at).toISOString().split("T")[0]} · **Last Activity:** ${new Date(repo.last_activity_at).toISOString().split("T")[0]}\n\n`;

		// Try to fetch README
		if (repo.readme_url) {
			const readmeResult = await loadPage(repo.readme_url, { timeout, signal });
			if (readmeResult.ok && readmeResult.content.trim().length > 0) {
				md += `---\n\n## README\n\n${readmeResult.content}\n`;
			}
		}

		return { content: md, ok: true };
	} catch {
		return { content: "", ok: false };
	}
}

/**
 * Render GitLab file
 */
async function renderGitLabFile(
	gl: GitLabUrl,
	projectId: number,
	timeout: number,
	signal?: AbortSignal,
): Promise<{ content: string; ok: boolean }> {
	const encodedPath = encodeURIComponent(gl.path!);
	const apiUrl = `https://gitlab.com/api/v4/projects/${projectId}/repository/files/${encodedPath}/raw?ref=${gl.ref}`;

	const result = await loadPage(apiUrl, { timeout, signal });
	if (!result.ok) return { content: "", ok: false };

	return { content: result.content, ok: true };
}

/**
 * Render GitLab directory tree
 */
async function renderGitLabTree(
	gl: GitLabUrl,
	projectId: number,
	timeout: number,
	signal?: AbortSignal,
): Promise<{ content: string; ok: boolean }> {
	const apiUrl = `https://gitlab.com/api/v4/projects/${projectId}/repository/tree?ref=${gl.ref}&path=${gl.path || ""}&per_page=100`;

	const result = await loadPage(apiUrl, { timeout, signal });
	if (!result.ok) return { content: "", ok: false };

	try {
		const tree = JSON.parse(result.content) as Array<{
			name: string;
			type: "tree" | "blob";
			path: string;
			mode: string;
		}>;

		let md = `# Directory: ${gl.path || "/"}\n\n`;
		md += `**Ref:** ${gl.ref}\n\n`;

		// Separate directories and files
		const dirs = tree.filter((item) => item.type === "tree");
		const files = tree.filter((item) => item.type === "blob");

		if (dirs.length > 0) {
			md += `## Directories (${dirs.length})\n\n`;
			for (const dir of dirs) {
				md += `- 📁 ${dir.name}/\n`;
			}
			md += `\n`;
		}

		if (files.length > 0) {
			md += `## Files (${files.length})\n\n`;
			for (const file of files) {
				md += `- 📄 ${file.name}\n`;
			}
		}

		return { content: md, ok: true };
	} catch {
		return { content: "", ok: false };
	}
}

/**
 * Render GitLab issue
 */
async function renderGitLabIssue(
	gl: GitLabUrl,
	projectId: number,
	timeout: number,
	signal?: AbortSignal,
): Promise<{ content: string; ok: boolean }> {
	const apiUrl = `https://gitlab.com/api/v4/projects/${projectId}/issues/${gl.id}`;

	const result = await loadPage(apiUrl, { timeout, signal });
	if (!result.ok) return { content: "", ok: false };

	try {
		const issue = JSON.parse(result.content) as {
			title: string;
			description?: string;
			state: string;
			author: { name: string; username: string };
			created_at: string;
			updated_at: string;
			labels: string[];
			upvotes: number;
			downvotes: number;
			user_notes_count: number;
			assignees?: Array<{ name: string }>;
		};

		let md = `# Issue #${gl.id}: ${issue.title}\n\n`;
		md += `**State:** ${issue.state.toUpperCase()} · **Author:** ${issue.author.name} (@${issue.author.username})\n`;
		md += `**Created:** ${new Date(issue.created_at).toISOString().split("T")[0]} · **Updated:** ${new Date(issue.updated_at).toISOString().split("T")[0]}\n`;
		md += `**Upvotes:** ${issue.upvotes} · **Downvotes:** ${issue.downvotes} · **Comments:** ${issue.user_notes_count}\n`;

		if (issue.labels.length > 0) {
			md += `**Labels:** ${issue.labels.join(", ")}\n`;
		}

		if (issue.assignees && issue.assignees.length > 0) {
			md += `**Assignees:** ${issue.assignees.map((a) => a.name).join(", ")}\n`;
		}

		md += `\n---\n\n## Description\n\n`;
		md += issue.description ? htmlToBasicMarkdown(issue.description) : "*No description*";

		return { content: md, ok: true };
	} catch {
		return { content: "", ok: false };
	}
}

/**
 * Render GitLab merge request
 */
async function renderGitLabMR(
	gl: GitLabUrl,
	projectId: number,
	timeout: number,
	signal?: AbortSignal,
): Promise<{ content: string; ok: boolean }> {
	const apiUrl = `https://gitlab.com/api/v4/projects/${projectId}/merge_requests/${gl.id}`;

	const result = await loadPage(apiUrl, { timeout, signal });
	if (!result.ok) return { content: "", ok: false };

	try {
		const mr = JSON.parse(result.content) as {
			title: string;
			description?: string;
			state: string;
			author: { name: string; username: string };
			created_at: string;
			updated_at: string;
			source_branch: string;
			target_branch: string;
			labels: string[];
			upvotes: number;
			downvotes: number;
			user_notes_count: number;
			assignees?: Array<{ name: string }>;
			draft: boolean;
			merge_status: string;
		};

		let md = `# MR !${gl.id}: ${mr.title}\n\n`;
		if (mr.draft) md += `**[DRAFT]** `;
		md += `**State:** ${mr.state.toUpperCase()} · **Author:** ${mr.author.name} (@${mr.author.username})\n`;
		md += `**Branch:** ${mr.source_branch} → ${mr.target_branch}\n`;
		md += `**Created:** ${new Date(mr.created_at).toISOString().split("T")[0]} · **Updated:** ${new Date(mr.updated_at).toISOString().split("T")[0]}\n`;
		md += `**Merge Status:** ${mr.merge_status} · **Upvotes:** ${mr.upvotes} · **Downvotes:** ${mr.downvotes} · **Comments:** ${mr.user_notes_count}\n`;

		if (mr.labels.length > 0) {
			md += `**Labels:** ${mr.labels.join(", ")}\n`;
		}

		if (mr.assignees && mr.assignees.length > 0) {
			md += `**Assignees:** ${mr.assignees.map((a) => a.name).join(", ")}\n`;
		}

		md += `\n---\n\n## Description\n\n`;
		md += mr.description ? htmlToBasicMarkdown(mr.description) : "*No description*";

		return { content: md, ok: true };
	} catch {
		return { content: "", ok: false };
	}
}

/**
 * Handle GitLab URLs specially
 */
export const handleGitLab: SpecialHandler = async (
	url: string,
	timeout: number,
	signal?: AbortSignal,
): Promise<RenderResult | null> => {
	const gl = parseGitLabUrl(url);
	if (!gl) return null;

	const fetchedAt = new Date().toISOString();
	const notes: string[] = [];

	switch (gl.type) {
		case "blob": {
			const projectId = await getProjectId(gl, timeout, signal);
			if (!projectId) break;

			notes.push(`Fetched raw file via GitLab API`);
			const result = await renderGitLabFile(gl, projectId, timeout, signal);
			if (result.ok) {
				const output = finalizeOutput(result.content);
				return {
					url,
					finalUrl: url,
					contentType: "text/plain",
					method: "gitlab-raw",
					content: output.content,
					fetchedAt,
					truncated: output.truncated,
					notes,
				};
			}
			break;
		}

		case "tree": {
			const projectId = await getProjectId(gl, timeout, signal);
			if (!projectId) break;

			notes.push(`Fetched directory tree via GitLab API`);
			const result = await renderGitLabTree(gl, projectId, timeout, signal);
			if (result.ok) {
				const output = finalizeOutput(result.content);
				return {
					url,
					finalUrl: url,
					contentType: "text/markdown",
					method: "gitlab-tree",
					content: output.content,
					fetchedAt,
					truncated: output.truncated,
					notes,
				};
			}
			break;
		}

		case "issue": {
			const projectId = await getProjectId(gl, timeout, signal);
			if (!projectId) break;

			notes.push(`Fetched issue via GitLab API`);
			const result = await renderGitLabIssue(gl, projectId, timeout, signal);
			if (result.ok) {
				const output = finalizeOutput(result.content);
				return {
					url,
					finalUrl: url,
					contentType: "text/markdown",
					method: "gitlab-issue",
					content: output.content,
					fetchedAt,
					truncated: output.truncated,
					notes,
				};
			}
			break;
		}

		case "merge_request": {
			const projectId = await getProjectId(gl, timeout, signal);
			if (!projectId) break;

			notes.push(`Fetched merge request via GitLab API`);
			const result = await renderGitLabMR(gl, projectId, timeout, signal);
			if (result.ok) {
				const output = finalizeOutput(result.content);
				return {
					url,
					finalUrl: url,
					contentType: "text/markdown",
					method: "gitlab-mr",
					content: output.content,
					fetchedAt,
					truncated: output.truncated,
					notes,
				};
			}
			break;
		}

		case "repo": {
			notes.push(`Fetched repository via GitLab API`);
			const result = await renderGitLabRepo(gl, timeout, signal);
			if (result.ok) {
				const output = finalizeOutput(result.content);
				return {
					url,
					finalUrl: url,
					contentType: "text/markdown",
					method: "gitlab-repo",
					content: output.content,
					fetchedAt,
					truncated: output.truncated,
					notes,
				};
			}
			break;
		}
	}

	return null;
};
