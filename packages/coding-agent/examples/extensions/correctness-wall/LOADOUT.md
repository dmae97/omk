# Correctness Wall — optional loadout (copy-paste)

Use this when you run OMK with the default **`omk-core-verified`** preset and want a **B2C patch safety screen** on `edit` / `write` before changes land on disk. The wall is policy- and evidence-limited; it is **not** proof of correctness. Canonical operator doc: [`docs/correctness-wall.md`](../../docs/correctness-wall.md).

## When to enable

| Situation | Action |
|-----------|--------|
| AI-generated or high-risk patches in a scoped lane | Load extension + set `OMK_WALL_SCOPE` |
| Shadow telemetry only (no blocking) | `OMK_PATCH_SAFETY_WALL_MODE=shadow` (default) |
| Block out-of-scope or secret-shaped diffs | `soft` or `hard` + explicit scope globs |
| Full outcome adjudication (OA) | Call tool `correctness_wall_evaluate` with fixture — not on the edit hook path |

**Routing note:** Domain router may send similar work to [`qa-testing`](../../docs/loadout-domains/qa-testing.md) (`execute-tests`, green-run evidence). The wall complements that lane: it gates **apply**, not **test execution**. For monorepo layout and extension paths, load skill **`packages`** when wiring paths from a checkout.

## Copy-paste: session start

From repo root (paths assume monorepo checkout):

```bash
export OMK_PATCH_SAFETY_WALL_MODE=shadow
export OMK_WALL_SCOPE='packages/coding-agent/**,packages/adaptorch-wpl/**'
export OMK_WALL_REPAIR_BUDGET=1

omk --extension packages/coding-agent/examples/extensions/correctness-wall/index.ts
```

Persistent install (user extensions dir):

```bash
cp -r packages/coding-agent/examples/extensions/correctness-wall ~/.omk/agent/extensions/correctness-wall/
# Then start omk; discovery depends on your agent config loading ~/.omk/agent/extensions/
```

## Dogfood phase 2 (soft) — internal lanes

After shadow telemetry review (see [correctness-wall.md](../../docs/correctness-wall.md#recommended-rollout-shadow--soft--hard)):

```bash
export OMK_PATCH_SAFETY_WALL_MODE=soft
export OMK_WALL_SCOPE='packages/adaptorch-wpl/**,packages/coding-agent/examples/extensions/correctness-wall/**'
export OMK_WALL_OVERRIDE=   # set only for intentional human override
omk --extension packages/coding-agent/examples/extensions/correctness-wall/index.ts
```

Live OA (optional): `OMK_WALL_OA_TRANSPORT=mcp`. The extension entry calls `autoWireLiveAdaptOrch(omk)` so live transport uses host `omk.callMcpTool` when the harness binds a handler at `bindCore`. Until a session MCP hub binds that handler, invocations throw and fixture transport remains the safe default. Manual `setWallAdaptOrchCallTool` is still available for tests.

## Copy-paste: `omk-core-verified` + extension

Keep your usual preset (`~/.omk/runtime-preset.json` or project default). Add **one** extra flag for this harness:

```bash
omk --extension packages/coding-agent/examples/extensions/correctness-wall/index.ts
```

Optional hardening for a single lane (example owned paths only):

```bash
export OMK_PATCH_SAFETY_WALL_MODE=soft
export OMK_WALL_SCOPE='packages/coding-agent/examples/extensions/correctness-wall/**'
export OMK_WALL_OVERRIDE=   # unset unless human override is intentional
```

## On-demand evaluation (tool)

Does not require blocking mode; useful for planners/reviewers:

- Tool: `correctness_wall_evaluate`
- Params: `kind`, optional `diffPath`, `approvedWriteScope`, `previewOnly`, `runIds`, `adjudicationFixturePath`
- OA fixture format: see [README.md](./README.md#oa-adjudication-fixture-format)

## Evidence & cache (no secrets in logs)

| Artifact | Purpose |
|----------|---------|
| `.omk/wall-cache/latest.json` | Last verdict summary |
| `.omk/wall-cache/shadow-telemetry.ndjson` | Shadow-mode audit trail |
| `.omk/wall-cache/repair-budget.json` | Capped repair hints per packet |

Final claims still need project rules: e.g. `npm run check` / targeted tests per [`AGENTS.md`](../../../../AGENTS.md) — the wall does not replace those.

## See also

- [correctness-wall.md](../../docs/correctness-wall.md) — verdicts, fast vs deep wall, Adaptorch relationship
- [adaptorch-preview.md](../../docs/adaptorch-preview.md) — preview planning (separate from apply gate)
- [README.md](./README.md) — env vars, hook behavior, limitations
- Domain catalog: [loadout-domains/README.md](../../docs/loadout-domains/README.md)