# K1 incremental Anthropic semantic stream

Status: implemented and locally verified. Not full K1, RC2, installed
adoption or a selectable Rust core. The full migration objective remains open.

## Scope and callers

- `native/omk-providers/src/anthropic_stream.rs`: the existing SSE decoder and
  reducer now have a single incremental owner. `Stream::new` accepts only the
  recorded text model. `feed` counts original bytes against 8 MiB and latches
  failures. `take_events` moves semantic events out once. Consuming `finish`
  flushes EOF and produces exactly one terminal event and final message.
- `anthropic.rs`: replay uses that owner instead of a second batch-only state
  machine. Existing upfront replay bounds, cancellation-boundary validation,
  opt-in argument observations, and request-only vision refusal are unchanged.
- `src/lib.rs`: private module registration; public API remains under `anthropic`.
- `tests/anthropic_stream.rs`: all 16 independently recorded Node terminal
  projections, incremental delivery/exactly-once draining, parser-error latching,
  total byte bound, unrecorded-model refusals, and real loopback transport delivery
  before EOF plus cancellation/socket closure at partial text.
- Crate README documents ownership and limits. No Node source, original corpus,
  model catalog, dependency/lock/notice, installed configuration, launcher,
  workflow, K0 fixture or another lane is changed.

The existing `replay-anthropic` executable consumes the new state machine through
its actual replay caller. Its library/CLI parity suites still compare expected
requests/results/events without supplying expected output to Rust. Live-provider
HTTP dispatch is not wired by this change. The loopback integration uses real
`Transport::post`, its deadline/cancellation and frozen synthetic SDK SSE bytes.
No credentials or external network are used.

## Oracle and RED

The independent Node provider/SDK recording was freshly checked, without rewriting,
before implementation in an isolated HOME and network-disabled sandbox. Expected
request/event/result bytes are unchanged.

A temporary batch-only adapter delegated to the existing replay, so terminal
parity already passed while new incremental behavior was missing. The compiled
RED ran four tests: one passed, three failed for absent early events, absent feed
failure and absent total-byte refusal. It is retained as `rust-red.log`; the
adapter was then replaced, not left as an alternate implementation.

The existing Node-derived frame consumer was moved unchanged into the incremental
owner. Replay still validates its complete input before constructing this owner.
Parser failures remain visible and take precedence over a generic later consumer
error; cancellation preserves the existing Node partial/incomplete outcome.

## Verification

- `cargo check --offline --locked`, fmt `--check`, Clippy `--all-targets -- -D
  warnings`, and full crate tests: exit 0. The crate runs 41 tests, including five
  new incremental tests. Linux Cargo checks use read-only source/cache and an
  external-network-disabled sandbox with isolated target, HOME and temp roots.
- Six focused independent Node fixture files: 14 passed, zero skipped, in a
  network-disabled sandbox; no corpus rewrite.
- `npm run check`: exit 0 in 264.869 seconds, including six native crates,
  independently refreshed Node oracles, contract recordings and repository guards.
  This is not the full product Vitest suite or native platform acceptance.
- Active LSP: two paths confirmed clean, one existing inactive-cfg hint and one
  inconclusive. Not an all-clean claim.
- Documentation links and `git diff --check`: exit 0.
- Preservation audit: HEAD and complete staged-diff digest unchanged; exactly six
  owned paths differ from this unit's baseline and `otherChanges` is empty. Prior
  transport/history/vision work, corpora, manifests, locks and notices are unchanged.
- Initial formatter failures were corrected only in owned code and retained as
  non-passes. The compiled batch-adapter RED remains separate from those failures.
- Direct review checked single ownership, byte/error latching, event draining,
  terminal/cancellation/EOF ordering, real replay and transport consumers, and
  absence of copied decoder/reducer logic or changed package/runtime settings.

This unit does not supply mutable partial snapshots, timestamp/cost parity,
full provider model/auth/cache/override/HTTP-error/retry policy, complete K1,
K2-K5 or the later platform/extension/Pi-independence gates.
