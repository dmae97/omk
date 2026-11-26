# K1 OpenAI Responses request bytes

Date: 2026-11-21. Scope: one K1 unit, the `{url, headers, body}` that
`streamOpenAIResponses` sends through the official `openai` SDK for system and
user-text history. Status: implemented and locally verified, uncommitted. Not
complete K1, live-provider, installed-runtime or release acceptance.

## Surface

`native/omk-providers/src/openai_responses.rs` and the
`request-openai-responses` executable port `buildParams` and `createClient` from
`packages/ai/src/providers/openai-responses.ts`, plus the system/user and tool
parts of `convertResponsesMessages`/`convertResponsesTools`:

- `POST {baseUrl}/responses`, `store:false`, `stream:true`, system role
  `developer` for reasoning models, user text as `input_text` parts (empty part
  lists skipped, as in Node).
- `max_output_tokens` (only when truthy), `temperature` (ECMAScript number text),
  `service_tier`, tools sorted and canonicalized by the existing
  `tool_schema::stable`, always `strict:false`.
- Reasoning: explicit effort or summary gives `{effort, summary}` plus
  `include:["reasoning.encrypted_content"]`; effort goes through
  `thinkingLevelMap` with `??` fallback and summary defaults to `auto`.
  Otherwise the model's `off` value or `none` is sent; `off:null` suppresses it.
- Cache: unlike chat completions, `prompt_cache_key` is sent for every host
  when retention is not `none` (content key, boundary rules and the 64 code point
  session clamp are reused from `openai_completions/cache.rs`).
  `prompt_cache_retention:"24h"` needs `long` and
  `supportsLongCacheRetention`, which defaults to true here.
- Headers: a non-empty session (retention not `none`) adds
  `x-client-request-id`, and `session_id` unless `sendSessionIdHeader` is false.

Shared helpers were made crate-visible rather than copied: `endpoint(base,
suffix)`, `cache::key`, `effort::Level`/`LevelMap` and `plain_header_value`.

Refused without partial output: GitHub Copilot and Cloudflare providers,
`sendCodexTurnMetadata:true`, assistant and tool-result messages, images, text
signatures, unknown fields, `reasoningEffort:"off"`, explicit `null` for
`temperature`/`serviceTier`/`sessionId` (Node forwards these), header values Fetch
would trim, Latin-1 encode or reject (Node itself fails on non-Latin-1 sessions
because Responses always sends them), non-canonical base URLs and tool names
outside `[A-Za-z0-9_-]`.

## Oracle and RED/GREEN

`scripts/fixtures/openai-responses-recorder.ts`, run by
`scripts/record-openai-responses-fixtures.mjs` in an isolated home with an
allowlisted environment, records 47 requests through the real provider and SDK
with an in-memory fetch that rejects any other URL or credential. It was recorded
before the Rust port; `--check` compares without rewriting.
`scripts/test/openai-responses-fixtures.test.mjs` checks freshness and a few
branch facts.

The first recording attempt failed on an astral session (`ByteString` error in
Node); that case became an ASCII clamp case plus a Rust refusal.

Compiled RED: with a stub module the corpus test failed on the first case
(`request refused: not ported`) while the refusal test passed. GREEN: the library
and executable match all 47 requests byte for byte (executable run with a cleared
environment plus `OPENAI_API_KEY` and `OMK_CACHE_RETENTION=long`, which must not
win). Three hand mutants failed at the expected cases: ignoring `off:null`
(`off-null`), `sendSessionIdHeader` default false (`session-short`) and
`supportsLongCacheRetention` default false (`retention-long-default`).

## Verification

- Crate: `cargo fmt --check`, `cargo check --all-targets`, Clippy
  `--all-targets -D warnings` and `cargo test` exit 0; 73 tests pass. The
  chat-completions suite still passes after the `endpoint` refactor (a first
  rerun failed because the new parameter shadowed a local `path`; fixed).
- Strict recorder `tsgo --ignoreConfig` exits 0; both fixture test files pass 7/7.
- One `npm run check` invocation exited 1 only at `check:pi-inventory`, because
  of another lane's deleted `packages/coding-agent/src/ci/verify-reporter.ts`.
  Earlier steps passed (`check:native`; `check:constitution` 736 passed, 30
  skipped, zero failed, including the new test). Workspace `tsgo --noEmit` and
  `check:browser-smoke` then exited 0 separately. Host load average was about 50.

## Not covered

Assistant text/reasoning/tool-call history and tool results (covered by the
follow-up below), images, `options.headers`/`model.headers`,
Copilot dynamic headers, Cloudflare base URL and gateway auth, Codex turn
metadata, `onPayload`, response SSE parsing, service-tier pricing, transport and
live providers.

