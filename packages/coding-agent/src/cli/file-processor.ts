/**
 * Process @file CLI arguments into text content and image attachments
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { ImageContent } from "@oh-my-pi/pi-ai";
import { isEnoent } from "@oh-my-pi/pi-utils";
import chalk from "chalk";
import { resolveReadPath } from "../tools/path-utils";
import { formatDimensionNote, resizeImage } from "../utils/image-resize";
import { detectSupportedImageMimeTypeFromFile } from "../utils/mime";

export interface ProcessedFiles {
	text: string;
	images: ImageContent[];
}

export interface ProcessFileOptions {
	/** Whether to auto-resize images to 2000x2000 max. Default: true */
	autoResizeImages?: boolean;
}

/** Process @file arguments into text content and image attachments */
export async function processFileArguments(fileArgs: string[], options?: ProcessFileOptions): Promise<ProcessedFiles> {
	const autoResizeImages = options?.autoResizeImages ?? true;
	let text = "";
	const images: ImageContent[] = [];

	for (const fileArg of fileArgs) {
		// Expand and resolve path (handles ~ expansion and macOS screenshot Unicode spaces)
		const absolutePath = path.resolve(resolveReadPath(fileArg, process.cwd()));

		// Read file, handling not-found gracefully
		let buffer: Buffer;
		try {
			buffer = await fs.readFile(absolutePath);
		} catch (err) {
			if (isEnoent(err)) {
				console.error(chalk.red(`Error: File not found: ${absolutePath}`));
				process.exit(1);
			}
			throw err;
		}
		if (buffer.length === 0) {
			continue;
		}

		const mimeType = await detectSupportedImageMimeTypeFromFile(absolutePath);

		if (mimeType) {
			// Handle image file
			const base64Content = buffer.toBase64();
			let attachment: ImageContent;
			let dimensionNote: string | undefined;

			if (autoResizeImages) {
				try {
					const resized = await resizeImage({ type: "image", data: base64Content, mimeType });
					dimensionNote = formatDimensionNote(resized);
					attachment = {
						type: "image",
						mimeType: resized.mimeType,
						data: resized.data,
					};
				} catch {
					// Fall back to original image on resize failure
					attachment = {
						type: "image",
						mimeType,
						data: base64Content,
					};
				}
			} else {
				attachment = {
					type: "image",
					mimeType,
					data: base64Content,
				};
			}

			images.push(attachment);

			// Add text reference to image with optional dimension note
			if (dimensionNote) {
				text += `<file name="${absolutePath}">${dimensionNote}</file>\n`;
			} else {
				text += `<file name="${absolutePath}"></file>\n`;
			}
		} else {
			// Handle text file
			try {
				const content = buffer.toString("utf-8");
				text += `<file name="${absolutePath}">\n${content}\n</file>\n`;
			} catch (error: unknown) {
				const message = error instanceof Error ? error.message : String(error);
				console.error(chalk.red(`Error: Could not read file ${absolutePath}: ${message}`));
				process.exit(1);
			}
		}
	}

	return { text, images };
}
