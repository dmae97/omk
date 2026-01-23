import { parse as parseHtml } from "node-html-parser";
import type { RenderResult, SpecialHandler } from "./types";
import { finalizeOutput, loadPage } from "./types";
import { convertWithMarkitdown, fetchBinary } from "./utils";

/**
 * Handle arXiv URLs via arXiv API
 */
export const handleArxiv: SpecialHandler = async (
	url: string,
	timeout: number,
	signal?: AbortSignal,
): Promise<RenderResult | null> => {
	try {
		const parsed = new URL(url);
		if (parsed.hostname !== "arxiv.org") return null;

		// Extract paper ID from various URL formats
		// /abs/1234.56789, /pdf/1234.56789, /abs/cs/0123456
		const match = parsed.pathname.match(/\/(abs|pdf)\/(.+?)(?:\.pdf)?$/);
		if (!match) return null;

		const paperId = match[2];
		const fetchedAt = new Date().toISOString();
		const notes: string[] = [];

		// Fetch metadata via arXiv API
		const apiUrl = `https://export.arxiv.org/api/query?id_list=${paperId}`;
		const result = await loadPage(apiUrl, { timeout, signal });

		if (!result.ok) return null;

		// Parse the Atom feed response
		const doc = parseHtml(result.content, { parseNoneClosedTags: true });
		const entry = doc.querySelector("entry");

		if (!entry) return null;

		const title = entry.querySelector("title")?.text?.trim()?.replace(/\s+/g, " ");
		const summary = entry.querySelector("summary")?.text?.trim();
		const authors = entry
			.querySelectorAll("author name")
			.map((n) => n.text?.trim())
			.filter(Boolean);
		const published = entry.querySelector("published")?.text?.trim()?.split("T")[0];
		const categories = entry
			.querySelectorAll("category")
			.map((c) => c.getAttribute("term"))
			.filter(Boolean);
		const pdfLink = entry.querySelector('link[title="pdf"]')?.getAttribute("href");

		let md = `# ${title || "arXiv Paper"}\n\n`;
		if (authors.length) md += `**Authors:** ${authors.join(", ")}\n`;
		if (published) md += `**Published:** ${published}\n`;
		if (categories.length) md += `**Categories:** ${categories.join(", ")}\n`;
		md += `**arXiv:** ${paperId}\n\n`;
		md += `---\n\n## Abstract\n\n${summary || "No abstract available."}\n\n`;

		// If it was a PDF link or we want full content, try to fetch and convert PDF
		if (match[1] === "pdf" || parsed.pathname.includes(".pdf")) {
			if (pdfLink) {
				notes.push("Fetching PDF for full content...");
				const pdfResult = await fetchBinary(pdfLink, timeout, signal);
				if (pdfResult.ok) {
					const converted = await convertWithMarkitdown(pdfResult.buffer, ".pdf", timeout, signal);
					if (converted.ok && converted.content.length > 500) {
						md += `---\n\n## Full Paper\n\n${converted.content}\n`;
						notes.push("PDF converted via markitdown");
					}
				}
			}
		}

		const output = finalizeOutput(md);
		return {
			url,
			finalUrl: url,
			contentType: "text/markdown",
			method: "arxiv",
			content: output.content,
			fetchedAt,
			truncated: output.truncated,
			notes: notes.length ? notes : ["Fetched via arXiv API"],
		};
	} catch {}

	return null;
};
