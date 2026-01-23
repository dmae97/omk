import type { SpecialHandler } from "./types";
import { finalizeOutput, htmlToBasicMarkdown, loadPage } from "./types";

interface MDNSection {
	type: string;
	value: {
		id?: string;
		title?: string;
		content?: string;
		isH3?: boolean;
		code?: string;
		language?: string;
		items?: Array<{ term: string; description: string }>;
		rows?: string[][];
	};
}

interface MDNDoc {
	doc: {
		title: string;
		summary: string;
		mdn_url: string;
		body: MDNSection[];
		browserCompat?: unknown;
	};
}

/**
 * Convert MDN body sections to markdown
 */
function convertMDNBody(sections: MDNSection[]): string {
	const parts: string[] = [];

	for (const section of sections) {
		const { type, value } = section;

		switch (type) {
			case "prose":
				if (value.content) {
					const markdown = htmlToBasicMarkdown(value.content);
					if (value.title) {
						const level = value.isH3 ? "###" : "##";
						parts.push(`${level} ${value.title}\n\n${markdown}`);
					} else {
						parts.push(markdown);
					}
				}
				break;

			case "browser_compatibility":
				if (value.title) {
					parts.push(`## ${value.title}\n\n(See browser compatibility data at MDN)`);
				}
				break;

			case "specifications":
				if (value.title) {
					parts.push(`## ${value.title}\n\n(See specifications at MDN)`);
				}
				break;

			case "code_example":
				if (value.title) {
					parts.push(`### ${value.title}`);
				}
				if (value.code) {
					const lang = value.language || "";
					parts.push(`\`\`\`${lang}\n${value.code}\n\`\`\``);
				}
				break;

			case "definition_list":
				if (value.items) {
					for (const item of value.items) {
						parts.push(`**${item.term}**`);
						const desc = htmlToBasicMarkdown(item.description);
						parts.push(desc);
					}
				}
				break;

			case "table":
				if (value.rows && value.rows.length > 0) {
					// Simple markdown table
					const header = value.rows[0].map((cell) => htmlToBasicMarkdown(cell)).join(" | ");
					const separator = value.rows[0].map(() => "---").join(" | ");
					const bodyRows = value.rows
						.slice(1)
						.map((row) => row.map((cell) => htmlToBasicMarkdown(cell)).join(" | "));

					parts.push(`| ${header} |`);
					parts.push(`| ${separator} |`);
					for (const row of bodyRows) {
						parts.push(`| ${row} |`);
					}
				}
				break;

			default:
				// Skip unknown types
				break;
		}
	}

	return parts.join("\n\n");
}

export const handleMDN: SpecialHandler = async (url: string, timeout: number, signal?: AbortSignal) => {
	const urlObj = new URL(url);

	// Only handle developer.mozilla.org
	if (!urlObj.hostname.includes("developer.mozilla.org")) {
		return null;
	}

	// Only handle docs paths
	if (!urlObj.pathname.includes("/docs/")) {
		return null;
	}

	const notes: string[] = [];

	// Construct JSON API URL
	const jsonUrl = url.replace(/\/?$/, "/index.json");

	try {
		const result = await loadPage(jsonUrl, { timeout, signal, headers: { Accept: "application/json" } });

		if (!result.ok) {
			notes.push(`Failed to fetch MDN JSON API (status ${result.status || "unknown"})`);
			return null;
		}

		const data: MDNDoc = JSON.parse(result.content);
		const { doc } = data;

		if (!doc || !doc.title) {
			notes.push("Invalid MDN JSON structure");
			return null;
		}

		// Build markdown content
		const parts: string[] = [];

		parts.push(`# ${doc.title}`);

		if (doc.summary) {
			const summary = htmlToBasicMarkdown(doc.summary);
			parts.push(summary);
		}

		if (doc.body && doc.body.length > 0) {
			const bodyMarkdown = convertMDNBody(doc.body);
			parts.push(bodyMarkdown);
		}

		const rawContent = parts.join("\n\n");
		const { content, truncated } = finalizeOutput(rawContent);

		return {
			url,
			finalUrl: doc.mdn_url || result.finalUrl,
			contentType: "text/markdown",
			method: "mdn",
			content,
			fetchedAt: new Date().toISOString(),
			truncated,
			notes,
		};
	} catch (err) {
		notes.push(`MDN handler error: ${err instanceof Error ? err.message : String(err)}`);
		return null;
	}
};
