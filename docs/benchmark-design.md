# OMK Control Plane Replay Benchmark Design

## 1. Purpose

Design a reproducible benchmark suite that measures OMK control plane
performance across 10 representative task categories. The benchmark runs in
**shadow mode** (recorded traces, no live LLM calls) for baseline
reproducibility, with optional **live-evaluation mode** for regression
testing against real providers.

## 2. Task Categories

| # | Category | Intent | Description |
|---|----------|--------|-------------|
| 1 | read-only repo Q&A | research | Agent answers questions about codebase structure |
| 2 | small bug fix | debugging | Single-file typo / logic fix |
| 3 | failing test repair | debugging | Update implementation to satisfy failing test |
| 4 | multi-file refactor | refactor | Rename/move symbols across 3+ files |
| 5 | CLI command task | shell-operation | Execute and verify CLI output |
| 6 | dependency update | coding | Bump package version, fix breaking changes |
| 7 | merge-conflict task | merge | Resolve git merge conflict automatically |
| 8 | security-sensitive task | review | Patch vulnerability with audit trail |
| 9 | provider failure fallback | debugging | Primary provider fails; fallback succeeds |
| 10 | quota/auth failure fallback | debugging | Quota/auth error triggers provider switch |

## 3. Metrics

| Metric | Definition | Source |
|--------|-----------|--------|
| solve_rate | passed_tasks / total_tasks | harness result |
| evidence_trust_score | ETS v2 score per task | evidence-trust-score engine |
| false_done_rate | tasks claiming success with failing evidence / total | harness+ETS |
| fallback_success_rate | fallback attempts that succeed / total fallback attempts | router decision trace |
| router_regret | best_available_runtime_score − selected_runtime_score | shadow-mode diff |
| cost_per_solved_task | Σ costUsdEstimated / solved_count | attempt records |
| p95_latency | 95th percentile of task latencyMs | attempt records |
| rollback_rate | tasks rolled back / total tasks | decision trace |
| sandbox_violation_count | tasks with unexpected file writes outside worktree | sandbox audit |

**router_regret** is computed in shadow mode by scoring all candidates for
every decision and comparing the selected runtime’s composite against the
maximum composite.

## 4. Reproducibility Contract

Every benchmark run must pin:
- **treeHash**: git commit SHA of the repo under test
- **seed**: PRNG seed for synthetic fixture generation
- **providerConfigHash**: hash of the runtime provider configuration
- **omkVersion**: package version
- **benchmarkSchemaVersion**: `omk.benchmark.v1`

Shadow-mode runs use pre-recorded `BenchmarkTrace` fixtures (see
`src/benchmark/fixtures.ts`). Live-evaluation mode records new traces into
`.omk/benchmarks/<runId>/`.

## 5. Shadow Mode

Shadow mode runs router v1 and v2 side-by-side on identical inputs:
1. Load a `BenchmarkTask` fixture.
2. Run `createRuntimeRouter` (v1) and `createRouterV2ScoringEngine` (v2).
3. Record both decisions into `ShadowModeRecord`.
4. Compute `router_regret` for each.
5. Diff v1/v2 selections and log disagreements.

No LLM API calls are made. Runtime `runNode` is replaced with a stub that
returns the recorded outcome from the fixture.

## 6. Benchmark Harness Lifecycle

```
loadConfig() → discoverTasks() → for each task:
  setupWorktree() → runTask() → evaluateEvidence() → teardown()
→ computeSummary() → writeJsonReport()
```

The harness integrates with `scripts/run-tests.mjs` via:
```bash
node scripts/run-benchmark.mjs --shadow --summary-json .omk/benchmarks/latest.json
```

## 7. CI Integration

A new `benchmark` job runs after `fast-gate` passes on `main` branch merges
and nightly cron. It:
1. Checks out the repo at the merge commit.
2. Runs `npm run benchmark:shadow`.
3. Uploads `.omk/benchmarks/latest.json` as artifact.
4. Fails if `solve_rate < 0.85` or `false_done_rate > 0.05`.

## 8. Directory Layout

```
src/benchmark/
  contracts.ts      # BenchmarkTask, BenchmarkResult, BenchmarkSummary
  harness.ts        # runBenchmarkSuite(), runBenchmarkTask()
  shadow-mode.ts    # ShadowModeEngine, computeRouterRegret()
  fixtures.ts       # generateSyntheticTraces(), loadRecordedTraces()
scripts/
  run-benchmark.mjs # CLI entrypoint
test/
  benchmark-harness.test.mjs
.omk/benchmarks/
  sample-run.json   # example output
```

## 9. Extending the Benchmark

To add a new task category:
1. Add intent mapping in `src/benchmark/fixtures.ts`.
2. Create a fixture under `test/benchmark-fixtures/`.
3. Add an evaluation rule in `src/benchmark/harness.ts`.
4. Register the category in `scripts/run-benchmark.mjs`.

## 10. Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Fixture drift (codebase changes) | Pin treeHash; auto-regenerate fixtures in CI if drift detected |
| Shadow mode not representative of live behavior | Weekly live-evaluation job with small sample |
| Metrics gaming (fake evidence) | ETS v2 gaming penalty + runner-source requirement |
| Secret leakage in recorded traces | Redact with `redactTrace()` before persistence |
