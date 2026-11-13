# K1 Anthropic JSON repair and partial-argument slice

## Status and scope

This continues the [first offline adoption](k1-adoption.md), not K1 acceptance or
production provider wiring. Only synthetic offline inputs are used. The six B1
resolution graphs, exact direct pins/features, lock and existing dependency notice
remain unchanged. No workflow, auth, runtime selection, production Node behavior
or publication changes are part of this unit.

The independent Node recorder calls `repairJson`, `parseJsonWithRepair`,
`parseStreamingJson` and actual `streamAnthropic` with a fully intercepted fetch.
Only `https://synthetic.invalid/v1/messages` and `faux-key` are permitted; there is
no network fallback. The wrapper uses a temporary home and allowlisted environment,
not host credentials. Node records expected values before Rust comparisons.

## Frozen evidence

- Existing `native/omk-providers/tests/fixtures/anthropic.json`: retain all 16 cases.
- New `native/omk-providers/tests/fixtures/anthropic-json.json`: 331 utility inputs
  and 17 streams, with Node source/package/license hashes. Final SHA-256:
  `a5b6d8522849ebab808ad56df22923bc2200f3741e1c3465933dd83fd04111c0`.
- Utility inputs include every prefix of nested objects/arrays, strings, Unicode,
  escapes, literals and numbers, all 32 raw string controls, invalid/dangling
  backslashes, malformed Unicode escapes, BOM/NBSP and trailing garbage.
- Stream inputs capture initial arguments, every delta and finalization, repair
  after partial-parser failure, primitive/array/null argument types, escaped-string
  splits, prototype keys, malformed/raw SSE, EOF, cancellation and error paths.
- The new projection retains each tool event's argument snapshot; timestamps,
  usage cost and SDK runtime headers remain the same explicit exclusions as the
  first corpus. The original normalization rules are not weakened.

The original 327-input recording preceded implementation. Four whitespace edge
cases were subsequently captured directly from Node; the BOM-prefix mismatch was
observed failing before its Rust fix. Provenance hashing was expanded to the
installed parser implementation/options/license and SDK package. These changes
extend only this new oracle, not the old provider or K0 goldens.

## Implementation and boundaries

- `native/omk-providers/src/json_parse.rs`: strict parse, repair order, raw controls,
  invalid/dangling escapes, root-nullish fallback and explicit resource errors.
- `src/partial_json.rs`: MIT adaptation of `partial-json` 0.1.7's default algorithm,
  including its observable prefix, skipped-colon and lowercase-exponent quirks.
  This is compatibility code, not a new general-purpose JSON specification.
- `src/anthropic.rs` and `src/reducer.rs`: repaired SSE decoding, partial updates,
  block-stop finalization and non-finalized EOF/error/abort arguments. SSE envelope
  usage numbers keep the existing field validation/error behavior.
- CLI `observeToolArguments: true` and library `replay_with_tool_arguments` enable
  intermediate snapshots. Default replay stores none and default CLI output is
  unchanged. Observation caps are 4096 snapshots and 8 MiB of argument JSON; limits
  emit a terminal error instead of dropping observations or growing without bound.
- Utility/tool-delta input caps: 1 MiB and depth 64. Unpaired UTF-16 surrogate
  escapes, integers outside the safe JavaScript range and non-finite numeric
  overflow are explicitly refused, not silently rounded or turned into partial
  success. Valid surrogate pairs and literal escaped backslashes are tested.
  These restrictions intentionally do not claim universal Node equivalence.
- `PARTIAL-JSON-NOTICE.md` retains the upstream MIT copyright/license/provenance
  separately from the immutable B1 dependency notice. Future distributions must
  include both, plus root LICENSE/NOTICE.

## Observed verification

