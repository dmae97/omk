# Review: Slash Commands + Cockpit HUD Enhancement

Date: 2026-06-10
Reviewer: omk-code-review / omk-security-review / omk-frontend-ui-review / omk-evidence-contract
Scope: READ-ONLY review — no edits performed

---

## Verdict Summary

| Lane | Verdict | Critical Blockers |
|------|---------|-------------------|
| SLASH Commands | **APPROVE-WITH-NITS** | 0 |
| CONTROL HUD | **APPROVE-WITH-NITS** | 0 |

**Overall: APPROVE-WITH-NITS** — No MUST-FIX items. Two minor nits documented below. Safe to merge after author discretion.

---

## Evidence Checked

| Check | Status | Evidence |
|-------|--------|----------|
| Tests pass | ✅ | `node --test test/slash-commands-status.test.mjs` → 9/9 pass |
| Tests pass | ✅ | `node --test test/cockpit-render-core.test.mjs` → 14/14 pass |
| Build clean | ✅ | `npm run build` → 0 errors |
| No secret leaks | ✅ | Manual audit of `/provider`, `/mcp`, `/trace` payloads |
| No `any` types | ✅ | No `any` in diff; `unknown[]` used instead |
| No raw hex/SGR | ✅ | New HUD code uses `style.*` semantic tokens only |
| Determinism | ✅ | No `Date.now()`/`Math.random()` in new formatters |
| No deleted tests | ✅ | Only additions to `test/cockpit-render-core.test.mjs` |
| No scope creep | ✅ | Changes confined to named files |

---

## SLASH Commands Findings

### ✅ PASS — Registration & Help
All six commands (`/mcp`, `/provider`, `/headroom`, `/tools`, `/memory`, `/trace`) are registered in `defaultHandlers` and `registerSlashCommands()`. Each appears in `/help` output with a one-line description.

### ✅ PASS — Read-Only Status Results
Every new handler returns `kind: "status"` with `sideEffects: []`. No mutation handlers introduced.

### ✅ PASS — Secret Leak Audit (CRITICAL)
- **`/provider`** (`src/runtime/slash-commands.ts:460-496`): Payload emits only `provider`, `model`, `available` (boolean), and `authPresent` (boolean). No API keys, tokens, or connection strings are printed. ✅
- **`/mcp`** (`src/runtime/slash-commands.ts:436-458`): Payload emits `name`, `status` (ok/degraded/down), and `active` (boolean). No secrets. ✅
- **`/trace`** (`src/runtime/slash-commands.ts:593-621`): Uses `redactTrace()` when `privacy.level === "l0"` or `!privacy.consentGiven`. Consent-aware redaction respected. ✅

### ✅ PASS — No Non-Deterministic Output
All slash command payloads derive from synchronous/registry/memory data. No wall-clock or random values.

### ⚠️ NIT — Arg Parsing vs. `stringValue` Mismatch
**File:** `src/runtime/slash-commands.ts`  
New handlers parse `input.args` directly (e.g. `input.args.join(" ")`, `Number(input.args[0])`), while the verification contract states "Arg parsing uses stringValue."  
**Impact:** None functional. `stringValue` is designed for `Record<string, unknown>` payload rendering (which IS used correctly in `renderSlashResultContent`), not for `string[]` arg parsing. Existing handlers (`/model`, `/theme`) also use direct `input.args` access.  
**Recommendation:** Update verification contract wording to "Payload rendering uses typed value helpers" or accept the existing pattern.

### ⚠️ NIT — Silent Error Swallowing
**File:** `src/runtime/slash-commands.ts`  
Three defensive `.catch(() => undefined)` patterns swallow errors silently:
1. `getActiveRuntimePreset().catch(() => undefined)` — `ToolsCommandHandler:519`
2. `providerDoctorStatus(...).catch(() => undefined)` — `ProviderCommandHandler:473`
3. `readFile(...).catch(() => "{}")` — `MemoryCommandHandler:564`
**Impact:** Low. Failures degrade gracefully (empty preset, omitted provider, zero node count).  
**Recommendation:** Consider logging a one-line warning at `DEBUG` level so failures are discoverable without breaking the status render.

---

## CONTROL HUD Findings

### ✅ PASS — Semantic Theme Tokens
All new cockpit formatters use `style.*` tokens (`style.mint`, `style.red`, `style.orange`, `style.gray`, `style.pinkBold`, `style.cream`, `healthColor()`). No raw hex literals or SGR escape sequences introduced. `color:gate` would pass.

### ✅ PASS — Determinism
`formatMcpHealth`, `formatEvidenceGate`, and `buildTeamRuntimeLines` use only pre-collected snapshot data (`resources`, `vm.workers`, `vm.teamRuntime`). No `Date.now()`, `Math.random()`, or other non-deterministic sources beyond the existing `elapsed` duration pattern.

### ✅ PASS — MCP Health Uses Pre-Collected Data
`formatMcpHealth` receives `resources: CockpitResourceSnapshot | null` from the existing `getCockpitResources` pipeline. No live network probes in the render path. ✅

### ✅ PASS — Responsive Width & Budget
- `formatMcpHealth` truncates with `truncateLine(result, maxWidth)`.
- `formatEvidenceGate` truncates the tally line and the latest verification detail.
- `buildTeamRuntimeLines` truncates each line to `maxWidth`.
- Budget allocator adds `evidenceBudget` alongside existing budgets; emergency shrink chain updated. New fixture test asserts correct rendering at width=100.

### ⚠️ NIT — Section Order Interpretation
**File:** `src/commands/cockpit/render.ts:910-915`  
The `activePanels` push order is now: `Run` → `Resources` → `Evidence` → `Workers & TODO` → `Changes & History`.  
Pre-existing relative order (`Run` < `Workers & TODO` < `Changes & History`) is maintained, but `Workers & TODO` shifts from panel #2 to panel #4 because new panels are inserted before it.  
**Impact:** Visual. The rendered frame in the impl doc shows this new order explicitly, so it appears intentional.  
**Recommendation:** If strict "no existing section position changes" is required, move `Resources` and `Evidence` after `Workers & TODO`. Otherwise, accept as-is.

---

## Cross-Cutting Findings

### ✅ PASS — No `any` Types
No `any` introduced in the diff. `MemoryCommandHandler` uses `JSON.parse(raw) as { nodes?: unknown[]; edges?: unknown[]; updatedAt?: string }` — a constrained type assertion with `unknown[]`, not `any[]`.

### ✅ PASS — No Deleted or Weakened Tests
- `test/cockpit-render-core.test.mjs`: 1 new test added (14 total), 0 removed, 0 weakened.
- `test/slash-commands-status.test.mjs`: 9 new tests, all passing.

### ✅ PASS — No Scope Creep
Changes are confined to:
- `src/runtime/slash-commands.ts`
- `src/commands/cockpit/render.ts`
- `test/cockpit-render-core.test.mjs`
- `test/slash-commands-status.test.mjs`

No modifications to ignored files (`src/providers/*`, `CLAUDE.md`, `AGENTS.md`, etc.).

---

## Merge Recommendation

**RECOMMEND MERGE** after author addresses nits at their discretion. No MUST-FIX blockers. No security regressions. No determinism violations.
