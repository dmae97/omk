import type { RenderResult, SpecialHandler } from "./types";
import { finalizeOutput, htmlToBasicMarkdown, loadPage } from "./types";

interface SpdxCrossRef {
	url?: string;
	isValid?: boolean;
	isLive?: boolean;
	match?: string;
	order?: number;
}

interface SpdxLicense {
	licenseId: string;
	name: string;
	isOsiApproved?: boolean;
	isFsfLibre?: boolean;
	licenseText?: string;
	licenseTextHtml?: string;
	seeAlso?: string[];
	crossRef?: SpdxCrossRef[];
	comment?: string;
	licenseComments?: string;
}

function formatYesNo(value?: boolean): string {
	if (value === true) return "Yes";
	if (value === false) return "No";
	return "Unknown";
}

function collectCrossReferences(license: SpdxLicense): string[] {
	const ordered = (license.crossRef ?? [])
		.filter((ref) => ref.url)
		.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
		.map((ref) => ref.url as string);

	const seeAlso = (license.seeAlso ?? []).filter((url) => url);
	const combined = [...ordered, ...seeAlso];
	return combined.filter((url, index) => combined.indexOf(url) === index);
}

/**
 * Handle SPDX license URLs via SPDX JSON API
 */
export const handleSpdx: SpecialHandler = async (
	url: string,
	timeout: number,
	signal?: AbortSignal,
): Promise<RenderResult | null> => {
	try {
		const parsed = new URL(url);
		if (parsed.hostname !== "spdx.org" && parsed.hostname !== "www.spdx.org") return null;

		const match = parsed.pathname.match(/^\/licenses\/([^/]+?)(?:\.html)?\/?$/i);
		if (!match) return null;

		const licenseId = decodeURIComponent(match[1]);
		if (!licenseId) return null;

		const fetchedAt = new Date().toISOString();
		const apiUrl = `https://spdx.org/licenses/${encodeURIComponent(licenseId)}.json`;
		const result = await loadPage(apiUrl, {
			timeout,
			headers: { Accept: "application/json" },
			signal,
		});

		if (!result.ok) return null;

		let license: SpdxLicense;
		try {
			license = JSON.parse(result.content);
		} catch {
			return null;
		}

		const title = license.name || license.licenseId || licenseId;
		let md = `# ${title}\n\n`;

		md += `**License ID:** ${license.licenseId ? `\`${license.licenseId}\`` : `\`${licenseId}\``}\n`;
		md += `**OSI Approved:** ${formatYesNo(license.isOsiApproved)}\n`;
		md += `**FSF Libre:** ${formatYesNo(license.isFsfLibre)}\n`;

		const description = license.licenseComments ?? license.comment;
		if (description) {
			md += `\n## Description\n\n${description}\n`;
		}

		const crossReferences = collectCrossReferences(license);
		if (crossReferences.length) {
			md += `\n## Cross References\n\n`;
			for (const ref of crossReferences) {
				md += `- ${ref}\n`;
			}
		}

		const licenseText = license.licenseText
			? license.licenseText
			: license.licenseTextHtml
				? htmlToBasicMarkdown(license.licenseTextHtml)
				: null;

		if (licenseText) {
			md += `\n## License Text\n\n\`\`\`\n${licenseText}\n\`\`\`\n`;
		}

		const output = finalizeOutput(md);
		return {
			url,
			finalUrl: url,
			contentType: "text/markdown",
			method: "spdx-api",
			content: output.content,
			fetchedAt,
			truncated: output.truncated,
			notes: ["Fetched via SPDX license API"],
		};
	} catch {}

	return null;
};
