#!/usr/bin/env bun
/**
 * Generates a base64-encoded JavaScript module from the photon WASM file.
 * This allows bundling the WASM binary inline for single-file distribution.
 */

import { join } from "node:path";

const VENDOR_DIR = join(import.meta.dir, "../src/vendor/photon");
const WASM_PATH = join(VENDOR_DIR, "photon_rs_bg.wasm");
const OUTPUT_PATH = join(VENDOR_DIR, "photon_rs_bg.wasm.b64.js");

const wasmFile = Bun.file(WASM_PATH);
if (!(await wasmFile.exists())) {
	console.error(`WASM file not found: ${WASM_PATH}`);
	process.exit(1);
}

const wasmBytes = await wasmFile.arrayBuffer();
const base64 = Buffer.from(wasmBytes).toString("base64");
const content = `export default "${base64}";\n`;

await Bun.write(OUTPUT_PATH, content);
console.log(`Generated ${OUTPUT_PATH} (${Math.round(base64.length / 1024)}KB)`);
