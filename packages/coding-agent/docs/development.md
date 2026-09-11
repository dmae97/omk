# Development

See [AGENTS.md](https://github.com/dmae97/omk/blob/main/AGENTS.md) for additional guidelines.

## Setup

```bash
git clone https://github.com/dmae97/omk
cd omk
npm install
npm run build
```

Run from source:

```bash
/path/to/omk/omk-test.sh
```

The script can be run from any directory. OMK keeps the caller's current working directory.

## Forking / Rebranding

Configure via `package.json`:

```json
{
  "omkConfig": {
    "name": "omk",
    "configDir": ".omk"
  }
}
```

Change `name`, `configDir`, and `bin` field for your fork. Affects CLI banner, config paths, and environment variable names.

## Path Resolution

Three execution modes: npm install, standalone binary, tsx from source.

**Always use `src/config.ts`** for package assets:

```typescript
import { getPackageDir, getThemeDir } from "./config.js";
```

Never use `__dirname` directly for package assets.

## Debug Command

`/debug` (hidden) writes to `~/.omk/agent/omk-debug.log`:

- Rendered TUI lines with ANSI codes
- Last messages sent to the LLM

## Testing

```bash
./test.sh                         # Run the non-LLM suite when a full run is intended
# Narrow, offline regression from the repository root:
LIVE_E2E=0 node node_modules/vitest/dist/cli.js --run packages/coding-agent/test/adaptorch-onboarding.test.ts
```

The root `vitest.config.ts` delegates to each package's Vitest project. This
preserves package-local setup files and source aliases; a root invocation must
not silently test stale `dist` dependencies. The coding-agent project resolves
`omk-adaptorch-wpl` to its source entrypoint during tests.

Package-local targeted commands continue to work, for example from
`packages/coding-agent`:

```bash
LIVE_E2E=0 node ../../node_modules/vitest/dist/cli.js --run test/adaptorch-onboarding.test.ts
```

Keep explicit file filters for routine work. A keyless regression pass is not a
live-provider or release verification, and unfiltered suites may include e2e tests.

## Commit checks

The pre-commit hook validates the working tree without changing the selected
index. It never auto-stages checker edits or unstaged hunks. If a checker changes
the index, the hook fails and asks you to review the selection again; it does not
restore or discard those changes. The checks still run against the working tree,
not an isolated staged snapshot, so review partially staged changes separately.

Hook regression: `node --test scripts/test/pre-commit-index.test.mjs`.

## Project Structure

```
packages/
  ai/           # LLM provider abstraction
  agent/        # Agent loop and message types  
  tui/          # Terminal UI components
  coding-agent/ # CLI and interactive mode
```
