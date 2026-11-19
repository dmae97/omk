# AdaptOrch results in subagent scheduling

This optional consumer uses the result of an actually executed, configured MCP
`adaptorch_route_topology` tool. It does not copy the private AdaptOrch engine,
call a service in the background, or add a scheduler. It is separate from the
older reasoning-effort advisory bridge and from the Preview blueprint.

Start with `OMK_SUBAGENT_ADAPTORCH=shadow`. After comparing the recorded proposals
with your current workload, `OMK_SUBAGENT_ADAPTORCH=enforce` enables ready-lane
priorities and a width limit of one for `sequential` results. Unset, `0`, or an
unrecognized value disables this consumer; `1` is an alias for `shadow`.

## Use

1. Configure and trust a compatible MCP server through the existing MCP workflow.
   `adaptorch_route_topology` must actually appear in its admitted tool catalog.
   AdaptOrch's remote profile may not expose this local/full-profile tool.
2. Call that tool through normal agent tool execution, with `subtasks` containing
   `id` and `description`. Give edges in one form only: per-node `depends_on`, or
   the top-level `dependencies` list of `{ "from", "to" }` pairs, where `to`
   depends on `from`. A call that fills both forms is not consumed.
3. In the same prompt, dispatch `subagent` graph nodes with matching IDs, task
   descriptions, and dependency sets. The host captures the actual response;
   supplying a claimed topology in text cannot create a receipt.

Only `parallel`, `sequential`, `hierarchical`, and `hybrid` results are consumed.
Every submitted lane must occur exactly once in `stages`. Stage order becomes a
priority among otherwise ready lanes; it does not create stage barriers or erase
dependencies. Existing path-conflict order, admission limits, effort limits,
permits, and verification remain authoritative. Ensemble/debate recommendations
cannot create extra agents. With `OMK_LANE_READY_QUEUE=0`, the original batch
order remains in use; a sequential width restriction can still narrow execution.

## Freshness, resources, and fallback

- A receipt is single-use and bound to the prompt, task/dependency fingerprint,
  and the host's observed late-mutation version. Ordinary potentially mutating
  tool activity also invalidates it, and routing observed while such tools are
  in flight is ignored. External filesystem changes are not detected by this
  mechanism. Dispatch still runs the existing authority checks.
- Up to 64 lanes, IDs of up to 128 characters, and 128 KiB of input task/ID/edge
  text are considered. Only IDs, a digest, and small metadata are retained; no
  task bodies, schemas, or model transcripts are cached. JSON escaping overhead
  is not included in that input-text limit.
- Missing, stale, failed, oversized, malformed, or incompatible results fall back
  to the existing local plan. There are no new retries, waits, or model calls.
- `<OMK_RUN_LOG_DIR>/subagent-routing.jsonl` records mode, lane count,
  `proposalChanged`, sequential restriction, and `extraCalls: 0`. The latter
  counts calls added by this consumer, not the preceding user/model-requested
  MCP call. `proposalChanged` is not a measured change in latency or success.
- A registered tool name identifies a configured tool, not an authenticated
  implementation of the private algorithm. The operator controls the server
  configuration and trust decision.

The baseline is OMK 1.5.11 at
`7389353a6f7f685b52d7be952f79a8bd79bd7565`. Offline tests exercise the real MCP
transport, AgentSession event path, and lane authority with a protocol fixture.
They establish wiring and boundary behavior, not live-engine correctness,
verified completion gains, or memory/latency improvements.

```sh
cd packages/coding-agent
node ../../node_modules/vitest/dist/cli.js --run \
  test/subagent-routing-receipt.test.ts \
  test/suite/subagent-routing-native.test.ts \
  test/subagent-lane-ready-frontier.test.ts
```

Rollback: unset `OMK_SUBAGENT_ADAPTORCH` or set it to `0`; the original local
ordering is used without changing MCP registration or subagent ownership.
