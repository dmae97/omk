# Lane DOCS-HYGIENE — Verification Report & Commit Plan

Generated: 2026-06-10
Scope: docs reorg verification, ignore-file hygiene, junk quarantine, AGENTS.md/README.md diff classification, ordered commit plan.

---

## 1. Docs-Move Verification Table

| Root file (deleted) | docs/ counterpart | Status | Intentional diff? |
|---------------------|-------------------|--------|-------------------|
| `ARCHITECTURE_ANALYSIS_CODEGRAPH.md` | `docs/ARCHITECTURE_ANALYSIS_CODEGRAPH.md` | ✅ exists | Yes — single hunk: path reference `OMK_CLI_V2_RUNTIME_ARCHITECTURE.md` → `docs/OMK_CLI_V2_RUNTIME_ARCHITECTURE.md` (line 104). Otherwise identical (223 lines). |
| `codex-oauth-setup.md` | `docs/codex-oauth-setup.md` | ✅ exists | Yes — substantial rewrite: Korean → English, added `omk openai setup` section, added Security principles section. Also tracked as `M` in git status (was already in docs/; the root copy is the one being deleted). |
| `headroom-omk-final-summary.md` | `docs/headroom-omk-final-summary.md` | ✅ exists | Yes — single hunk: internal path references updated to `docs/headroom-omk-*.md` (lines 150–153). Otherwise identical. |
| `headroom-omk-integration.md` | `docs/headroom-omk-integration.md` | ✅ exists | ✅ identical (clean move, no diff) |
| `headroom-omk-setup-guide.md` | `docs/headroom-omk-setup-guide.md` | ✅ exists | ✅ identical (clean move, no diff) |
| `headroom-omk-usage-examples.md` | `docs/headroom-omk-usage-examples.md` | ✅ exists | ✅ identical (clean move, no diff) |
| `OMK_CLI_V2_RUNTIME_ARCHITECTURE.md` | `docs/OMK_CLI_V2_RUNTIME_ARCHITECTURE.md` | ✅ exists | Yes — two hunks: (1) repo name `dmae97/oh-my-kimi` → `dmae97/open-multi-agent-kit` (line 5); (2) trailing newline added at EOF. Content otherwise preserved (2058 lines). |
| `AGENTS.md.test` | `docs/AGENTS.md.test` | ❌ **MISSING** | N/A — this was an 11-byte test file containing only `hello world`. No docs/ counterpart. **Content loss is acceptable** (no production value). Last commit: `1553d6f feat(runtime): align OMK CLI v2 harness surfaces`. |

**Content-loss flag:** `OMK_CLI_V2_RUNTIME_ARCHITECTURE.md` content is **NOT lost** — it lives in `docs/OMK_CLI_V2_RUNTIME_ARCHITECTURE.md` with two trivial edits. `AGENTS.md.test` content is lost but is junk (11-byte test artifact).

---

## 2. Ignore-File Diff Summary + .gitignore Addition

### .gitattributes
```diff
+# Hand-written extension templates; exclude from linguist language stats
+templates/web-bridge/chrome-extension/** linguist-vendored
```
**Workstream:** Git-history-bloat mitigation (interim). Supports the decision in `docs/decisions/2026-06-10-git-history-bloat.md`.

### .gitignore
```diff
+# Deploy-Exclusion Guard (Lane 1): re-ignore persona stack even under templates/.
+templates/.kimi/SOUL.md
+templates/.kimi/JAILBREAK.md
+templates/.kimi/soul.md
+templates/.kimi/jailbreak.md
+templates/.omk/prompts/soul.md
+templates/.omk/prompts/jailbreak.md
+templates/.omk/agents/roles/unrestricted-orchestrator.yaml
+templates/**/*SOUL*.md
+templates/**/*JAILBREAK*
```
**Workstream:** Persona-stack deploy exclusion (Lane 1). Prevents ENI/SOUL/JAILBREAK persona artifacts from being tracked even under the `templates/` negation rules.

