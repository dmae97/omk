import type { ImageContent } from "@oh-my-pi/pi-ai";
import { logger } from "../core/logger";
import { getImageDimensionsWithImageMagick, resizeWithImageMagick } from "./image-magick";
import { Vips } from "./vips";

export interface ImageResizeOptions {
	maxWidth?: number; // Default: 2000
	maxHeight?: number; // Default: 2000
	maxBytes?: number; // Default: 4.5MB (below Anthropic's 5MB limit)
	jpegQuality?: number; // Default: 80
}

export interface ResizedImage {
	data: string; // base64
	mimeType: string;
	originalWidth: number;
	originalHeight: number;
	width: number;
	height: number;
	wasResized: boolean;
}

// 4.5MB - provides headroom below Anthropic's 5MB limit
const DEFAULT_MAX_BYTES = 4.5 * 1024 * 1024;

const DEFAULT_OPTIONS: Required<ImageResizeOptions> = {
	maxWidth: 2000,
	maxHeight: 2000,
	maxBytes: DEFAULT_MAX_BYTES,
	jpegQuality: 80,
};

/**
 * Fallback resize using ImageMagick when wasm-vips is unavailable.
 */
async function resizeImageWithImageMagick(
	img: ImageContent,
	opts: Required<ImageResizeOptions>,
): Promise<ResizedImage> {
	const dims = await getImageDimensionsWithImageMagick(img.data);
	const originalWidth = dims?.width ?? 0;
	const originalHeight = dims?.height ?? 0;

	const result = await resizeWithImageMagick(
		img.data,
		img.mimeType,
		opts.maxWidth,
		opts.maxHeight,
		opts.maxBytes,
		opts.jpegQuality,
	);

	if (result) {
		return {
			data: result.data,
			mimeType: result.mimeType,
			originalWidth,
			originalHeight,
			width: result.width,
			height: result.height,
			wasResized: true,
		};
	}

	return {
		data: img.data,
		mimeType: img.mimeType,
		originalWidth,
		originalHeight,
		width: originalWidth,
		height: originalHeight,
		wasResized: false,
	};
}

/** Helper to pick the smaller of two buffers */
function pickSmaller(
	a: { buffer: Uint8Array; mimeType: string },
	b: { buffer: Uint8Array; mimeType: string },
): { buffer: Uint8Array; mimeType: string } {
	return a.buffer.length <= b.buffer.length ? a : b;
}

/**
 * Resize an image to fit within the specified max dimensions and file size.
 * Returns the original image if it already fits within the limits.
 *
 * Uses wasm-vips for image processing. Falls back to ImageMagick if unavailable.
 *
 * Strategy for staying under maxBytes:
 * 1. First resize to maxWidth/maxHeight
 * 2. Try both PNG and JPEG formats, pick the smaller one
 * 3. If still too large, try JPEG with decreasing quality
 * 4. If still too large, progressively reduce dimensions
 */
