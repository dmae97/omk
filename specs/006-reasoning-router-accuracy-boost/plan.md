# Implementation Plan: Reasoning-Router Accuracy Boost (v3)

**Status**: Plan only. Do not implement until user explicitly approves.  
**Evidence root**: `.omk/goals/006-reasoning-router-algorithm-strengthening-plan/`

## Synthesis decisions

1. **Versioned rollout**: implement v3 as opt-in `auto-v3`; do not change v1 (`/think auto`) or v2 (`/think auto-v2`).
2. **Context over precedence**: v3 should use leading intent and object context before generic keyword precedence.
3. **Benchmark first**: refactor benchmark split/gates before tuning v3 weights.
4. **Privacy by construction**: learning is a separate default-off feature; v3 accuracy must not depend on private feedback.
5. **AdaptOrch last**: bridge depends on a stable local v3 API and remains advisory/default-off.

## Proposed algorithm

Pipeline:
1. Normalize prompt and extract `firstClause`, body, code/diff spans.
2. Extract contextual features:
   - F1 leading intent: review, plan, refactor, code-gen, debug, simple-edit.
   - F2 localized edit object: spelling, punctuation, comma, semicolon, double space, headline, title, author email, copyright year, closing tag.
   - F3 diagnostic failure evidence: stack traces, runtime failure, crashes, EADDRINUSE, race/deadlock, memory leak, use-after-free, data corruption.
   - F4 review scope: PR, diff, plan risks, API, schema, coverage, clarity, licensing, edge cases.
   - F5 plan brief: architecture/migration/roadmap markers, long structured prompt markers.
   - F6 refactor expansion: consolidate, split module, move logic, untangle, merge duplicate.
3. Suppress misleading generic keywords by context:
   - `audit log` is not review by itself.
   - `error handling`, `error messages`, `error budgets` are not strong debug evidence.
   - `fix`/`add` derive class from object cues, not automatic debug/code-gen.
4. Score with bounded weights: leading intent +8, local edit +7, diagnostic +7, plan brief +8, review scope +3, strong keyword +4, weak keyword +1, code/diff +4.
5. Resolve level with the existing capability clamp and optional bounded bias/hint paths.

## DAG and lane grants

| Lane | Role | Authority | Write scope | Skills | MCP | Hooks | Acceptance | Evidence |
|---|---|---|---|---|---|---|---|---|
| P1 Benchmark split | omk-tester | write-scoped tests/fixtures | gold-set fixture, 006 benchmark tests/scripts | programming, ai-regression-testing, debugging | filesystem | pre-shell-guard, typecheck-after-edit, stop-verify | train/dev/holdout split; dev gates runnable; artifact schema | laneP1-eval.md |
| P2 v3 pure core | omk-coder | write-scoped core only | `reasoning-router-v3.ts`, v3 weights module | programming, ast-grep, omk-typescript-strict | filesystem, serena | protect-secrets, typecheck-after-edit, eslint-after-edit | v3 fixes miss clusters; deterministic; v1/v2 unchanged | laneP2-v3-core.md |
| P3 calibration | omk-tester | write-scoped scripts/tests | calibration sweep + golden diff artifacts | debugging, verification-loop | filesystem | pre-shell-guard, stop-verify | candidate accepted by dev gates; holdout untouched | laneP3-calibration.md |
| P4 activation | omk-coder | write-scoped UI/session | interactive `/think auto-v3`, session version enum if needed | programming, TUI minimal | filesystem, serena | typecheck-after-edit, eslint-after-edit | v1/v2/manual semantics preserved; v3 opt-in only | laneP4-activation.md |
| P5 learning privacy | omk-coder + omk-security | write-scoped collector/compile | `router-feedback-collector.ts`, compile CLI/tests | omk-security-review, security-review, programming | filesystem | protect-secrets, pre-shell-guard, stop-verify | default-off, exact schema, 0700/0600, deterministic compile | laneP5-learning.md |
| P6 AdaptOrch bridge | omk-coder + omk-security | write-scoped bridge | `adaptorch-bridge.ts`, integration tests | adaptorch, omk-security-review, programming | adaptorch(read), filesystem | protect-secrets, subagent-stop-audit | read/advisory only, fallback F1-F9, no raw payload | laneP6-bridge.md |
| P7 review/docs | omk-reviewer | review-only or docs-scoped | docs/changelog only if delegated | review-work, omk-docs-release | filesystem-readonly, github(read) | stop-verify, subagent-stop-audit | precedence traced; `npm run check`; merge verdict | laneP7-review.md |

Parallelism:
- P1 can start first and should precede P2 acceptance.
- P2 and P3 serialize where calibration depends on v3 outputs.
- P5 and P6 can be planned/implemented after P2 API stabilizes, but remain default-off.
- P4 must wait for P2/P3 gates.
- P7 always last.

## Verification commands

Targeted:
```bash
cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/suite/regressions/003-reasoning-router.test.ts test/suite/regressions/004-reasoning-router-v2-accuracy.test.ts test/suite/regressions/006-reasoning-router-v3-feature-engineering.test.ts
```

Full repo gate:
```bash
npm run check
```

Do not run `npm run build` unless explicitly requested.

## Exit criteria

- v3 dev CWA > v2 and holdout aggregate is not worse than v2.
- Current v2 miss clusters are fixed or explicitly accepted with rationale.
- `/think auto`, `/think auto-v2`, and manual `/think <level>` behavior unchanged.
- No `packages/ai` or `packages/agent` diff.
- Learning and AdaptOrch remain default-off with security gates.
