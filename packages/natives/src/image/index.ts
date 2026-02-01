/**
 * Image processing via native bindings.
 */

import { type NativePhotonImage, native } from "../native";

const images = new Map<number, NativePhotonImage>();
let nextHandle = 1;

function registerImage(image: NativePhotonImage): number {
	const handle = nextHandle++;
	images.set(handle, image);
	return handle;
}

function getImage(handle: number): NativePhotonImage {
	const image = images.get(handle);
	if (!image) {
		throw new Error("Image already freed");
	}
	return image;
}

export const SamplingFilter = native.SamplingFilter;
export type SamplingFilter = (typeof SamplingFilter)[keyof typeof SamplingFilter];

/**
 * Image handle for async operations.
 */
export class PhotonImage {
	#handle: number;
	#freed = false;

	private constructor(handle: number) {
		this.#handle = handle;
	}

	/** @internal */
	static _create(handle: number): PhotonImage {
		if (!images.has(handle)) {
			throw new Error("Invalid image handle");
		}
		return new PhotonImage(handle);
	}

	/**
	 * Load an image from encoded bytes (PNG, JPEG, WebP, GIF).
	 */
	static async new_from_byteslice(bytes: Uint8Array): Promise<PhotonImage> {
		const image = await native.PhotonImage.newFromByteslice(bytes);
		const handle = registerImage(image);
		return new PhotonImage(handle);
	}

	/** @internal */
	_getHandle(): number {
		if (this.#freed) throw new Error("Image already freed");
		return this.#handle;
	}

	#native(): NativePhotonImage {
		if (this.#freed) throw new Error("Image already freed");
		return getImage(this.#handle);
	}

	/** Get image width in pixels. */
	get_width(): number {
		return this.#native().getWidth();
	}

	/** Get image height in pixels. */
	get_height(): number {
		return this.#native().getHeight();
	}

	/** Export as PNG bytes. */
	async get_bytes(): Promise<Uint8Array> {
		return this.#native().getBytes();
	}

	/** Export as JPEG bytes with specified quality (0-100). */
	async get_bytes_jpeg(quality: number): Promise<Uint8Array> {
		return this.#native().getBytesJpeg(quality);
	}

	/** Release native resources. */
	free() {
		if (this.#freed) return;
		this.#freed = true;
		images.delete(this.#handle);
	}

	/** Alias for free() to support using-declarations. */
	[Symbol.dispose](): void {
		this.free();
	}
}

/**
 * Resize an image to the specified dimensions.
 * Returns a new PhotonImage (original is not modified).
 */
export async function resize(image: PhotonImage, width: number, height: number, filter: number): Promise<PhotonImage> {
	const nativeImage = getImage(image._getHandle());
	const resized = await nativeImage.resize(width, height, filter);
	const handle = registerImage(resized);
	return PhotonImage._create(handle);
}

/**
 * Terminate image resources (no-op for native bindings).
 */
export function terminate(): void {}
