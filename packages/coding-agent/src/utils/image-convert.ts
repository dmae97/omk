import { convertToPngWithImageMagick } from "./image-magick";

// Cached vips instance
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let vipsInstance: any;
let vipsLoadFailed = false;

async function getVips() {
	if (vipsLoadFailed) return undefined;
	if (vipsInstance) return vipsInstance;

	try {
		const wasmVips = await import("wasm-vips");
		const Vips = wasmVips.default ?? wasmVips;
		vipsInstance = await Vips();
		return vipsInstance;
	} catch {
		vipsLoadFailed = true;
		return undefined;
	}
}

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

	// Try wasm-vips first
	const vips = await getVips();
	if (vips) {
		let image: ReturnType<typeof vips.Image.newFromBuffer> | undefined;
		try {
			const buffer = Buffer.from(base64Data, "base64");
			image = vips.Image.newFromBuffer(buffer);
			const pngBuffer = image.writeToBuffer(".png");
			return {
				data: Buffer.from(pngBuffer).toString("base64"),
				mimeType: "image/png",
			};
		} catch {
			// wasm-vips failed, try ImageMagick fallback
		} finally {
			image?.delete();
		}
	}

	// Fall back to ImageMagick
	return convertToPngWithImageMagick(base64Data, mimeType);
}
