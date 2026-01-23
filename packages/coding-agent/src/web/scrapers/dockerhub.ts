import type { RenderResult, SpecialHandler } from "./types";
import { finalizeOutput, formatCount, loadPage } from "./types";

interface DockerHubRepo {
	name: string;
	namespace: string;
	description?: string;
	star_count?: number;
	pull_count?: number;
	last_updated?: string;
	is_official?: boolean;
	is_automated?: boolean;
	user?: string;
}

interface DockerHubTag {
	name: string;
	last_updated?: string;
	full_size?: number;
	digest?: string;
	images?: Array<{
		architecture?: string;
		os?: string;
		size?: number;
	}>;
}

interface DockerHubTagsResponse {
	results?: DockerHubTag[];
}

function formatSize(bytes: number): string {
	if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)}GB`;
	if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)}MB`;
	if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(1)}KB`;
	return `${bytes}B`;
}

/**
 * Handle Docker Hub URLs via API
 */
export const handleDockerHub: SpecialHandler = async (
	url: string,
	timeout: number,
	signal?: AbortSignal,
): Promise<RenderResult | null> => {
	try {
		const parsed = new URL(url);
		if (!parsed.hostname.includes("hub.docker.com")) return null;

		let namespace: string;
		let repository: string;

		// Official images: /_ /{image}
		const officialMatch = parsed.pathname.match(/^\/_\/([^/]+)/);
		if (officialMatch) {
			namespace = "library";
			repository = officialMatch[1];
		} else {
			// Regular images: /r/{namespace}/{repository}
			const repoMatch = parsed.pathname.match(/^\/r\/([^/]+)\/([^/]+)/);
			if (!repoMatch) return null;
			namespace = repoMatch[1];
			repository = repoMatch[2];
		}

		const fetchedAt = new Date().toISOString();

		// Fetch repository info and tags in parallel
		const repoUrl = `https://hub.docker.com/v2/repositories/${namespace}/${repository}/`;
		const tagsUrl = `https://hub.docker.com/v2/repositories/${namespace}/${repository}/tags/?page_size=10`;

		const [repoResult, tagsResult] = await Promise.all([
			loadPage(repoUrl, { timeout, headers: { Accept: "application/json" }, signal }),
			loadPage(tagsUrl, { timeout: Math.min(timeout, 10), headers: { Accept: "application/json" }, signal }),
		]);

		if (!repoResult.ok) return null;

		let repo: DockerHubRepo;
		try {
			repo = JSON.parse(repoResult.content);
		} catch {
			return null;
		}

		// Parse tags
		let tags: DockerHubTag[] = [];
		if (tagsResult.ok) {
			try {
				const tagsData = JSON.parse(tagsResult.content) as DockerHubTagsResponse;
				tags = tagsData.results ?? [];
			} catch {}
		}

		// Build markdown output
		const fullName = namespace === "library" ? repo.name : `${namespace}/${repo.name}`;
		let md = `# ${fullName}\n\n`;

		if (repo.description) {
			md += `${repo.description}\n\n`;
		}

		// Stats line
		const stats: string[] = [];
		if (repo.pull_count !== undefined) stats.push(`**Pulls:** ${formatCount(repo.pull_count)}`);
		if (repo.star_count !== undefined) stats.push(`**Stars:** ${formatCount(repo.star_count)}`);
		if (repo.is_official) stats.push("**Official Image**");
		if (repo.is_automated) stats.push("**Automated Build**");
		if (stats.length > 0) {
			md += `${stats.join(" · ")}\n`;
		}

		if (repo.last_updated) {
			const date = new Date(repo.last_updated);
			md += `**Last Updated:** ${date.toISOString().split("T")[0]}\n`;
		}

		md += "\n";

		// Docker pull command
		md += "## Quick Start\n\n";
		md += "```bash\n";
		md += `docker pull ${fullName}\n`;
		md += "```\n\n";

		// Tags
		if (tags.length > 0) {
			md += "## Recent Tags\n\n";
			md += "| Tag | Size | Architectures | Updated |\n";
			md += "|-----|------|---------------|--------|\n";

			for (const tag of tags) {
				const size = tag.full_size ? formatSize(tag.full_size) : "-";
				const archs =
					tag.images
						?.map((img) => img.architecture)
						.filter(Boolean)
						.join(", ") || "-";
				const updated = tag.last_updated ? new Date(tag.last_updated).toISOString().split("T")[0] : "-";
				md += `| \`${tag.name}\` | ${size} | ${archs} | ${updated} |\n`;
			}
			md += "\n";
		}

		const output = finalizeOutput(md);
		return {
			url,
			finalUrl: url,
			contentType: "text/markdown",
			method: "dockerhub",
			content: output.content,
			fetchedAt,
			truncated: output.truncated,
			notes: ["Fetched via Docker Hub API"],
		};
	} catch {}

	return null;
};
