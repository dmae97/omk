import { parse as parseHtml } from "node-html-parser";
import { ToolAbortError } from "$c/tools/tool-errors";
import type { RenderResult, SpecialHandler } from "./types";
import { finalizeOutput, loadPage } from "./types";

const NITTER_INSTANCES = [
	"nitter.privacyredirect.com",
	"nitter.tiekoetter.com",
	"nitter.poast.org",
	"nitter.woodland.cafe",
];

/**
 * Handle Twitter/X URLs via Nitter
 */
export const handleTwitter: SpecialHandler = async (
	url: string,
	timeout: number,
	signal?: AbortSignal,
): Promise<RenderResult | null> => {
	try {
		const parsed = new URL(url);
		if (!["twitter.com", "x.com", "www.twitter.com", "www.x.com"].includes(parsed.hostname)) {
			return null;
		}

		const fetchedAt = new Date().toISOString();

		// Try Nitter instances
		for (const instance of NITTER_INSTANCES) {
			const nitterUrl = `https://${instance}${parsed.pathname}`;
			const result = await loadPage(nitterUrl, { timeout: Math.min(timeout, 10), signal });

			if (result.ok && result.content.length > 500) {
				// Parse the Nitter HTML
				const doc = parseHtml(result.content);

				// Extract tweet content
				const tweetContent = doc.querySelector(".tweet-content")?.text?.trim();
				const fullname = doc.querySelector(".fullname")?.text?.trim();
				const username = doc.querySelector(".username")?.text?.trim();
				const date = doc.querySelector(".tweet-date a")?.text?.trim();
				const stats = doc.querySelector(".tweet-stats")?.text?.trim();

				if (tweetContent) {
					let md = `# Tweet by ${fullname || "Unknown"} (${username || "@?"})\n\n`;
					if (date) md += `*${date}*\n\n`;
					md += `${tweetContent}\n\n`;
					if (stats) md += `---\n${stats.replace(/\s+/g, " ")}\n`;

					// Check for replies/thread
					const replies = doc.querySelectorAll(".timeline-item .tweet-content");
					if (replies.length > 1) {
						md += `\n---\n\n## Thread/Replies\n\n`;
						for (const reply of Array.from(replies).slice(1, 10)) {
							const replyUser = reply.parentNode?.querySelector(".username")?.text?.trim();
							md += `**${replyUser || "@?"}**: ${reply.text?.trim()}\n\n`;
						}
					}

					const output = finalizeOutput(md);
					return {
						url,
						finalUrl: nitterUrl,
						contentType: "text/markdown",
						method: "twitter-nitter",
						content: output.content,
						fetchedAt,
						truncated: output.truncated,
						notes: [`Via Nitter: ${instance}`],
					};
				}
			}
		}
	} catch {
		if (signal?.aborted) {
			throw new ToolAbortError();
		}
	}

	if (signal?.aborted) {
		throw new ToolAbortError();
	}

	// X.com blocks all bots - return a helpful error instead of falling through
	return {
		url,
		finalUrl: url,
		contentType: "text/plain",
		method: "twitter-blocked",
		content:
			"Twitter/X blocks automated access. Nitter instances were unavailable.\n\nTry:\n- Opening the link in a browser\n- Using a different Nitter instance manually\n- Checking if the tweet is available via an archive service",
		fetchedAt: new Date().toISOString(),
		truncated: false,
		notes: ["X.com blocks bots; Nitter instances unavailable"],
	};
};
