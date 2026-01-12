import { logger } from "../core/logger";
import { convertToPngWithImageMagick } from "./image-magick";
import { getPhoton } from "./photon";

/**
 * Convert image to PNG format for terminal display.
 * Kitty graphics protocol requires PNG format (f=100).
 * Uses Photon (Rust/WASM) if available, falls back to ImageMagick.
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
		const photon = await getPhoton();
		const image = photon.PhotonImage.new_from_byteslice(new Uint8Array(Buffer.from(base64Data, "base64")));
		try {
			const pngBuffer = image.get_bytes();
			return {
				data: Buffer.from(pngBuffer).toString("base64"),
				mimeType: "image/png",
			};
		} finally {
			image.free();
		}
	} catch (error) {
		// Photon failed, try ImageMagick fallback
		logger.error("Failed to convert image to PNG with Photon", {
			error: error instanceof Error ? error.message : String(error),
		});
	}

	// Fall back to ImageMagick
	return convertToPngWithImageMagick(base64Data, mimeType);
}
