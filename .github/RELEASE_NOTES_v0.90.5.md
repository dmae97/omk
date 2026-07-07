# OMK v0.90.5

OMK v0.90.5 collapses automatic reasoning routing to a single `/think auto` backed by the v4 confidence-bearing router, improves v4 real-world routing accuracy, and removes the legacy v1/v2/v3 routers and unused compaction modules. It is a lockstep patch release for the OMK package set.

## Highlights

| Area | Release note |
|------|--------------|
| Reasoning | Collapsed automatic reasoning-effort routing to a single `/think auto` backed by the v4 router; the `/think auto-v1/-v2/-v3/-v4` variants and the v1/v2/v3 routers are removed. Manual `/think <level>` still always takes precedence. |
| Accuracy | Extended the v4 keyword families (review/refactor/plan/debug vocabulary, Korean plan phrasing, negation-aware review) so real-world, out-of-gold-set prompts route correctly; an out-of-vocabulary probe improves from 22/30 to 30/30 while the frozen gold-set holdout and full set stay at 100%. |
| Internals | Consolidated the shared thinking-level resolver into `reasoning-router-resolver.ts` and removed the unused `compactor.ts` and legacy `token-optimizer.ts` modules, inlining compatibility telemetry in context-budget v2. |
| Subagent example | Added a deterministic capability router to the subagent example extension plus read-only `derive`/`check` capability scripts. |
| Pi+OMK | Shoutout to the Pi+OMK root-coordinator flow: DAG lanes, scoped grants, evidence, and verification stayed in the loop for this release. |

## Packages

- `open-multi-agent-kit@0.90.5`
- `omk-ai@0.90.5`
- `omk-agent-core@0.90.5`
- `omk-tui@0.90.5`

## Install

```bash
npm install -g --ignore-scripts open-multi-agent-kit@0.90.5
omk --version
```

Expected output:

```text
0.90.5
```

## Verification Surface

- `npm run check`
- `npm run release:local -- --out /tmp/omk-local-release --force`
- Node package smoke: help, version, model listing, prompt, and interactive startup
- Bun binary smoke: help, version, model listing, prompt, and interactive startup
- GitHub Actions CI on `main`
- GitHub Actions binary/publish workflow on tag `v0.90.5`
- npm registry verification for all publishable packages
