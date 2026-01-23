/**
 * Read the Docs handler for web-fetch
 */

import { parse as parseHtml } from "node-html-parser";
import type { RenderResult, SpecialHandler } from "./types";
import { finalizeOutput, htmlToBasicMarkdown, loadPage } from "./types";

export const handleReadTheDocs: SpecialHandler = async (
	url: string,
	timeout: number,
	signal?: AbortSignal,
): Promise<RenderResult | null> => {
	// Check if URL matches Read the Docs patterns
	const urlObj = new URL(url);
	const isReadTheDocs =
		urlObj.hostname.endsWith(".readthedocs.io") ||
		urlObj.hostname === "readthedocs.org" ||
		urlObj.hostname === "www.readthedocs.org";

	if (!isReadTheDocs) {
		return null;
	}

	const notes: string[] = [];
	const fetchedAt = new Date().toISOString();

	// Fetch the page
	const result = await loadPage(url, { timeout, signal });
	if (!result.ok) {
		return {
			url,
			finalUrl: result.finalUrl,
			contentType: result.contentType,
			method: "readthedocs",
			content: `Failed to fetch Read the Docs page (status: ${result.status ?? "unknown"})`,
			fetchedAt,
			truncated: false,
			notes,
		};
	}

	// Parse HTML
	const root = parseHtml(result.content);

	// Extract main content from common Read the Docs selectors
	let mainContent =
		root.querySelector(".document") ||
		root.querySelector('[role="main"]') ||
		root.querySelector("main") ||
		root.querySelector(".rst-content") ||
		root.querySelector(".body");

	if (!mainContent) {
		// Fallback to body if no main content found
		mainContent = root.querySelector("body");
		notes.push("Using full body content (no main content div found)");
	}

	// Remove navigation, sidebar, footer elements
	mainContent
		?.querySelectorAll(
			".headerlink, .viewcode-link, nav, .sidebar, footer, .related, .sphinxsidebar, .toctree-wrapper",
		)
		.forEach((el) => {
			el.remove();
		});

	// Try to find Edit on GitHub/GitLab links for raw source
	const editLinks = root.querySelectorAll('a[href*="github.com"], a[href*="gitlab.com"]');
	let sourceUrl: string | null = null;

	for (const link of editLinks) {
		const href = link.getAttribute("href");
		const text = link.textContent?.toLowerCase() || "";

		if (href && (text.includes("edit") || text.includes("source"))) {
			// Convert edit URL to raw URL
			if (href.includes("github.com")) {
				sourceUrl = href.replace("/blob/", "/raw/").replace("/edit/", "/raw/");
			} else if (href.includes("gitlab.com")) {
				sourceUrl = href.replace("/blob/", "/raw/").replace("/edit/", "/raw/");
			}
			break;
		}
	}

	let content = "";

	// Try to fetch raw source if available
	if (sourceUrl) {
		try {
			const sourceResult = await loadPage(sourceUrl, { timeout: Math.min(timeout, 10), signal });
			if (sourceResult.ok && sourceResult.content.length > 0 && sourceResult.content.length < 1_000_000) {
				content = sourceResult.content;
				notes.push(`Fetched raw source from ${sourceUrl}`);
			}
		} catch {
			// Ignore errors, fall back to HTML
		}
	}

	// If no raw source, convert HTML to markdown
	if (!content && mainContent) {
		const html = mainContent.innerHTML;
		content = htmlToBasicMarkdown(html);
	}

	if (!content) {
		content = "No content extracted from Read the Docs page";
		notes.push("Failed to extract content");
	}

	const { content: finalContent, truncated } = finalizeOutput(content);

	return {
		url,
		finalUrl: result.finalUrl,
		contentType: sourceUrl ? "text/plain" : "text/html",
		method: "readthedocs",
		content: finalContent,
		fetchedAt,
		truncated,
		notes,
	};
};
