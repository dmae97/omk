# Critical Issues & Improvement Plan — 2026-05-01

**Date:** 2026-05-01 (KST)
**Project:** open-multi-agent-kit
**Scope:** current repository state, CLI runtime, orchestration, MCP, safety hooks, docs, and release readiness
**Audience:** maintainer / future implementation agents

---

## Executive Summary

open-multi-agent-kit already has a promising shell: CLI entry points, Kimi wrapping, scaffold generation, design integration, MCP server, DAG primitives, tmux layout, HUD, and a polished README. The main gap is that several advertised “team runtime / quality gate / live HUD” capabilities are still scaffold-level or partially connected.

The most urgent work before treating this as a serious public tool is:

1. Remove user-specific MCP/scaffold defaults and harden MCP command execution.
2. Add real tests and lint gates; today only TypeScript compile gates exist.
3. Wire `omk run` / `omk team` into the DAG + worktree + state runtime instead of launching mostly manual flows.
4. Make global `~/.kimi` mutations opt-in, diffable, reversible, and tested.
5. Align README/docs with actual command maturity.

### Debug Update — 2026-05-01 KST

Completed in the current working tree:

- P0-1 is partially mitigated: default scaffold MCP config is now local-only (`omk-project`) instead of shipping maintainer-local secret loader paths or absolute home paths.
- Public-release secret guard added: `npm run secret:scan` checks tracked + untracked non-ignored files without printing secret values.
- CI/release gates now run `lint`, `check`, `test`, and `build`.
- `prepublishOnly` now runs `lint`, `test`, and `build`.
- P0-2 is partially mitigated: MCP quality gates no longer execute config strings through a shell; they only run package-manager scripts through argv-based execution.
- P0-3 is partially mitigated: `npm run lint` and `npm test` now exist, and a regression test covers blocked quality-gate command injection.
- `omk_write_config` is now disabled by default and requires explicit `OMK_MCP_ALLOW_WRITE_CONFIG=1` for trusted local sessions.
- Open-source scaffold defaults now use `approval_policy = "yolo"` plus `yolo_mode = true`.
- Built-in TypeScript LSP support added: `omk lsp typescript`, `.omk/lsp.json`, bundled `typescript-language-server`, and LSP regression tests.
- Current TypeScript build blockers in the graph memory files are resolved; `npm run check`, `npm run build`, and `npm pack --dry-run --json` pass.
- Control-plane theme follow-up completed: `omk --help` and Kimi banner fallback now use the OMK Control neon-grid token set plus compact ASCII instead of the previous oversized ANSI image fallback.
- AGENTS/DAG runtime ETA support added: executor records per-node timing/attempts, persists `RunState.estimate`, passes ETA env to task runners, and HUD displays progress/ETA when `state.json` exists.
- Theme safety guardrails added: terminal display strings are sanitized, `NO_COLOR`/`TERM=dumb` are respected, and configured logo images are project-relative by default with type/size/magic-byte validation.

Still open:

- P0-2 still needs read-only/write-capable MCP server separation if the project wants a stronger boundary than the current env-gated trusted-write mode.
- P0-3 still needs a real style/static lint policy beyond the current secret-scan-backed `lint`.
- P0-4/P0-5 remain product/runtime hardening work.

---

## Verification Snapshot

Commands run during this review:

| Command | Result | Notes |
|---|---:|---|
| `git status --short` | Pass | Working tree has multiple in-progress changes; do not treat as release-clean. |
| `npm run secret:scan` | Pass | No high-confidence secrets or maintainer-private paths found. |
| `npm run lint` | Pass | Currently secret-scan-backed; style lint remains TODO. |
| `npm run check` | Pass | `tsc --noEmit` completed. |
| `npm test` | Pass | Node test runner: 23 regression tests covering quality gates, config-write permissions, LSP config, local graph memory, logo image safety, ETA, and OMK Control theme output. |
| `npm run build` | Pass | `tsc` completed. |
| `node dist/cli.js lsp --print-config` | Pass | Default `.omk/lsp.json` payload renders. |
| `node dist/cli.js lsp --check` | Pass | Resolves bundled `typescript-language-server` binary. |
| `git diff --check` | Pass | No whitespace/check errors. |
| Hardcoded token/path scan | Pass | No matches outside ignored `.git` internals, `node_modules`, `dist`, and lockfile. |
| `node dist/cli.js --help` | Pass | CLI help renders. |
| `node dist/cli.js doctor` | Pass with warning | 1 warning: global `~/.kimi` pollution. |
| `node dist/cli.js hud` | Pass | HUD renders. |
| `npm audit --omit=dev --audit-level=moderate` | Pass | 0 vulnerabilities reported. |
| `npm pack --dry-run --json` | Pass | Package: 238 files, ~165.4 kB tarball, ~719.2 kB unpacked. |
| `omx explore --prompt ...` | Pass | Initially confirmed release-readiness gaps; test/lint coverage is now partially mitigated. |

