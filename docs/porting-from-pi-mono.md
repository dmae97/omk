# Porting From pi-mono: A Practical Merge Guide

This guide is a repeatable checklist for porting changes from pi-mono into this repo.
Use it for any merge: single file, feature branch, or full release sync.

## Last Sync Point

**Commit:** `6730b4fa`
**Date:** January 2026

When starting a new sync, generate patches from this commit forward:

```bash
git format-patch 6730b4fa..HEAD --stdout > changes.patch
```

## 0) Define the scope

- Identify the upstream reference (commit, tag, or PR).
- List the packages or folders you plan to touch.
- Decide which features are in-scope and which are intentionally skipped.

## 1) Bring code over safely

- Prefer a clean, focused diff rather than a wholesale copy.
- Avoid copying built artifacts or generated files.
- If upstream added new files, add them explicitly and review contents.

## 2) Remove `.js` from imports

We use a bundler and strip `.js` from TypeScript imports.

- Remove `.js` extensions from all internal imports.
- Keep real file extensions only when required by tooling (e.g., `.json`, `.css`).
- Example:
  - `import { x } from "./foo.js";` -> `import { x } from "./foo";`

## 3) Replace import scopes

Upstream uses different package scopes. Replace them consistently.

- Replace old scopes with the local scope used here.
- Examples (adjust to match the actual packages you are porting):
  - `@mariozechner/pi-coding-agent` -> `@oh-my-pi/pi-coding-agent`
  - `@mariozechner/pi-agent-core` -> `@oh-my-pi/pi-agent-core`
  - `@mariozechner/tui` -> `@oh-my-pi/pi-tui`

## 4) Use Bun APIs where they improve on Node

We run on Bun. Replace Node APIs only when Bun provides a better alternative.

**DO replace:**

- Process spawning: `child_process.spawn` → `Bun.spawn` / `Bun.spawnSync`
- File I/O: `fs.readFileSync` → `Bun.file().text()` / `Bun.write()`
- HTTP clients: `node-fetch`, `axios` → native `fetch`
- Crypto hashing: `node:crypto` → Web Crypto or `Bun.hash`
- SQLite: `better-sqlite3` → `bun:sqlite`
- Env loading: `dotenv` → Bun loads `.env` automatically

**DO NOT replace (these work fine in Bun):**

- `os.homedir()` — do NOT replace with `process.env.HOME`, `Bun.env.HOME`, or literal `"~"`
- `os.tmpdir()` — do NOT replace with `Bun.env.TMPDIR || "/tmp"` or hardcoded paths
- `fs.mkdtempSync()` — do NOT replace with manual path construction
- `path.join()`, `path.resolve()`, etc. — these are fine

**Import style:** Use `node:` prefix for Node builtins (`import { homedir } from "node:os"`).

**Wrong:**

```typescript
// BROKEN: env vars may be undefined, "~" is not expanded
const home = process.env.HOME || Bun.env.HOME || "~";
const tmp = Bun.env.TMPDIR || "/tmp";
```

**Correct:**

```typescript
import { homedir, tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";

const configDir = join(homedir(), ".config", "myapp");
const tempDir = mkdtempSync(join(tmpdir(), "myapp-"));
```

## 5) Prefer Bun embeds (no copying)

Do not copy runtime assets or vendor files at build time.

- If upstream copies assets into a dist folder, replace with Bun-friendly embeds.
- Use `import.meta.dir` + `Bun.file` to load adjacent resources.
- Keep assets in-repo and let the bundler include them.
- Eliminate copy scripts unless the user explicitly requests them.
- If upstream reads a bundled fallback file at runtime, replace filesystem reads with a Bun text embed import.
  - Example (Codex instructions fallback):
    - `const FALLBACK_PROMPT_PATH = join(import.meta.dir, "codex-instructions.md");` -> removed
    - `import FALLBACK_INSTRUCTIONS from "./codex-instructions.md" with { type: "text" };`
    - Use `return FALLBACK_INSTRUCTIONS;` instead of `readFileSync(FALLBACK_PROMPT_PATH, "utf8")`

## 6) Port `package.json` carefully

Treat `package.json` as a contract. Merge intentionally.

