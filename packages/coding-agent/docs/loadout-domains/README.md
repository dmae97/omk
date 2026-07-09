# Domain Loadout Router

OMK routes incoming tasks to a **domain capability profile** ("inherited document") before dispatch. Each profile is a curated bundle of skills, MCP servers, hooks, a tool gate, an authority, and a detailed English routing prompt — all selected from the live capability inventory. The router is deterministic, I/O-free, and explainable.

> Auto-generated from `src/core/domain-loadouts.ts` + `src/core/domain-router.ts`. Regenerate with `node --import tsx scripts/gen-domain-docs.mjs`.

## How routing works

1. **Signal extraction.** The task text (plus optional path hints and upstream tags) is lowercased and scored against every domain's triggers.
2. **Weighted multi-signal scoring.**
   - `keyword` — literal phrase occurrences (counted, capped at 3) × weight.
   - `regex` — intent cluster tested once against the task text × weight.
   - `extension` — file suffix on any path hint × weight.
   - `path` — path fragment contained in any path hint × weight.
3. **Ranking.** Domains are sorted best-first; ties break by registry order (deterministic).
4. **Confidence.**
   - top score ≥ **8** → `confident`
   - **4** ≤ top score < 8 → `tentative`
   - top score < 4 (or zero signals) → `fallback` to [`general`](general.md)
5. **Ambiguity.** When the runner-up is within **2** of a tentative leader, the result is flagged `ambiguous` (the leader still wins; the caller can ask for clarification).

Thresholds: `STRONG_THRESHOLD = 8`, `WEAK_THRESHOLD = 4`, `AMBIGUITY_MARGIN = 2`.

## Domains (13 + 1 fallback)

- [`frontend-ui`](frontend-ui.md) — Frontend & UI
- [`visual-qa`](visual-qa.md) — Visual QA & Website Cloning
- [`korean-document`](korean-document.md) — Korean Document (HWP/HWPX)
- [`backend-api`](backend-api.md) — Backend & API
- [`data-science`](data-science.md) — Data Science & Analysis
- [`security-audit`](security-audit.md) — Security Audit
- [`devops-infra`](devops-infra.md) — DevOps & Infrastructure
- [`research`](research.md) — Research & Investigation
- [`mobile`](mobile.md) — Mobile (iOS / Android / KMP)
- [`docs-writing`](docs-writing.md) — Docs & Technical Writing
- [`qa-testing`](qa-testing.md) — QA & Testing
- [`grok-harness`](grok-harness.md) — Grok xAI Harness
- [`ai-agent-ops`](ai-agent-ops.md) — AI Agent Engineering & Ops
- [`general`](general.md) — General (fallback)

## Worked examples

| task | path hints | routed to | confidence | reason |
|---|---|---|---|---|
| `build a responsive login form with tailwind` | `src/app/page.tsx` | [`frontend-ui`](frontend-ui.md) | confident | Frontend & UI selected (20) |
| `scan for xss and sql injection vulnerabilities` | — | [`security-audit`](security-audit.md) | confident | Security Audit selected (19) |
| `do a literature review on RLHF, cite arxiv` | — | [`research`](research.md) | confident | Research & Investigation selected (17) |
| `write a dockerfile and deploy to vercel` | `Dockerfile` | [`devops-infra`](devops-infra.md) | confident | DevOps & Infrastructure selected (19) |
| `fix the failing playwright e2e tests` | `tests/login.test.ts` | [`qa-testing`](qa-testing.md) | confident | QA & Testing selected (28) |
| `add a postgres migration for the users table` | — | [`backend-api`](backend-api.md) | confident | Backend & API selected (11) |
| `train a classifier on the dataset, plot results` | `notebooks/model.ipynb` | [`data-science`](data-science.md) | confident | Data Science & Analysis selected (22) |
| `hello there` | — | [`general`](general.md) | fallback | no domain signals detected |

## Composition with role loadouts

A domain profile is a `LoadoutProfile`, so it composes with the existing role-based system (`BUILTIN_LOADOUTS`: inspect / plan / code / test / review / security / package-maintainer). The domain gates **which** skills/MCP/hooks are active; the role sets authority/tools/commands. Use `domainLoadoutProfiles()` to get plain profiles consumable by `applyLoadoutProfile()`.

## API

```ts
import { routeDomain } from "./core/domain-router.ts";
const result = routeDomain({ task: "build a login form", paths: ["page.tsx"] });
// result.primary   -> DomainProfile
// result.confidence -> "confident" | "tentative" | "fallback"
// result.scores    -> ranked DomainScore[] with matchedSignals
// result.ambiguous -> boolean
```

## Adding a domain

1. Add a new entry to `DOMAIN_PROFILES` in `src/core/domain-loadouts.ts` (id, label, authority, tools, curated skills/mcp/hooks, triggers, routingPrompt).
2. The router and docs pick it up automatically — no other code changes.
3. Run `npm run check` (biome + tsgo + tests) and regenerate docs.
