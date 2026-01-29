import { PhotonImage } from "@oh-my-pi/pi-natives";

/**
 * Convert image to PNG format for terminal display.
 * Kitty graphics protocol requires PNG format (f=100).
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
		using image = await PhotonImage.new_from_byteslice(new Uint8Array(Buffer.from(base64Data, "base64")));
		const pngBuffer = await image.get_bytes();
		return {
			data: Buffer.from(pngBuffer).toString("base64"),
			mimeType: "image/png",
		};
	} catch {
		// Conversion failed
		return null;
	}
}