- Keep existing `name`, `version`, `type`, `exports`, and `bin` unless the port requires changes.
- Replace npm/node scripts with Bun equivalents (e.g., `bun run`, `bun test`).
- Ensure dependencies use the correct scope.
- Do not downgrade dependencies to fix type errors; upgrade instead.
- Validate workspace package links and `peerDependencies`.

## 7) Align code style and tooling

- Keep existing formatting conventions.
- Do not introduce `any` unless required.
- Avoid dynamic imports and inline type imports.
- Prefer existing helpers and utilities over new ad-hoc code.
- Preserve Bun-first infrastructure changes already made in this repo:
  - Runtime is Bun (no Node entry points).
  - Package manager is Bun (no npm lockfiles).
  - Heavy Node APIs (`child_process`, `readline`) are replaced with Bun equivalents.
  - Lightweight Node APIs (`os.homedir`, `os.tmpdir`, `fs.mkdtempSync`, `path.*`) are kept.
  - CLI shebangs use `bun` (not `node`, not `tsx`).
  - Packages use source files directly (no TypeScript build step).
  - CI workflows run Bun for install/check/test.

## 8) Remove old compatibility layers

Unless requested, remove upstream compatibility shims.

- Delete old APIs that were replaced.
- Update all call sites to the new API directly.
- Do not keep `*_v2` or parallel versions.

## 9) Update docs and references

- Replace pi-mono repo links where appropriate.
- Update examples to use Bun and correct package scopes.
- Ensure README instructions still match the current repo behavior.

## 10) Validate the port

Run the standard checks after changes:

- `bun run check`

If the repo already has failing checks unrelated to your changes, call that out.
Tests use Bun's runner (not Vitest), but only run `bun test` when explicitly requested.

## 11) Protect improved features (regression trap list)

If you already improved behavior locally, treat those as **non‑negotiable**. Before porting, write down
the improvements and add explicit checks so they don’t get lost in the merge.

- **Freeze the expected behavior**: add a short “before/after” note for each improvement (inputs, outputs,
  defaults, edge cases). This prevents silent rollback.
- **Map old → new APIs**: if upstream renamed concepts (hooks → extensions, custom tools → tools, etc.),
  ensure every old entry point still wires through. One missed flag or export equals lost functionality.
- **Verify exports**: check `package.json` `exports`, public types, and barrel files. Upstream ports often
  forget to re-export local additions.
- **Cover non‑happy paths**: if you fixed error handling, timeouts, or fallback logic, add a test or at
  least a manual checklist that exercises those paths.
- **Check defaults and config merge order**: improvements often live in defaults. Confirm new defaults
  didn’t revert (e.g., new config precedence, disabled features, tool lists).
- **Audit env/shell behavior**: if you fixed execution or sandboxing, verify the new path still uses your
  sanitized env and does not reintroduce alias/function overrides.
- **Re-run targeted samples**: keep a minimal set of “known good” examples and run them after the port
  (CLI flags, extension registration, tool execution).

## 11) Detect and handle reworked code

Before porting a file, check if upstream significantly refactored it:

```bash
# Compare the file you're about to port against what you have locally
git diff HEAD upstream/main -- path/to/file.ts
```

If the diff shows the file was **reworked** (not just patched):

- New abstractions, renamed concepts, merged modules, changed data flow

Then you must **read the new implementation thoroughly** before porting. Blind merging of reworked code loses functionality because:

Note: interactive mode was recently split into controllers/utils/types. When backporting related changes, port updates into the individual files we created and ensure `interactive-mode.ts` wiring stays in sync.

1. **Defaults change silently** - A new variable `defaultFoo = [a, b]` may replace an old `getAllFoo()` that returned `[a, b, c, d, e]`.

2. **API options get dropped** - When systems merge (e.g., `hooks` + `customTools` → `extensions`), old options may not wire through to the new implementation.

3. **Code paths go stale** - A renamed concept (e.g., `hookMessage` → `custom`) needs updates in every switch statement, type guard, and handler—not just the definition.

4. **Context/capabilities shrink** - Old APIs may have exposed `{ logger, typebox, pi }` that new APIs forgot to include.

### Semantic porting process

When upstream reworked a module:

1. **Read the old implementation** - Understand what it did, what options it accepted, what it exposed.

2. **Read the new implementation** - Understand the new abstractions and how they map to old behavior.

3. **Verify feature parity** - For each capability in the old code, confirm the new code preserves it or explicitly removes it.

