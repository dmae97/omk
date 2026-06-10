# CHANGELOG Implementation Evidence

## File Changed

- `CHANGELOG.md` — added `[Unreleased]` section at top with four subsections.

## Entry Text (as merged)

```markdown
## [Unreleased]

### Added

- **Opt-in append-only memory durability** — `OMK_MEMORY_DURABILITY=legacy|delta` (default `legacy`). Delta mode uses CRC-framed JSONL append + replay with snapshot compaction, avoiding per-write full serialization. Legacy mode remains byte-identical and the default.
- **Opt-in sandbox writableRoots enforcement** — `assertWritable` with deepest-existing-ancestor realpath resolution denies symlink escapes outside declared writable roots. Safe-default unrestricted when roots are empty; wired into `buildGatedDispatch` only when enforce, roots, resolver, and path are all present.

### Changed

- **Performance: hot-path optimizations** — `secret-scanner` `getLineColumn` reduced from O(matches × n) to O(n + matches × log lines) via precomputed newline-offset binary search. Memory store search reduced from O(N²) to O(N + E) one-pass content index; `mutateState` reuses a process-local parsed-state cache guarded by mtime/size/ctime/inode. Routing regex cache (~150× fewer recompiles per node). `runtime-router` precomputes capability scores before sort. `control-loop` six filters collapsed to one bucket pass. `cockpit`/`system24`/`terminal-layout` reduced ANSI strip/regex passes.

### Removed

- **BREAKING: Native (Rust) omk-safety lane** — Removed `crates/omk-safety`, root `Cargo.toml`/`Cargo.lock`, `scripts/build-native.mjs`, `scripts/rust-safety-check.mjs`, `scripts/normalize-native-artifacts.mjs`, `src/util/native-safety.ts`, and native-only tests. Removed npm scripts `rust:build`, `rust:check`, `native:build`, `native:normalize`, `native:no-kimi:turn`, and the shipped `omk-safety` binary. Safety checks are now pure TypeScript. See [ADR-0001](docs/adr/0001-no-native-rust-lane.md).

### Fixed

- **Cockpit color determinism test flake** — Timer-normalized the control-output determinism test to remove wall-clock dependency.
```

## Constraints Respected

- Only `CHANGELOG.md` was modified; no `package.json` bump, no provider/anthropic/CLAUDE/AGENTS.md/CI/source changes.
- `RELEASE.md` was not touched (repo does not use a separate release notes file).
- Claims are factual and conservative: delta durability and writableRoots enforcement are both explicitly called opt-in.
- ADR-0001 is linked from the BREAKING entry.

## Verification

- No markdown lint script found in `package.json` scripts.
- Markdown structure validated manually: headings are balanced, list syntax consistent, links well-formed.
