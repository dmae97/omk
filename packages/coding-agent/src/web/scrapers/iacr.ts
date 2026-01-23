import { parse as parseHtml } from "node-html-parser";
import type { RenderResult, SpecialHandler } from "./types";
import { finalizeOutput, loadPage } from "./types";
import { convertWithMarkitdown, fetchBinary } from "./utils";

/**
 * Handle IACR ePrint Archive URLs
 */
export const handleIacr: SpecialHandler = async (
	url: string,
	timeout: number,
	signal?: AbortSignal,
): Promise<RenderResult | null> => {
	try {
		const parsed = new URL(url);
		if (parsed.hostname !== "eprint.iacr.org") return null;

		// Extract paper ID from /year/number or /year/number.pdf
		const match = parsed.pathname.match(/\/(\d{4})\/(\d+)(?:\.pdf)?$/);
		if (!match) return null;

		const [, year, number] = match;
		const paperId = `${year}/${number}`;
		const fetchedAt = new Date().toISOString();
		const notes: string[] = [];

		// Fetch the HTML page for metadata
		const pageUrl = `https://eprint.iacr.org/${paperId}`;
		const result = await loadPage(pageUrl, { timeout, signal });

		if (!result.ok) return null;

		const doc = parseHtml(result.content);

		// Extract metadata from the page
		const title =
			doc.querySelector("h3.mb-3")?.text?.trim() ||
			doc.querySelector('meta[name="citation_title"]')?.getAttribute("content");
		const authors = doc
			.querySelectorAll('meta[name="citation_author"]')
			.map((m) => m.getAttribute("content"))
			.filter(Boolean);
		// Abstract is in <p> after <h5>Abstract</h5>
		const abstractHeading = doc.querySelectorAll("h5").find((h) => h.text?.includes("Abstract"));
		const abstract =
			abstractHeading?.parentNode?.querySelector("p")?.text?.trim() ||
			doc.querySelector('meta[name="description"]')?.getAttribute("content");
		const keywords = doc.querySelector(".keywords")?.text?.replace("Keywords:", "").trim();
		const pubDate = doc.querySelector('meta[name="citation_publication_date"]')?.getAttribute("content");

		let md = `# ${title || "IACR ePrint Paper"}\n\n`;
		if (authors.length) md += `**Authors:** ${authors.join(", ")}\n`;
		if (pubDate) md += `**Date:** ${pubDate}\n`;
		md += `**ePrint:** ${paperId}\n`;
		if (keywords) md += `**Keywords:** ${keywords}\n`;
		md += `\n---\n\n## Abstract\n\n${abstract || "No abstract available."}\n\n`;

		// If it was a PDF link, try to fetch and convert PDF
		if (parsed.pathname.endsWith(".pdf")) {
			const pdfUrl = `https://eprint.iacr.org/${paperId}.pdf`;
			notes.push("Fetching PDF for full content...");
			const pdfResult = await fetchBinary(pdfUrl, timeout, signal);
			if (pdfResult.ok) {
				const converted = await convertWithMarkitdown(pdfResult.buffer, ".pdf", timeout, signal);
				if (converted.ok && converted.content.length > 500) {
					md += `---\n\n## Full Paper\n\n${converted.content}\n`;
					notes.push("PDF converted via markitdown");
				}
			}
		}

		const output = finalizeOutput(md);
		return {
			url,
			finalUrl: url,
			contentType: "text/markdown",
			method: "iacr",
			content: output.content,
			fetchedAt,
			truncated: output.truncated,
			notes: notes.length ? notes : ["Fetched from IACR ePrint Archive"],
		};
	} catch {}

	return null;
};
