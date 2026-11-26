# K1 OpenAI chat-completions request bytes

Date: 2026-11-17
Status: implemented bounded source unit; full K1 and migration remain open.

This is the first non-Anthropic request slice in `native/omk-providers`. The new
oracle, `scripts/fixtures/openai-completions-recorder.ts`, runs the real Node
`streamOpenAICompletions` and `openai` SDK 6.49.0 with an in-memory fetch. That
fetch refuses retries and any credential other than `faux-key`. Each case answers
with a minimal synthetic SSE stream and must not end in `error`. The recorder runs
with an isolated HOME and allowlisted environment. Recording creates the corpus
exclusively; `--check` never rewrites it. Source files and the SDK package are
SHA-256 recorded. Twenty-one requests cover:

- system/developer role selection by `reasoning` and `supportsDeveloperRole`,
  empty system prompts with and without `requiresSystemMessageFirst`
- `max_completion_tokens` versus `max_tokens`, omitted and zero `maxTokens`,
  `store`, `stream_options`
- temperature `0.7`, `0` and `1e-7` (ECMAScript number text)
- tools sorted by the existing `stableTools` port, full canonical `parameters`,
  non-object `properties` and `strict: false` on and off
- tool choice `auto`, `none`, `required` and a named function
- history: user strings and text blocks, empty user text, empty block arrays,
  assistant text joining, ECMAScript-blank (space, tab, BOM) versus NEL text
- base URLs with and without a trailing slash, a root URL and an HTTP loopback port

`native/omk-providers/src/openai_completions.rs` builds `{url, headers, body}` with
typed serialization. It reuses the tool-schema canonicalizer, ECMAScript number
formatting and blank-text predicate from the existing crate. The new
`request-openai-completions` executable reads one bounded input (2 MiB), uses only
the fixed synthetic key and prints the request. It ignores ambient credentials.

The caller supplies resolved compatibility (`supportsStore`,
`supportsDeveloperRole`, `supportsUsageInStreaming`, `maxTokensField`,
`supportsStrictMode`, `requiresSystemMessageFirst`). Node provider/URL detection,
thinking formats, routing preferences and provider-specific behavior are not
ported. Unknown fields are refused. These admission bounds are not Node parity
claims:

- base URLs whose WHATWG serialization could differ from the input (uppercase
  hosts, default ports, dot segments, queries, userinfo, non-canonical IPv4,
  `xn--` labels, other schemes)
- `api.openai.com`, where Node adds `prompt_cache_key` (admitted since the
  2026-11-20 cache follow-up below)
- images, tool calls/results, thinking, assistant string content, invalid
  tool-choice or temperature shapes, and the existing tool-name refusals

Node's ambient `OMK_CACHE_RETENTION=long` can add cache fields. The isolated oracle
does not set it, and Rust does not read the environment.

Compiled behavioral RED: with a stub that returned an error, the library and
executable corpus tests failed. The refusal test passed against the stub too, so it
shows only that refusals leave no partial output, not why each refusal happens.
After the implementation, all 21 requests match exactly through the library and
the actual executable.

Verification evidence is in `/mnt/omkdata/tmp/omk-k1-oaicomp-kMB80C`. It holds the
baseline status/index/preserved hashes, before images, the first probe output, and
RED/GREEN logs and command receipts.

- Rust: `cargo check`, `fmt --check` and all-target Clippy with `-D warnings` exit 0.
  Tests: 66 passed, zero failed or ignored.
- Recorder strict TypeScript exits 0.
- Fifteen Node fixture regression files ran with networking disabled and an owned
  TMPDIR: 23 passed, zero failed or skipped.
- `npm run check`: one invocation exit 0 in 388 s at load average about 66.
  `check:constitution`: 724 passed, 30 skipped, zero failed.

Scope: this is request-byte parity for a narrow API-key chat-completions surface.
It is not response/SSE parsing, catalog dispatch, transport wiring, OpenAI
responses API, provider detection, reasoning parameters, cache keys/control,
OAuth, retries, agent/session/core adoption, or platform or live acceptance. No
dependency, lock, notice, corpus or installed engine changed. No delegated agent,
provider inference, install, commit, push or publication occurred. See also
[tool schemas](k1-tool-schema.md).

## Follow-up: user images (2026-11-18)