---

## P0 — Critical Issues

### P0-1. `omk init` ships maintainer-local MCP defaults

**Current status:** partially mitigated in working tree. Fresh scaffold defaults are now local-only, but regression tests still need to be added before this can be called closed.

**Evidence**

- `src/commands/init.ts:450-527` embeds default MCP config.
- Several scaffolded MCP commands sourced a maintainer-local secret-loader path.
- Filesystem MCP pointed at a maintainer-local absolute home path.
- `src/commands/init.ts:658-661` writes that MCP JSON into every initialized project.

**Impact**

- New users receive maintainer-specific paths that will not exist on their machines.
- The scaffold implies a private local secret-loading convention.
- It increases trust risk because an init command should not inject opaque personal paths.

**Recommended fix**

- Replace defaults with a minimal local-only `omk-project` MCP config.
- Move optional external MCPs to explicit presets: `omk init --mcp full`, `omk mcp enable github`, etc.
- Use environment variables directly, not a maintainer-local secrets file.
- Never scaffold an absolute home path; use placeholders and docs.

**Acceptance criteria**

- Fresh `omk init` contains no maintainer-local secret-loader paths, absolute home paths, or other maintainer-specific paths.
- Optional MCP setup requires explicit user opt-in.
- Add a regression test that greps generated scaffold for forbidden local paths.

---

### P0-2. MCP config write + quality gate execution can become arbitrary command execution

**Current status:** mitigated for the known direct exploit path. `omk_run_quality_gate` now resolves quality settings to package scripts and runs them with `execFileSync(file, args)` instead of shell strings. Malicious settings such as `npm run lint && touch pwned` are blocked and covered by a regression test. `omk_write_config` is disabled by default and requires `OMK_MCP_ALLOW_WRITE_CONFIG=1` in trusted local sessions.

**Evidence**

- `src/mcp/omk-project-server.ts` exposes `omk_write_config`, but it is now env-gated by default.
- Previous implementation executed configured quality commands through `execSync(command, ...)`.
- Current implementation routes quality execution through `src/mcp/quality-gate.ts`, which normalizes settings to package scripts and blocks shell-like command strings.

**Impact**

Originally, a model/tool caller with access to `omk_write_config` and `omk_run_quality_gate` could write a malicious command into config and trigger it. The direct shell execution path is now blocked, and config writes require explicit trusted-session opt-in. A future read-only/write-capable MCP split would still make the boundary easier to reason about.

**Recommended fix**

- Split read-only and write-capable MCP servers or disable `omk_write_config` by default.
- Represent quality commands as argv arrays, not shell strings.
- Allow only package-manager script names in auto mode unless an explicit trusted config flag is set.
- Run command policy checks through the same safety engine used by hooks.

**Acceptance criteria**

- `omk_run_quality_gate` cannot execute shell metacharacters from config by default.
- Unit tests cover malicious config values such as `lint = "echo ok; touch /tmp/pwned"`.
- Docs clearly mark any arbitrary-command mode as trusted/local-only.

---

### P0-3. No real test/lint gates despite quality-gate claims

**Current status:** partially mitigated. A secret scanner exists and is wired through `npm run lint`; `npm test` uses Node's built-in test runner and includes initial quality-gate command-injection regression coverage. A real style/static lint policy is still missing.

**Evidence**

- `package.json` now defines `lint`, `check`, `test`, `secret:scan`, `build`, and publish gates.
- `test/quality-gate.test.mjs` covers the first command-injection regression path.
- CI/release workflows now run lint/check/test/build.
- A dedicated style/static lint tool is still not chosen.
- README advertises “Quality Gates” and automatic lint/typecheck/test/build verification (`README.md:53-62`).

