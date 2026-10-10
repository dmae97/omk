# Source-quote memory recall hardening

## Runtime changes

- An already-aborted transform rejects with the original abort reason before calling its predecessor. Work that was already started still settles through the existing owner; close and predecessor errors remain observable.
- Source and private-record read buffers use the statted byte length plus one instead of always allocating the maximum permitted size. Existing size limits, no-symlink and hardlink checks, ownership checks, before/after identity checks and complete-source redaction/injection scans remain. A growing or replaced file is refused, not silently truncated.
- V2 selection does not tokenize records with no lexical match. All admitted records still undergo source validation. The complete candidate pair and final request retain their existing token accounting; call identity, matching, utility and tie rules are unchanged. Legacy selection is unchanged.
- TUI `/session` displays `Memory: <state> eligible=<count> omitted=<count>`. This reads the last request's `memoryStatus` once, not the store, and never displays source quotes. Opening it does not enable recall or submit a model request. `ready` means optional context was admitted, not semantic truth or successful verification.

Recall still requires both `OMK_VERIFIED_MEMORY=1` and Context Budget V2. Persistent record formats, limits, TTL, revocation, transcript/compaction exclusion and defaults are unchanged. No source-validity cache or cross-request token cache is added.

## Verification boundaries

Focused regressions cover pre-cancellation, source-sized allocations, mutation during read, nonmatching-record work, full-pair limits and all five status labels at 40/80/120 columns. Actual AgentSession tests carry quotes only as transient provider tool data and verify revocation before the next request. An isolated built CLI is used for the `/session` terminal smoke check.

AdaptOrch verification refers to the local `CommandVerifier` executing commands with source digests and bounded resources. OMK's reasoning-router advisory bridge remains default-off and its production transport remains a no-op. Offline bridge/client tests do not establish a live service connection, remote orchestration or semantic correctness.

Release checks use a task-owned Linux checkout of the starting commit with only this change overlaid. Shared worktrees, running TUI processes, credentials and installed launcher files are not replaced. Build, test and packaging evidence does not authorize a version bump, tag, push or public release.

## Observed checks

- Initial RED reproduced nine failures in cancellation, fixed source allocation, nonmatching-record pricing and missing TUI status. A further RED measured a fixed 16 KiB record read buffer.
- After rebuilding the isolated checkout, 292 focused tests passed across memory, TUI and advisory boundaries. The WPL suite passed all 150 tests, including actual engine-source enum/tool parity. Whole-tree `tsgo --noEmit`, `npm run build` and `npm run check` exited 0.
- Coverage reran 102 memory/TUI tests. For the four changed memory modules, line coverage was 98.23%, branch coverage 85.86%, function coverage 100%. This is not whole-product coverage.
- The actual offline factorial CLI produced 1,200 evaluations. Independent paired success delta remained 0; dependent delta remained 1. This deterministic mechanism control is not live LLM accuracy evidence.
- A 512-byte source's read allocation fell from 262,145 bytes to 513 bytes. Actual storage recall uses a record-sized buffer too. This measures read-buffer allocation, not process RSS or long-run heap growth.
- An owned terminal exercised the built `/session` at 120, 80 and 40 columns, then `/quit` exited 0. Status/count rendering, line width and quote exclusion are also covered by component/AgentSession tests.
- The built OMK MCP client connected to the real local AdaptOrch stdio server, matched all 11 tool names and capabilities to engine constants, routed independent/dependent fixtures to `parallel`/`sequential`, and observed transport closure. Only capabilities and topology tools were called, not remote run/cancel.

## Remaining release gate

The full `./test.sh` attempt did not complete within its 600-second bound. Proxy-related tests timed out on both the unchanged base and the candidate. `verified-run` tests failed in both trees with varying individual failures; this comparison does not establish that every failure is unrelated. The shared WSL checkout check also reached its timeout. Do not label the complete release suite green or publish based on the scoped passes above.

The checks do not change the current 1.3.0 version, publish a package/tag, replace the installed launcher or restart an existing user's TUI.
