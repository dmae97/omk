# Correctness Wall extension

B2C patch safety gate for `edit` and `write` tool calls, plus an explicit `correctness_wall_evaluate` tool. Policy checks come from `omk-adaptorch-wpl` via a **relative import** (no workspace `package.json` dependency).

## Usage

From the `packages/coding-agent` directory (or repo root with a valid path):

```bash
omk --extension examples/extensions/correctness-wall/index.ts
```

Copy into user extensions for auto-discovery:

```bash
cp -r examples/extensions/correctness-wall ~/.omk/agent/extensions/correctness-wall/
```

## Claim boundaries

- **In scope**: unified-diff preview for pending `edit`/`write`, fast policy wall (write scope, flags), optional OA adjudication when `correctness_wall_evaluate` is called with `runIds`, `previewOnly: false`, and an OA fixture file (env or tool param).
- **Out of scope**: Replacing core hooks, modifying `packages/adaptorch-wpl` from this lane, or adding npm workspace dependencies. The extension only **imports** `evaluateCorrectnessWall` and `AdaptOrchClient` from `../../../../adaptorch-wpl/src/index.ts`.

## Environment variables

| Variable | Default | Meaning |
|----------|---------|---------|
| `OMK_PATCH_SAFETY_WALL_MODE` | `shadow` | `shadow` — log/notify only, never block. `soft` — block `BLOCKED` unless override. `hard` — block `BLOCKED` and `INCONCLUSIVE`. |
| `OMK_WALL_SCOPE` | *(empty)* | Comma-separated glob/path prefixes allowed in the diff. Empty means scope checks do not approve any path (out-of-scope diffs can trigger blocking flags when paths are present). |
| `OMK_WALL_OVERRIDE` | unset | When `1` / `true` / `yes`, `soft` mode does not block `BLOCKED` verdicts (human override). |
| `OMK_WALL_REPAIR_BUDGET` | `1` | Capped regenerate budget: max **blocked attempts** per packet (keyed by `packetId` or SHA-256 of `kind` + sorted `OMK_WALL_SCOPE`) before repair hints are treated as exhausted. Also caps hint string count in UI/JSON. Persisted in `.omk/wall-cache/repair-budget.json`. Hints only — no auto-regenerate. |
| `OMK_WALL_RUN_IDS` | *(empty)* | Comma-separated AdaptOrch run ids. On `edit`/`write` hooks, when non-empty **and** `OMK_WALL_OA_FIXTURE_PATH` (or per-tool `adjudicationFixturePath`) is set, evaluation uses `previewOnly: false` and OA adjudication via `resolveOaClientForEvaluation`. Otherwise hooks stay preview-only. |
| `OMK_WALL_OA_FIXTURE_PATH` | unset | Path to OA adjudication fixture JSON. Used when `correctness_wall_evaluate` runs with `previewOnly: false` and non-empty `runIds`, and on edit/write hooks when combined with `OMK_WALL_RUN_IDS`. Overridden per call by `adjudicationFixturePath`. |
| `OMK_WALL_AUTO_REGENERATE` | unset | When `1` / `true` / `yes`, `correctness_wall_evaluate` JSON may include a `regeneratePacket` (capped hints only; no automatic patch apply). |
| `OMK_WALL_RECEIPT_SIGNING_SECRET` | unset | When set, verification receipts include `signedReceipt` (HMAC-SHA256 over digest composite). Never log or commit this value. |
| `OMK_WALL_DEEP_PHASE` | `stub` | `docker` records deep-wall intent; hermetic runner still unavailable (batch-2). |
| `OMK_WALL_OA_TRANSPORT` | `fixture` | `mcp` or `live` uses session-injected MCP `callTool` via `setWallAdaptOrchCallTool` (see `adjudication-fixture.ts`). Fixture path optional for receipt metadata when using `mcp`. |

## OA adjudication fixture format

Fixture file (JSON object). Each `run_id` must define the three AdaptOrch introspection payloads the in-memory client serves:

