import type { SpecialHandler } from "./types";
import { finalizeOutput, formatCount, loadPage } from "./types";

/**
 * Handle Hex.pm (Elixir package registry) URLs via API
 */
export const handleHex: SpecialHandler = async (url, timeout, signal) => {
	try {
		const parsed = new URL(url);
		if (parsed.hostname !== "hex.pm" && parsed.hostname !== "www.hex.pm") return null;

		// Extract package name from /packages/name or /packages/name/version
		const match = parsed.pathname.match(/^\/packages\/([^/]+)/);
		if (!match) return null;

		const packageName = decodeURIComponent(match[1]);
		const fetchedAt = new Date().toISOString();

		// Fetch from Hex.pm API
		const apiUrl = `https://hex.pm/api/packages/${packageName}`;
		const result = await loadPage(apiUrl, { timeout, signal });

		if (!result.ok) return null;

		let data: {
			name: string;
			meta?: {
				description?: string;
				links?: Record<string, string>;
				licenses?: string[];
			};
			releases?: Array<{
				version: string;
				inserted_at: string;
			}>;
			downloads?: {
				all?: number;
				week?: number;
				day?: number;
			};
			latest_version?: string;
			latest_stable_version?: string;
		};

		try {
			data = JSON.parse(result.content);
		} catch {
			return null;
		}

		let md = `# ${data.name}\n\n`;
		if (data.meta?.description) md += `${data.meta.description}\n\n`;

		const version = data.latest_stable_version || data.latest_version || "unknown";
		md += `**Latest:** ${version}`;
		if (data.meta?.licenses?.length) md += ` · **License:** ${data.meta.licenses.join(", ")}`;
		md += "\n";

		if (data.downloads?.all) {
			md += `**Total Downloads:** ${formatCount(data.downloads.all)}`;
			if (data.downloads.week) md += ` · **This Week:** ${formatCount(data.downloads.week)}`;
			md += "\n";
		}
		md += "\n";

		if (data.meta?.links && Object.keys(data.meta.links).length > 0) {
			md += `## Links\n\n`;
			for (const [key, value] of Object.entries(data.meta.links)) {
				md += `- **${key}:** ${value}\n`;
			}
			md += "\n";
		}

		// Fetch releases if available
		if (data.releases?.length) {
			const releasesUrl = `https://hex.pm/api/packages/${packageName}/releases/${version}`;
			const releaseResult = await loadPage(releasesUrl, { timeout: Math.min(timeout, 5), signal });

			if (releaseResult.ok) {
				try {
					const releaseData = JSON.parse(releaseResult.content) as {
						requirements?: Record<string, { app?: string; optional: boolean; requirement: string }>;
					};

					if (releaseData.requirements && Object.keys(releaseData.requirements).length > 0) {
						md += `## Dependencies (${version})\n\n`;
						for (const [dep, info] of Object.entries(releaseData.requirements)) {
							const optional = info.optional ? " (optional)" : "";
							md += `- ${dep}: ${info.requirement}${optional}\n`;
						}
						md += "\n";
					}
				} catch {}
			}

			// Show recent releases
			const recentReleases = data.releases.slice(0, 10);
			if (recentReleases.length > 0) {
				md += `## Recent Releases\n\n`;
				for (const release of recentReleases) {
					const date = new Date(release.inserted_at).toISOString().split("T")[0];
					md += `- **${release.version}** (${date})\n`;
				}
			}
		}

		const output = finalizeOutput(md);
		return {
			url,
			finalUrl: url,
			contentType: "text/markdown",
			method: "hex",
			content: output.content,
			fetchedAt,
			truncated: output.truncated,
			notes: ["Fetched via Hex.pm API"],
		};
	} catch {}

	return null;
};
