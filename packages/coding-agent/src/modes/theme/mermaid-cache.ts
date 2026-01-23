import {
	extractMermaidBlocks,
	type MermaidImage,
	type MermaidRenderOptions,
	renderMermaidToPng,
} from "@oh-my-pi/pi-tui";

const cache = new Map<string, MermaidImage>();
const pending = new Map<string, Promise<MermaidImage | null>>();

const defaultOptions: MermaidRenderOptions = {
	theme: "dark",
	backgroundColor: "transparent",
};

let onRenderNeeded: (() => void) | null = null;

/**
 * Set callback to trigger TUI re-render when mermaid images become available.
 */
export function setMermaidRenderCallback(callback: (() => void) | null): void {
	onRenderNeeded = callback;
}

/**
 * Get a pre-rendered mermaid image by hash.
 * Returns null if not cached or rendering failed.
 */
export function getMermaidImage(hash: string): MermaidImage | null {
	return cache.get(hash) ?? null;
}

/**
 * Pre-render all mermaid blocks in markdown text.
 * Renders in parallel, deduplicates concurrent requests.
 * Calls render callback when new images are cached.
 */
export async function prerenderMermaid(
	markdown: string,
	options: MermaidRenderOptions = defaultOptions,
): Promise<void> {
	const blocks = extractMermaidBlocks(markdown);
	if (blocks.length === 0) return;

	const promises: Promise<boolean>[] = [];

	for (const { source, hash } of blocks) {
		if (cache.has(hash)) continue;

		let promise = pending.get(hash);
		if (!promise) {
			promise = renderMermaidToPng(source, options);
			pending.set(hash, promise);
		}

		promises.push(
			promise.then((image) => {
				pending.delete(hash);
				if (image) {
					cache.set(hash, image);
					return true;
				}
				return false;
			}),
		);
	}

	const results = await Promise.all(promises);
	const newImages = results.some((added) => added);

	if (newImages && onRenderNeeded) {
		onRenderNeeded();
	}
}

/**
 * Check if markdown contains mermaid blocks that aren't cached yet.
 */
export function hasPendingMermaid(markdown: string): boolean {
	const blocks = extractMermaidBlocks(markdown);
	return blocks.some(({ hash }) => !cache.has(hash));
}

/**
 * Clear the mermaid cache.
 */
export function clearMermaidCache(): void {
	cache.clear();
}
