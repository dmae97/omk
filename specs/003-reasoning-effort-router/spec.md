# Feature Specification: Per-Task Reasoning-Effort Router

**Feature Branch**: `003-reasoning-effort-router`
**Created**: 2026-07-03
**Status**: Draft
**Input**: Resolve ThinkingLevel dynamically per turn for the same model via a local task classifier + rule table (AdaptOrch-style routing, local only), with manual `/think` override always winning and a new `auto` thinking mode.
**OMK Preset**: `omk`

## Requirements

### Requirement 1 - Pure reasoning-router module (Priority: P1)

**Agent**: coder
**Skills**: omk-typescript-strict, omk-code-review
**Evidence Gate**: command-pass
**Risk**: medium

**What**: Add `packages/coding-agent/src/core/reasoning-router.ts` as a pure, side-effect-free module exporting a task classifier and a rule-table resolver.

**Acceptance**:
1. `classifyTask(input)` consumes only: prompt text length, presence of code/diff (fenced blocks, diff markers), keyword signals (debug/refactor/plan/review/simple-edit families), and optional explicit subagent lane type. It returns one deterministic task class from a closed union (`trivial | simple-edit | code-gen | debug | refactor | review | plan`).
2. Overlapping keyword signals resolve by a documented fixed precedence (debug > refactor > review > plan > simple-edit); same input always yields the same class (no clock, randomness, or I/O).
3. `resolveThinkingLevel(taskClass, availableLevels)` maps class → recommended ThinkingLevel via a static rule table (trivial→minimal, simple-edit→low, code-gen→medium, debug/refactor/review→high, plan→xhigh) and clamps the result to `availableLevels` (from `session.getAvailableThinkingLevels()`), so models without xhigh/max never receive them.
4. An explicit subagent lane type (`planner`/`security` escalate one step, `explorer` de-escalates one step) adjusts within the clamped range only.
5. The module imports nothing from session, TUI, or provider code; unit-testable in isolation.

### Requirement 2 - `auto` thinking mode with override precedence (Priority: P1)

**Agent**: coder
**Skills**: omk-typescript-strict
**Evidence Gate**: command-pass
**Risk**: medium

**What**: Add an `auto` thinking mode to the session and wire per-turn resolution into `AgentSession.prompt()` at the recon-verified insertion point (after skill/template expansion and model validation, before agent dispatch, `agent-session.ts` ~L1290).

**Acceptance**:
1. Precedence is exactly: explicit `/think <level>` (manual mode) > per-turn router result (auto mode) > model default. Manual mode never invokes the router.
2. `/think auto` enables auto mode; any `/think <level>` with a concrete level returns to manual mode at that level. `/think` selector continues to work and gains an `auto` entry.
3. In auto mode, the resolved level is applied to the turn (`agent.state.thinkingLevel`) before dispatch; the user's persisted default thinking level in settings is NOT overwritten by auto-resolved turns.
4. Resolution reuses the existing per-turn `reasoning` flow (`packages/agent/src/agent.ts` passes `state.thinkingLevel` as `reasoning`; providers clamp via `clampThinkingLevel`). No `packages/ai` API change.
5. Models with `reasoning: false` bypass the router entirely (level stays `off`).
6. The active mode survives within the session and is visible to the user (status/selector reflects `auto`).

### Requirement 3 - Regression coverage on faux harness (Priority: P1)

**Agent**: tester
**Skills**: omk-typescript-strict
**Evidence Gate**: command-pass
**Risk**: low

**What**: Add `packages/coding-agent/test/suite/regressions/003-reasoning-router.test.ts` using `test/suite/harness.ts` + faux provider (no real provider APIs, keys, or paid tokens).

**Acceptance**:
1. Classifier determinism: fixed input table (incl. code-fence, diff, each keyword family, empty/short/long prompts, lane types) asserts stable classes across repeated runs.
2. Clamp-to-capability: faux models with narrowed level sets never receive unsupported levels (plan-class on a no-xhigh model yields high).
3. Override precedence: manual `/think high` beats router; `/think auto` re-enables routing; settings default untouched after auto turns.

### Requirement 4 - Docs and spec-kit consistency (Priority: P2)

**Agent**: reviewer
**Skills**: omk-docs-release
**Evidence Gate**: file-exists
**Risk**: low

**What**: Document `/think auto` and the precedence rule in user-facing docs; keep constitution slash-command UX rule accurate.

**Acceptance**:
1. `packages/coding-agent/docs/usage.md` documents `auto` mode, the classifier inputs, and the manual-wins precedence.
2. Changelog entry under `## [Unreleased]` / `### Added` in `packages/coding-agent/CHANGELOG.md`.

## Expected Files

- `packages/coding-agent/src/core/reasoning-router.ts` — pure classifier + rule table (new).
- `packages/coding-agent/src/core/agent-session.ts` — auto-mode state, per-turn wiring in `prompt()`.
- `packages/coding-agent/src/core/slash-commands.ts` — `/think` description mentions auto.
- `packages/coding-agent/src/modes/interactive/interactive-mode.ts` — `/think auto` parsing, selector `auto` entry.
- `packages/coding-agent/test/suite/regressions/003-reasoning-router.test.ts` — regression coverage (new).
- `packages/coding-agent/docs/usage.md` — `/think auto` docs.
- `packages/coding-agent/CHANGELOG.md` — Unreleased entry.

## Verification Commands

- `cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/suite/regressions/003-reasoning-router.test.ts`
- `npm run check`
- `npm run build` (only when the user requests runtime application, per constitution)

## Assumptions

- Local-only routing for MVP: no external AdaptOrch service, MCP call, or network dependency in the router path.
- `ThinkingLevel` union (`off|minimal|low|medium|high|xhigh|max`, `packages/agent/src/types.ts:284`) is unchanged; `off` remains the non-reasoning-model state, not a router output for reasoning models.
- `packages/ai` requires no breaking change; provider-side `clampThinkingLevel` remains the final safety net.
- Default behavior is unchanged until the user opts into `auto` (manual mode remains the default).
