# Offline memory factorial experiment

## Scope and design

Implement the briefing's selected 2×2 experiment only: independent/dependent episodes × memory off/on. The operator selected offline execution. This is a synthetic observability and isolation check using OMK's real source-quote store and V2 selector, not an LLM benchmark, SCM/PESCO implementation, or reproduction of the paper's results.

Primary source checked on 2026-10-08: [Persistent Memory in Multi-Agent LLM Inference](https://arxiv.org/html/2610.07782v1), sections 4 and 5. C1 requires proving the memory path ran; C2 requires independent stores; C3 requires the same solver/parser and counterbalanced order; C4 requires repeated runs. The paper's abstract reports +0.015 accuracy with 95% CI [-0.011, +0.046]; this does not establish no memory effect in dependent sessions.

Each scored episode starts in its own private temporary workspace, writes a prior-session source fact, then reopens the actual `VerifiedMemoryStore`. Independent questions receive their own current evidence; dependent questions can answer only from the previous session's fact. The same rule-based solver sees the question, current evidence and selected source quotes, never the gold label, source files or stored records. Memory off performs no writes or recalls. Memory on admits only records registered to that episode and an earlier session, frozen at evaluation start. Newly written, current-session, future-session and foreign-episode records are excluded. Workspaces are removed in `finally` and no user store is reset.

Default size: 100 paired episodes, seeds 42/43/44, four cells, 1,200 scored evaluations. Seeds deterministically change fixture facts; they are not stochastic model repetitions. Every memory pair shares fixture, seed, solver, parser and budget, and differs only in the memory flag. Memory order alternates across paired episodes and seeds.

Record success, actual write/retrieve/selection calls, selected/relevant recall counts, recall reachability, estimated evaluation input/output/total tokens, equivalent evaluation-call footprint and elapsed time. Peak KV bytes remain `null`: neither a model KV geometry nor accelerator telemetry exists in this offline run. Token estimates are not billed provider usage. Report per-seed success rates and within-regime paired deltas; do not attach inferential significance or a confidence interval to deterministic fixture output.

Token totals cover only the serialized evaluation input and parsed answer. No setup solver call occurs, so generated source facts and an imagined setup response are not charged as executed work. The equivalent-call token footprint is a modeled quantity, not an observed provider call or billed cost.

## Implementation plan

Use `programming`, `tdd-workflow`, `security-review`, `statistical-analysis`, `code-review-and-quality`, `adaptorch-route` and `adaptorch-benchmark` only for their matching tasks. Parent performs implementation; bounded read-only children inspect memory isolation and AdaptOrch APIs.

1. Create `test/memory-factorial.test.ts`. Run it before implementation. Test the missing API, all four cells, actual reopened storage, provenance/future/current/foreign filtering, zero budget, malformed size/seeds, paired input identity, deterministic reruns and cleanup after failure.
2. Create `scripts/memory-factorial.ts` and `scripts/memory-factorial-cli.ts` under `packages/coding-agent`. Reuse `VerifiedMemoryStore`, `memoryContextPair`, and the fallback token counter. Add no dependency, runtime setting, SDK export or production memory change.
3. Run the same focused Vitest file and CLI for the default 100×3×4 run. Save full JSON results in a new output directory, refuse overwrites, and keep results outside tracked files.
4. Use the current local AdaptOrch `TaskDAG`/`TopologyRouter` for advisory routing and `CommandVerifier` for the exact test and CLI commands. Bind local receipts to source hashes, actual exits and the AdaptOrch revision. No AdaptOrch provider, synthesis or MCP run is requested.
5. Run primary LSP diagnostics, required `npm run check`, and session `lens_diagnostics mode=all`. Preserve and report unrelated worktree failures without modifying their files. Commit, push, full build and full Vitest are not requested.

## Acceptance

- Default CLI produces exactly 1,200 rows and all four cells, with three distinct seeds.
- Dependent off cannot recover a hidden prior fact; dependent on can through the actual stored tool-pair injection. Independent success is not contingent on memory.
- On/off serialized base inputs are identical; memory execution order is counterbalanced.
- Late, current, future and foreign records cannot enter the solver. Zero budget cannot be counted as successful recall.
- Records and workspaces remain isolated and cleanup runs even after admission failure.
- Missing KV telemetry and deterministic fixture limitations are explicit. AdaptOrch command success is not a correctness proof.

Visual companion: not applicable, no UI decision. Design approved through the execution-scope selection. The initial experiment request did not authorize a commit.


## Run from this checkout

```bash
node --import ./node_modules/tsx/dist/loader.mjs \
  packages/coding-agent/scripts/memory-factorial-cli.ts \
  --tasks 100 --seeds 42,43,44

cd packages/coding-agent
node ../../node_modules/vitest/dist/cli.js --run \
  test/memory-factorial.test.ts test/verified-memory-store.test.ts \
  --maxWorkers=2 --minWorkers=1
```

The CLI prints the path to `results.json` in a new private temporary report directory. `--out /path/to/new-directory` is optional and refuses an existing directory. `--memory-budget 0` exercises a reachable-but-not-injected control; the maximum is 2,048 estimated tokens. Task count is bounded to 1–1,000, and 3–10 distinct nonnegative integer seeds are required. Reports include selected module hashes checked before and after execution; these are not a complete transitive source-tree attestation. Record and workspace UUIDs, token envelope prices and timings need not be byte-identical across runs.

The primary path is the script in this checkout, not the installed CLI or currently running TUI. There is no new slash command, SDK export, memory opt-in or production policy change.

## Local AdaptOrch verification

The validation run uses an existing local AdaptOrch checkout and its Python environment, without installing or copying it into OMK. The native background delegate could not resolve `pi`; two separate OMK print-mode children instead loaded the matching skills and used a `read`-only tool allowlist. These are model-assisted API/protocol reviews, not the offline benchmark's solver. Their reviews identified source revalidation, pre-selection ID filtering, explicit V2 injection, counterbalanced pairing and command-cache disabling.

`TaskDAG`/`TopologyRouter` advised `hierarchical` with width 2, structural depth 4 and six nodes. The actual schedule keeps independent reviews separate, implements in the parent, executes focused tests and the experiment, then reviews evidence. Routing alone does not dispatch work.

`CommandVerifier.verify_candidate` executes the exact focused Vitest and script commands, with `cache_results=False`, `inherit_environment=False`, a 180-second command timeout in the final run and explicit resource limits. Receipts capture command exits, timeouts, source hashes and repository revisions. The verifier's `isolated` mode is resource-limited process execution, not filesystem or network isolation. These are approved trusted repository checks. No AdaptOrch synthesis, remote MCP, production run, Full50 status or release authorization is implied.


## Verification environment and known failures

Direct Vitest startup on the original WSL `v9fs` checkout exceeded 120 seconds, and coverage startup exceeded 150 seconds. The same source copied to a task-owned Linux-filesystem snapshot executed the regression tests. The snapshot uses existing Linux dependencies with an identical lockfile; no dependency installation or original-tree replacement occurs. Verification receipts compare all relevant package source files plus test, script and compiler configuration hashes before execution and recheck the original source afterward.

The first resource-limited AdaptOrch run failed during WebAssembly initialization. The final check keeps the 16 GiB virtual-address-space cap and uses Node's `--disable-wasm-trap-handler` to retain inline WebAssembly bounds checks while reducing guard-region address reservations. This is not an accelerator-memory limit or a filesystem/network sandbox.

A later public-CLI failure was traced to a 2,416 ms host wall-clock rollback: the source hash and quote still matched, no revocation existed, but the record's creation timestamp was ahead of `Date.now()`. `waitForClock` is experiment-only, waits for the real clock for at most five monotonic seconds before recall, and records `clockWaitMs`. It never substitutes the clock, edits timestamps, retries invalid source data, or bypasses the production store's future/expiry/revocation checks. A clock that does not catch up still fails the run.

`npm run check` ran but stopped at three unrelated `scripts/test/neo-built-cli.test.mjs` process-start timeouts. Continuing the remaining gates separately found an unrelated link in `docs/context-files.md` to uncommitted `project-context.md`; release-surface scanning later exceeded its time budget. The original TypeScript compiler completed successfully. None of those existing files or protection rules was changed. Repository-wide green status is therefore not established even when focused experiment checks pass.


## Observed final evidence

- OMK revision: `571c80ffdc4ce0346d25f5aa655446dc55e857f1`; AdaptOrch revision: `8a88696fcbf2696095e443babe323298751ad5ac`.
- Task-owned Linux snapshot: `/tmp/omk-memory-factorial-snapshot-cLILpI`.
- AdaptOrch receipt: `/tmp/omk-memory-factorial-accepted-ae3h5tou/verification.json`.
- Experiment data: `/tmp/omk-memory-factorial-accepted-ae3h5tou/experiment/results.json`.
- Both verification commands exited 0. All 54 targeted tests passed; the actual CLI completed 1,200 evaluations. Source matching covered 994 files and the original source remained unchanged during verification.
- Coverage is scoped to the three new experiment scripts: 96.85% lines/statements, 91.2% branches, 100% functions. It is not repository-wide coverage.
- Original-checkout `tsgo --noEmit`, focused LSP, explicit Biome checks of all four TypeScript files and `git diff --check` passed. Full `npm run check` did not pass for the unrelated failures above.

| Regime | Memory | Evaluations | Synthetic success | Estimated evaluation tokens | Equivalent peak tokens |
| --- | --- | ---: | ---: | ---: | ---: |
| Independent | off | 300 | 100% | 16,500 | 55 |
| Independent | on | 300 | 100% | 129,300 | 431 |
| Dependent | off | 300 | 0% | 12,900 | 43 |
| Dependent | on | 300 | 100% | 126,300 | 421 |

The paired success delta is 0 for independent fixtures and 1 for dependent fixtures. Memory-on executed 300 write, retrieve and selection calls per regime; reachability, injection and fixture-defined relevance were all 1. These ceiling results are intentionally constructed positive/negative controls, not empirical estimates of realistic memory efficacy. No confidence interval or significance is claimed. KV bytes are `null` in every row.

The run spent 18,874 ms waiting for the actual clock across episodes; those waits remain included in elapsed time. Token prices are fallback estimates of the complete evaluation envelope, including synthetic host tool metadata, not provider usage or execution-time cost. Temporary evidence is local and may be deleted by OS cleanup. No commit, push, build, deployment or TUI reload was performed.
