# K1 Anthropic tool schema canonicalization and collation

Date: 2026-11-17
Status: implemented bounded source unit; full K1 and migration remain open.

Before this unit, the Rust request builder sent tools in caller order with raw
`properties`, so callers had to pre-apply Node `stableTools`. The new oracle,
`scripts/fixtures/anthropic-tool-schema-recorder.ts`, calls the real Node
`streamAnthropic` and SDK with an in-memory fetch. That fetch refuses other URLs,
credentials and retries. The recorder also calls `stableToolSchema` directly on 25
JSON literals. The Node default collation locale is asserted as `en-US`. Recording
creates the corpus exclusively, and `--check` never rewrites it. The source and SDK
package are SHA-256 recorded.

Five request cases cover these inputs:

- 64 single-character names in the full `[A-Za-z0-9_-]` alphabet
- 24 mixed-case, punctuated and numeric names
- one nested schema with array-index keys, `__proto__`, empty/emoji/U+FFFD keys,
  nullish `required`, numbers and control-character strings
- non-object `properties`
- short cache on the last tool after sorting

The 25 literals cover JavaScript number formatting, overflow to `null`, `-0`,
duplicate keys, whitespace, nested `required: null` removal and non-object
roots. The first local recording wrapped scalar literals in a non-object root,
so it recorded only `{}`. That recording was discarded before any Rust test used
it and is retained in evidence.

`native/omk-providers/src/tool_schema.rs` ports the Node behavior inside the
existing request path. No parallel builder is added.

- Object keys are re-emitted in JSON.parse property order: array-index keys
  ascending, then UTF-16 code-unit order.
- The last duplicate key wins. `required: null` is dropped at every level.
- Numbers use ECMAScript `Number::toString`, and non-finite values become `null`.
- Strings are re-escaped.
- Non-object `properties` become `{}`.
- Tools are sorted with the ICU root/en-US collation for `[A-Za-z0-9_-]`: primary
  `_ - 0-9 a-z`, then lowercase before uppercase.

Admission bounds are explicit refusals, not Node parity claims:

- tool names outside that alphabet, where locale collation is not implemented
- duplicate names, which Node would tie-break on description/schema
- lone surrogate strings, which Rust strings cannot hold

One older boundary test asserted the order of the raw caller schema. It became
obsolete because Node sorts keys. Only that expectation was replaced, with a
comment. Unknown-field refusal and string-space preservation remain.

Compiled behavioral RED, before the implementation: the library and executable
dispatch tests failed on exact request bytes (Rust sent `z` first; Node sent `_`
first). The new literal and refusal tests failed, and the obsolete boundary
expectation failed. Afterwards both the library and the actual `provider stream`
executable match all 97 recorded dispatch requests, including the five new ones.

Verification evidence is in `/mnt/omkdata/tmp/omk-k1-toolschema-67A228`. It holds
the baseline status/index/preserved hashes, before images, RED/GREEN logs, the
discarded recording and command receipts.

- Rust: `cargo check`, `fmt --check` and all-target Clippy with `-D warnings` exit
  0. Tests: 63 passed, zero failed or ignored.
- Recorder strict TypeScript (`tsgo --ignoreConfig --strict`) exits 0.
- Thirteen Node fixture regression files, including the new one, ran with
  networking disabled: 22 passed, zero failed or skipped. A first sandbox attempt
  failed with EROFS because TMPDIR was read-only. It is retained and is not
  behavioral evidence.
- `npm run check`: exit 1 after 434 s, at load average about 65. Biome, native,
  contracts and drift passed. In `check:constitution`, 722 passed, 30 skipped and
  1 failed. The failure is `contract-fixtures.test.mjs` "fresh contract recordings":
  its 80 s child timeout returned status `null`. Run directly, the same K0
  recorder passes in 157 s. That recorder does not touch `omk-providers`. In a
  standalone run, the test file failed once more (12/13) and then passed 13/13
  without changes. The timeout was not raised. The failed runs are retained. The
  steps that `npm run check` skipped after the failure (Biome rerun,
  release/readme/doc-links/openwiki/feature-claims/private-home/release-surface/
  shrinkwrap/pi-inventory, `tsgo --noEmit`, browser smoke) each exit 0 when run
  separately. This is not one clean `npm run check` invocation.

Scope: this is Anthropic API-key request tool ordering and schema canonicalization
only. It is not full K1/RC2. Other provider APIs (OpenAI completions/responses
also use `stableTools`), prompt-cache affinity keys, OAuth tool-name mapping,
non-ASCII or other-locale collation, description/schema tie-breaks, complete
response parity, agent/session/core adoption, and platform or live acceptance
all remain open. Original corpora, dependencies, locks, notices, installed
engines/settings/credentials and other lanes' changes are outside this unit. No
delegated agent, provider inference, install, commit, push or publication
occurred. See also [explicit request caching](k1-request-cache.md) and
[thinking signatures](k1-thinking-signature.md).
