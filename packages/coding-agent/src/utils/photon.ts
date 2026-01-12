import type { base64_to_image, PhotonImage, resize as photonResize, SamplingFilter } from "@silvia-odwyer/photon";

let _photon: typeof import("@silvia-odwyer/photon") | undefined;
let _initialized = false;

/**
 * Get the initialized Photon module.
 * Lazily imports and initializes the WASM module on first use.
 */
export async function getPhoton(): Promise<typeof import("@silvia-odwyer/photon")> {
	if (_photon && _initialized) return _photon;

	const photon = await import("@silvia-odwyer/photon");

	// Initialize the WASM module (default export is the init function)
	if (!_initialized) {
		await photon.default();
		_initialized = true;
	}

	_photon = photon;
	return _photon;
}

export type { PhotonImage, SamplingFilter, photonResize, base64_to_image };
