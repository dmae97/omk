import { extractMermaidBlocks, logger, renderMermaidAsciiSafe } from "@oh-my-pi/pi-utils";

const cache = new Map<bigint, string>();
const failed = new Set<bigint>();

let onRenderNeeded: (() => void) | null = null;

/**
 * Set callback to trigger TUI re-render when mermaid ASCII renders become available.
 */
export function setMermaidRenderCallback(callback: (() => void) | null): void {
	onRenderNeeded = callback;
}

/**
 * Get a pre-rendered mermaid ASCII diagram by hash.
 * Returns null if not cached or rendering failed.
 */
export function getMermaidAscii(hash: bigint): string | null {
	return cache.get(hash) ?? null;
}

/**
 * Render all mermaid blocks in markdown text.
 * Caches results and calls render callback when new diagrams are available.
 */
export function prerenderMermaid(markdown: string): void {
	const blocks = extractMermaidBlocks(markdown);
	if (blocks.length === 0) return;

	let hasNew = false;

	for (const { source, hash } of blocks) {
		if (cache.has(hash) || failed.has(hash)) continue;

		const ascii = renderMermaidAsciiSafe(source);
		if (ascii) {
			cache.set(hash, ascii);
			hasNew = true;
		} else {
			failed.add(hash);
		}
	}

	if (hasNew && onRenderNeeded) {
		try {
			onRenderNeeded();
		} catch (error) {
			logger.warn("Mermaid render callback failed", {
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}
}

/**
 * Check if markdown contains mermaid blocks that aren't cached yet.
 */
export function hasPendingMermaid(markdown: string): boolean {
	const blocks = extractMermaidBlocks(markdown);
	return blocks.some(({ hash }) => !cache.has(hash) && !failed.has(hash));
}

/**
 * Clear the mermaid cache.
 */
export function clearMermaidCache(): void {
	cache.clear();
	failed.clear();
}