## Follow-up: assistant, reasoning and tool history (2026-11-21)

`native/omk-providers/src/openai_responses/history.rs` ports `transformMessages`
and the assistant/tool-result branches of `convertResponsesMessages`. Every
assistant carries an explicit `source {provider, api, model}`; there is no
implicit same-model default.

- First pass (source differs from the target provider, `openai-responses` or
  model): redacted and blank thinking dropped, other thinking becomes text, text
  signatures dropped, tool-call IDs normalized as `normalizeToolCallId` does
  (`normalizeIdPart` over UTF-16 units, `fc_` + `shortHash` item IDs for a
  foreign provider/API, an `fc_` prefix otherwise, only for `openai`,
  `openai-codex` and `opencode` targets) and later results remapped.
- Second pass: error/aborted assistants and their results dropped, results
  without a live call or with a blank ID dropped, IDs trimmed with ECMAScript
  whitespace, missing results synthesized as `No result provided`.
- Items: reasoning signatures re-serialized with JS key order (index keys first),
  only for nonblank thinking; text messages with `{v:1,id,phase}` or legacy
  signature IDs, over-64-unit IDs hashed to `msg_<shortHash>`, otherwise
  `msg_omk_<index>[_<textIndex>]` where the index skips turns that emit nothing,
  as Node's `continue` does; `function_call` with the item ID dropped for a
  same-provider different-model `fc_` item; `function_call_output` joining text
  with `\n`, or `(see attached image)` when empty.

Shared helpers made crate-visible: `openai_completions::arguments::stringify` and
`handoff::short_hash`. Refused without output: unparsable or non-object reasoning
signatures, duplicate keys, text signatures starting with `{` that serde cannot
parse (Node's JSON.parse also accepts lone surrogates and overflowing numbers, so
the port refuses rather than guesses), non-object arguments, images in assistant,
user or tool-result content, unknown block fields, assistants without source and
sources on other roles.

Oracle: `scripts/fixtures/openai-responses-history-recorder.ts`
(`record-openai-responses-fixtures.mjs --history`, 19 cases: same-model tool
turn, reasoning items, 13 text signatures, message index skipping, pairing,
tool-result text, odd call IDs, and a 3 target × 4 source-change cross matrix with
10 IDs), recorded before the port. Compiled RED: the corpus test refused the first
case (`unknown variant assistant`), the other two tests passed. GREEN on the first
implementation run for all 19 cases; the 47 earlier requests still match. Eight
hand mutants each failed: index counting empty turns (`message-index`), foreign
check without API (`cross-openai-api`), ignoring the different-model item drop
(`cross-openai-model`), no trailing `_` strip (`cross-synthetic-provider`), code
point instead of UTF-16 ID length (`text-signatures`), space join
(`tool-results`), empty instead of blank thinking (`same-reasoning`) and keeping
redacted thinking cross-model (`cross-synthetic-provider`).

Commands: crate `cargo fmt --check`, `check --all-targets`, Clippy `-D warnings`
and `cargo test` exit 0 (74 tests); strict recorder `tsgo --ignoreConfig` exit 0;
fixture test 2/2. One `npm run check` again exited 1 only at
`check:pi-inventory` (deleted `verify-reporter.ts`, another lane), after
`check:native` and `check:constitution` (737 passed, 30 skipped, zero failed);
workspace `tsgo --noEmit` and `check:browser-smoke` exit 0 separately. Load
average about 37.

Not covered: images (user, tool-result and non-vision downgrade; covered by the
follow-up below), Copilot and Cloudflare clients, `options.headers`, response SSE parsing, transport and live
providers.

## Follow-up: images (2026-11-21)

`history.rs` now accepts `{type:"image", data, mimeType}` in user and tool-result
content. The caller resolves `vision` (Node: `model.input` includes `"image"`);
a request whose history contains any image without explicit `vision` is refused
before pairing, so a dropped orphan result cannot hide the missing capability.

- Vision: user images become `{type:"input_image", detail:"auto",
  image_url:"data:<mimeType>;base64,<data>"}` in order, data and MIME type
  verbatim (Responses has no image guard). Tool results with images become an
  output list: one `input_text` with the `\n`-joined text when it is non-empty,
  then the images; text-only results stay a string, empty ones
  `(see attached image)`.
- Non-vision: `downgradeUnsupportedImages`, reusing `request_content::texts`
  (user and tool placeholders, consecutive images collapsed, a literal
  placeholder text suppressing the next one), then the text-only mapping.

