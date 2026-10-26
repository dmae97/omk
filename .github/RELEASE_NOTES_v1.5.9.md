# OMK v1.5.9

OMK 1.5.9 is a patch release. It turns on seventeen harness flags by default, stores
evidence commands verbatim, adds project context documents, refreshes the model catalog,
clears the production dependency audit and fixes lock, goal and clock edge cases.
Every new default can be turned off again; see "Behavior changes" before upgrading.

## Behavior changes

- **Seventeen `OMK_*` harness flags are on by default** (#279, #281):
  `OMK_EDIT_DIAGNOSTICS`, `OMK_EXEC_TRUNCATE_MIDDLE`, `OMK_JSON_SESSION_INFO`,
  `OMK_GOAL_AUTONOMY`, `OMK_SKILL_ADMISSION`, `OMK_SKILL_AUTO_LOAD`,
  `OMK_EVIDENCE_LIFECYCLE`, `OMK_ADAPTIVE_EFFORT`, `OMK_DOMAIN_ROUTING`,
  `OMK_GOAL_OUTPUT_RECALL`, `OMK_LANE_READY_QUEUE`, `OMK_LANE_FAILURE_SCOPE`,
  `OMK_RTK_OUTPUT`, `OMK_SESSION_CONTROL`, `OMK_VERIFIED_MEMORY`,
  `OMK_RESPONSE_REASONING_CAP` and `OMK_PREFIX_BOUNDARY`. Set any of them to `0`,
  `false` or `off` to restore the 1.5.8 behavior. `OMK_EVIDENCE_LIFECYCLE` deletes only
  verified goal-recall files; `observe` deletes nothing.
- **Evidence receipts store commands verbatim** (#223). Command credential redaction is
  removed and older v3 receipts stay readable. Keep secrets out of command lines.
- **GitHub Copilot default model is `gpt-6.1-sol`**, because Copilot retired `gpt-5.4`.

## Added

- Project context documents: `omk init --project`, and a bare `omk` launch in an empty Git
  root, create `PRD.md`, `ARCHITECTURE.md`, `DESIGN.md`, `RULES.md`, `TASKS.md` and
  `PROGRESS.md` without overwriting files (`OMK_PROJECT_CONTEXT_BOOTSTRAP=0` disables the
  launch bootstrap).
- DeepSeek harness, default on for DeepSeek models (`OMK_DEEPSEEK_HARNESS=0` disables it).
- Acceptance diagnostics behind `OMK_GOAL_DIAGNOSTICS` (flag, default off) (#170).
- Kimi K3.1 Pro in the `kimi-coding` and `moonshotai` catalogs (#280).

## Fixed

- A passed acceptance check completes its goal on a loaded host (#291).
- Repeated skill searches reuse unchanged document terms (#290).
- Monotonic clock for durations, caches and deadlines (WSL2 clock steps).
- Lock ownership for the goal journal, auth, trust store and session doctor.
- Per-call bash timeouts, local context overflow recovery, status sidebar usage after
  `/new`, `omk run cancel` during live appends, and stale autocomplete acceptance.

## Dependencies and catalog

- `npm audit --omit=dev` is clean: `undici` 8.12.3, `zod` 4.6.7, and the optional Gondolin
  example on 0.14.0 without `node-forge` (#289).
- Model catalog regenerated; upstream-deprecated models are removed (#288).

## Not yet measured

- There is no on/off benchmark for the new defaults, so this release makes no
  performance claims about them.
