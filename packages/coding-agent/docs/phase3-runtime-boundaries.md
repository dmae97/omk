# Runtime ownership and bounded DAG reduction

Status: reviewed patch candidate. Source baseline `6c8bd15f9d66307fe66ee2200abbee87054ed539`.
This document is not a CI receipt or a release claim.

The live DAG reducer preserves the exact predecessor reachability contract while
using a bounded triangular Uint32 ancestor matrix. Closure allocation is limited
to 16 MiB; larger graphs use exact iterative traversal. The cap does not include
input/output adjacency or total process memory. The existing frontier caller and
conflict predicate remain unchanged.

Final prompt input estimation projects tool `name`, `description` and `parameters`
rather than serializing executable AgentTool instances. Provider-specific wire
wrappers and image token accounting remain estimates, not billing authority.
Numeric environment parsing rejects trailing junk rather than accepting prefixes.

A subagent authority acquires a process-local lease on its shared workload pool
before planning a dispatch. Concurrent dispatches receive `ownership.dispatch_active`;
parallel lanes inside one admitted plan still run concurrently. Unsettled child
ownership remains held until a positive settlement observation. The launcher takes
an immutable snapshot of consumed plan, cap and callback fields, and returns lane
outcomes in plan order. Different pools or processes require separate coordination.

Snapshot admission visits every batch and lane array position. Sparse or non-array
batches and lane lists are rejected before any callback or permit acquisition;
missing lane IDs cannot become completed outcomes. Caller-owned plan, callback,
and decision mutations after dispatch do not change the admitted snapshot.

An unsettled callback's settlement promise is read once and shared by the authority
and permit owner. Replacing the callback result's field cannot substitute a different
termination observation or prevent release after the original promise fulfills.
A rejected observation still retains ownership; no timeout-based release is added.

MCP transport ownership distinguishes `error`, direct-process `exit`, and stdio
`close`. Errors are diagnostics, not termination proofs. `McpClient.waitForTransportClose()`
resolves only after native process/stdio close, or a close before any spawn.
Failed startup attempts retain their queue slot until this observation. Same-server
reconnects wait for retirement and recheck generation after the wait.
`McpManager.status()` exposes optional `retiring: true` while a physical close is
pending. `await manager.closeAndWait()` is the explicit shutdown-join API; the
existing synchronous `close()` remains a cancellation request. Injected clients
must implement the physical close observation contract, not resolve on kill request.

A rejected or unavailable retirement observation retains ownership and may prevent
reconnection. This is deliberate fail-closed behavior. Direct-process/stdio close
is not proof that descendant processes or remote effects terminated.

Focused regression locations:
- `packages/agent/test/phase3-dag-reduction.test.ts`
- `packages/coding-agent/test/phase3-prompt-projection.test.ts`
- `packages/coding-agent/test/phase3-lane-ownership.test.ts`
- `packages/coding-agent/test/phase3-mcp-retirement.test.ts`

Additional regression locations:
- `packages/coding-agent/test/phase3-lane-input-boundaries.test.ts`
- `packages/coding-agent/test/phase3-lane-settlement-identity.test.ts`
- `packages/coding-agent/test/mcp/phase3-close-proof.test.ts`
- `packages/coding-agent/test/mcp/phase3-catalog-integration.test.ts`

The close-proof suite holds distinct request and physical-observation gates. It
covers repeated shutdown joins, delayed and rejected close proof, startup capacity,
and invalidated reconnects. Its controlled clients do not start native processes.
The catalog suite uses a local Node server with real McpClient/stdio transport and
nonempty catalogs: schema projection, descriptor quarantine, duplicate rejection,
stale catalog publication, failed-health in-flight calls, and malformed results.
Every native fixture is joined through closeAndWait during cleanup.

The original bundle harness used seams for empty message conversion, pre-admitted
lane planning and empty MCP catalogs. The additional tests do not establish remote
effect termination, descendant shutdown, every CLI shutdown caller, performance
improvement, or Windows/macOS behavior. Those remain separate gates.
