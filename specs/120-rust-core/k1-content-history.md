# K1 user arrays and non-vision image downgrade

Date: 2026-11-16. Request-start HEAD: `ab08eb635e` on `2.0.0`.
This bounded continuation preserves the preexisting uncommitted tool/thinking
slice and all prior corpora. It does not complete K1 or start K2.

## Scope

The existing text-only synthetic request model now accepts user history `content`
arrays and text/image blocks in tool results. The original user/assistant `text`
shapes and final `user` string remain supported. User arrays remain arrays with
blank text removed; tool text remains a newline-joined string with blanks intact.

The shared conversion follows `transform-messages.ts`: replace images with the
role-specific omission text and collapse adjacent images or images immediately
after that exact placeholder. An intervening blank text resets adjacency before
user blank filtering. Explicit text placeholders are not themselves deduplicated.
Empty user arrays still interrupt pending tools and separate tool-result groups.
The existing pairing, missing-result synthesis and orphan/error filtering remain.

This model cannot see images. Payloads and MIME strings must be present and typed,
but are never decoded or transmitted. This intentionally does not validate image
formats or base64 that Node also discards before conversion. No image URL is
fetched. Vision metadata, image transmission and oversized-image guards remain
outside this slice. A future vision slice must independently record those paths.
Unsupported/ambiguous fields and blocks are refused. The existing 4096-block bound
is applied before image deduplication, even for orphan tool results.

## Independent oracle

`scripts/record-anthropic-content-fixtures.mjs` invokes actual Node
`streamAnthropic` and the official SDK with an isolated home, allowlisted
environment, in-memory fetch, synthetic credential/endpoint and zero retries.
The model remains text-only; no existing recorder or corpus is changed.
The recorder refuses to overwrite an existing corpus; `--check` compares without
writing. Rust never generates expected values.

The 26 requests cover blank/text/Unicode user arrays, ECMAScript whitespace,
single/adjacent/separated images, explicit omission text, blank adjacency,
discarded MIME/data, empty/blank/text tool results, grouped results, interrupted
tools, blank-array group boundaries and orphan/failed-assistant image results.
Both `build_request` and the real `replay-anthropic` executable compare each
captured request body string and non-runtime headers exactly. The Node fixture
assertions independently check omission, joining, blank filtering and grouping.

## Verification

The compiled RED failed two Rust tests with `unsupported or ambiguous history
message fields`, starting at `user-empty-array`; malformed-input refusal already
passed. The same three focused tests pass after implementation. They also check
malformed image/content refusal without partial stdout and the 4096/4097-block
boundary before deduplication for user and tool-result arrays.

All runs use synthetic data. Focused offline Cargo runs use a read-only source/cache,
network-disabled sandbox and an owned writable target/temporary directory.
No dependency, lockfile, model catalog, Node provider, installed-runtime, auth,
workflow, staged-content, commit, push or release change is part of this unit.

Final observed checks:

- `cargo check --offline --locked`, `cargo fmt --check`, Clippy with `-D warnings`
  and all 19 crate tests pass. The new corpus adds three tests and 26 request
  comparisons through both library and executable. Existing request/SSE/JSON
  corpora remain unchanged.
- The historical text-history refusal test treated an empty user array as
  unsupported. It now rejects user `toolCall` blocks instead; the new positive
  oracle covers empty arrays. The initial full-crate failure is retained.
- All 12 focused Node oracle/regression tests pass with zero skips. Strict recorder
  TypeScript compilation passes; `tsgo` requires explicit `--ignoreConfig` when
  files are supplied. Its first invocation failed with TS5112 and is not a pass.
- `npm run check` exits 0. It checks all six native crates, fresh K0 fixtures,
  contracts, TypeScript and repository guards. Script tests: 741 total, 711 pass,
  30 skip, zero fail. This is not a whole-product Vitest or live-provider run.
- The first repository check hit the outer 120-second tool limit; no terminal
  exit was observed. The retry completed in 236.598 seconds. Both logs remain.
- Scoped Biome processed no files because existing configuration excludes scripts;
  that invocation is not a lint pass. Repository Biome and strict TypeScript
  checks passed without changing those exclusions. Initial Rust format findings
  were fixed only in this unit's changed lines.
- LSP checked six paths: one confirmed clean, one auxiliary synthetic-endpoint
  warning, four inconclusive. This is not an all-clean LSP result.

The final scoped preservation audit checks the request-start HEAD, staged diff
and every captured tracked/untracked path outside the 13 enumerated unit paths.
It reports no outside changes. No preservation exception or fixture rewrite was
used to obtain a passing check. `git diff --check` exits 0.

Commands from the repository root (credential-free environment):

```sh
node scripts/record-anthropic-content-fixtures.mjs --check
node --test scripts/test/anthropic-content-fixtures.test.mjs scripts/test/anthropic-tool-history-fixtures.test.mjs scripts/test/anthropic-history-fixtures.test.mjs scripts/test/anthropic-json-fixtures.test.mjs scripts/test/provider-fixtures.test.mjs
cargo check --locked --offline --manifest-path native/omk-providers/Cargo.toml
cargo fmt --check --manifest-path native/omk-providers/Cargo.toml
cargo clippy --locked --offline --manifest-path native/omk-providers/Cargo.toml --all-targets -- -D warnings
cargo test --locked --offline --manifest-path native/omk-providers/Cargo.toml
npm run check
```