The request replay now admits user image blocks when the caller supplies `vision`
from the model's input capabilities. With `true`, the converter keeps text and
image order and embeds the original MIME type and payload in `image_url.url`.
It does not decode or validate the payload. With `false`, it uses the shared Node
history downgrade rules: adjacent images collapse to one omission marker and a
literal marker suppresses another generated marker immediately after it. State
resets between messages. Missing capability still refuses images; assistant
images, tool-result images and image-bearing turns above 4096 blocks are refused.
The original text-only inputs require no new field.

Reproduce the independent SDK check with
`node scripts/record-openai-completions-fixtures.mjs --images --check`. The new
corpus covers four histories with vision both on and off; the original 21-case
corpus is unchanged. Before the port, the library and replay executable both
refused the first image case. Both now match all 29 SDK requests, including the
serialized body string. `cargo test --locked` in `native/omk-providers` passed
66 tests; `cargo check`, `cargo fmt --check`, all-target Clippy with `-D warnings`,
strict recorder typechecking with `tsgo`, and `npm run check` passed. No live
provider or installed engine was used to verify this conversion.

## Follow-up: same-model tool calls and results

`openai_completions/{pairing,history,arguments}.rs` handles same-model calls with
object arguments, real and synthetic tool results, and consecutive image results.
Call IDs stay verbatim; result IDs use ECMAScript trim. Missing results are filled
before the next user or assistant turn, or at EOF. Results with no surviving
parent are dropped. Even when all such messages are dropped, tool history in the
original input requests `tools: []` if no definitions are supplied. The caller
can enable `requiresToolResultName` and `requiresAssistantAfterToolResult`.

`node scripts/record-openai-completions-fixtures.mjs --tools --check` verifies 12
independent SDK requests without rewriting them. `cargo test --locked --test
openai_completions` in `native/omk-providers` compares the actual `body` bytes
through both the library and replay executable. The fixture reader passes the raw
input, preserving insertion order. Cases cover parallel calls, reordered,
missing, late and repeated results, aborted/error assistants, mixed/empty text,
vision and non-vision results, and nested non-alphabetical argument keys.

Scope is unsigned same-model history on the existing bounded replay surface.
Cross-model ID remapping, reasoning signatures and live transport are not covered.
Replayed object arguments refuse duplicate keys, depths above 64 and lone
surrogates rather than claiming byte parity for those inputs.

## Follow-up: cross-model tool history

`openai_completions/handoff.rs` compares each assistant's `source` (`provider`,
`api`, `model`) with the target before pairing. A foreign call and subsequent
results use the Node ID mapping, including UTF-16 sanitization and the short
hash for long pipe-separated IDs. OpenAI's 40-code-unit plain-ID limit applies
only to foreign calls targeting `openai`. Cross-model replay strips tool thought
signatures, drops redacted thinking, and converts visible thinking to text. For
the same model, parsed truthy tool signatures populate `reasoning_details` in
call order. Signed inputs need explicit identity; existing unsigned inputs do not.

`node scripts/record-openai-completions-fixtures.mjs --cross --check` reproduces
8 SDK requests: a same-model control and independent changes of provider, API and
model for each of the `openai` and `synthetic` targets. The Rust crate's
`cargo test --locked --test openai_completions` compares the library and executable
with the captured request body, including eight parallel calls with reversed
results. Both targets use a synthetic URL and no network. Other explicit target
providers, nonstandard same-model reasoning fields (beyond `reasoning` and
`reasoning_content`), and truncation through a surrogate pair are not supported.
This is request replay, not verification of a live provider or installed runtime.

## Follow-up: assistant reasoning history compatibility

The caller may enable `requiresThinkingAsText` to emit nonblank thinking blocks
joined with two newlines as the first assistant text part, followed by the
original nonblank answer parts. Without any nonblank thinking, answer text stays
a string. `requiresReasoningContentOnAssistantMessages` adds `reasoning_content`
only for a reasoning model and only when the field is missing. The SDK adds the
empty fallback after tool calls and their reasoning details; signed nonempty
`reasoning_content` stays in its original position. Neither flag defaults on.

`node scripts/record-openai-completions-fixtures.mjs --reasoning --check` checks
all eight combinations of the two flags and the model's reasoning capability.
Each request covers interleaved answer and thinking blocks, signed tool calls,
existing reasoning content, thinking-only, blank and empty turns. The Rust
library and replay executable match the recorded body bytes. This extends
request serialization only; no streaming response or installed runtime change.

