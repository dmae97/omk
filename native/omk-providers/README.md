# omk-providers — first offline Anthropic slice

This unpublished crate adopts the exact B1-reviewed transport graph and provides a
synthetic request builder, byte-chunk SSE replay library and `replay-anthropic`
stdin/stdout executable. It is **not a live provider, core selector or completed K1**.
No production Node provider behavior changes.

Approval, implementation scope and validation are recorded in
[the K1 adoption record](../../specs/120-rust-core/k1-adoption.md).

## Independent oracle

`node scripts/record-provider-fixtures.mjs` runs the actual Node `streamAnthropic`
and official Anthropic SDK under an isolated home and allowlisted environment.
Its fetch implementation never calls a network implementation; it refuses any URL
except `https://synthetic.invalid/v1/messages`, uses only `faux-key`, and refuses
retries. It records the SDK's serialized request body as a string, response byte
chunks, projected semantic events and final message. Rust never creates expected
fixtures. `--check` compares fresh Node output without overwriting it.

The 16 cases cover Unicode and bytewise UTF-8 splits, CRLF, trailing frames, tool
JSON fragments, thinking/signatures, token/cache usage, length/refusal stops,
unknown proxy events, SSE errors, empty/early EOF, cancellation before reading
and during streaming. Both Rust library tests and the real CLI compare with Node.

Projection is explicit in the fixture: SDK runtime/OS headers (`x-stainless-*`,
`user-agent`), timestamps, usage costs and mutable intermediate message snapshots
are excluded. All other captured headers and the request body string compare
exactly. Final content, usage, errors and event order compare structurally.
This is not full raw-header, partial-message, provider or model parity.

The split-CRLF case intentionally reproduces the Node decoder's current error:
consuming CR at the end of a chunk can prematurely flush an empty event on LF.
Intact CRLF succeeds. Empty input also preserves Node's current empty success.
Fixing these baselines is separate work, not a reason to rewrite an oracle.

## JSON repair and partial tool arguments

A separate Node-only oracle, `scripts/record-anthropic-json-fixtures.mjs`, records
331 utility observations and 17 synthetic streams in `tests/fixtures/anthropic-json.json`.
It calls the real Node JSON helpers and provider, including every intermediate
`toolcall_start`, `toolcall_delta` and `toolcall_end` argument value. The original
16-case oracle and all K0 goldens remain unchanged. Rust library and CLI tests
consume the frozen Node expectations, never manufacture them.

`json_parse` repairs invalid/dangling escapes and raw string controls, then uses a
bounded adaptation of `partial-json` 0.1.7. It preserves Node's partial literal,
number, string, nested-container and root-nullish behavior on the recorded surface,
including EOF/error/cancellation without finalization. JSON utilities and tool
JSON deltas refuse inputs over 1 MiB, nesting over 64, unpaired UTF-16 escapes,
non-finite numeric overflow and integers outside JavaScript's safe integer range.
Those refusals are explicit scope limits, not Node parity claims; SSE usage fields
retain their existing reducer validation. Valid surrogate pairs are supported.

Intermediate observations are opt-in: `replay_with_tool_arguments` or CLI
`observeToolArguments: true`. Default replay/CLI output stays unchanged and stores
no observations. The probe refuses more than 4096 observations or 8 MiB of argument
JSON snapshots rather than retaining unbounded quadratic history. These limits do
not apply to default replay. See [the JSON unit record](../../specs/120-rust-core/k1-json-parity.md).

## Checks

From the repository root, with a credential-free build environment:

```sh
node scripts/check-provider-dependencies.mjs --graphs
node scripts/record-provider-fixtures.mjs --check
node scripts/record-anthropic-json-fixtures.mjs --check
cargo check --locked --offline --manifest-path native/omk-providers/Cargo.toml
cargo fmt --check --manifest-path native/omk-providers/Cargo.toml
cargo clippy --locked --offline --manifest-path native/omk-providers/Cargo.toml --all-targets -- -D warnings
cargo test --locked --offline --manifest-path native/omk-providers/Cargo.toml
cargo build --locked --offline --manifest-path native/omk-providers/Cargo.toml
```

Offline commands require the locked registry sources to have been downloaded.
No vendor directory is committed. `npm run check:native` discovers this crate and
checks the graph before builds, then checks the fresh Node recording afterwards.

To replay one recording without sending the expected answer to Rust:

```sh
node --input-type=module -e 'import fs from "node:fs"; const c=JSON.parse(fs.readFileSync("native/omk-providers/tests/fixtures/anthropic.json")).cases[0]; console.log(JSON.stringify({input:c.input,chunks:c.chunks,abort:c.abort}));' |
  cargo run --locked --offline --quiet --manifest-path native/omk-providers/Cargo.toml --bin replay-anthropic
```

`abortAfterChunks` optionally models cancellation at a consumed chunk boundary.
Unknown input/oracle fields are refused. The request builder accepts only the
recorded synthetic model, API-key/no-cache user/system/tool surface. Replay has
an 8 MiB input limit, 1 MiB SSE buffer/event limit and bounded CLI input.
Beyond the bounded JSON corpus, OAuth, cache policy, model catalog, images,
history conversion, request overrides, HTTP errors/retries, proxy/deadline
semantics and a live network dispatcher remain outside this unit.

## Transport and distribution boundaries

`transport::build_client` is a build-only probe: it explicitly installs Ring,
refuses a preexisting process crypto-provider owner, disables redirects/retries
and proxies, applies a 30-second timeout and retains certificate verification.
It exposes no credential or dispatch integration. These are probe policies, not
claimed Node transport parity. Native trust stores and revocation behavior need
separate native-platform tests.

The exact lock differs from the reviewed temporary lock only in the root package
name. The guard checks the restored digest, direct pins/features, notice digest
and six effective resolution graphs. This does not replace native-host validation.
Only GNU Linux, macOS and Windows MSVC x64/ARM64 are approved targets. Other targets
fail compilation. macOS/Windows, including ARM64 Clang/SDK requirements, remain
unverified here; no cross-compiled artifact is acceptance evidence.

[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) retains all discovered license/notice
texts for the 99-package union, deduplicating byte-identical texts. Include it and
root LICENSE/NOTICE with any future binary distribution. MIT alternatives do not
remove Ring's Apache-2.0 AND ISC, ISC, BSD-3-Clause or Unicode-3.0 obligations.
The source adaptation has an additional [PARTIAL-JSON-NOTICE.md](PARTIAL-JSON-NOTICE.md);
include it alongside the existing notices. It does not change the digest-pinned
B1 dependency notice or add a Rust dependency. No binary is published or packaged
by this change.