**Impact**

- Core safety, scaffold, MCP, DAG, and CLI behavior can regress while CI remains green.
- “tests passed” claims in docs can become misleading.
- Public releases can ship broken runtime behavior as long as TypeScript compiles.

**Recommended fix**

- Start with Node’s built-in test runner to avoid a new dependency, or add a dedicated test framework after an explicit dependency decision.
- Add tests for:
  - `init` scaffold output
  - safety hooks and TS safety policy parity
  - MCP server read/write/path/quality-gate behavior
  - DAG scheduler/executor retry/deadlock behavior
  - CLI smoke commands
- Add `lint`/format policy and run it in CI.

**Acceptance criteria**

- `npm test`, `npm run lint`, `npm run check`, and `npm run build` exist and run in CI.
- CI fails on missing tests or missing lint scripts.
- At least P0 security/scaffold paths have regression tests.

---

### P0-4. Runtime claims are ahead of implementation wiring

**Evidence**

- `src/commands/run.ts:44-85` writes `goal.md`/`plan.md`, then launches interactive Kimi with a flow prompt.
- `src/commands/run.ts` does not call `createExecutor`, `createWorktree`, or the DAG scheduler.
- `src/commands/team.ts:30-60` creates/attaches a fixed tmux layout, but does not bootstrap workers with scoped prompts or worktrees.
- `src/commands/merge.ts:57-70` only checks diffs and prints manual cherry-pick guidance.
- README already marks `team`, `merge`, and `hud` as experimental/partial (`README.md:116-125`) while features section advertises live team/HUD behavior (`README.md:53-62`).

**Impact**

The product experience is still closer to “Kimi wrapper + scaffold + manual coordination” than a durable worktree-based coding team. This is fine for alpha, but not for “serious” positioning unless docs and commands are aligned.

**Recommended fix**

- Define a real run lifecycle: plan → DAG → worktree allocation → worker launch → state persistence → quality gate → merge queue.
- Make `omk run` use `createExecutor` and `createKimiTaskRunner` or intentionally rename it to `omk flow` until the DAG runtime is wired.
- Make `omk team` launch role-specific panes with assigned run IDs, worker directories, and prompts.
- Add a non-interactive smoke mode for CI.

**Acceptance criteria**

- `omk run feature-dev "..." --workers 2` creates isolated worktrees and state files.
- HUD can read live worker state from `.omk/runs/<id>/state.json`.
- Merge command can produce a deterministic merge plan with conflict status.

---

### P0-5. Global `~/.kimi` mutations are automatic and not reversible enough

**Evidence**

- `src/util/fs.ts:282-304` syncs hooks, MCP, and skills into global Kimi locations.
- `src/util/fs.ts:353-368` injects model, MCP config files, and skills directories into Kimi CLI args.
- `omk doctor` reported one warning: `Global Pollution ~/.kimi에 예상外 파일 존재 — omk --global opt-in 확인`.

**Impact**

Global mutations are powerful and useful, but they are also the highest-trust part of the tool. If they are automatic, users can lose confidence because local Kimi behavior changes outside the current repo.

**Recommended fix**

- Make global sync explicit or clearly scoped: `omk sync --global`, `omk chat --with-global-sync`.
- Add `--dry-run`, `--diff`, `--backup`, and `omk sync rollback`.
- Store a manifest of files/blocks changed by OMK.
- Keep default project execution local when possible.

**Acceptance criteria**

- Users can see exactly what will change before global sync.
- Users can rollback OMK-managed global changes.
- Doctor distinguishes OMK-managed files from unrelated user files.

---

## P1 — High-Value Improvements

### P1-1. Wire-mode tool handling is incomplete

**Evidence**

- `src/kimi/wire-client.ts:150-209` advertises external tools to Kimi.
- `src/kimi/wire-client.ts:230-254` emits server requests as events.
- `src/kimi/wire-client.ts:286-324` task runner listens for message/error/tool_result only; it does not respond to request events.
- `src/kimi/wire-client.ts:304-307` creates `childEnv` but does not use it.

**Improvement**

Implement a real tool dispatcher for `omk_claim_task`, `omk_update_task`, memory, metrics, and blockers. Add timeout/error behavior for unhandled server requests. Apply per-node env through process restart or request context.

