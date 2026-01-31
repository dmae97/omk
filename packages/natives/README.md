# @oh-my-pi/pi-natives

Native Rust functionality via N-API.

## What's Inside

- **Grep**: Regex-based search powered by ripgrep's engine with native file walking and matching
- **Find**: Glob-based file/directory discovery with gitignore support (pure TypeScript via `globPaths`)
- **Image**: Image processing via photon-rs (resize, format conversion) exposed through N-API

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
# Build native addon from workspace root (requires Rust)
bun run build:native

# Type check
bun run check
```

## Architecture

```
crates/pi-natives/       # Rust source (workspace member)
  src/lib.rs             # N-API exports
  src/image.rs           # Image processing (photon-rs)
  Cargo.toml             # Rust dependencies
native/                  # Native addon binaries
  pi_natives.<platform>-<arch>.node
  pi_natives.node
src/                     # TypeScript wrappers
  native.ts              # Native addon loader
  index.ts               # Public API
```