**Added by this hygiene lane:**
```diff
+# Proof raw artifacts (future dumps only; existing tracked proof evidence is unaffected until separately archived/untracked)
+proof/theme-check/
 proof/**/*.out
```
**Rationale:** `proof/theme-check/` is generated output from `npm run theme:check` (script: `scripts/theme-check.mjs --out proof/theme-check`). Regenerated every run. `git ls-files proof/theme-check` returned empty — not tracked in history. Safe to ignore.

### .npmignore
```diff
+# Deploy-Exclusion Guard (Lane 1): belt-and-suspenders persona exclusions.
+SOUL.md
+JAILBREAK.md
+soul.md
+jailbreak.md
+unrestricted-orchestrator.yaml
+persona-manifest.json
+**/SOUL.md
+**/JAILBREAK.md
+**/soul.md
+**/jailbreak.md
+**/unrestricted-orchestrator.yaml
+**/persona-manifest.json
```
**Workstream:** Same persona-stack deploy exclusion, mirrored for npm tarball publishing.

### .dockerignore (new, untracked)
Content:
- Excludes `.git`, `node_modules`
- Excludes OMK/Kimi runtime local state (`.kimi/`, `.omk/`, `.pi/`, `.omx/`)
- Excludes persona stack filenames anywhere (`**/SOUL.md`, `**/JAILBREAK.md`, etc.)
- Excludes build caches (`dist/`, `coverage/`, `.nyc_output/`, `*.log`)
**Workstream:** Docker build-context hygiene + persona deploy exclusion.

---

## 3. Junk Quarantine Manifest

### What moved
| File | From | To |
|------|------|-----|
| `failed-tests.txt` | root | `.omk/quarantine-2026-06-10/failed-tests.txt` |
| `test-summary.json` | root | `.omk/quarantine-2026-06-10/test-summary.json` |
| `scripts/web_research_jailbreak.py` | `scripts/` | `.omk/quarantine-2026-06-10/web_research_jailbreak.py` |
| `scripts/web_research_v2.py` | `scripts/` | `.omk/quarantine-2026-06-10/web_research_v2.py` |
| `scripts/web_research_v3.py` | `scripts/` | `.omk/quarantine-2026-06-10/web_research_v3.py` |
| `scripts/fetch_targets.py` | `scripts/` | `.omk/quarantine-2026-06-10/fetch_targets.py` |
| `scripts/fetch_key_articles.py` | `scripts/` | `.omk/quarantine-2026-06-10/fetch_key_articles.py` |
| `scripts/fetch_final_pass.py` | `scripts/` | `.omk/quarantine-2026-06-10/fetch_final_pass.py` |
| `scripts/extract_findings.py` | `scripts/` | `.omk/quarantine-2026-06-10/extract_findings.py` |

### What stayed and why
- `scripts/verify-no-persona.mjs` — **Stayed in `scripts/`**. This is an actively referenced script (`package.json` adds `"verify:no-persona": "node scripts/verify-no-persona.mjs"` and wires it into `release:check`, `release:full`, `release:rc`). It is NOT junk.
- `schemas/omk.weights.v1.json` — **Stayed in root**. New schema contract referenced by `src/runtime/weights-config.ts` and `src/cli/release-promotion-gate.ts`. Part of the weights-config workstream, not docs hygiene.
- `src/commands/mcp/` and `src/util/fs/` — **Stayed in place**. These are untracked source directories part of a concurrent refactor workstream (MCP command split + fs utilities). Out of scope for docs hygiene.
- `test/weights-config.test.mjs` — **Stayed in place**. Part of weights-config workstream.

### Verification
- `grep -rn <script_name> package.json .github/ scripts/*.mjs src/` → no hits for any of the 7 `.py` files.
- `git ls-files -- <file>` → no tracked entries for any quarantined file.
- `head` of `failed-tests.txt` → list of failing test paths (`test/cockpit-render.test.mjs`, etc.).
- `head` of `test-summary.json` → `{"schemaVersion":1,"ok":false,"testDir":"test",...}` — transient test summary.

Restore commands are recorded in `.omk/quarantine-2026-06-10/MANIFEST.md`.

---

## 4. AGENTS.md / README.md Hunk Classification