---

### P1-2. State writes and run path helpers need one hardened implementation

**Evidence**

- `src/orchestration/state-persister.ts:34-38` writes state directly to final path.
- `src/util/run-dir.ts:5-20` joins run IDs into `.omk/runs` without the same validation used elsewhere.
- `docs/phase1-final-report.md:123-128` already lists state atomicity and path/root caching as known technical debt.

**Improvement**

Create one `safeRunId` / `safeRunPath` utility and use temp-file-then-rename atomic writes. Add tests for traversal, corrupted JSON, interrupted write, and concurrent writes.

---

### P1-3. Safety policy is duplicated and shallow

**Evidence**

- TypeScript policy is in `src/safety/guard-hooks.ts`.
- Shell hook policy is separately embedded in `.omk/hooks/*.sh` and generated by `src/commands/init.ts`.
- Secret detection is partly regex-based and partly keyword-based.

**Improvement**

Use a single policy source that can generate both TS checks and shell hook behavior. Add fixtures for allowed/blocked command examples and secret examples. Reduce false positives for docs while expanding coverage for common destructive variants.

---

### P1-4. Documentation maturity matrix is needed

**Evidence**

- README features section sells mature capabilities (`README.md:53-62`).
- README command table later marks several commands partial/stub (`README.md:116-125`).
- `docs/getting-started.md` still says `npm install -g open-multi-agent-kit`, while package name is `open-multi-agent-kit`.

**Improvement**

Add a command maturity matrix with `stable`, `alpha`, `experimental`, and `planned`. Keep README quickstart conservative and move prototypes to roadmap/dev docs.

---

### P1-5. Release workflow needs package smoke tests

**Evidence**

- `.github/workflows/release.yml` builds and publishes on any `v*` tag.
- No pack/install smoke test is run before `npm publish`.

**Improvement**

Before publish, run:

```bash
npm ci
npm run lint
npm test
npm run check
npm run build
npm pack --dry-run
node dist/cli.js --help
node dist/cli.js doctor || true  # environment-dependent, assert parseable output separately
```

Add npm provenance if compatible with the release environment.

---

## P2 — Product Polish / Scale Work

1. Add `omk doctor --json` for machine-readable CI and bug reports.
2. Add `omk hud --watch` and persist worker/test status in a stable JSON schema.
3. Add `omk issue` or templates that collect environment, Kimi version, Node version, scaffold status, and logs.
4. Add a compatibility matrix for Node 20/22/24 and Kimi CLI versions.
5. Replace ad-hoc docs with a maintained roadmap: `Now / Next / Later`.
6. Cache `getProjectRoot()` or pass root through command context to avoid repeated sync shell calls.
7. Normalize naming: docs still mix `open-multi-agent-kit`, legacy repo names, and `omk`.

---

## Suggested 2-Week Stabilization Plan

### Week 1 — Trust & Safety

- Remove maintainer-local MCP defaults from `init`.
- Harden `omk-project` MCP command execution.
- Add test runner and first P0 regression tests.
- Add lint script and CI gates.
- Document global sync behavior and add dry-run/diff mode.

### Week 2 — Runtime Reality

- Wire `omk run` to DAG executor and state files.
- Make `team` launch scoped worker commands or clearly keep it as layout-only.
- Add live HUD state reading.
- Add package smoke tests and release checklist.
- Update README command maturity and getting-started install name.

---

## Current Strengths to Preserve

- Clear CLI surface and polished UX (`src/cli.ts`, `src/util/theme.ts`).
- Useful scaffold model for AGENTS/Kimi/skills/templates.
- Existing DAG, scheduler, executor, worktree, and MCP primitives are a strong foundation.
- Doctor/HUD already provide good feedback loops.
- Package dry-run is reasonably small and includes the expected `dist` + `templates` surface.

---

## Open Questions

1. Should default MCP setup be minimal/local-only, with all remote MCPs opt-in?
2. Should this project target Kimi-only first, or maintain portable AGENTS/CLAUDE/GEMINI support as a core promise?
3. Should `omk run` be non-interactive by default for automation, with `omk chat` remaining interactive?
4. Is the serious-product target npm CLI only, or also an OMX-compatible orchestration layer?
