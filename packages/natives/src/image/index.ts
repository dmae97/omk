/**
 * Async image processing via worker.
 *
 * All heavy lifting happens in a worker thread to avoid blocking the main thread.
 * Uses transferable ArrayBuffers to avoid copying image data.
 */

import { WorkerPool } from "../pool";
import { resolveWorkerSpecifier } from "../worker-resolver";
import type { ImageRequest, ImageResponse } from "./types";

// Re-export the enum for filter selection
export { SamplingFilter } from "../../wasm/pi_natives";

const pool = new WorkerPool<ImageRequest, ImageResponse>({
	createWorker: () =>
		new Worker(
			resolveWorkerSpecifier({
				compiled: "./packages/natives/src/image/worker.ts",
				dev: new URL("./worker.ts", import.meta.url),
			}),
		),
	maxWorkers: 1,
	idleTimeoutMs: 0, // Keep alive - stateful (image handles)
});

/**
 * Image handle for async operations.
 * Must call free() when done to release WASM memory.
 */
export class PhotonImage {
	#handle: number;
	#width: number;
	#height: number;
	#freed = false;

	private constructor(handle: number, width: number, height: number) {
		this.#handle = handle;
		this.#width = width;
		this.#height = height;
	}

	/** @internal */
	static _create(handle: number, width: number, height: number): PhotonImage {
		return new PhotonImage(handle, width, height);
	}

	/** @internal */
	_getHandle(): number {
		if (this.#freed) throw new Error("Image already freed");
		return this.#handle;
	}

	/**
	 * Load an image from encoded bytes (PNG, JPEG, WebP, GIF).
	 * The bytes are transferred to the worker (zero-copy).
	 */
	static async new_from_byteslice(bytes: Uint8Array): Promise<PhotonImage> {
		const response = await pool.request<Extract<ImageResponse, { type: "loaded" }>>(
			{ type: "load", bytes },
			{
				transfer: [bytes.buffer],
			},
		);
		return new PhotonImage(response.handle, response.width, response.height);
	}

	/** Get image width in pixels. */
	get_width(): number {
		return this.#width;
	}

	/** Get image height in pixels. */
	get_height(): number {
		return this.#height;
	}

	/** Export as PNG bytes. */
	async get_bytes(): Promise<Uint8Array> {
		if (this.#freed) throw new Error("Image already freed");
		const response = await pool.request<Extract<ImageResponse, { type: "bytes" }>>({
			type: "get_png",
			handle: this.#handle,
		});
		return response.bytes;
	}

	/** Export as JPEG bytes with specified quality (0-100). */
	async get_bytes_jpeg(quality: number): Promise<Uint8Array> {
		if (this.#freed) throw new Error("Image already freed");
		const response = await pool.request<Extract<ImageResponse, { type: "bytes" }>>({
			type: "get_jpeg",
			handle: this.#handle,
			quality,
		});
		return response.bytes;
	}

	/** Release WASM memory. Must be called when done with the image. */
	free() {
		if (this.#freed) return;
		this.#freed = true;
		pool.request({ type: "free", handle: this.#handle }).catch(() => {});
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
	const handle = image._getHandle();
	const response = await pool.request<Extract<ImageResponse, { type: "resized" }>>({
		type: "resize",
		handle,
		width,
		height,
		filter,
	});
	return PhotonImage._create(response.handle, response.width, response.height);
}

/**
 * Terminate the image worker.
 * Call this when shutting down to clean up resources.
 */
export function terminate(): void {
	pool.terminate();
}
