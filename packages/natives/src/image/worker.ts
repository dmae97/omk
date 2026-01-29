/**
 * Worker for image processing operations.
 * Uses WASM for actual processing, communicates via transferable buffers.
 */

import { PhotonImage, type SamplingFilter, resize as wasmResize } from "../../wasm/pi_natives";
import type { ImageRequest, ImageResponse } from "./types";

declare const self: Worker;

/** Map of handle -> PhotonImage */
const images = new Map<number, PhotonImage>();
let nextHandle = 1;

function respond(msg: ImageResponse, transfer?: ArrayBufferLike[]): void {
	if (transfer) {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		self.postMessage(msg, transfer as any);
	} else {
		self.postMessage(msg);
	}
}

self.addEventListener("message", (e: MessageEvent<ImageRequest>) => {
	const msg = e.data;

	switch (msg.type) {
		case "init":
			respond({ type: "ready", id: msg.id });
			break;

		case "destroy":
			for (const img of images.values()) {
				img.free();
			}
			images.clear();
			break;

		case "load": {
			try {
				const img = PhotonImage.new_from_byteslice(msg.bytes);
				const handle = nextHandle++;
				images.set(handle, img);
				respond({
					type: "loaded",
					id: msg.id,
					handle,
					width: img.get_width(),
					height: img.get_height(),
				});
			} catch (err) {
				respond({
					type: "error",
					id: msg.id,
					error: err instanceof Error ? err.message : String(err),
				});
			}
			break;
		}

		case "resize": {
			const img = images.get(msg.handle);
			if (!img) {
				respond({ type: "error", id: msg.id, error: "Invalid image handle" });
				break;
			}
			try {
				const filter = msg.filter as SamplingFilter;
				const resized = wasmResize(img, msg.width, msg.height, filter);
				const handle = nextHandle++;
				images.set(handle, resized);
				respond({
					type: "resized",
					id: msg.id,
					handle,
					width: resized.get_width(),
					height: resized.get_height(),
				});
			} catch (err) {
				respond({
					type: "error",
					id: msg.id,
					error: err instanceof Error ? err.message : String(err),
				});
			}
			break;
		}

		case "get_dimensions": {
			const img = images.get(msg.handle);
			if (!img) {
				respond({ type: "error", id: msg.id, error: "Invalid image handle" });
				break;
			}
			respond({
				type: "dimensions",
				id: msg.id,
				width: img.get_width(),
				height: img.get_height(),
			});
			break;
		}

		case "get_png": {
			const img = images.get(msg.handle);
			if (!img) {
				respond({ type: "error", id: msg.id, error: "Invalid image handle" });
				break;
			}
			try {
				const bytes = img.get_bytes();
				respond({ type: "bytes", id: msg.id, bytes }, [bytes.buffer]);
			} catch (err) {
				respond({
					type: "error",
					id: msg.id,
					error: err instanceof Error ? err.message : String(err),
				});
			}
			break;
		}

		case "get_jpeg": {
			const img = images.get(msg.handle);
			if (!img) {
				respond({ type: "error", id: msg.id, error: "Invalid image handle" });
				break;
			}
			try {
				const bytes = img.get_bytes_jpeg(msg.quality);
				respond({ type: "bytes", id: msg.id, bytes }, [bytes.buffer]);
			} catch (err) {
				respond({
					type: "error",
					id: msg.id,
					error: err instanceof Error ? err.message : String(err),
				});
			}
			break;
		}

		case "free": {
			const img = images.get(msg.handle);
			if (img) {
				img.free();
				images.delete(msg.handle);
			}
			respond({ type: "freed", id: msg.id });
			break;
		}
	}
});
