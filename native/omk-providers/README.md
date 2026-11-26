# omk-providers — first offline Anthropic slice

This unpublished crate adopts the exact B1-reviewed transport graph and provides
synthetic replay plus an explicit catalog-selected Anthropic dispatch library and
`provider` executable. It is **not the installed provider host, core selector or
completed K1**. No production Node provider behavior changes.

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

## Incremental response consumption

`anthropic::Stream` exposes the existing recorded text-model decoder/reducer as
`new`, `feed`, `take_events` and consuming `finish(error, aborted)`. Drain after
construction and every feed, including a failed feed. Complete semantic frames
are available before EOF; drained events are never returned twice. `finish`
flushes trailing EOF frames and returns undrained events plus one terminal event
and the final message. An earlier parser failure takes precedence over a later
transport/sink diagnostic. Feeding after failure returns the same latched error.

The stream retains decoder/reducer state, not the original chunks, and enforces
an 8 MiB total wire bound. Callers still own transport cancellation, deadlines,
backpressure and prompt event draining. Existing replay and its executable use
this same state machine, preserving all frozen event/result and tool-argument
oracles. A loopback transport test waits for a delivered text event before sending
the remaining response, and verifies socket closure and recorded partial results
when cancelled at that event. This does not add a production provider dispatcher,
mutable partial snapshots, cost/auth/catalog policy or vision response support.
See [the incremental stream unit](../../specs/120-rust-core/k1-stream.md).

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

## Text-only conversation history

The optional request `history` array accepts `{role: "user" | "assistant", text}`
before the existing final `user` string. Twelve independently recorded Node/SDK
requests cover multi-turn text, Unicode, blank filtering and exact serialized
body bytes through the Rust library and executable. The original text corpus remains
unchanged. See [the text-history unit](../../specs/120-rust-core/k1-text-history.md).

`node scripts/record-anthropic-history-fixtures.mjs --check` checks this separate
oracle without changing either existing provider corpus. Its script regression
is included by the repository's normal script-test discovery.

## Tool and thinking conversation history

`history` additionally accepts assistant `content` blocks (`text`, `thinking`,
`toolCall`) with an optional `stopReason`, and `toolResult` messages with
`toolCallId`, text `content` blocks and `isError`. The earlier `{role, text}` input
still works. These shapes are mutually exclusive; unsupported fields are refused.

The separate 25-case Node oracle records exact request bodies and non-runtime
headers before Rust implementation. The library and executable preserve same-model
call IDs, consecutive-result grouping, missing-result synthesis, orphan-result
filtering, error/aborted-turn removal, signed/redacted thinking and unsigned-thinking
text fallback. This builds requests only: it neither executes tools nor owns an
agent loop. Run `node scripts/record-anthropic-tool-history-fixtures.mjs --check`.

History is limited to 4096 messages and 4096 blocks per message. Tool arguments use
the existing 1 MiB/64-level safe-number JSON guard. Arguments preserve recorded
Node JSON key order; equivalence for arbitrary JSON number/escape spellings is not
claimed. Cross-provider history, OAuth, caching and live dispatch remain unsupported.
See [the tool-history unit](../../specs/120-rust-core/k1-tool-history.md).

## User arrays and non-vision image downgrade

For the existing text-only synthetic model, user `history` accepts `content` arrays
of `{type: "text", text}` and `{type: "image", data, mimeType}`. Tool-result arrays
accept the same blocks. Images are replaced with the Node role-specific omission
text; adjacent image placeholders are deduplicated before user blank filtering.
User arrays remain block arrays; tool-result text is joined with newlines, including
blank blocks. Empty user arrays still interrupt tool flow before being omitted.
The original `{role, text}` and final `user` string remain unchanged.

The separate 26-case Node/SDK oracle compares request bytes in the library and
executable. Run `node scripts/record-anthropic-content-fixtures.mjs --check`.
The 4096-block limit counts inputs before deduplication, including orphan results.
Image payloads are never decoded, fetched or transmitted. This does not enable
vision, dimension guards or a model-capability option; unknown fields are refused.
See [the content-history unit](../../specs/120-rust-core/k1-content-history.md).