### AGENTS.md (1 hunk, 13-line diff)
```diff
- Architecture doc: `OMK_CLI_V2_RUNTIME_ARCHITECTURE.md` (2058 lines), ~85% implemented.
+ Architecture doc: `docs/OMK_CLI_V2_RUNTIME_ARCHITECTURE.md` (2058 lines), ~85% implemented.
```
**Workstream:** Docs reorg — path update to reflect the moved architecture document. **Does NOT contradict committed theme work.** It is a necessary consistency fix.

### README.md (1 hunk, 21-line diff)
```diff
+### Native safety binary (crates/omk-safety)
+
+OMK ships a small, intentional Rust safety probe (725 LOC) rather than relying on JS-only checks:
+
+- Built by `npm run native:build` ...
+- Self-tested at build time ...
+- Packed into the npm tarball ...
+- Pure-TypeScript fallback lives in `src/util/native-safety.ts` ...
+- The crate is `publish = false` ... See [crates/omk-safety/README.md](crates/omk-safety/README.md).
```
**Workstream:** Rust/native-safety lane documentation. Adds a README section describing the `crates/omk-safety` probe. **Does NOT contradict committed theme work.** It is orthogonal (safety binary vs. theme system).

---

## 5. Ordered Commit Plan (Conventional Commits)

### Commit 1: `chore(hygiene): quarantine transient outputs and unreferenced research scripts`
```
D  failed-tests.txt
D  test-summary.json
D  scripts/web_research_jailbreak.py
D  scripts/web_research_v2.py
D  scripts/web_research_v3.py
D  scripts/fetch_targets.py
D  scripts/fetch_key_articles.py
D  scripts/fetch_final_pass.py
D  scripts/extract_findings.py
A  .omk/quarantine-2026-06-10/MANIFEST.md
```
**Note:** The `D` entries represent files that were never tracked in git (`??` in status), so they have no git history to delete. The practical effect is simply ensuring they are not accidentally `git add`-ed. The MANIFEST.md is the only actual addition.

### Commit 2: `chore(gitignore): add proof/theme-check/ and persona deploy-exclusion guards`
```
M  .gitattributes
M  .gitignore
M  .npmignore
A  .dockerignore
```
**Rationale:** Bundles all ignore-file changes. `.dockerignore` is new; the others are modified.

### Commit 3: `docs(reorg): move root markdown into docs/ with path-reference fixes`
```
D  ARCHITECTURE_ANALYSIS_CODEGRAPH.md
A  docs/ARCHITECTURE_ANALYSIS_CODEGRAPH.md
D  codex-oauth-setup.md
M  docs/codex-oauth-setup.md
D  headroom-omk-final-summary.md
A  docs/headroom-omk-final-summary.md
D  headroom-omk-integration.md
A  docs/headroom-omk-integration.md
D  headroom-omk-setup-guide.md
A  docs/headroom-omk-setup-guide.md
D  headroom-omk-usage-examples.md
A  docs/headroom-omk-usage-examples.md
D  OMK_CLI_V2_RUNTIME_ARCHITECTURE.md
A  docs/OMK_CLI_V2_RUNTIME_ARCHITECTURE.md
D  AGENTS.md.test
```
**Rationale:** Groups all docs moves/deletions. `docs/codex-oauth-setup.md` is `M` because it already existed in docs/ and received content updates during this workstream; the root copy is deleted.

**Content-loss check:** `OMK_CLI_V2_RUNTIME_ARCHITECTURE.md` content is preserved in `docs/OMK_CLI_V2_RUNTIME_ARCHITECTURE.md`. `AGENTS.md.test` is intentionally dropped (11-byte test artifact).

### Commit 4: `docs(decisions): add git-history-bloat decision record`
```
A  docs/decisions/2026-06-10-git-history-bloat.md
```
**Rationale:** Standalone decision record; logically separate from the reorg commit.

### Commit 5: `docs(readme): document native safety binary (crates/omk-safety)`
```
M  README.md
A  crates/omk-safety/README.md
```
**Rationale:** README hunk + the crate README it links to. Orthogonal to theme work.

### Commit 6: `docs(agents): update architecture doc path in AGENTS.md`
```
M  AGENTS.md
```
**Rationale:** Single-hunk consistency fix.

