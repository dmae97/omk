#!/usr/bin/env bun
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";

const vendorDir = join(dirname(import.meta.dir), "src/vendor/photon");
const wasmPath = join(vendorDir, "photon_rs_bg.wasm");
const b64Path = join(vendorDir, "photon_rs_bg.wasm.b64.js");

const wasmBytes = readFileSync(wasmPath);
const wasmB64 = wasmBytes.toString("base64");
writeFileSync(b64Path, `export default "${wasmB64}";\n`);

console.log(`Generated ${b64Path} (${wasmB64.length} chars)`);