## Synthetic vision requests and image header guard

The separately recorded `synthetic-anthropic-vision` model accepts image blocks
in user and tool-result history. The existing text-only model is unchanged.
User images retain order and their original base64/MIME strings. Tool results use
mixed blocks when images remain, adding `(see attached image)` only for image-only
results; text-only results still join with newlines.

The Node-derived PNG/JPEG/GIF/WebP header guard replaces recognized dimensions
above 1900px with the exact Node omission text. It decodes at most the first 87384
UTF-16 code units (up to 65538 bytes), including Node's permissive base64 behavior.
Unknown/short/malformed formats remain unchanged; this is not an image validator
or proof the API will accept them. There is no image fetching, resizing or dispatch.

`node scripts/record-anthropic-vision-fixtures.mjs --check` verifies 50 independent
Node/SDK request recordings through both Rust library and CLI tests. Vision replay
admits only the empty response used by the request oracle; nonempty responses and
cancellation remain refused until independently recorded. See
[the vision unit record](../../specs/120-rust-core/k1-vision-history.md).

## Credential snapshot resolution

`auth::Snapshot` resolves a host-supplied credential-store snapshot in Node priority
order: nonempty runtime override, stored API-key config, provider-selected environment
key, then optional model-config fallback. Unreadable/malformed stores block substitution;
a stored empty key or unresolved template does not fall through to another account.
`auth::resolve_config` supports the Node literal/`$NAME`/`${NAME}` grammar and `$$`/`$!`
escapes with caller-supplied environment lookup. Keys have redacted `Debug` output.

The independent real Node `AuthStorage` oracle contains 52 cases, compared through
both library and `replay-auth`. Run `node scripts/record-auth-fixtures.mjs --check`.
This offline diagnostic explicitly prints resolved **supplied stdin values**; use only
synthetic keys, not real credentials. It never reads auth files or ambient environment.
Snapshots are read-only and must be refreshed by their host before use. File storage,
locking, OAuth refresh, command execution and provider environment-name policy remain
unimplemented. The separate catalog/dispatch adapter below consumes these snapshots.
Commands and OAuth entries return typed host-required refusals rather than falling back. See
[the auth-resolution unit](../../specs/120-rust-core/k1-auth-resolution.md).

## Explicit catalog and authenticated dispatch

`catalog::Catalog::load` embeds 2,245 public Node models and applies host-supplied
models.json text. Sixteen independently recorded overlays cover defaults, inheritance,
replacement, ordering, nested compatibility/cost merges, headers, visibility and invalid
configuration. `view` takes authenticated provider IDs from the host; it does not infer
login status from text. Invalid overlays retain builtins for inspection but dispatch
refuses them; invalid explicit visibility fails closed. Overlay input is bounded at 1 MiB.
This is a frozen catalog, not runtime discovery, refresh or OAuth model mutation.

`dispatch::prepare` selects an `anthropic-messages` model, resolves explicit credential
sources and headers, and reuses the existing request/transport/stream owners. Model-config
key fallback requires `KeySources.include_fallback`; a supplied fallback takes precedence
over catalog configuration. Empty/unresolved stored keys, unreadable stores, commands and
OAuth never silently substitute another account. `Prepared` has no Debug/Serialize.

The adapter defaults to no cache, one attempt and explicit maxTokens. Optional typed
thinking/temperature/metadata/tool-choice policies are described below. Copilot, Cloudflare
and Kimi special client policies and OAuth bearer tokens remain refused. Recorded eager-tool
and beta headers, configured header precedence and catalog image request capability are reused.
Ten independent Node SDK cases compare body bytes, non-runtime headers, semantic events
and final token/content projections through real loopback library and executable paths.
This does not establish vision-response, arbitrary-model, cache/thinking/retry or live TLS parity.

