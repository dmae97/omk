# Spec: behavior-neutral split of `agent-session.ts`

Status: draft (step 1, doc only, no code)
Prerequisite for: spec 104 phase 2 (wire `OMK_REQUIRED_TOOLS` into real sessions; phase 1 merged at `0054023769`).

## 1. Problem

`packages/coding-agent/src/core/agent-session.ts` is 5622 physical lines (4239 pure LOC, its
`scripts/module-size-baseline.json` entry). The module-size check (`scripts/check-module-size.mjs`,
ceiling 250 pure LOC) only lets a baselined file shrink, so any 104 wiring added there must be paid for
by removing lines elsewhere in the same file. Phase 1 states the gap directly: nothing supplies
`requiredTools` to `SessionTurnAdmission` yet ("agent-session.ts wiring is a later PR").

The 104 wiring point today sits inside the `AgentSession` constructor (about lines 895-910):
`new SessionTurnAdmission({ model, state, contextWindow, compactionSettings, latestCompactionTimestamp,
toolGroup, compact, notify })` plus `agent.prepareTools = ... fitTools(...)`. Phase 2 adds one host
callback, `requiredTools: () => RequiredToolContract | undefined` (`session-turn-admission.ts:38`),
fed from the approved acceptance contract. Admission runs at prompt preflight
(`await this._turnAdmission.admit(messages, ...)`, about line 2686).

## 2. Goal

Move cohesive sections out of `agent-session.ts` into new modules so that the 104 wiring lands in a
small new module, without changing any behavior. A later, separate PR does the wiring.

## 3. Proposed extraction (approximate physical lines from `origin/main` `3def31a31e`)

| # | New module (`src/core/`) | Moves from `agent-session.ts` | ~lines |
|---|---|---|---|
| 1 | `agent-session-turn-admission-host.ts` | constructor block that builds the `SessionTurnAdmission` host object and sets `agent.prepareTools` (as a `createTurnAdmission(session)` factory). **104 wiring point.** | ~40 |
| 2 | `agent-session-compaction.ts` | "Compaction" section: `_beginCompactionTransaction`, `_pendingToolResultReserve`, `_runtimeCompactionDecision`, `_recordCompactionCommitForHysteresis`, `_summarizeCompaction`, `compact`, `abortCompaction`, `_effectiveTurnContextWindow`, `_checkCompaction`, `_runAutoCompaction` (about 3477-4270) | ~790 |
| 3 | `agent-session-thinking.ts` | "Thinking Level Management": `_applyAutoThinkingLevelForTurn`, `_appendRouterFeedback`, `_getReasoningRouterBiasSnapshot`, `_getAdaptorchHint`, `_getThinkingLevelForModelSwitch` (about 3108-3455) | ~345 |
| 4 | `agent-session-retry.ts` | "Auto-Retry": `_summarizationRetryCallbacks`, `_maybeRotateModelRoutes`, `_prepareRetry` (about 4823-5078) | ~255 |
| 5 | `agent-session-tree.ts` | "Tree Navigation" + stats/export: `navigateTree`, `getUserMessagesForForking`, `getSessionStats`, `exportToHtml` (about 5147-5562) | ~415 |
| 6 | `agent-session-events.ts` | "Event Subscription" helpers: `_emit`, `_willRetryAfterAgentEnd`, `_findLastAssistantMessage`, `_emitExtensionEvent`, `_recordToolMetric` (about 1304-1640) | ~335 |
| 7 | `agent-session-resources.ts` | MCP/extension resources and runtime: `extendResourcesFromExtensions`, `getExtensionSourceLabel`, `_refreshCurrentModelFromRegistry`, `attachMcpServers`, `mcpProjectTrustReport`, `mcpCheckHealth`, `_buildRuntime`, `_reload` (about 4275-4822) | ~545 |

Expected remainder in `agent-session.ts`: about 2900 physical lines (prompting, model management,
state accessors, public class shell). Every new module must be at or under 250 pure LOC; where a row
above exceeds it (2, 5, 7), that row is split further along existing method boundaries in the code
PR (for example compaction into `-compaction-decision.ts` and `-compaction-run.ts`). No new module is
added to `module-size-baseline.json`.

Shape: the public methods stay on `AgentSession` as one-line delegates with identical signatures;
the moved bodies become functions taking the session (or a narrow host interface) as first argument,
the same pattern `SessionTurnAdmission` already uses. Private fields stay on the class.

## 3a. Scope and PR plan

**PR 1 (before the 10/23 12:00 KST deadline)** contains only:
1. the equivalence harness and its negative-control test (section 5), committed first against unchanged code;
2. extraction of module 1, `agent-session-turn-admission-host.ts` (~40 lines, the 104 wiring point).

**Follow-ups (after 10/23 12:00 KST, one module per PR, same rules and harness):**
- F1 `agent-session-compaction.ts`
- F2 `agent-session-thinking.ts`
- F3 `agent-session-retry.ts`
- F4 `agent-session-tree.ts` (tree / stats / export)
- F5 `agent-session-events.ts`
- F6 `agent-session-resources.ts`

## 4. Rules

1. **Mechanical move only.** No logic change, no reordering of awaits, side effects or emitted events,
   no renamed identifiers beyond `this.` -> `session.` at moved call sites. Comments move with code.
2. **Identical public surface.** Exports of `agent-session.ts` (classes, types, `export type {...}`
   re-exports) are unchanged; a `.d.ts` diff of the built package is empty for `agent-session`.
3. **Baselines only go down.** `agent-session.ts` baseline is lowered by `--update`; no entry is
   raised or added in `module-size-baseline.json` or `import-cycle-baseline.json`. New modules must
   not join an import cycle (they import types from `agent-session.ts` with `import type` only).
4. **0 new dependencies.**
5. One extraction per commit so each diff reviews as a move (`git diff --color-moved`).

## 5. Proof of neutrality

- Full `npm test` and `test/suite/` pass with **no existing test file changed**.
- `npm run check` passes (module size, import cycles, dep tree, Biome, types).
- **Whole-sequence byte equality:** a harness runs a fixed set of scenarios (plain prompt, MCP tools
  over budget, forced compaction, retry after a transient error) against a recording faux provider on
  the base commit and on the split branch, with a fixed clock and session id. It compares **every**
  provider request of each scenario byte for byte (system prompt, cache boundary, tools, messages), not
  only the first, because retry and compaction diverge from the 2nd request on. It also compares the
  **order and payload of every session event** emitted to subscribers, and the run trace/summary from
  the 103b golden scenario. Any diff fails the PR. The harness is added in the first commit of PR 1,
  before any move, so its baseline output comes from unchanged code.
- **Committed negative control:** a test in the same commit as the harness, touching no production
  code, takes the recorded output, mutates one byte of one recorded request, and separately one byte of
  one session event (and swaps the order of two events), and asserts the harness comparison **fails**
  for each. It runs in CI on every run, so a harness that silently compares nothing cannot pass.

### 5.1 Pass criterion and known-failure baseline

"Tests pass" is judged on CI for the PR head, not on a local run. Failures that already occur on main
are recorded here and do not block, provided they fail identically before and after:

| Test | Known failing on |
|---|---|
| `task-result-producer` case 4 | main `d25366d265` and current main |
| `2791-fswatch-error-crash` | main `d25366d265` and current main |

Any other failure, or a change in these two, blocks the PR.

## 6. Out of scope

The 104 `requiredTools` wiring itself, any behavior or flag change, any test edit.

## 7. Rollback

Pure moves: revert the PR.