Oracle: `scripts/fixtures/openai-responses-images-recorder.ts`
(`record-openai-responses-fixtures.mjs --images`, 10 cases = 5 histories ×
vision/non-vision: single, ordered, literal markers of both kinds, per-turn with
empty and string turns, and 9 tool results including empty MIME/data, newline and
U+2028 in data). Recorded before the port. Compiled RED: `unknown field vision`
on the first case, the other three tests passed. GREEN after one fix: the
existing refusal of a tool-result image without `vision` passed through because
the orphan result was dropped first; the up-front check above restored it. Five
new refusals: non-boolean `vision`, missing `mimeType`, unknown image field and
4097 blocks with either `vision` value. Six hand mutants failed: always adding
`input_text` (`vision-tool-results`), `detail:"high"` (`vision-user-only`), the
tool placeholder for users (`text-user-only`), the user placeholder for tool
results (`text-tool-results`), dropping the empty-text fallback
(`vision-tool-results`) and requiring `vision` without images (base corpus; it is
equivalent on the image corpus).

Commands: crate `cargo fmt --check`, `check --all-targets`, Clippy `-D warnings`
and `cargo test` exit 0 (75 tests); strict recorder `tsgo --ignoreConfig` exit 0;
fixture test 3/3. One `npm run check` exited 1 only at `check:pi-inventory`
(another lane's deleted `verify-reporter.ts`) after `check:native` and
`check:constitution` (738 passed, 30 skipped, zero failed); workspace
`tsgo --noEmit` and `check:browser-smoke` exit 0 separately. Load average about
78.

Not covered: Copilot vision headers, Cloudflare clients, `options.headers`
(covered by the follow-up below), response SSE parsing, transport and live providers.

## Follow-up: model and option headers (2026-11-21)

`native/omk-providers/src/openai_responses/headers.rs` ports the `createClient`
merge and the openai 6.49.0 SDK `buildHeaders` order. Input fields:
`modelHeaders` (`model.headers`) and `headers` (`options.headers`), both
`Record<string, string>` in source key order.

- `createClient` is `Object.assign` on case-sensitive keys: model headers, then
  `session_id` (unless `sendSessionIdHeader` is false) and `x-client-request-id`,
  then option headers. An existing key keeps its position and takes the new
  value.
- `buildHeaders`: `accept` and `authorization` first, then the merged object
  with lowercased names where the last entry per lowercase name wins, then
  `content-type: application/json` from the body headers. So option and model
  headers can override `accept` and `authorization` but not `content-type`, and a
  later-cased key can beat an earlier key that was overwritten in place.
- Array-index keys reorder under `Object.entries`, but digits have no case
  variants, so the result is the same without reordering (kept as a comment).

Refused without output: non-string or null values, non-object header records,
duplicate keys, names outside the SDK's HTTP token set, values Fetch would trim,
Latin-1 encode or reject, and `user-agent`/`x-stainless-*` (SDK-owned and outside
the recorded headers). The old negative example that refused any `headers` field
was replaced by these.

Oracle: `scripts/fixtures/openai-responses-headers-recorder.ts`
(`record-openai-responses-fixtures.mjs --headers`). The first 15 cases were
recorded before the port: model only, option only, option over model in the same
and a different case, case-collision position, index keys, model session keys
replaced by the session, option over session, `sendSessionIdHeader:false` keeping
the model's `session_id`, retention `none`, `accept`/`authorization` overrides,
SDK-owned `content-type`, empty and inner-whitespace values, token punctuation
and empty records. Compiled RED: `unknown field modelHeaders` on the first case,
the other four tests passed. GREEN on the first run. Hand mutants: appending
instead of in-place assign (`case-collision-position`), no `content-type` last
(`model-only`), ignoring option headers (`options-only`) and first-wins
lowercasing (`options-override-other-case`) failed. A mutant setting the session
under a different-cased key survived, so a 16th Node case
(`session-in-place-before-cased-key`, model `session_id` then `SESSION_ID`) was
recorded after the port; it kills that mutant. The 15-case recording is retained
at `/tmp/openai-responses-headers.v15.json`, and its 15 cases are unchanged in the
16-case fixture.

Commands: crate `cargo fmt --check`, `check --all-targets`, Clippy `-D warnings`
and `cargo test` exit 0 (76 tests); strict recorder `tsgo --ignoreConfig` exit 0;
fixture test 4/4. One `npm run check` exited 1 only at `check:pi-inventory`
(another lane's deleted `verify-reporter.ts`) after `check:native` and
`check:constitution` (739 passed, 30 skipped, zero failed); workspace
`tsgo --noEmit` and `check:browser-smoke` exit 0 separately.

Not covered: Copilot dynamic headers, Cloudflare gateway authorization,
`OPENAI_ORG_ID`/`OPENAI_PROJECT_ID`, `onPayload`, response SSE parsing, transport
and live providers.
