# FS / MCP Barrel Refactor Hygiene — 2026-06-10

## 1. Refactor Integrity Verdict

### Commands
- `npx tsc --noEmit` → **PASS** (no output, 0 errors)
- `npm run build` → **PASS** (`tsc && node scripts/chmod-dist.mjs` completed cleanly)

### Dropped Exports
**None.**

Compared `git show HEAD:src/util/fs.ts` export surface against the new `src/util/fs.ts` barrel + `src/util/fs/*.ts` modules using line-level export matching (`comm -23`). No export lines from the old monolith are missing in the new modules. Key verified surfaces:

| Old export | New location |
|---|---|
| `export async function collectMcpConfigs` | `src/util/fs/mcp-diagnose.ts` |
| `export async function injectKimiGlobals` | `src/util/fs/kimi-sync.ts` |
| `export async function preflightRuntimeMcpServers` | `src/util/fs/preflight.ts` |
| `export async function pruneRuntimeMcpServers` | `src/util/fs/mcp-diagnose.ts` |
| `export function getProjectRoot` | `src/util/fs/paths.ts` |
| `export { resolveProjectRoot, resolveProjectRootAsync, ... }` | `src/util/fs/paths.ts` |
| `export { validateRunId, sanitizeRunId, ... }` | `src/util/fs/paths.ts` |

Similarly, `src/commands/mcp.ts` barrel re-exports everything the old monolith exported (verified with `comm -23` — no missing exports).

## 2. Broken Test Fix

### Failing test
`test/omk-no-args-hud.test.mjs` — "keeps root runtime discovery on OMK and portable agent paths"

### Root cause
The test used `sliceFunction(fsSource, "export async function collectMcpConfigs", "async function readMcpServersForRuntime")` on `dist/util/fs.js`. After the barrel refactor, `dist/util/fs.js` is a pure re-export barrel; `collectMcpConfigs` now lives in `dist/util/fs/mcp-diagnose.js`, and `readMcpServersForRuntime` lives in `dist/util/fs/mcp-runtime-config.js`, so both the start and end needles were missing from the old file.

### Fix applied (minimal)
Replaced the string-slicing assertion with a direct read of the new module file, preserving the intent that `.omk` and `.kimi` paths appear in the MCP config collection logic.

```diff
-    const fsSource = readFileSync(DIST_FS, "utf-8");
-    const collectMcpSource = sliceFunction(fsSource, "export async function collectMcpConfigs", "async function readMcpServersForRuntime");
-    assert.match(collectMcpSource, /\.omk/);
-    assert.match(collectMcpSource, /\.kimi/);
+    const fsMcpDiagnoseSource = readFileSync(
+      join(process.cwd(), "dist", "util", "fs", "mcp-diagnose.js"),
+      "utf-8"
+    );
+    assert.match(fsMcpDiagnoseSource, /\.omk/);
+    assert.match(fsMcpDiagnoseSource, /\.kimi/);
```

Rationale: `mcp-diagnose.js` contains only `collectMcpConfigs` and `diagnoseRuntimeMcpServer`; `.omk` and `.kimi` appear exclusively inside `collectMcpConfigs`, so a file-level match is semantically equivalent to the old function-level slice.

## 3. Test Results

| Test file | Result |
|---|---|
| `test/omk-no-args-hud.test.mjs` | 5 pass, 0 fail |
| `test/orchestration.test.mjs` | 69 pass, 0 fail |
| `test/logo-image-path.test.mjs` | 2 pass, 0 fail |
| `test/cli-json-contract.test.mjs` | 26 pass, 0 fail |

Total: **102 pass, 0 fail**

## 4. Lint Results

- `npx eslint test/omk-no-args-hud.test.mjs` → ignored by eslint ignore pattern (warning only, 0 errors). No code changes to linted source files were required.

## 5. Exact File List for Root Commit (`refactor(util)`)

Files already in the working tree that belong to this slice:
```
src/util/fs.ts
src/util/fs/core.ts
src/util/fs/internal.ts
src/util/fs/kimi-sync.ts
src/util/fs/logo.ts
src/util/fs/manifest.ts
src/util/fs/mcp-diagnose.ts
src/util/fs/mcp-runtime-config.ts
src/util/fs/paths.ts
src/util/fs/preflight.ts
src/commands/mcp.ts
src/commands/mcp/config.ts
src/commands/mcp/doctor.ts
src/commands/mcp/doctor-fix.ts
src/commands/mcp/list.ts
src/commands/mcp/test.ts
test/omk-no-args-hud.test.mjs
```

## 6. Remaining Risk

- **Low.** The barrel re-export surface is identical to the old monolith; all direct consumers (`orchestration.test.mjs`, `logo-image-path.test.mjs`, `cli-json-contract.test.mjs`) pass.
- **Minor residual:** `test/omk-no-args-hud.test.mjs` still relies on dist-file string inspection rather than runtime behavior. If `collectMcpConfigs` moves again (e.g., into a different submodule), this assertion will break. A future hardening step could replace the grep with a behavioral test that mocks `pathExists` and asserts the returned config paths contain both `.omk` and `.kimi` entries.
- **No risk to production code:** tsc and build are clean; no runtime logic was changed, only file organization.
