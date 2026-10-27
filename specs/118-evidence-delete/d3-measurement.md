# Spec 118 — D3 measurement addendum (spill / tool-bash / executor `fullOutputPath`)

Base: `origin/main` `2f3747625c`. Extends `spec.md` §2 D3, §3, §4 (EV12), §5. Spec only: no code, no deps, no paid run.
All `file:line` references are `packages/coding-agent/src/…` on that SHA.

## 1. Producers D3 maps (where each registers, how it returns)

| Producer | Report group | Registers at | Created by | Real return path (EV12) | Existing cleanup |
|---|---|---|---|---|---|
| `read-spill` | `spill` | `core/tools/artifact-spill.ts:33-37` | `core/tools/read.ts:177-185` (byte-truncated read) | tool result text `[Full read output spilled to …]` (`artifact-spill.ts:40`) + `details.fullOutputPath` (`read.ts:185`) → model context | none (file in `omk-spill-*` tmp dir, `artifact-spill.ts:23`) |
| `bash-spill` | `spill` | `core/tools/artifact-spill.ts:34` (`kind: "bash"`) | no call site in `src` (only `read.ts:177` calls `spillTruncatedOutput`); **excluded from D3** | — | — |
| `tool-output-log` (`omk-bash-*.log`) | `bash` | `core/tools/output-accumulator.ts:163` (after stream `finish`) | bash tool, `core/tools/bash.ts:149-152`, `finish()` at `bash.ts:203` | `details.fullOutputPath` on updates (`bash.ts:161-166`) and final result (`bash.ts:206`); timeout partial text `Full output: …` (`packages/agent/src/tool-execution-boundary.ts:96-97`) | only written when truncated (`output-accumulator.ts:122`) |
| `bash-executor-log` | `executor` | `core/bash-executor.ts:173` (normal), `:199` (abort) | `AgentSession.executeBash` → `core/agent-session.ts:5076` → `core/session-bash-service.ts:172` | `BashResult.fullOutputPath` (`bash-executor.ts:180,205`) → `bashExecution` message (`session-bash-service.ts:206`) → LLM text `[Output truncated. Full output: …]` (`packages/agent/src/harness/messages.ts:102-103`) unless `excludeFromContext`; shown to user in interactive (`modes/interactive/interactive-mode.ts:6427,6468`) and returned over RPC (`modes/rpc/rpc-mode.ts:560`) | not truncated or thrown ⇒ `discardTempFile` (`bash-executor.ts:83-97,163,192,210`) — must be kept (EV12) |

Why every one is `unknown` today: none passes `requiredConsumers`, and `holdsOf` returns `["unknown"]` when it is undefined (`core/evidence-lifecycle.ts:123-124`). Group mapping: `core/evidence-lifecycle-report.ts:80-86`. `unattributed` = registrations outside a session scope (`core/evidence-lifecycle-scope.ts:9`, report `evidence-lifecycle-report.ts:154`).

## 2. Free measurement (done, $0)

Path: `test/suite/harness.ts` faux provider + real `AgentSession`, `OMK_EVIDENCE_LIFECYCLE=observe`, real `createReadTool` / `createBashTool`, one `session.executeBash`, two prompts; last `evidence_lifecycle` entry (`core/evidence-lifecycle-session.ts:15,26-46`). Scratch test, not committed; 3 runs, identical aggregates:

| Group | present | unknown | share |
|---|---|---|---|
| spill (`read-spill`) | 1 | 1 | 1 |
| bash (`tool-output-log`) | 1 | 1 | 1 |
| executor (`bash-executor-log`) | 1 | 1 | 1 |

`unattributed` = 0, `overflow` = 0, `deletes` = 0, `wouldDelete.count` = 0, `settleIndex` = 1. `bash-spill` cannot be exercised (no producer call site).

Reading: `unattributed` = 0 is met. `unknown` = 0 **cannot** be met on main by construction (§1); it is the thing D3's mapping changes, not a precondition main can satisfy.

## 3. Preconditions (fixed, before any D3 delete code is enabled)

