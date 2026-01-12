import { logger } from "../core/logger";
import { convertToPngWithImageMagick } from "./image-magick";
import { Vips } from "./vips";

/**
 * Convert image to PNG format for terminal display.
 * Kitty graphics protocol requires PNG format (f=100).
 * Uses wasm-vips if available, falls back to ImageMagick (magick/convert).
 */
export async function convertToPng(
	base64Data: string,
	mimeType: string,
): Promise<{ data: string; mimeType: string } | null> {
	// Already PNG, no conversion needed
	if (mimeType === "image/png") {
		return { data: base64Data, mimeType };
	}

	try {
		const { Image } = await Vips();
		const image = Image.newFromBuffer(Buffer.from(base64Data, "base64"));
		try {
			const pngBuffer = image.writeToBuffer(".png");
			return {
				data: Buffer.from(pngBuffer).toString("base64"),
				mimeType: "image/png",
			};
		} finally {
			image.delete();
		}
	} catch (error) {
		// wasm-vips failed, try ImageMagick fallback
		logger.error("Failed to convert image to PNG with wasm-vips", {
			error: error instanceof Error ? error.message : String(error),
		});
	}

	// Fall back to ImageMagick
	return convertToPngWithImageMagick(base64Data, mimeType);
}
