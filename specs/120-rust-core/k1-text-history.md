# K1 text-only conversation history

## Goal and scope

The owner reaffirmed the OMK 2 direction on 2026-11-14: keep the strict native
`omk` dialect, migrate remaining Pi surfaces instead of enabling compatibility to
hide startup warnings, and continue the Rust core and binary work. Existing MIT
and Apache attribution stays intact. This does not remove the separately approved
explicit compatibility adapter or change the K5/K8 release gates.

This unit continues K1 in spec 120. It is not a K4 transport, a Rust agent loop,
a production core selection, or an installed `omk2` change. Node remains the
production owner. A Bun-compiled Node distribution is distinct from a Rust core
binary; the executable built here is only the offline `replay-anthropic` probe.

The next stages remain provider parity (K1), loop/session ownership (K2), tools
(K3), the Node extension host and Rust manifest policy (K4), then the headless
candidate and platform acceptance (K5). Rust terminal UI and the default flip
remain K6 to K8. No stage or release is marked complete by this unit.

## Independent oracle and implementation

The new `scripts/record-anthropic-history-fixtures.mjs` invokes the actual Node
`streamAnthropic` and official SDK with a synthetic fetch, isolated home and
allowlisted environment. It accepts only the synthetic URL and key, refuses
retries, and records request body strings and non-runtime headers. The original
provider, JSON and K0 corpora are neither generated nor modified.

Twelve cases were recorded before Rust implementation: an empty-history control,
multiple turns, Unicode, blank user/assistant/final messages, all-blank input,
U+0085 as real text, preservation of leading/trailing whitespace, consecutive
roles, escaped controls and ECMAScript whitespace. Rust never produces expected
request bytes. SDK runtime headers are excluded as in the existing K1 corpus.

`request_history.rs` adds a typed `user | assistant` text-history input and borrowed
wire conversion. User content remains a string; assistant text uses a content
block array. Blank messages are omitted using ECMAScript's whitespace set rather
than Rust's broader whitespace classification; retained strings are not trimmed.
The optional `history` input defaults to an empty vector, preserving existing
recorded requests. Unsupported roles, fields and shapes are rejected rather than
silently dropping tool results, images or reasoning.

No new dependency, feature, lockfile, live HTTP path, credential behavior, goal
controller, manifest default, implicit alias or runtime activation is added.
This is same-model plain-text history only. Tool-use/result pairing, images,
thinking/signatures, cross-provider transformations, OAuth, caching and complete
provider parity remain outside this unit.

## Verification

Focused commands, from the repository root:

```sh
node scripts/record-anthropic-history-fixtures.mjs --check
node --test scripts/test/anthropic-history-fixtures.test.mjs scripts/test/anthropic-json-fixtures.test.mjs scripts/test/provider-fixtures.test.mjs
cargo check --locked --offline --manifest-path native/omk-providers/Cargo.toml
cargo fmt --manifest-path native/omk-providers/Cargo.toml --check
cargo clippy --locked --offline --manifest-path native/omk-providers/Cargo.toml --all-targets -- -D warnings
cargo test --locked --offline --manifest-path native/omk-providers/Cargo.toml
cargo build --release --locked --offline --manifest-path native/omk-providers/Cargo.toml --bin replay-anthropic
```

- Behavioral RED: compiled test failed because `history` was an unknown input
  field. The negative control already passed. This was a runtime assertion, not
  a missing toolchain or uncompilable scaffold.
- GREEN: 12 independent request comparisons through both library and debug
  executable, plus unsupported-input rejection through both surfaces.
- Rust check, formatting, Clippy with denied warnings, all 13 crate tests and the
  release build passed with no skipped tests. Builds used Rust 1.99.0, a read-only
  source/cache, an isolated target/home, cleared environment and disabled network.
  The first sandbox setup failed to create a mountpoint on the read-only root;
  using the existing writable temporary mount fixed setup without weakening it.
- Focused Node tests: 8 passed, zero skipped. The new TypeScript recorder passed
  its targeted strict compiler check.
- Primary LSP coverage was inconclusive. The auxiliary hardcoded-URL warning is
  the deliberately fixed synthetic endpoint, not a production endpoint setting.

- Full credential-free `npm run check`: exit 0, including all six native crates,
  declaration/matrix/fresh-fixture checks, TypeScript and repository guards.
  Script tests: 723 total, 692 passed, 31 skipped, zero failures. Existing skipped
  platform/live/tool-dependent checks are not acceptance evidence.
- The optimized GNU Linux x64 executable independently matched all 12 request
  recordings. This verifies the built replay executable, not the OMK application.
- Pi inventory: exit 0. Its existing manifest/import/alias inventory is not zero;
  no rejection fixture, compatibility setting or gate was removed to hide it.

Preservation compares the original provider/JSON/K0 corpora, dependency locks and
manifest against the request-start snapshot. No native macOS/Windows, production
TUI, full Rust core, installed-runtime or publication acceptance is implied.
The original `omk2` package warnings remain until those packages are migrated;
this unit neither suppresses them nor opts into legacy compatibility.
