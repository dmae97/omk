# Audit revalidation — 2026-09-17

Baseline: `1e58611d0c28775c8a066b6e913ea6710ccea396`, with unrelated local
provider/model changes present. This is a scoped local revalidation, not a release
approval, full security audit, or competitor benchmark.

## Inputs and scope

The local September 14 reproduction ZIP targets
`69e0637d8fddd26eb40a7ec3f8ebfb65b500de5b`. All 25 entries listed in its
SHA256SUMS matched. Its recorded six expected failures describe that historical
snapshot, not the current checkout. The archived runner was not executed or
substituted for current repository tests.

The September 15 strategy report combines historical findings with proposed
resource-aware scheduling, recovery, and comparative evaluation. These proposals
are not measured product benefits. The September 16 GitHub audit targets
`739bc6f3b6fe1c89bfe058aad7ec17ad252fb10e`; its missing DAG contract is no longer
present in this baseline. The documents were used to select the checks below;
not every proposed acceptance criterion was executed.

## Executed regression groups

Commands use `node ../../node_modules/vitest/dist/cli.js --run` from the named
workspace. No external provider requests were needed.

| Workspace | Test files | Result |
| --- | --- | --- |
| agent | `test/tool-dag-*.test.ts` | 83 passed, including 10,000 seeded bounded schedules |
| coding-agent | `test/mcp/{protocol,protocol-required,manager-lifecycle,manager-health,client,tools}.test.ts` | 61 passed; client tests include a local stdio fixture |
| protocol | `test/{protocol,evaluation-candidate-binding,validation,run-dag-contract,run-dag-properties}.test.ts` | 44 passed |
| coding-agent | `test/{context-budget-v2-validation-cache,context-budget-cache,context-budget-cache-policy,context-budget-v2-tier-floor,context-budget-v2-eligibility,context-budget-v2-nonfinite-tokens,context-budget-governor-v2}.test.ts` | 46 passed after the fix below |

These are 234 distinct passing test cases, not 234 independent production tasks.
An initial command included nonexistent `test/mcp/manager.test.ts`; Vitest ran
other matching files successfully. Manager coverage above comes from the actual
`manager-lifecycle`, `manager-health`, and `client` files, not that missing path.

## Fixed: input diagnostics leaked across plan-cache reuse

`planPromptContextBudgetV2()` originally decided cache eligibility before
`validateBudgetItems()`. Duplicate IDs are dropped and invalid token estimates are
recomputed. Their sanitized items can produce exactly the same plan key as valid
input, but their input diagnostics are different.

Three regressions failed before the fix:

1. A cached valid plan hid a duplicate-ID diagnostic on a later call.
2. A plan produced from duplicate IDs carried its diagnostic into a later valid call.
3. A cached plan hid the diagnostic for a recomputed non-finite token estimate.

Cache eligibility is now decided after input validation. Calls with input or
budget diagnostics neither read nor write the plan cache. Representation-cache
validation and normal valid-input plan reuse remain unchanged. The regression
uses a required item to isolate plan reuse from the existing
`cache_dependency_unsafe` rejection for plans containing representation-cache hits.

Changed implementation: `src/core/context-budget-v2-planner.ts`.
Regression: `test/context-budget-v2-validation-cache.test.ts` (3 passed).
This preserves diagnostics; it does not redesign duplicate-item handling or tier
allocation policy.

## Remaining boundaries

- Full `npm run check` has been blocked by unrelated local module-size growth in
  `agent-session.ts` and `model-registry.ts`; those files and the ratchet baseline
  are not changed by this fix. A passing focused compiler/test run does not close
  the full repository gate.
- General observation evaluation still has existential semantics. Passing
  candidate-binding tests does not establish latest-result or complete-coverage
  semantics, or independently authenticate a verifier.
- ECRAF remains an internal planner. Resource normalization, fairness, live
  admission integration, and equal-budget performance comparisons were not added.
- This pass does not validate the complete timeout/ownership fault matrix,
  verified-run crash recovery, all MCP authorization boundaries, remote CI,
  branch protection, published artifacts, or router calibration.
- No release, commit, push, paid benchmark, or new runtime default is implied.
