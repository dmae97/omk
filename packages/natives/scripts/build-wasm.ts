import { $ } from "bun";
import * as path from "node:path";
import * as fs from "node:fs/promises";

const repoRoot = path.join(import.meta.dir, "../../..");
const rustDir = path.join(repoRoot, "crates/pi-natives");
const wasmDir = path.join(import.meta.dir, "../wasm");

await fs.mkdir(wasmDir, { recursive: true });

console.log("Building Rust WASM with wasm-bindgen...");

// Build with wasm-pack (wasm-opt disabled in Cargo.toml)
const buildResult = await $`wasm-pack build --target deno --release --out-dir pkg`
	.cwd(rustDir)
	.nothrow();

if (buildResult.exitCode !== 0) {
	console.error("wasm-pack build failed");
	console.error(buildResult.stderr.toString());
	process.exit(1);
}

const pkgDir = path.join(rustDir, "pkg");

// Crate name is pi-natives -> output files are pi_natives_*
const wasmSrc = path.join(pkgDir, "pi_natives_bg.wasm");
const wasmDst = path.join(wasmDir, "pi_natives_bg.wasm");

// Optimize with wasm-opt with bulk memory enabled
const optResult = await $`wasm-opt \
  --enable-bulk-memory \
  --enable-nontrapping-float-to-int \
  -O3 \
  --strip-debug \
  ${wasmSrc} \
  -o ${wasmDst}`.nothrow();

if (optResult.exitCode !== 0) {
	console.log("wasm-opt failed or not available, copying unoptimized build");
	await fs.copyFile(wasmSrc, wasmDst);
}

// Copy JS bindings
await fs.copyFile(path.join(pkgDir, "pi_natives.js"), path.join(wasmDir, "pi_natives.js"));

// Copy d.ts bindings
await fs.copyFile(path.join(pkgDir, "pi_natives.d.ts"), path.join(wasmDir, "pi_natives.d.ts"));
await fs.copyFile(path.join(pkgDir, "pi_natives_bg.wasm.d.ts"), path.join(wasmDir, "pi_natives_bg.wasm.d.ts"));

const stat = await fs.stat(wasmDst);
console.log(`Done: ${wasmDst} (${(stat.size / 1024).toFixed(0)}KB)`);

// Clean up pkg directory
await fs.rm(pkgDir, { recursive: true, force: true });