These are the original slice's observations. The later owner-requested whole-tree
repair and passing full check are recorded in [the follow-up](#follow-up-whole-tree-check-repair).

- `/tmp/omk-k1-json-red.log`: the initial scaffold did not compile because the new
  API/observation field did not exist. This is **not** valid behavioral RED evidence.
- Isolated compiled probes then disabled invalid-escape repair and replaced partial
  handling with strict-only fallback. Both exited 101 on real value assertions:
  `repair-tool`/`json-29` and `incomplete-string`/`json-7`, respectively. Logs:
  `/tmp/omk-k1-json-repair-mutation-red.log` and
  `/tmp/omk-k1-json-partial-mutation-red.log`. These are post-implementation
  regression-sensitivity probes, not a claim that the initial missing-API build
  established behavioral TDD. The main source and Node fixtures were not mutated;
  native checks were rerun successfully from main sources afterwards.
- `/tmp/omk-k1-json-bounds-red.log`: resource/surrogate refusal regression failed
  before the explicit bounds.
- `/tmp/omk-k1-json-edge-red.log`: BOM-prefix and numeric-surface regressions failed
  before the follow-up fixes.
- `cargo test --locked --offline --manifest-path native/omk-providers/Cargo.toml`:
  exit 0, including old oracle, new library/CLI comparisons, usage/resource refusal
  and opt-in observation count/byte limits.
- `npm run check:native`: exit 0; all six effective graph checks, discovered native
  fmt/Clippy (warnings denied)/locked tests and fresh 16-case/331-input/17-stream
  Node comparisons. Log: `/tmp/omk-k1-json-native-check.log`.
- `node --test scripts/test/anthropic-json-fixtures.test.mjs scripts/test/provider-fixtures.test.mjs scripts/test/contract-fixtures.test.mjs`:
  exit 0, 19 passed, no skips; log `/tmp/omk-k1-json-focused-node.log`.
- Strict `tsgo` for the two new TypeScript recorder modules: exit 0.
- SHA-256 comparison against the start-of-unit inventory: all 16 preserved files
  unchanged, including the original provider corpus, all 11 K0 golden/manifest
  files, Cargo manifest/lock, review JSON and B1 dependency notice.
  Receipt: `/tmp/omk-k1-json-preservation-check.json`.
- `npm run check:contracts`, browser smoke and the other unaffected root subchecks:
  exit 0. All remaining root pipeline checks were attempted individually after
  the full command stopped; `/tmp/omk-k1-json-check-results.json` records each exit.
- Full credential-free `npm run check`: **exit 1**, stopped at Biome on unrelated
  extension/SLYE edits (24 errors, 2 warnings). Log:
  `/tmp/omk-k1-json-full-check.log`. This is not a full-check pass.
- Additional unrelated blockers: module-size ratchet on `agent-session.ts` and
  extension `runner.ts`/`types.ts`; constitution suite 721 total, 688 passed,
  2 failed, 31 skipped (module-size baseline and SLYE package diagram); doc-link
  check references uncommitted `speak-like-you-eat.md`; workspace `tsgo --noEmit`
  exits 2 on extension test fixtures and a SLYE test. These files/baselines are not
  changed to make this unit pass. No gate was disabled or relaxed.
- Changed-path LSP probe was inconclusive for eight files; four auxiliary warnings
  concern the intentionally fixed synthetic URL and deletion from a cloned event
  projection. It is not clean-LSP evidence; actual compiler/Clippy/strict recorder
  checks above are the verification evidence.

## Self-review

Correctness is checked against independently recorded Node values, including every
tool update, plus CLI/library agreement and unchanged legacy oracles. Bounds and
unsupported numeric/UTF-16 surfaces fail explicitly. A review-found quadratic
snapshot-retention risk was fixed with opt-in observation and count/byte budgets;
regressions exercise both budgets and default replay without observation. A
numeric-boundary change initially altered the legacy invalid-usage error; separating
SSE envelope handling restored that existing regression without editing its test.

The parser stays isolated from transport, no dependency/feature is added, and copied
MIT attribution is retained. No live network dispatch or credential read is added.
The JSON slice is locally verified, but the overall worktree is not a verified
full-check/merge candidate while the unrelated failures above remain.

The check environment uses the existing downloaded B1 registry cache, an isolated
HOME, `CARGO_NET_OFFLINE=true` and an allowlisted PATH. No API/OAuth operation or
live-provider conformance is tested. GNU Linux is the only native host exercised;
macOS/Windows and the other reviewed target/platform cells remain unverified.
No binary is published, and no commit/push is performed.

## Follow-up whole-tree check repair

The owner subsequently requested repair of the remaining repository check errors
while preserving existing work, goldens and reviewed dependencies.

Fresh inspection found that concurrent changes had already fixed the module-size
ratchet and workspace diagram. Those changes and the new optional-field host
compatibility handling were preserved, not replaced or baselined away. This pass
completed extension/compaction test fixtures, formatted the affected registration
and SLYE settings code, and added legacy registry/model-scope regression tests.
The SLYE package link now points to an actual quick-start section in the existing
tracked `packages.md`; the separate untracked guide remains intact. Neither the
Git index nor the documentation checker was changed to hide a missing target.

Observed results:

- Full `npm run check`: **exit 0**, including native fmt/Clippy/locked tests, all
  six resolution graphs, fresh K0/K1 recordings, TypeScript, documentation guards
  and browser smoke. Log: `/tmp/omk-check-repair-full-check.log`.
- Constitution tests: 721 total, 690 passed, 31 skipped, zero failures.
- Targeted coding-agent extension/compaction tests: 45 passed, 8 skipped. Live
  compaction cases stayed disabled in the credential-free environment.
- SLYE synthetic tests: 33 passed, zero skips; no provider requests.
- Request-start SHA-256 inventory: all 21 files unchanged, covering both provider
  corpora, K0 goldens/manifest, npm/Cargo locks, approved provider manifest, review
  JSON, dependency notices and the module-size baseline. This preserves the state
  at the start of the follow-up, not an older snapshot over concurrent work.
  Receipt: `/tmp/omk-check-repair-preservation-result.json`.
- `git diff --check`: exit 0. No dependency, golden, threshold, skip policy or
  workflow was changed to obtain this result. No commit, push or publication.

This supersedes the earlier full-check blocker, not the native-platform or live
provider verification limits. The existing skipped R/Bun/live-provider cases and
non-Linux target acceptance remain outside the observed pass.

Suggested change message: `확장 호환 타입과 패키지 문서 일관성을 복구하고 전체 검사를 통과시킨다`.

### Deferred repair commit after SLYE/custom-entry

Owner authorization now covers committing SLYE/custom-entry prerequisites first,
then these check repairs separately. Prerequisite commit `a247169725` contains the
optional package, public entry-renderer/scoped-model API and package integration.
Its selected snapshot passed TypeScript and 75 synthetic tests. Review also found
a start-time abort race; the new failing regression was fixed without provider calls.

This repair retains the module-size baseline and reuses the existing two evidence
receipt identifiers to remove a redundant AgentSession helper. The receipt cache
invalidation behavior stays unchanged. Fixture defaults, legacy registry/scope
regressions, package-document navigation and this verification record are separate
from the prerequisite commit. K0 goldens, K1 code/approval/locks and unrelated G1
work are excluded.

The configured `.husky/_` directory is absent in this checkout. This, rather than
isolated HOME, explains the earlier missing automatic hook. The unchanged project
pre-commit script was explicitly run after the prerequisite commit: exit 0,
721 constitution cases (690 passed, 31 skipped). The repair commit uses a temporary
executable hook that delegates to that same script; no repository hook, permanent
configuration, threshold or skip policy is weakened. No live API, publishing or
push is authorized by these local commits.

The combined selected snapshot, excluding unrelated working-tree changes, passes
TypeScript and the unchanged module-size ratchet. Focused host/cache regressions
pass 50 cases (8 live cases skipped); SLYE passes 34 synthetic cases. Logs are
`/tmp/omk-slye-repair-types.log`, `/tmp/omk-slye-repair-size.log`,
`/tmp/omk-slye-repair-core-tests.log` and `/tmp/omk-slye-repair-package-tests.log`.
