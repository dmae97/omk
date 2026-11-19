# Rust host slice H1: owned Linux sandbox execution

The implementation target is a real opt-in backend of `executeSandbox`, reached
by `RunCoordinator.start()` for writer and verifier commands. It is not another
read-only prototype. Production defaults remain Node until the milestone gates
pass; explicit `OMK_RUST_EXECUTION_HOST` selects the native executable.

## Ownership

- Node alone owns approval, durable authority grants, run journals, scheduling,
  candidate verification and publication.
- Rust alone spawns and supervises each selected writer/verifier sandbox,
  enforces monotonic time and combined output budgets, waits for commit before
  releasing candidate code, cancels its process group and observes termination.
- Node records the real namespace identity and authority start before sending
  commit. A failed native invocation never falls back to Node execution.
- Git publication stays on the existing separately reviewed Node boundary.
- Failed cleanup or a lost native process remains unknown/quarantined, not a
  successful termination witness or permission to retry.

## Implementation

Use the existing Linux bubblewrap arguments and gated command contract. A private
stdio JSONL channel connects the trusted parent and native child; neither UI nor
model-authored input selects the backend. Bound request/control/output frames,
validate identity and ordering, scrub inherited environment and preserve the
filesystem, PID, network and capability isolation. Reuse pinned Serde packages;
no new third-party dependency or unsafe Rust is required.

The backend identity includes the exact native binary hash in environment binding.
Binary/configuration drift refuses dispatch or evidence eligibility. No global
installation, engine activation, publication or default flip belongs to this slice.

## Mathematical contract

For integer elapsed time e, timeout T, retained bytes u, limit L and next chunk b,
continue exactly when e is nondecreasing, e < T and b <= L-u. Otherwise latch the
first failure. Accepted chunks add b to u; rejected chunks add nothing. The
retained-byte invariant is 0 <= u <= L. A latched failure cannot be reset by later
input. Avoid addition overflow by comparing b with L-u before adding.

Base R independently evaluates fixed trace inputs and exact decisions/byte counts
from the production Rust budget reducer. Include timeout equality, byte equality,
clock regression, zero chunks, large integers and negative controls. Numerical
agreement covers the finite domain, not process cleanup or all concurrency.

## Required evidence

1. Intended RED tests before implementation; Rust unit and actual process tests.
2. Real SDK coordinator writer/verifier execution and unchanged base workspace.
3. Rejected approval/gate, cancellation before/after commit, timeout, output cap,
   detached descendants, parent disconnect and native crash/unknown outcomes.
4. Independent base-R budget oracle and existing TS/R/Rust DAG parity.
5. Targeted Node regressions, Cargo test/check/Clippy/fmt, repository check and
   direct review. Report default Node and the exact moved ownership separately.

Harness impact: preserve. Approval, scope isolation, one dispatch, retained-byte
limits, no unsafe retry and witnessed settlement must not regress against source
HEAD `48fb8e33a84d01fde163091ed36a8bca981d3bbe`. This is not a performance claim.