### Commit 7: `test(rename): move model-tabs test to canonical test/ directory`
```
D  tests/model-tabs.test.ts
A  test/model-tabs.test.ts
```
**Rationale:** Rename pair; content is identical.

### Commit 8: `chore(proof): add phase0 and rust-lane evidence directories`
```
A  proof/phase0-2026-06-10/recon.md
A  proof/rust-lane-2026-06-10/adr-draft-no-native-lane.md
A  proof/rust-lane-2026-06-10/benchmark-shadow-stdout.txt
A  proof/rust-lane-2026-06-10/cpuprofile/
A  proof/rust-lane-2026-06-10/cpuprofile-analysis.txt
A  proof/rust-lane-2026-06-10/kill-execution/
A  proof/rust-lane-2026-06-10/native-turn-stdout.txt
A  proof/rust-lane-2026-06-10/phase0-baseline.md
A  proof/rust-lane-2026-06-10/phase0-recon-lanes.md
A  proof/rust-lane-2026-06-10/r2-gate-table.md
A  proof/rust-lane-2026-06-10/ts-throughput-bench.txt
```
**Rationale:** Adds the untracked proof directories. These are evidence artifacts from prior lanes.

---

## 6. UNSAFE-to-Commit Items

| Item | Risk | Mitigation / Action |
|------|------|---------------------|
| `.omk/quarantine-2026-06-10/` | `.omk/` is already gitignored; committing the MANIFEST.md inside it requires an explicit `git add -f` or path override. If committed, it is safe but slightly odd to have a tracked file inside an ignored directory. | **Recommendation:** Either move `MANIFEST.md` to `docs/quarantine-manifest-2026-06-10.md` (safe path), or explicitly `git add -f .omk/quarantine-2026-06-10/MANIFEST.md`. |
| `docs/codex-oauth-setup.md` rewrite | The docs/ version was substantially rewritten (Korean→English + new sections). If this rewrite happened in a separate workstream (e.g., i18n or docs-release), bundling it into the reorg commit conflates two concerns. | **Flag:** The `M` on `docs/codex-oauth-setup.md` suggests it was edited before or during this workstream. Verify the rewrite is intentional and reviewed before committing. |
| `proof/theme-2026-06-10/` | This directory contains evidence from the theme lane and is currently untracked. If it is added later as part of a theme acceptance commit, adding it here would be premature. | **Flag:** The user's scope explicitly lists `proof/theme-2026-06-10/` as part of the commit plan in some form, but the directory already contains many files. Only `hygiene-docs-plan.md` (this file) is newly written by this lane. The rest are prior artifacts. **Do NOT bulk-add the entire `proof/theme-2026-06-10/` directory** unless the theme lane explicitly requests it. |
| `src/`, `schemas/`, `test/weights-config.test.mjs` modifications | The weights-config workstream (`src/cli/release-promotion-gate.ts`, `src/runtime/weights-config.ts`, `schemas/omk.weights.v1.json`, etc.) is uncommitted and out of scope. Committing it alongside docs hygiene would mix workstreams. | **Exclude from this commit plan.** These belong to a separate `feat(weights)` or `refactor(gate)` commit. |

---

## 7. Verification Checklist

- [x] All deleted root `.md` files verified against `docs/` counterparts.
- [x] `OMK_CLI_V2_RUNTIME_ARCHITECTURE.md` content preserved in `docs/` (minor edits noted).
- [x] `AGENTS.md.test` confirmed as deletion without counterpart (intentional — 11-byte junk).
- [x] `proof/theme-check/` added to `.gitignore`.
- [x] `git ls-files proof/theme-check` confirmed empty before addition.
- [x] 7 unreferenced `.py` scripts confirmed unreferenced in tracked build/runtime surfaces.
- [x] `failed-tests.txt` + `test-summary.json` confirmed transient ( inspected heads).
- [x] Junk moved to `.omk/quarantine-2026-06-10/` (mv only, no rm).
- [x] Quarantine manifest written to `.omk/quarantine-2026-06-10/MANIFEST.md`.
- [x] AGENTS.md and README.md hunks classified; no contradiction with theme work found.