## Follow-up: reasoning-effort request parameters (2026-11-20)

`openai_completions/effort.rs` ports the `thinkingFormat` branches of
`buildParams`: `openai`, `openrouter`, `deepseek`, `together`, `zai`, `qwen`,
`qwen-chat-template`, `string-thinking` and `ant-ling`. The input may set
`reasoningEffort` and `thinkingLevelMap`. The caller supplies
`compat.thinkingFormat` and `compat.supportsReasoningEffort`; if
`thinkingFormat` is absent, Node's documented default `openai` applies. Node's
provider/URL detection of these flags is still not ported. The Rust code does
reproduce the one host test `buildParams` performs itself: Model Studio
(`dashscope*`/`*.maas.aliyuncs.com`) decides whether `qwen` sends
`reasoning_effort`. Mapped values replace the level names. A `null` mapping falls
back to the level name, except `off: null`, which suppresses the off value.
The `deepseek-v4-` minimal-to-low fallback applies only to Model Studio `qwen`.

These admission rules are not Node parity claims. Rust refuses a
`reasoningEffort` or `thinkingLevelMap` when `supportsReasoningEffort` is not
explicitly resolved. It also refuses `reasoningEffort: "off"`, which
`streamSimple` clamps away before Node's call, as well as unknown levels,
formats and non-string map values.

`node scripts/record-openai-completions-fixtures.mjs --effort --check` reproduces
45 independent SDK requests across all nine formats. They cover effort on and
off, mapped, null and absent mappings, unsupported effort, non-reasoning models,
tools, and the Model Studio host. The 57 existing requests still match. Compiled
RED: the replay executable refused the first new input
(`unknown field supportsReasoningEffort`), and the other five tests passed. After
the port, the library and executable match all 45 body strings. Two hand-made
mutants failed the new test at the expected cases: the deepseek fallback and
OpenRouter off-null handling.

Verification ran in a network-disabled sandbox with read-only source and an
owned HOME, TMPDIR, CARGO_HOME and target; evidence is in
`/mnt/omkdata/tmp/omk-k1-oaisse-xjYQvw/logs`. `cargo fmt --check`, `check`,
all-target Clippy with `-D warnings` and `test` exit 0, with 69 tests passed and
none failed or ignored. The first formatter run and one Clippy `some_filter` run
failed and are retained as non-passes. Strict recorder `tsgo` exits 0. One
`npm run check` invocation exited 1 at `check:pi-inventory`, because another
lane's tracked deletion of `packages/coding-agent/src/ci/verify-reporter.ts` is
outside this unit. Every earlier step passed, including `check:native`,
`check:contracts` and `check:constitution` (734 passed, 30 skipped, zero failed).
The skipped final steps, workspace `tsgo --noEmit` and `check:browser-smoke`,
then exited 0 separately. This is not one clean invocation. HEAD and the staged
diff are unchanged.

Scope remains request serialization. `prompt_cache_key`/retention,
`api.openai.com`, OpenRouter/Vercel routing, `zaiToolStream`, cache control,
provider-specific model renaming, response parsing, transport, installed runtime
and live providers are not covered.

## Follow-up: prompt cache key and retention (2026-11-20)

`openai_completions/cache.rs` ports the `prompt_cache_key` and
`prompt_cache_retention` fields from `buildParams`, along with
`resolveOpenAIPromptCacheKey` and `deriveContextPromptCacheKey`. New input fields
are `cacheRetention` (`none`, `short` or `long`), `sessionId`,
`systemPromptCacheBoundary`, `systemPromptCacheBoundaryBypass` and
`compat.supportsLongCacheRetention`. Without `cacheRetention`, Rust uses Node's
default `short`. Rust never reads `OMK_CACHE_RETENTION`.

The request includes a key when the base URL contains `api.openai.com` and
retention is not `none`, or when retention is `long` and long retention is
supported. The second condition also adds `prompt_cache_retention: "24h"`. A
valid boundary yields `omk-` plus `shortHash` of the canonical JSON
fingerprint (prefix, `provider/model` scope, stable tools, version 1). Any other
present boundary, including `null`, `0`, fractions and strings, or a bypass,
yields no key. Otherwise `sessionId` is clamped to 64 code points; an empty
string still sends an empty key. The previous `api.openai.com` refusal is
removed, and its negative example is replaced.