`provider catalog` reads `{overlay?, providers?, authenticated?}` JSON from stdin.
`provider stream` reads `{overlay?, provider, input, store?, runtime?, environment?, env?,
timeoutMs?, maxResponseBytes?}` and flushes `{event: ...}` NDJSON, then `{result: ...}`.
Both refuse unknown fields and stdin above 2 MiB. `input` has the replay request shape,
with a catalog model ID. The CLI explicitly enables the catalog key fallback and never
reads ambient environment/auth files. Its `store` and `env` are caller-supplied snapshots.
Use synthetic credentials for offline diagnostics. Provider errors are sanitized; a valid
stream protocol with an error result is not a successful provider completion. The CLI's
exit status reports protocol execution; callers must inspect the terminal event/result.
Callbacks must return promptly; blocked output cannot be preempted by the deadline.

Run `node scripts/record-catalog-fixtures.mjs --check` and
`node scripts/record-dispatch-fixtures.mjs --check` to check provenance without rewriting.
See [the catalog/dispatch unit](../../specs/120-rust-core/k1-catalog-dispatch.md).

## Explicit Anthropic request options

Catalog dispatch additionally accepts `input.options` with `temperature`, `thinkingEnabled`,
`thinkingBudgetTokens`, `thinkingDisplay`, `effort`, `metadata` and `toolChoice`.
Thirty-two independently recorded Node SDK cases compare exact request bytes and projected
responses through both existing loopback library and actual CLI tests. Options preserve
non-reasoning gates, thinking/temperature exclusion, classic zero-budget fallback to 1024,
adaptive effort/display, explicit disabled-thinking compatibility, user_id-only metadata
and the auto/any/none/named-tool choice shapes. Eight additional Node model-name observations
check the default disabled-thinking gate and explicit compatibility overrides.

Unknown options and invalid enum/shape input are refused. This bounded interface also
refuses temperature outside 0 through 1, non-u32 budgets and empty/over-256-byte named tools;
these are admission bounds, not claims that Node rejects the same values. Legacy synthetic
replay refuses `options` rather than silently ignoring them. Existing replay corpora remain
unchanged. No ambient defaults, simple-reasoning inference, OAuth or retry/error-policy
parity, provider-model acceptance or installed adoption is added by that unit. The explicit
cache/system-boundary follow-up is described below.
Run `node scripts/record-anthropic-policy-fixtures.mjs --check`.
See [the request-policy record](../../specs/120-rust-core/k1-request-policy.md).

## Explicit Anthropic request cache

Catalog dispatch accepts `input.options.cacheRetention` as `none`, `short` or `long`.
Long retention includes a one-hour TTL only when model compatibility allows it. Cache
control is attached to the final supplied tool when allowed and to the final converted
user text/image/tool-result block. Tool order and schemas are canonicalized as described
in the tool-schema section below; the final tool is selected after sorting.

`input.systemPromptCacheBoundary` uses UTF-16 units. A valid positive integral boundary
splits stable prefix from dynamic suffix and caches only the prefix. Explicit invalid
metadata (including null), or `systemPromptCacheBoundaryBypass: true`, leaves the system
prompt uncached; conversation/tool cache is independent. Splitting a surrogate pair
removes unpaired units exactly as the Node sanitizer does. Boundary presence is retained
instead of conflating missing with null. Cache/bypass shapes are strict, and synthetic
replay still refuses new policies. Omitted retention preserves the bounded adapter's
previous no-cache behavior; Node's ambient/default retention is not inferred.

Thirty-two new independent Node SDK cases match exact library/executable socket requests.
All prior corpora remain unchanged. Run
`node scripts/record-anthropic-cache-fixtures.mjs --check`.
See [the cache unit](../../specs/120-rust-core/k1-request-cache.md).
This is explicit API-key request caching, not provider acceptance, cache-affinity policy,
OAuth, caching success/billing, full K1 or installed runtime adoption.

## Empty thinking-signature compatibility

Catalog-selected `compat.allowEmptySignature` now preserves nonblank same-model thinking
with an empty signature when the original signature is missing or ECMAScript-blank.
Without the flag it remains plain text. Compatibility applies even when `input.options`
is absent. Valid signatures, redacted opaque blocks and blank-thinking omission retain
existing behavior; replay defaults and malformed-redacted refusals are unchanged.
Eighteen independent SDK requests match both library and executable sockets, including
BOM versus NEL trim behavior and empty redacted data. This is not cross-model history,
OAuth or full provider parity. Run
`node scripts/record-anthropic-signature-fixtures.mjs --check`.
See [the signature unit](../../specs/120-rust-core/k1-thinking-signature.md).

