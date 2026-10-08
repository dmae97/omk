# Source-quote memory lifecycle and request-local pricing

## Scope

This change targets the existing opt-in `SessionMemory` provider-input transform. It does not enable memory, rebuild the installed CLI, change persistent record formats, cache source validity, or alter shared dirty `agent-session.ts` changes.

Source inspection found a retained-callback path: restoring `agent.transformContext` on close does not invalidate a wrapper already captured by a pending request. Stacking transforms and closing an inner owner first can also reinstall a closed wrapper when the outer owner closes. These are object-reference and lifecycle mechanisms, not a measured claim of unbounded process heap growth. Normal `AgentSession.close()` already aborts and drains owned work before disposal; that behavior remains.

The intended fix makes owned wrappers inert after close, removes the enrichment callback's reference to the disposed controller, walks past closed managed predecessors and preserves unrelated replacement callbacks. Closing resets memory status to the existing disabled state and releases the cached store. Pending predecessor errors and cancellation remain observable. Direct mutation calls on a closed memory controller fail rather than recreating storage.

## Bounded optimization

Candidate fitting currently reprices the same system prompt and tool schemas repeatedly. Cache only those two exact text-count results within one synchronous enrichment request. Keep complete conversation/envelope counting and all existing integer/capacity checks. Do not approximate token concatenation, add independently rounded token counts, or reuse this cache across requests, models, source updates, expiry or revocation.

This reduces repeated static token-counter work; it does not claim O(1) history pricing. Incremental history estimation, source caching, zero-headroom inventory shortcuts and generic cache configuration are intentionally excluded because they require additional accounting or status contracts.

## Verification plan

- Controlled pending-predecessor and retained-wrapper tests prove that close prevents further recall and clears status.
- All six close orders of three stacked controllers restore the original callback; unrelated callback replacement remains untouched.
- Original errors and aborted signals propagate.
- Instrument the real fallback counter with eight source records: static prompt/schema count once per request, subsequent requests revalidate changed sources.
- Existing source-store, selection, hard-budget and actual AgentSession wiring tests run with the new regressions.
- AdaptOrch's local `CommandVerifier` executes scoped commands with source hashes, resource limits and no providers. A source-matched Linux snapshot is used for WSL I/O latency; the original compiler/LSP and required repository checks remain separate evidence.
- No release, semantic-correctness, global heap benchmark or live-provider performance claim follows from these checks.

## Observed verification

- Regression RED: seven lifecycle cases failed before the change; static system-prompt text was priced ten times rather than once.
- AdaptOrch local verification: all 83 tests in seven targeted files passed, including actual `AgentSession` memory wiring, store/selection, prompt budgets and prior factorial regressions. Exit 0, no provider calls.
- Coverage scoped to `session-memory.ts`, `memory-context-transform.ts` and `memory-token-counter.ts`: 92.3% lines/statements, 91.93% branches. This is not whole-product or heap-usage evidence.
- Receipt: `/tmp/omk-memory-wiring-verification-091tl5kf/verification.json`; source hashes matched the Linux snapshot and original sources were unchanged during execution.
- The narrowed original-source compiler check exited 0. Whole-repository type checking exited 2 for unrelated `test/jev-builtin.test.ts` importing a missing `src/core/jev.ts`. Full `npm run check` stopped on formatting in that unrelated test; those files were not modified by this task.
- Self-review and delegated review found no remaining implementation defect. Added model-key/parts/envelope equivalence, closed-chain error/signal, and deferred stacked-close tests after review.
- No build, TUI restart, global memory enablement, token-boundary approximation or persistent source cache was applied.

The prior offline factorial experiment is a separate atomic commit. Only explicitly reviewed request paths are staged; unrelated changes remain unstaged. Commit and push require a valid operator-approved Git author identity.
