# Feature Specification: Reasoning Router Advanced Accuracy Harness

**Feature Branch**: `008-reasoning-router-advanced-accuracy`  
**Created**: 2026-07-03  
**Status**: Draft / implementation-ready planning artifact  
**Input**: User request to use Adaptorch and parallel subagents to plan a more accurate reasoning-router algorithm and harness.  
**OMK Preset**: `omk`

## Agent-Oriented Requirements

### Requirement 1 - Benchmark governance before further tuning (Priority: P1)

**Agent**: `omk-tester`  
**Skills**: `ai-regression-testing`, `eval-harness`, `benchmark`, `programming`  
**MCP**: `filesystem`, `understand-anything` advisory only  
**Evidence Gate**: command-pass + aggregate benchmark artifact  
**Risk**: high

**What**: Split the reasoning-router gold set into train/dev/holdout governance, add aggregate-only holdout reporting, and prevent classifier overfit to visible fixture rows.

**Verify**:
1. `GOLD_SET` keeps stable IDs and 30 rows/class.
2. Existing `holdout: true` rows map exactly to the `holdout` split.
3. Train/dev assignment is deterministic and content-blind.
4. Holdout test output never prints prompt text or per-row holdout labels.
5. Targeted regression family still passes.

**Acceptance**:
- Additive fixture metadata only: `split`, `category`, `featureTags`, `labelVersion`, optional adjudication ref.
- Existing v1/v2/v3 tests remain meaningful and unchanged except where import types require fixture metadata.
- Hard gates include CWA, micro accuracy, macro F1, min-class F1, severe under-allocation, class-flip, and McNemar reporting.

---

### Requirement 2 - Confidence-bearing v4 classifier design (Priority: P1)

**Agent**: `omk-coder` after tester gates are in place  
**Skills**: `programming`, `ast-grep`, `debugging`  
**MCP**: `filesystem`, `serena`  
**Evidence Gate**: command-pass + benchmark report  
**Risk**: medium

**What**: Restore the v2-style feature/gating/scoring/verdict separation that v3 abandoned, and introduce a deterministic `ClassifierVerdictV4` with task class, scores, runner-up, margin, confidence band, fallback reason, and audit flags.

**Verify**:
- v1/v2/v3 files and semantics are untouched.
- v4 returns the same class union as v3.
- Default weights produce v3-equivalent behavior unless new governance evidence justifies calibrated changes.
- Confidence/margin is available to evaluation, learning, and Adaptorch advisory code without storing prompts.

**Acceptance**:
- No new dependencies.
- Pure deterministic classifier: no I/O, time, random, model calls, network, or state mutation.
- Confidence cannot lower effort on prompt text such as “don’t think hard”; low confidence only holds or escalates.

---

### Requirement 3 - Privacy-preserving learning ledger, default off (Priority: P2)

**Agent**: `omk-coder`, reviewed by `omk-security`  
**Skills**: `security-review`, `programming`, `verification-loop`  
**MCP**: `filesystem`; no `supermemory` unless separately approved  
**Evidence Gate**: security-review PASS + tests  
**Risk**: high

**What**: Add a local-only opt-in learning ledger and offline bias compiler that stores only bounded enums/booleans/buckets, never raw prompts, paths, diffs, session IDs, provider payloads, or secrets.

**Verify**:
- Default behavior writes nothing.
- Unknown ledger keys are rejected.
- Ledger files use restrictive permissions and refuse symlinks/non-regular files.
- Bias is compiled offline, deterministic, bounded, and pinned for a session.

**Acceptance**:
- User-level/global opt-in only; no project-local committed opt-in.
- Bias remains zero until a minimum evidence threshold is met.
- Manual `/think <level>` and v1/v2/v3 defaults remain unaffected when disabled.

---

### Requirement 4 - Adaptorch advisory bridge, default off (Priority: P2)

**Agent**: `omk-coder`, reviewed by `omk-security`  
**Skills**: `adaptorch`, `security-review`, `agent-architecture-audit`, `cost-aware-llm-pipeline`  
**MCP**: `adaptorch` advisory only, `filesystem`; no mutating Adaptorch run tools from the router path  
**Evidence Gate**: security-review PASS + timeout/fallback tests  
**Risk**: high

**What**: Add an anti-corruption bridge that can accept bounded advisory hints from Adaptorch without blocking the synchronous turn-start router path and without sending raw prompt text.

**Verify**:
- Payload schema contains only closed enums, bounded numbers, and booleans.
- No raw prompt, hash, path, model ID, session ID, tool output, hook output, or credential-shaped value is accepted.
- Bridge reads cached hints only in the turn path; refresh is async/fire-and-forget or outside the critical path.
- Failures degrade to “no hint” silently.

**Acceptance**:
- Disabled by default.
- Budget/TTL/circuit breaker enforced.
- Hint magnitude bounded by capability ladder and cannot bypass manual mode.

---

### Requirement 5 - Integration, documentation, and review gates (Priority: P1)

**Agent**: `omk-coder`, `omk-tester`, `omk-reviewer`  
**Skills**: `programming`, `review-work`, `docs-write-concisely`  
**MCP**: `filesystem`, `github` read-only for review if needed  
**Evidence Gate**: targeted tests + `npm run check` + reviewer MERGE  
**Risk**: medium

**What**: Wire only after modules and security gates pass; document actual behavior after implementation, not speculatively.

**Verify**:
- Targeted reasoning-router regression family passes.
- `npm run check` passes cleanly.
- `packages/ai` and `packages/agent` diffstat remains empty.

## Expected Files

Planning-only Goal 008 created:
- `.omk/goals/008-reasoning-router-advanced-accuracy-plan/laneA-algorithm-design.md`
- `.omk/goals/008-reasoning-router-advanced-accuracy-plan/laneB-evaluation-harness.md`
- `.omk/goals/008-reasoning-router-advanced-accuracy-plan/laneC-privacy-adaptorch.md`
- `.omk/goals/008-reasoning-router-advanced-accuracy-plan/laneD-dag-plan.md`
- `specs/008-reasoning-router-advanced-accuracy/{spec.md,plan.md,tasks.md}`

Future implementation paths are listed in `plan.md` and `tasks.md`; no product source changes are made by this planning goal.

## Verification Commands

- Targeted future test family: `cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run <reasoning-router regression files>`
- Full repo gate after code changes: `npm run check`
- Diff isolation: `git diff --stat -- packages/ai packages/agent`

## Assumptions

- v3 remains opt-in and not default.
- Goal 007 v3 benchmark (`v3Micro=1.0`, `cwaV3=0.9746`) was measured on non-holdout rows; stronger governance is required before claiming generalization.
- Understand-Anything graph exists but is stale; direct file evidence and fresh tests take precedence.
