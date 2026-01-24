import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { $ } from "bun";

export interface MermaidImage {
	base64: string;
	widthPx: number;
	heightPx: number;
}

export interface MermaidRenderOptions {
	theme?: "default" | "dark" | "forest" | "neutral";
	backgroundColor?: string;
	width?: number;
	scale?: number;
}

/**
 * Render mermaid diagram source to PNG.
 *
 * Uses `mmdc` (mermaid-cli) which must be installed and in PATH.
 * Returns null if rendering fails or mmdc is unavailable.
 */
export async function renderMermaidToPng(
	source: string,
	options: MermaidRenderOptions = {},
): Promise<MermaidImage | null> {
	const mmdc = Bun.which("mmdc");
	if (!mmdc) {
		return null;
	}

	const tmpDir = path.join(os.tmpdir(), `mermaid-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	const inputPath = path.join(tmpDir, "input.mmd");
	const outputPath = path.join(tmpDir, "output.png");

	try {
		await Bun.write(inputPath, source);

		const args: string[] = ["-i", inputPath, "-o", outputPath, "-q"];

		if (options.theme) {
			args.push("-t", options.theme);
		}
		if (options.backgroundColor) {
			args.push("-b", options.backgroundColor);
		}
		if (options.width) {
			args.push("-w", String(options.width));
		}
		if (options.scale) {
			args.push("-s", String(options.scale));
		}

		const result = await $`${mmdc} ${args}`.quiet().nothrow();
		if (result.exitCode !== 0) {
			return null;
		}

		const outputFile = Bun.file(outputPath);
		if (!(await outputFile.exists())) {
			return null;
		}

		const buffer = Buffer.from(await outputFile.bytes());
		const base64 = buffer.toString("base64");

		const dims = parsePngDimensions(buffer);
		if (!dims) {
			return null;
		}

		return {
			base64,
			widthPx: dims.width,
			heightPx: dims.height,
		};
	} catch {
		return null;
	} finally {
		await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
	}
}

function parsePngDimensions(buffer: Buffer): { width: number; height: number } | null {
	if (buffer.length < 24) return null;
	if (buffer[0] !== 0x89 || buffer[1] !== 0x50 || buffer[2] !== 0x4e || buffer[3] !== 0x47) {
		return null;
	}
	return {
		width: buffer.readUInt32BE(16),
		height: buffer.readUInt32BE(20),
	};
}

/**
 * Extract mermaid code blocks from markdown text.
 * Returns array of { source, startIndex, endIndex } for each block.
 */
export function extractMermaidBlocks(markdown: string): { source: string; hash: string }[] {
	const blocks: { source: string; hash: string }[] = [];
	const regex = /```mermaid\s*\n([\s\S]*?)```/g;

	for (let match = regex.exec(markdown); match !== null; match = regex.exec(markdown)) {
		const source = match[1].trim();
		const hash = Bun.hash(source).toString(16);
		blocks.push({ source, hash });
	}

	return blocks;
}

/**
 * Pre-render all mermaid blocks in markdown text.
 * Returns a cache map: hash → MermaidImage.
 */
export async function prerenderMermaidBlocks(
	markdown: string,
	options: MermaidRenderOptions = {},
): Promise<Map<string, MermaidImage>> {
	const blocks = extractMermaidBlocks(markdown);
	const cache = new Map<string, MermaidImage>();

	const results = await Promise.all(
		blocks.map(async ({ source, hash }) => {
			const image = await renderMermaidToPng(source, options);
			return { hash, image };
		}),
	);

	for (const { hash, image } of results) {
		if (image) {
			cache.set(hash, image);
		}
	}

	return cache;
}