```json
{
  "wall_version": "1",
  "dispatchRecordId": "local-dev-dispatch",
  "runsById": {
    "run-oa-1": {
      "run": { "run_id": "run-oa-1", "status": "completed" },
      "artifacts": [{ "path": "out.md", "size_bytes": 42 }],
      "traces": [{ "kind": "write", "level": "info" }]
    }
  }
}
```

- **`wall_version`**: optional string copied onto the verification **receipt** returned by `correctness_wall_evaluate` (defaults to extension version `1`).
- **`dispatchRecordId`**: optional; passed to OA adjudication when not set elsewhere.
- **`runsById`**: required map; keys must match `runIds` in the tool call.

`createInMemoryAdaptOrchClient` (in `adjudication-fixture.ts`) wraps these entries with the same transport pattern as `packages/adaptorch-wpl/test/b2c-wall-oa.test.ts`.

## Tools

### `correctness_wall_evaluate`

Parameters:

- `kind` (string, required)
- `approvedWriteScope` (optional string array)
- `previewOnly` (optional boolean, default `true`)
- `diffPath` (optional string) — if omitted, returns an `INCONCLUSIVE` verdict card JSON
- `runIds` (optional string array)
- `packetId` (optional string)
- `adjudicationFixturePath` (optional string) — OA fixture file; falls back to `OMK_WALL_OA_FIXTURE_PATH`

Returns JSON text: `{ verdictCard, receipt }`, and `repairHints` when `verdictCard.verdict` is `BLOCKED`.

The **`receipt`** includes standard `VerificationReceipt` fields from adaptorch-wpl plus **`wall_version`** (from the fixture or default).

Example receipt fragment:

```json
{
  "schemaVersion": 1,
  "evaluatedAt": "2026-07-08T12:00:00.000Z",
  "kind": "code-edit",
  "runIds": ["run-oa-1"],
  "previewOnly": false,
  "wall_version": "1",
  "adjudicationVerdict": "CONFIRMED",
  "policyFlags": []
}
```

## Edit/write gate

On each `edit` or `write` `tool_call` hook:

1. Build a unified diff preview from `event.input` (edits or write content).
2. Call `evaluateCorrectnessWall` with scope from `OMK_WALL_SCOPE`. Default `previewOnly: true`; when `OMK_WALL_RUN_IDS` is non-empty and an OA fixture path is set (`OMK_WALL_OA_FIXTURE_PATH`), hooks use `previewOnly: false`, pass `runIds`, and supply the OA client from `resolveOaClientForEvaluation`.
3. Apply `OMK_PATCH_SAFETY_WALL_MODE` blocking rules; blocked calls return `{ block: true, reason: "<short user message>" }`.
4. Write a summary snapshot to `.omk/wall-cache/latest.json` (mode, verdict, `wouldBlock`, compact card summary, timestamp — no full diff or secrets).
5. In `shadow` mode, append one NDJSON line per gated tool call to **`.omk/wall-cache/shadow-telemetry.ndjson`** (`event`, `wall_version`, `mode`, `verdict`, `wouldBlock`, `kind`, `tool`, `previewOnly`, `usedOaFixture`, `timestamp` — no diff or secrets).
6. On `BLOCKED`, increment per-packet attempts in `.omk/wall-cache/repair-budget.json`. In `shadow` mode, append capped repair hints to the UI notification; when `attempts >= OMK_WALL_REPAIR_BUDGET`, append a repair-budget-exhausted message.

## Limitations

- Edit preview reads the target file from disk relative to session `cwd`; if the file is missing or paths are wrong, the hook may return `INCONCLUSIVE` (and block in `hard` mode).
- Hook OA requires both `OMK_WALL_RUN_IDS` and a fixture path; if either is missing, hooks remain preview-only. Explicit `correctness_wall_evaluate` can still pass `runIds`, `previewOnly: false`, and `adjudicationFixturePath` per call.
- Relative imports require loading this extension from the monorepo layout (or an equivalent path to `adaptorch-wpl` and `coding-agent` sources).