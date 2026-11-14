# Rust host H2i: original boot-bound phase deadline

Date: 2026-11-10. Baseline HEAD: `48fb8e33a84d01fde163091ed36a8bca981d3bbe`.
Depends on H2h grant retention; prior dirty work remains intact. Versions remain
**1.5.10**. No dependency installation, commit, push, activation or release.

## Ownership transferred

Production verified-run dispatches now pass their already anchored phase cap as
`phaseDeadline: { bootId, deadlineMs }`. Writers use the original work deadline;
verifiers use their original verification deadline. Rust, not a replacement Node
observer, enforces that boot-bound cap before record creation, again after record
persistence before spawn, throughout supervision, and after durable commit before
code release. Losing the parent does not renew the cap. The relative per-command
timeout, output budget, cleanup rules and independent termination witnesses remain.

The new Rust `PhaseDeadline` type parses a strict optional private wire field and
fails closed on malformed bounds, unknown clocks or another boot. It reads Linux
`/proc/uptime`, which includes elapsed boot time rather than parent wall time.
The proc representation truncates to centiseconds. Rust uses its upper bound,
allowing up to 10 ms early expiry rather than extending the cap. OS scheduling
and uninterruptible processes are not hard-real-time guarantees.

Accepted native records persist the original cap. Node's strict reader validates
it; reconnect and connected verifier receipt continuation compare it with the
original journal before accepting the record. A forged later cap is rejected
before reconnect publication or native control. No grant token or journal budget
is reissued, remapped or extended.

Old low-level v1 callers can still omit the optional field and use the old
relative timeout behavior. Their records do not satisfy the new phase-bound
production reconnect gate. Old native binaries reject the new field, without
fallback. Changed native binary hashes retain the existing environment binding.
No installed binary or global selection was changed.

## Code and cleanup

- `native/omk-execution/src/phase_deadline.rs`: typed clock cap, overflow-safe
  conservative proc-clock decoder, inclusive comparison and finite oracle tests.
- `protocol.rs`, `record.rs`, `supervisor.rs`, `lib.rs`: private request schema,
  durable original cap and owned spawn/commit/supervision checks.
- `tests/protocol.rs`, `tests/witness.rs`, `tests/fixtures/phase-deadline.csv`:
  exact schema, persisted cap and fixed numerical boundary cases.
- Node `native-phase-deadline.ts`, `sandbox-types.ts`, `owned-execution.ts`,
  `rust-host-execution.ts`, `rust-host-record.ts`, `native-reconnect-binding.ts`:
  trusted dispatch, strict decoding and journal-bound acceptance.
- `verified-run-rust-phase-deadline.test.ts`: real detached execution, commit wait,
  pre-spawn expiry/boot refusal, forged cap and actual source CLI controls.
- `scripts/architecture/verify-phase-deadline.R`: independent developer-only
  centisecond-bucket reference. No R interpreter enters production.

Migrated every Rust `Record::create_bound` caller to the new explicit optional
cap argument rather than leaving an obsolete overload. Reused the existing native
record, commit gate, budget reducer and cleanup machinery. No dependency, unsafe
Rust, second scheduler, new grant issuer or speculative compatibility layer was
added. Pstack's **Model the Domain** separates the original boot-clock cap from
relative command timeout; **Sequence work into verifiable units** required H2h
GREEN before this ownership change.

## Observed checks

Evidence root: `/tmp/omk-rust-h2hi-20261110-E6mguP/`.

| Gate | Observed result | Evidence |
|---|---|---|
| Rust protocol RED | New cap rejected as an unknown field; other three tests passed | `h2i-rust-red.log` |
| Native/source CLI RED on H2d | Unsupported field or missing persisted original cap failed the new controls | `h2i-native-red.log` |
| Locked/offline Rust tests, one test thread | **16 passed**, zero failures/ignored | `cargo-test-final.log` |
| Cargo check, all-target Clippy `-D warnings`, fmt check, release build | All exit **0** | `cargo-*-final.log` |
| Explicit-binary authority/reconnect/GC/native matrix | **161 passed**, 25 files, no skips/failures | `final-matrix.log` |
| After final post-persistence/pre-spawn guard | **26 passed**, five files, no skips/failures | `post-review-native.log` |
| Independent base-R phase-clock oracle | **14 fixed cases passed**, changed expected verdict rejected with exit 1 | `phase-r-oracle.log`, `phase-r-negative.log` |
| `npm run check`, including compiler and repository guards | Exit **0**, script **588 passed / 30 skipped / 0 failed** | `root-check.log` |
| Active LSP | Two files confirmed clean, seven unconfirmed; no blocking finding returned | Session diagnostics |

Cargo used the new task-local cache/target/home under an OS network-disabled
sandbox, with source and toolchain read-only and no agent-home mount (`cargo.sh`).
Heavy checks ran sequentially. The final binary is
`/tmp/omk-rust-h2hi-20261110-E6mguP/target/release/omk-execution-host`, SHA-256
`3356f685a96308d6fa0b695e6beda76d9a07038897a8bdb7a866a8e2837a0f3f`.
The broader matrix predates the final extra pre-spawn check; the 26-case recheck,
final Cargo gates and root check bind that final source/binary shape.

Actual native tests close the parent's pipes after code starts, send no cancel,
start no replacement observer and observe a committed `deadline` result with a
gone namespace and no late write. A separate control withholds commit and proves
code never starts. The 14-case R comparison covers finite clock arithmetic only,
not arbitrary recovery, operating-system cleanup or whole-host correctness.

## Review and remaining scope

Direct self-review covered gate ordering, original-clock binding, durable-prefix
semantics, crash cleanup, stale observer rejection, no budget renewal, legacy
refusal, conservative quantization and dependency/module limits. It added the
post-persistence/pre-spawn check and reran affected real-binary controls. No
independent multi-agent approval or performance improvement is claimed.

Node still owns approvals, grant issuance/revocation, ledger, scheduling,
reconciliation, final receipts and publication. Rust now enforces an additional
original phase lifetime, not the entire authorization lifecycle. Native revocation
handoff and ledger/scheduler migration remain next bounded work. DAG/scripted or
session reconnect, witness retention, installed artifacts, desktop and OS matrix
acceptance remain open. Phase 2 and the 2.0 milestone are not complete.

Proposed commit message: `Rust host가 원래 부트 기준 실행 기한을 직접 집행`.
