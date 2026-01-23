import type { RenderResult, SpecialHandler } from "./types";
import { finalizeOutput, formatCount, loadPage } from "./types";

interface NuGetODataEntry {
	Id: string;
	Version: string;
	Title?: string;
	Description?: string;
	Summary?: string;
	Authors?: string;
	ProjectUrl?: string;
	PackageSourceUrl?: string;
	Tags?: string;
	DownloadCount?: number;
	VersionDownloadCount?: number;
	Published?: string;
	LicenseUrl?: string;
	ReleaseNotes?: string;
	Dependencies?: string;
}

interface NuGetODataResponse {
	d?: {
		results?: NuGetODataEntry[];
	};
}

/**
 * Handle Chocolatey package URLs via NuGet v2 OData API
 */
export const handleChocolatey: SpecialHandler = async (
	url: string,
	timeout: number,
	signal?: AbortSignal,
): Promise<RenderResult | null> => {
	try {
		const parsed = new URL(url);
		if (!parsed.hostname.includes("chocolatey.org")) return null;

		// Extract package name from /packages/{name} or /packages/{name}/{version}
		const match = parsed.pathname.match(/^\/packages\/([^/]+)(?:\/([^/]+))?/);
		if (!match) return null;

		const packageName = decodeURIComponent(match[1]);
		const specificVersion = match[2] ? decodeURIComponent(match[2]) : null;

		const fetchedAt = new Date().toISOString();

		// Build OData query - filter by Id and optionally version
		let apiUrl = `https://community.chocolatey.org/api/v2/Packages()?$filter=Id%20eq%20'${encodeURIComponent(packageName)}'`;
		if (specificVersion) {
			apiUrl += `%20and%20Version%20eq%20'${encodeURIComponent(specificVersion)}'`;
		} else {
			// Get latest version by ordering and taking first
			apiUrl += "&$orderby=Version%20desc&$top=1";
		}

		const result = await loadPage(apiUrl, {
			timeout,
			signal,
			headers: {
				Accept: "application/json",
			},
		});

		if (!result.ok) return null;

		let data: NuGetODataResponse;
		try {
			data = JSON.parse(result.content);
		} catch {
			return null;
		}

		const pkg = data.d?.results?.[0];
		if (!pkg) return null;

		// Build markdown output
		let md = `# ${pkg.Title || pkg.Id}\n\n`;

		if (pkg.Summary) {
			md += `${pkg.Summary}\n\n`;
		} else if (pkg.Description) {
			// Use first paragraph of description as summary
			const firstPara = pkg.Description.split(/\n\n/)[0];
			md += `${firstPara}\n\n`;
		}

		md += `**Version:** ${pkg.Version}`;
		if (pkg.Authors) md += ` · **Authors:** ${pkg.Authors}`;
		md += "\n";

		if (pkg.DownloadCount !== undefined) {
			md += `**Total Downloads:** ${formatCount(pkg.DownloadCount)}`;
			if (pkg.VersionDownloadCount !== undefined) {
				md += ` · **Version Downloads:** ${formatCount(pkg.VersionDownloadCount)}`;
			}
			md += "\n";
		}

		if (pkg.Published) {
			const date = new Date(pkg.Published);
			md += `**Published:** ${date.toISOString().split("T")[0]}\n`;
		}

		md += "\n";

		if (pkg.ProjectUrl) md += `**Project URL:** ${pkg.ProjectUrl}\n`;
		if (pkg.PackageSourceUrl) md += `**Source:** ${pkg.PackageSourceUrl}\n`;
		if (pkg.LicenseUrl) md += `**License:** ${pkg.LicenseUrl}\n`;

		if (pkg.Tags) {
			const tags = pkg.Tags.split(/\s+/).filter((t) => t.length > 0);
			if (tags.length > 0) {
				md += `**Tags:** ${tags.join(", ")}\n`;
			}
		}

		// Full description if different from summary
		if (pkg.Description && pkg.Description !== pkg.Summary) {
			md += `\n## Description\n\n${pkg.Description}\n`;
		}

		if (pkg.ReleaseNotes) {
			md += `\n## Release Notes\n\n${pkg.ReleaseNotes}\n`;
		}

		if (pkg.Dependencies) {
			// Dependencies format: "id:version|id:version"
			const deps = pkg.Dependencies.split("|").filter((d) => d.trim().length > 0);
			if (deps.length > 0) {
				md += `\n## Dependencies\n\n`;
				for (const dep of deps) {
					const [depId, depVersion] = dep.split(":");
					if (depId) {
						md += `- ${depId}${depVersion ? `: ${depVersion}` : ""}\n`;
					}
				}
			}
		}

		md += `\n---\n**Install:** \`choco install ${packageName}\`\n`;

		const output = finalizeOutput(md);
		return {
			url,
			finalUrl: url,
			contentType: "text/markdown",
			method: "chocolatey",
			content: output.content,
			fetchedAt,
			truncated: output.truncated,
			notes: ["Fetched via Chocolatey NuGet API"],
		};
	} catch {}

	return null;
};
