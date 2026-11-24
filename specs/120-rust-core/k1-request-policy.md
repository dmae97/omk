# K1 explicit Anthropic request policies

Date: 2026-11-17
Status: implemented bounded source unit; full K1 and migration remain open.

## Independent contract and scope

The actual Node `streamAnthropic` and SDK recorded 32 new synthetic requests before Rust
policy implementation. Expectations are separate from every earlier corpus and carry
source SHA-256 provenance. Isolated temporary homes, explicit fake runtime keys, an
in-memory synthetic-only fetch and network-isolated recording prevent provider execution.
The recorder creates exclusively; `--check` compares without rewriting expected data.

A compiled behavioral RED rejected the recorded `options` field. The minimal implementation
adds typed `request_policy::Options`, attaches it to the existing request input, and uses
one `Policy` during the existing body serialization. It does not round-trip tool schemas or
raw arguments through serde_json::Value. Existing transport, authentication, headers,
incremental reducer and executable remain the owners.

Every new case now traverses both actual library and executable numeric-loopback HTTP.
The shared dispatch tests run the original 10 cases plus these 32, comparing exact SDK body
bytes/non-runtime headers and projected semantic events/results. Expected outputs are not
supplied to Rust. This is no-cache API-key request parity on those cases, not all Anthropic
options, arbitrary model acceptance, monetary-cost or full provider-response parity.

## Implemented options

- `temperature`: serialized before tools when supplied, thinking was not requested, and
  model compatibility permits it. A thinking request suppresses it even for nonreasoning
  models, matching observed Node behavior. Numeric spellings of zero/one are canonicalized.
- `thinkingEnabled`, `thinkingBudgetTokens`, `thinkingDisplay`: gated by model reasoning;
  classic thinking uses `enabled`, a default/zero budget of 1024 and summarized default.
  Adaptive compatibility uses `adaptive` with optional low/medium/high/xhigh/max `effort`.
- Explicit disabled thinking respects the compatibility override and the Node-derived
  Fable/Opus model-name default. Eight separately observed real Node helper outputs test
  prefix/segment/digit-boundary behavior and explicit override precedence.
- `metadata`: emits only a string `user_id`, including empty strings; other values/fields
  do not appear on the wire.
- `toolChoice`: auto/any/none strings or the strict `{type:"tool",name}` form, serialized
  after thinking/output config/metadata in the SDK's property order.

Unknown fields/enums/shapes fail before dispatch. Temperature outside 0 through 1,
non-u32 budgets, and empty/over-256-byte named tools are explicit local admission limits;
Node may send such values to an API, so refusal equivalence is not claimed. Synthetic
`build_request`/replay refuse options rather than pretending to execute new model policy.
The original replay inputs/corpora remain byte-unchanged.

No ambient cache preference or simple-reasoning inference is introduced. Cache retention,
stable system-prompt boundaries, empty-thinking signatures, OAuth/bearer clients, all other
provider APIs, retry/error semantics, credential storage/locking/refresh, agent/session/core
adoption and platform/live acceptance remain outstanding.

## Verification and preservation

Evidence: `/mnt/omkdata/tmp/omk-k1-policy-YwYkCdpa` with immutable baseline, before images,
command argv/cwd/exit/duration, logs and scoped preservation audit. Previous catalog,
dispatch and all original corpora/dependencies/notices are preserved from this baseline.

- Rust crate: 58 passed, zero failed/ignored, including the original 54 tests and four
  policy boundary/default tests. The two dispatch tests each exercise all 42 requests.
- Strict recorder TypeScript passed; ten Node regression files passed, 19 tests with zero
  failures/skips, including non-rewriting checks for all prior oracles and the new 32 cases.
- Cargo check, fmt and all-target Clippy with warnings denied passed offline/locked.
- `npm run check`: exit 0, 577.024 seconds; script tests 748 total, 718 passed,
  30 skipped, zero failed. This is not full product Vitest/platform acceptance.
- Active LSP: six paths inconclusive, no confirmed-clean paths and no returned diagnostics.
  Compiler checks passed; this is not an all-clean LSP claim.
- Scoped preservation: unchanged HEAD/index, twelve owned paths, no other Git-visible change.

Retained non-passes: first recorder attempt lacked writable child /tmp, a standalone Node
helper command had an extra parenthesis, added test code initially lacked an explicit
serde_json::Value annotation, and formatting needed correction. A 120-second tool wait
expired during compilation without an observed terminal exit; no owned process remained.
The successful offline Cargo rerun used two jobs and a longer wait, without weakening a
test or guard. None of those infrastructure/compiler failures is counted as behavioral RED.

No real user authentication file was read or changed. No dependency, lock, notice,
launcher/installed engine/default/settings mutation, provider inference, delegated agent,
commit, push or publication. Remaining requirements stay open in [spec.md](spec.md),
[tasks.md](tasks.md) and the preceding [catalog/dispatch record](k1-catalog-dispatch.md).