4. **Grep for stragglers** - Search for old names/concepts that may have been missed in switch statements, handlers, UI components.

5. **Test the boundaries** - CLI flags, SDK options, event handlers, default values—these are where regressions hide.

### Quick checks

```bash
# Find all uses of an old concept that may need updating
rg "oldConceptName" --type ts

# Compare default values between versions
git show upstream/main:path/to/file.ts | rg "default|DEFAULT"

# Check if all enum/union values have handlers
rg "case \"" path/to/file.ts
```

## 12) Quick audit checklist

Use this as a final pass before you finish:

- [ ] No `.js` import extensions in TS files
- [ ] No Node-only APIs in new/ported code
- [ ] All package scopes updated
- [ ] `package.json` scripts use Bun
- [ ] Assets load via Bun embed patterns (no copy scripts)
- [ ] Tests or checks run (or explicitly noted as blocked)
- [ ] No functionality regressions (see section 11)

## 13) Intentional Divergences

Our fork has architectural decisions that differ from upstream. **Do not port these upstream patterns:**

### UI Architecture

| Upstream                                    | Our Fork                    | Reason                                              |
| ------------------------------------------- | --------------------------- | --------------------------------------------------- |
| `FooterDataProvider` class                  | `StatusLineComponent`       | Simpler, integrated status line                     |
| `ctx.ui.setHeader()` / `ctx.ui.setFooter()` | Removed                     | Not implemented; StatusLineComponent handles status |
| `ctx.ui.setEditorComponent()`               | Removed                     | Not implemented                                     |
| `InteractiveModeOptions` interface          | Positional constructor args | Existing pattern works fine                         |

### Component Naming

| Upstream                     | Our Fork                |
| ---------------------------- | ----------------------- |
| `extension-input.ts`         | `hook-input.ts`         |
| `extension-selector.ts`      | `hook-selector.ts`      |
| `ExtensionInputComponent`    | `HookInputComponent`    |
| `ExtensionSelectorComponent` | `HookSelectorComponent` |

### File Consolidation

| Upstream                              | Our Fork                 | Reason                                |
| ------------------------------------- | ------------------------ | ------------------------------------- |
| `clipboard.ts` + `clipboard-image.ts` | `clipboard.ts` only      | Merged with Bun-native implementation |
| `@mariozechner/clipboard` dependency  | Native platform commands | No external dependency needed         |

### Test Framework

| Upstream                  | Our Fork                      |
| ------------------------- | ----------------------------- |
| `vitest` with `vi.mock()` | `bun:test` with `vi` from bun |
| `node:test` assertions    | `expect()` matchers           |

### Tool Architecture

| Upstream                            | Our Fork                                  |
| ----------------------------------- | ----------------------------------------- |
| `createTool(cwd: string, options?)` | `createTool(session: ToolSession)`        |
| Per-tool `*Operations` interfaces   | Unified `FileOperations` in `ToolSession` |
| Node.js `fs/promises`               | Bun APIs (`Bun.file()`, `Bun.write()`)    |

### Auth Storage

| Upstream                       | Our Fork                                    |
| ------------------------------ | ------------------------------------------- |
| `proper-lockfile` library      | Native `O_EXCL` atomic file locking         |
| Single credential per provider | Multi-credential with round-robin selection |

### Extensions

| Upstream                      | Our Fork                                   |
| ----------------------------- | ------------------------------------------ |
| `jiti` for TypeScript loading | Native Bun `import()`                      |
| `pkg.pi` manifest field       | `pkg.omp ?? pkg.pi` (prefer our namespace) |

### Skip These Upstream Features

When porting, **skip** these files/features entirely:

- `footer-data-provider.ts` — we use StatusLineComponent
- `clipboard-image.ts` — merged into clipboard.ts
- `compaction-extensions.test.ts` — different test architecture
- GitHub workflow files — we have our own CI
- `models.generated.ts` — auto-generated, regenerate locally

### Features We Added (Preserve These)

These exist in our fork but not upstream. **Never overwrite:**

- `StatusLineComponent` in interactive mode
- Multi-credential auth with session affinity
- Capability-based discovery system (`loadSync`, `skillCapability`, etc.)
- Voice mode integration
- MCP/Exa/SSH integrations
- LSP writethrough for format-on-save
- Bash interception (`checkBashInterception`)
- Fuzzy path suggestions in read tool