export async function resizeImage(img: ImageContent, options?: ImageResizeOptions): Promise<ResizedImage> {
	const opts = { ...DEFAULT_OPTIONS, ...options };
	const buffer = Buffer.from(img.data, "base64");

	try {
		const { Image } = await Vips();
		const image = Image.newFromBuffer(buffer);
		try {
			const originalWidth = image.width;
			const originalHeight = image.height;
			const format = img.mimeType?.split("/")[1] ?? "png";

			// Check if already within all limits (dimensions AND size)
			const originalSize = buffer.length;
			if (originalWidth <= opts.maxWidth && originalHeight <= opts.maxHeight && originalSize <= opts.maxBytes) {
				return {
					data: img.data,
					mimeType: img.mimeType ?? `image/${format}`,
					originalWidth,
					originalHeight,
					width: originalWidth,
					height: originalHeight,
					wasResized: false,
				};
			}

			// Calculate initial dimensions respecting max limits
			let targetWidth = originalWidth;
			let targetHeight = originalHeight;

			if (targetWidth > opts.maxWidth) {
				targetHeight = Math.round((targetHeight * opts.maxWidth) / targetWidth);
				targetWidth = opts.maxWidth;
			}
			if (targetHeight > opts.maxHeight) {
				targetWidth = Math.round((targetWidth * opts.maxHeight) / targetHeight);
				targetHeight = opts.maxHeight;
			}

			// Helper to resize and encode in both formats, returning the smaller one
			function tryBothFormats(
				width: number,
				height: number,
				jpegQuality: number,
			): { buffer: Uint8Array; mimeType: string } {
				const scale = Math.min(width / originalWidth, height / originalHeight);
				const resized = image!.resize(scale);

				const pngBuffer = resized.writeToBuffer(".png");
				const jpegBuffer = resized.writeToBuffer(".jpg", { Q: jpegQuality });

				resized.delete();

				return pickSmaller(
					{ buffer: pngBuffer, mimeType: "image/png" },
					{ buffer: jpegBuffer, mimeType: "image/jpeg" },
				);
			}

			// Try to produce an image under maxBytes
			const qualitySteps = [85, 70, 55, 40];
			const scaleSteps = [1.0, 0.75, 0.5, 0.35, 0.25];

			let best: { buffer: Uint8Array; mimeType: string };
			let finalWidth = targetWidth;
			let finalHeight = targetHeight;

			// First attempt: resize to target dimensions, try both formats
			best = tryBothFormats(targetWidth, targetHeight, opts.jpegQuality);

			if (best.buffer.length <= opts.maxBytes) {
				return {
					data: Buffer.from(best.buffer).toString("base64"),
					mimeType: best.mimeType,
					originalWidth,
					originalHeight,
					width: finalWidth,
					height: finalHeight,
					wasResized: true,
				};
			}

			// Still too large - try JPEG with decreasing quality
			for (const quality of qualitySteps) {
				best = tryBothFormats(targetWidth, targetHeight, quality);

				if (best.buffer.length <= opts.maxBytes) {
					return {
						data: Buffer.from(best.buffer).toString("base64"),
						mimeType: best.mimeType,
						originalWidth,
						originalHeight,
						width: finalWidth,
						height: finalHeight,
						wasResized: true,
					};
				}
			}

			// Still too large - reduce dimensions progressively
			for (const scale of scaleSteps) {
				finalWidth = Math.round(targetWidth * scale);
				finalHeight = Math.round(targetHeight * scale);

				if (finalWidth < 100 || finalHeight < 100) {
					break;
				}

				for (const quality of qualitySteps) {
					best = tryBothFormats(finalWidth, finalHeight, quality);

					if (best.buffer.length <= opts.maxBytes) {
						return {
							data: Buffer.from(best.buffer).toString("base64"),
							mimeType: best.mimeType,
							originalWidth,
							originalHeight,
							width: finalWidth,
							height: finalHeight,
							wasResized: true,
						};
					}
				}
			}

			// Last resort: return smallest version we produced
			return {
				data: Buffer.from(best.buffer).toString("base64"),
				mimeType: best.mimeType,
				originalWidth,
				originalHeight,
				width: finalWidth,
				height: finalHeight,
				wasResized: true,
			};
		} finally {
			image.delete();
		}
	} catch (error) {
		logger.error("Failed to resize image with wasm-vips", {
			error: error instanceof Error ? error.message : String(error),
		});
		return resizeImageWithImageMagick(img, opts);
	}
}

/**
 * Format a dimension note for resized images.
 * This helps the model understand the coordinate mapping.
 */
export function formatDimensionNote(result: ResizedImage): string | undefined {
	if (!result.wasResized) {
		return undefined;
	}

	const scale = result.originalWidth / result.width;
	return `[Image: original ${result.originalWidth}x${result.originalHeight}, displayed at ${result.width}x${
		result.height
	}. Multiply coordinates by ${scale.toFixed(2)} to map to original image.]`;
}