## Tool schema canonicalization and collation

Every request now applies the Node `stableTools` contract inside the existing builder.
Tools are sorted by name with en-US/ICU root order for `[A-Za-z0-9_-]`: punctuation,
digits, then letters, with lowercase before uppercase on ties. `properties` is
re-emitted in JSON.parse key order: array-index keys first, then UTF-16 order. The
last duplicate key wins, `required: null` is dropped, numbers use ECMAScript
formatting and non-object roots become `{}`. Five independent SDK requests match through
the library and executable; 25 `stableToolSchema` literals match through the library.

Names outside that alphabet, duplicate names and lone-surrogate strings are refused
instead of being misordered. Those are admission bounds, not Node parity claims. One
obsolete raw-order boundary expectation was replaced. Other corpora are unchanged. Run
`node scripts/record-anthropic-tool-schema-fixtures.mjs --check`.
See [the tool-schema unit](../../specs/120-rust-core/k1-tool-schema.md). This unit does
not cover other provider APIs, cache-affinity keys, OAuth name mapping or full K1.

## OpenAI chat-completions request bytes

`openai_completions::build_request` and the `request-openai-completions` executable
build the exact `{url, headers, body}` that Node `streamOpenAICompletions` and the
`openai` SDK send for a narrow API-key surface. That surface is system/developer
role, user strings and text blocks, assistant text, tools with canonical parameters
and `strict`, tool choice, temperature and both max-token fields. The caller passes
resolved compatibility flags; provider/URL detection is not ported. Twenty-one
independent Node requests match through both paths. Base URLs that WHATWG
serialization could rewrite and unsupported history shapes are refused. Later
follow-ups add images, tool history, caller-resolved `thinkingFormat`/`reasoningEffort`
parameters (`--effort` corpus) and `prompt_cache_key`/`prompt_cache_retention`
(`--cache` corpus, which also admits `api.openai.com`). There is no
response parser, dispatch or transport wiring yet.
Run `node scripts/record-openai-completions-fixtures.mjs --check`.
See [the OpenAI completions unit](../../specs/120-rust-core/k1-openai-completions-request.md).

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
recorded synthetic models, API-key/no-cache user/system/tool surface. Replay has
a 16 MiB recording-stdin limit and an 8 MiB stream/replay wire limit, 1 MiB SSE buffer/event limit and bounded CLI input.
Beyond the bounded JSON and image-request corpora, OAuth, cache policy, model catalog,
cross-provider history, request overrides, HTTP errors/retries, proxy/deadline
semantics and a live network dispatcher remain outside this unit.

## Transport and distribution boundaries

`transport::Transport::post` now sends an explicit single-attempt HTTP POST and
streams bounded response bytes to a synchronous consumer, with status/headers
available before each chunk. It uses the existing Ring/native-root client, no
redirects/retries/inherited proxies, and its existing 30-second ceiling. A caller
also supplies an absolute Tokio deadline and an irreversible cancellation handle;
headers and body share that deadline. There is no background request task.

Only HTTPS or numeric loopback HTTP is admitted. URL credentials/fragments,
caller-supplied framing headers and requests/response limits above 8 MiB are
refused. Bytes over the response cap are never delivered to the consumer. Errors
are typed and do not include endpoints, credentials, request bodies or reqwest's
raw diagnostic text. HTTP error status/body is delivered once, not retried or
translated into provider errors. Dropping the future cancels local I/O, not work
already accepted by the server. Consumers must return promptly; synchronous
callbacks cannot be preempted.

Thirteen real loopback tests run without external networking, including transmission
of an unchanged independently recorded SDK request and response replay. They test
transport ownership/policy, not Node SDK transport parity or production provider
wiring. No live credential/provider, TLS handshake, proxy, retry, native trust
store/revocation or macOS/Windows acceptance is claimed. See
[the transport unit record](../../specs/120-rust-core/k1-transport.md).

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