1. D3 mapping PR lands; it registers `requiredConsumers` / holds only, no deletes.
2. Counted on an `observe` run **after** the mapping lands (not a flag-off run): the free faux run of §2 plus the executor abort path and a timeout partial gives, per mapped producer, `unknown` = 0 except artifacts holding `user-visible`; `unattributed` = 0; `overflow` = 0.
3. The same mapping PR carries a separate flag-off G0 byte-identity check against main: normalized hash (UUIDs replaced in first-seen order with `<id-1>`, `<id-2>`… for both `id` and `parentId`), entry count, and the type/disposition order list. All three must match. Flag unset ⇒ no entry, no registration (`evidence-lifecycle.ts:147-148`).

## 4. Metrics

- **Primary:** bytes of mapped-producer artifacts still present at session end, per producer, from the last `evidence_lifecycle` entry per session. Today the report has only total `presentBytes` (`evidence-lifecycle-types.ts:36`); The same mapping PR adds `presentBytesByProducer` (counts only), written to the `evidence_lifecycle` entry only when the flag is `observe`/`delete`; flag off ⇒ no field and no computation.
- **Verdict:** 0 required-evidence loss: 0 `missing_unexpectedly`, 0 read of a deleted path by a later tool call, 0 delete of an artifact with any hold (incl. `user-visible`).
- **Guards/secondary (report only):** `heldBytes` / reasons, `delete_pending` by reason, `wouldDelete` from the `observe` arm, executor discard still firing for non-truncated output.

## 5. EV12 per producer (gate, deterministic)

- `read-spill`: deleted only after the tool result is committed and the turn settled with no later `read` of the spill path; text marker never points to a deleted file without `deleted_after_use`.
- `tool-output-log`: same, covering both update and final `details.fullOutputPath` and the timeout partial path.
- `bash-executor-log`: every interactive/RPC result ⇒ `user-visible` hold, never auto-deleted, **including** `excludeFromContext` results (that option only controls model context, not whether the user saw the path). If ownership or visibility is unclear ⇒ fail closed (no delete). Existing `discardTempFile` behaviour unchanged.
- `bash-spill`: no call site in `src`, excluded from D3. Removing the dead code is a separate later PR.

## 6. Gates

G0–G13 of `spec.md` §4 plus EV12 above, all 100% on deterministic tests before any paid run.

## 7. A/B plan

- Arms: `observe` vs `delete`, one pinned main SHA, same tasks/model/seeds.
- Tasks: those producing ≥1 mapped artifact (truncated read or bash); count from existing logs first (free), need ≥ 3 eligible.
- Team gates: task-clustered CI lower bound of pass-rate delta ≥ −3pp; cost ≤ 1.10× base; wall ≤ 1.25× base; n ≥ 5 per arm per task; plus §4 verdict.
- **Paid runs blocked until 인호 sets a $ cap.** Only after D2 merged (spec.md §5).

## 8. Decisions (Tech Lead, 2026-10-24 KST)

1. The precondition (`unknown` = 0 except `user-visible`, `unattributed` = 0, `overflow` = 0) is counted on an `observe` run after the mapping lands, not on a flag-off run (supersedes the wording of `spec.md` §8 decision 2 for D3). The mapping PR also includes the flag-off G0 check of §3.3.
2. `presentBytesByProducer` ships in the mapping PR; only with flag `observe`/`delete`; flag off has no field and no computation.
3. `bash-spill`: no call site in `src`, excluded from D3; dead-code removal is a separate later PR.
4. Executor results in RPC/interactive always hold `user-visible`, even with `excludeFromContext`. When unsure, fail closed (no delete).

## 9. Consumer names (Tech Lead, 2026-10-24 KST)

- `tool-result-commit`: the tool result that contains or references the artifact has been committed to the session/context.
- `turn-settled`: the turn that produced or read the artifact has settled, with no further tool reads pending.
- `bash-executor-log` needs no consumer: it is always pinned `user-visible` (§8 decision 4).
- The mapping PR only maps; recording these consumers as consumed is wired in the PR that enables delete.
