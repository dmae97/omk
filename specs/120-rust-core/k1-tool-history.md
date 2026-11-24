# K1 tool and thinking request history

Date: 2026-11-15. Request-start HEAD: `ab08eb635e` on `2.0.0`.
This continues the owner's full Rust migration direction under spec 120. It does
not complete K1, start K2, select a Rust agent, change the installed engine or
remove Node. The existing staged decision-assistance work is outside this unit.

## Scope

The existing `history` request input now accepts same-model assistant content
blocks and text tool results in addition to the original user/assistant `text`.
The request builder ports the existing Node transformations rather than changing
them: retain same-model IDs, synthesize missing results, drop orphan results and
failed/aborted assistant turns, trim result IDs with ECMAScript whitespace rules,
and group consecutive results in one user message. Signed and redacted thinking
are retained; unsigned thinking falls back to text. Blank blocks are omitted.

The Rust replay library and `replay-anthropic` executable both reach the same
request builder. This is request conversion, not tool execution, HTTP dispatch,
a session store or an agent loop. No side effect runs twice for comparison.

No dependency, feature, lockfile, compatibility default, workflow, model catalog,
authentication setting or installed runtime changes. Existing MIT provenance,
root LICENSE/NOTICE and dependency notices remain intact. The new source modules
name their Node source. No commit, push, release or provider inference is performed.

## Independent oracle

The Node-only recorder invokes the actual `streamAnthropic` and official SDK.
It uses an isolated home, allowlisted environment, only the synthetic endpoint
and credential, an in-memory fetch and no retries. It records the 25 request
bodies before Rust implementation, with non-runtime headers. It never reads Rust
or creates expected output from Rust. Original provider, JSON, text-history and
K0 corpora are unchanged.

The fixture covers single/multiple tools, reversed and duplicate results, missing
all/one/end-of-history results, interruptions by user/assistant/error, orphaned
results, error/aborted turns, trimmed IDs, same-model special-character IDs,
empty and multiblock error results, nested arguments with nonalphabetic/numeric
key order, signed/unsigned/blank/redacted thinking, blank blocks and two tool turns.

The recorded oracle SHA-256 is
`a4cf07b87b02c43d4d0385eff83e9b1d8f7c347860c8f1cbadbf46ec16cd5972`.
The `--check` runner compares fresh Node bytes without rewriting it. The repository's
normal script-test discovery runs freshness, credential-isolation and preservation
checks. Library tests and real child-process tests compare every recorded request.

## Boundaries

- At most 4096 history messages and 4096 blocks per assistant/tool-result message.
- Tool argument validation reuses the 1 MiB, 64-level, finite/safe-integer JSON guard.
  Unpaired surrogate escapes remain refused rather than silently sanitized.
- Raw argument serialization preserves Node-recorded key order, without adding a
  serde feature or dependency. Arbitrary alternate JSON number/escape spellings
  are outside the byte-parity claim. Input is a bounded synthetic request surface,
  not the full session or production provider schema.
- Images, cross-provider/model transformations, cache/OAuth/model policies, live
  networking, native macOS/Windows and full RC2/PL1 acceptance remain unverified.

## Verification

The first isolated build failed because the linker had no writable temporary
path; this is setup failure, not behavioral RED. It is retained separately.
Setting `TMPDIR` to the already-owned writable directory kept the source/cache
read-only and network disabled. The actual compiled behavioral RED then failed
at `single-tool` with `unknown field content, expected text`, exit 101.

After implementation, the three focused Rust tests pass: all 25 request byte
comparisons through both library and executable, unsupported-input refusals with
no partial stdout, and size/safe-number refusals. The new Node tests pass 2/2.
The recorder's strict TypeScript compilation passes. The focused Node suite passes
10/10 with zero skipped cases. Credential-free, network-disabled Rust checks pass:
`cargo check`, formatting, Clippy with warnings denied, and all 16 crate tests
with zero ignored tests. The crate tests also retain the original 16-stream,
17-JSON-stream, 331-JSON-value and 12-text-history comparisons.

Primary LSP coverage was inconclusive. Its auxiliary hardcoded-URL warning is the
intentionally fixed synthetic endpoint, not a production configuration setting.
Compiler, Clippy and tests provide the independent completed checks.

The initial full repository check passed native checks for all six crates and
then stopped because the chosen `TMPDIR` was too long for K0's fixed-width path
fixture. That is a setup failure, not golden drift. The retry uses a short
private recorder directory under `/tmp`, without altering the fixture or guard.
With `TMPDIR=/tmp`, the full credential-free `npm run check` exits 0. All six
native crates pass their configured gates; generated contracts, capability matrix
and all ten fresh K0 fixture files match. Repository script tests report 729 total:
698 passed, 31 skipped, zero failures. TypeScript and the remaining repository
checks pass. Skipped tool/platform/live cases are not acceptance evidence.

A formatting-only attempt and the interrupted superseded repository run are
retained as non-acceptance logs. The final passing checks use the corrected source;
no fixture was rewritten to make Rust pass. The request-start snapshot verifies
43 existing files and the entire preexisting staged diff unchanged.

Commands from the repository root:

```sh
node scripts/record-anthropic-tool-history-fixtures.mjs --check
node --test scripts/test/anthropic-tool-history-fixtures.test.mjs scripts/test/anthropic-history-fixtures.test.mjs scripts/test/anthropic-json-fixtures.test.mjs scripts/test/provider-fixtures.test.mjs
cargo check --locked --offline --manifest-path native/omk-providers/Cargo.toml
cargo fmt --manifest-path native/omk-providers/Cargo.toml --check
cargo clippy --locked --offline --manifest-path native/omk-providers/Cargo.toml --all-targets -- -D warnings
cargo test --locked --offline --manifest-path native/omk-providers/Cargo.toml
npm run check
```
