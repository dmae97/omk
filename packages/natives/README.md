# @oh-my-pi/pi-natives

Native Rust functionality compiled to WebAssembly via wasm-bindgen.

## What's Inside

- **Grep**: Regex-based search powered by ripgrep's engine (WASM handles matching, JS handles I/O + gitignore-aware file walking)
- **Find**: Glob-based file/directory discovery with gitignore support (pure TypeScript via `globPaths`)
- **Image**: Image processing via photon-rs (resize, format conversion)

## Usage

```typescript
import { grep, find, PhotonImage, resize, SamplingFilter } from "@oh-my-pi/pi-natives";

// Grep for a pattern
const results = await grep({
	pattern: "TODO",
	path: "/path/to/project",
	glob: "*.ts",
	context: 2,
});

// Find files
const files = await find({
	pattern: "*.rs",
	path: "/path/to/project",
	fileType: "file",
});

// Image processing
using image = await PhotonImage.new_from_byteslice(bytes);
using resized = await resize(image, 800, 600, SamplingFilter.Lanczos3);
const pngBytes = await resized.get_bytes();
```

## Building

```bash
# Build WASM from workspace root (requires Rust + wasm-pack)
bun run build:wasm

# Type check
bun run check
```

## Architecture

```
crates/pi-natives/       # Rust source (workspace member)
  src/lib.rs             # Grep/search + wasm-bindgen bindings
  src/image.rs           # Image processing (photon-rs)
  Cargo.toml             # Rust dependencies
wasm/                    # Generated WASM output
  pi_natives.wasm        # Compiled WASM module
  pi_natives.js          # wasm-bindgen generated JS glue
  pi_natives.d.ts        # TypeScript definitions
src/                     # TypeScript wrappers
  index.ts               # Public API
  grep/                  # Grep with worker pool
  image/                 # Async image processing via worker
  pool.ts                # Generic worker pool infrastructure
```
