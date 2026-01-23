import type { RenderResult, SpecialHandler } from "./types";
import { finalizeOutput, loadPage } from "./types";

const TLDR_BASE = "https://raw.githubusercontent.com/tldr-pages/tldr/main/pages";
const PLATFORMS = ["common", "linux", "osx"] as const;

/**
 * Handle tldr page URLs
 * - https://tldr.sh/{command}
 * - https://tldr.ostera.io/{command}
 */
export const handleTldr: SpecialHandler = async (
	url: string,
	timeout: number,
	signal?: AbortSignal,
): Promise<RenderResult | null> => {
	try {
		const parsed = new URL(url);
		if (parsed.hostname !== "tldr.sh" && parsed.hostname !== "tldr.ostera.io") return null;

		// Extract command from path (e.g., /tar -> tar)
		const command = parsed.pathname.replace(/^\//, "").replace(/\.md$/, "");
		if (!command || command.includes("/")) return null;

		const fetchedAt = new Date().toISOString();

		// Try platforms in order: common, linux, osx
		for (const platform of PLATFORMS) {
			const rawUrl = `${TLDR_BASE}/${platform}/${command}.md`;
			const result = await loadPage(rawUrl, { timeout, signal });

			if (result.ok && result.content.trim()) {
				const output = finalizeOutput(result.content);
				return {
					url,
					finalUrl: rawUrl,
					contentType: "text/markdown",
					method: "tldr",
					content: output.content,
					fetchedAt,
					truncated: output.truncated,
					notes: [`Fetched from tldr-pages (${platform})`],
				};
			}
		}

		return null;
	} catch {}

	return null;
};
