import type realVips from "wasm-vips";
import { logger } from "../core/logger";

// Cached vips instance
let _vips: Promise<typeof realVips> | undefined;

/**
 * Get the vips instance.
 * @returns The vips instance.
 */
export function Vips(): Promise<typeof realVips> {
	if (_vips) return _vips;

	let instance: Promise<typeof realVips> | undefined;
	try {
		instance = import("wasm-vips").then((mod) => (mod.default ?? mod)());
	} catch (error) {
		logger.error("Failed to import wasm-vips", { error: error instanceof Error ? error.message : String(error) });
		instance = Promise.reject(error);
	}
	_vips = instance;
	return instance;
}