The fingerprint reuses the existing `stableTools` canonicalizer and `shortHash`
port. `tool_schema::write` now takes the key order as a parameter. Plain
`canonicalJsonStringify` sorts all keys by UTF-16 code units. The request schema
keeps its index-first `JSON.parse` order.

These admission rules are not Node parity claims. Rust refuses `long` without
an explicit `supportsLongCacheRetention`. It also refuses a content key without
`provider`, a boundary that splits a surrogate pair, non-boolean bypass values
and non-string session IDs.

`node scripts/record-openai-completions-fixtures.mjs --cache --check` reproduces
35 independent SDK requests. The cases cover each retention against the
synthetic host, `api.openai.com` and a substring host; session clamps (ASCII and
astral); valid, invalid, `null` and string boundaries; bypass; empty prompts;
scope; and unsorted, index-like, astral and private-use schema keys with
`-0`/`1e21` numbers. The 102 existing requests still match. Compiled RED: the
executable refused the first new input (`unknown field cacheRetention`), and the
other six tests passed. The new refusals also passed before the port, so they
show only fail-closed behavior. After the port, the library and executable match
all 35 body strings. Four hand-made mutants each failed at the expected cases:
index-first fingerprint order, a missing `none` check, ignoring present
boundaries, and a 65-code-point clamp.

Evidence is in `/mnt/omkdata/tmp/omk-k1-oaicache-nEdXGT/logs`, using the same
sandbox as the effort unit. `cargo fmt --check`, `check`, all-target Clippy
with `-D warnings` and `test` exit 0, with 70 tests passing and none failing or
ignored. The first formatter run failed on two owned files and is retained as a
non-pass. All seven oracle modes pass `--check`, and strict recorder `tsgo` exits
0. One `npm run check` invocation again exited 1 at `check:pi-inventory`
because of another lane's deleted `verify-reporter.ts`. Every earlier step
passed (`check:constitution`: 734 passed, 30 skipped, zero failed). Workspace
`tsgo --noEmit` and `check:browser-smoke` then exited 0 separately. HEAD, the
staged diff and 161 preserved paths are unchanged.

This is not covered: session-affinity headers (`sendSessionAffinityHeaders`
remained a refused compat field until the follow-up below), Anthropic-format `cacheControlFormat`,
`OPENAI_ORG_ID`/`OPENAI_PROJECT_ID` SDK environment headers, response parsing,
transport, installed runtime and live providers.

## Follow-up: session-affinity headers (2026-11-21)

Node `createClient` adds `session_id`, `x-client-request-id` and
`x-session-affinity` with the full (unclamped) session ID when
`compat.sendSessionAffinityHeaders` is true and the session is non-empty, except
when cache retention resolves to `none`. Rust now accepts the caller-resolved
boolean (absent means false; Node detection never enables it) and adds the same
three headers. Values Fetch `Headers` would trim (leading/trailing space or tab),
Latin-1 encode or reject are refused instead of guessed.

The oracle `scripts/fixtures/openai-completions-affinity-recorder.ts`
(`record-openai-completions-fixtures.mjs --affinity`, 12 cases) was recorded
before the port: flag true/false/absent, missing and empty sessions, retention
`none`/`short`/`long`, a 70-character session on `api.openai.com` (headers full,
`prompt_cache_key` clamped), internal space/tab and visible ASCII punctuation.
Compiled RED: the executable refused the first case
(`unknown field sendSessionAffinityHeaders`), the other seven tests passed. After
the port the library and executable match all 12 requests; five new refusals
cover padded, Latin-1, newline and non-boolean inputs. A hand mutant ignoring
retention `none` failed the new test. The affinity mode joins the fixture
freshness test.

Commands: crate `cargo fmt --check`, all-target Clippy with `-D warnings` and
`cargo test` exit 0; strict recorder `tsgo --ignoreConfig` exits 0; the fixture
test passes 6/6. One `npm run check` invocation exited 1 only at
`check:pi-inventory` (another lane's deleted `verify-reporter.ts`), after
`check:native` and `check:constitution` (735 passed, 30 skipped, zero failed);
workspace `tsgo --noEmit` and `check:browser-smoke` then exited 0 separately.

Not covered: caller `options.headers` overrides, `model.headers`, GitHub Copilot
dynamic headers, Cloudflare AI Gateway authorization, response parsing,
transport and live providers.
