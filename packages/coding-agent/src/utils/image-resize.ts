import type { ImageContent } from "@oh-my-pi/pi-ai";
import { ImageFormat, PhotonImage, SamplingFilter } from "@oh-my-pi/pi-natives";

export interface ImageResizeOptions {
	maxWidth?: number; // Default: 2000
	maxHeight?: number; // Default: 2000
	maxBytes?: number; // Default: 4.5MB (below Anthropic's 5MB limit)
	jpegQuality?: number; // Default: 80
}

export interface ResizedImage {
	buffer: Uint8Array;
	mimeType: string;
	originalWidth: number;
	originalHeight: number;
	width: number;
	height: number;
	wasResized: boolean;
	get data(): string;
}

// 4.5MB - provides headroom below Anthropic's 5MB limit
const DEFAULT_MAX_BYTES = 4.5 * 1024 * 1024;

const DEFAULT_OPTIONS: Required<ImageResizeOptions> = {
	maxWidth: 2000,
	maxHeight: 2000,
	maxBytes: DEFAULT_MAX_BYTES,
	jpegQuality: 80,
};

/** Helper to pick the smaller of two buffers */
function pickSmaller(
	a: { buffer: Uint8Array; mimeType: string },
	b: { buffer: Uint8Array; mimeType: string },
): { buffer: Uint8Array; mimeType: string } {
	return a.buffer.length <= b.buffer.length ? a : b;
}

/** Polyfill for Buffer.toBase64, technically since it derives from Uint8Array it should exist but Bun reasons... */
Buffer.prototype.toBase64 = function (this: Buffer) {
	return new Uint8Array(this.buffer, this.byteOffset, this.byteLength).toBase64();
};

/**
 * Resize an image to fit within the specified max dimensions and file size.
 * Returns the original image if it already fits within the limits.
 *
 * Uses Photon for image processing. If Photon is not available,
 * returns the original image unchanged.
 *
 * Strategy for staying under maxBytes:
 * 1. First resize to maxWidth/maxHeight
 * 2. Try both PNG and JPEG formats, pick the smaller one
 * 3. If still too large, try JPEG with decreasing quality
 * 4. If still too large, progressively reduce dimensions
 */
export async function resizeImage(img: ImageContent, options?: ImageResizeOptions): Promise<ResizedImage> {
	const opts = { ...DEFAULT_OPTIONS, ...options };
	const inputBuffer = Buffer.from(img.data, "base64");

	try {
		const image = await PhotonImage.parse(inputBuffer);

		const originalWidth = image.width;
		const originalHeight = image.height;
		const format = img.mimeType?.split("/")[1] ?? "png";

		// Check if already within all limits (dimensions AND size)
		const originalSize = inputBuffer.length;
		if (originalWidth <= opts.maxWidth && originalHeight <= opts.maxHeight && originalSize <= opts.maxBytes) {
			return {
				buffer: inputBuffer,
				mimeType: img.mimeType ?? `image/${format}`,
				originalWidth,
				originalHeight,
				width: originalWidth,
				height: originalHeight,
				wasResized: false,
				get data() {
					return img.data;
				},
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
		async function tryBothFormats(
			width: number,
			height: number,
			quality: number,
		): Promise<{ buffer: Uint8Array; mimeType: string }> {
			const resized = await image.resize(width, height, SamplingFilter.Lanczos3);

			const [pngBuffer, jpegBuffer] = await Promise.all([
				resized.encode(ImageFormat.PNG, quality),
				resized.encode(ImageFormat.JPEG, quality),
			]);

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
		best = await tryBothFormats(targetWidth, targetHeight, opts.jpegQuality);

		if (best.buffer.length <= opts.maxBytes) {
			return {
				buffer: best.buffer,
				mimeType: best.mimeType,
				originalWidth,
				originalHeight,
				width: finalWidth,
				height: finalHeight,
				wasResized: true,
				get data() {
					return best.buffer.toBase64();
				},
			};
		}

		// Still too large - try JPEG with decreasing quality
		for (const quality of qualitySteps) {
			best = await tryBothFormats(targetWidth, targetHeight, quality);

			if (best.buffer.length <= opts.maxBytes) {
				return {
					buffer: best.buffer,
					mimeType: best.mimeType,
					originalWidth,
					originalHeight,
					width: finalWidth,
					height: finalHeight,
					wasResized: true,
					get data() {
						return best.buffer.toBase64();
					},
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
				best = await tryBothFormats(finalWidth, finalHeight, quality);

				if (best.buffer.length <= opts.maxBytes) {
					return {
						buffer: best.buffer,
						mimeType: best.mimeType,
						originalWidth,
						originalHeight,
						width: finalWidth,
						height: finalHeight,
						wasResized: true,
						get data() {
							return best.buffer.toBase64();
						},
					};
				}
			}
		}

		// Last resort: return smallest version we produced
		return {
			buffer: best.buffer,
			mimeType: best.mimeType,
			originalWidth,
			originalHeight,
			width: finalWidth,
			height: finalHeight,
			wasResized: true,
			get data() {
				return best.buffer.toBase64();
			},
		};
	} catch {
		// Failed to load image
		return {
			buffer: inputBuffer,
			mimeType: img.mimeType,
			originalWidth: 0,
			originalHeight: 0,
			width: 0,
			height: 0,
			wasResized: false,
			get data() {
				return img.data;
			},
		};
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
