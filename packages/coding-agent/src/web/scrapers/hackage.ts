import type { RenderResult, SpecialHandler } from "./types";
import { finalizeOutput, loadPage } from "./types";

interface HackagePackage {
	name: string;
	synopsis: string;
	description: string;
	license: string;
	author: string;
	maintainer: string;
	version: string;
	homepage?: string;
	"bug-reports"?: string;
	category?: string;
	stability?: string;
	dependencies?: Record<string, string>;
}

/**
 * Handle Hackage (Haskell package registry) URLs via JSON API
 */
export const handleHackage: SpecialHandler = async (
	url: string,
	timeout: number,
	signal?: AbortSignal,
): Promise<RenderResult | null> => {
	try {
		const parsed = new URL(url);
		if (parsed.hostname !== "hackage.haskell.org") return null;

		// Match /package/{name} or /package/{name}-{version}
		const match = parsed.pathname.match(/^\/package\/([^/]+)(?:\/|$)/);
		if (!match) return null;

		const packageId = decodeURIComponent(match[1]);
		const fetchedAt = new Date().toISOString();

		// Fetch package info with JSON accept header
		const apiUrl = `https://hackage.haskell.org/package/${encodeURIComponent(packageId)}`;
		const result = await loadPage(apiUrl, {
			timeout,
			headers: { Accept: "application/json" },
			signal,
		});

		if (!result.ok) return null;

		let pkg: HackagePackage;
		try {
			pkg = JSON.parse(result.content);
		} catch {
			return null;
		}

		let md = `# ${pkg.name}\n\n`;
		if (pkg.synopsis) md += `${pkg.synopsis}\n\n`;

		md += `**Version:** ${pkg.version}`;
		if (pkg.license) md += ` · **License:** ${pkg.license}`;
		md += "\n";

		if (pkg.author) md += `**Author:** ${pkg.author}\n`;
		if (pkg.maintainer) md += `**Maintainer:** ${pkg.maintainer}\n`;
		if (pkg.category) md += `**Category:** ${pkg.category}\n`;
		if (pkg.stability) md += `**Stability:** ${pkg.stability}\n`;
		if (pkg.homepage) md += `**Homepage:** ${pkg.homepage}\n`;
		if (pkg["bug-reports"]) md += `**Bug Reports:** ${pkg["bug-reports"]}\n`;

		if (pkg.description) {
			md += `\n## Description\n\n${pkg.description}\n`;
		}

		if (pkg.dependencies && Object.keys(pkg.dependencies).length > 0) {
			md += `\n## Dependencies\n\n`;
			for (const [dep, version] of Object.entries(pkg.dependencies)) {
				md += `- ${dep}: ${version}\n`;
			}
		}

		const output = finalizeOutput(md);
		return {
			url,
			finalUrl: url,
			contentType: "text/markdown",
			method: "hackage",
			content: output.content,
			fetchedAt,
			truncated: output.truncated,
			notes: ["Fetched via Hackage API"],
		};
	} catch {}

	return null;
};
