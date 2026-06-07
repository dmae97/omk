# Contributing to OMK

Thanks for your interest in contributing! OMK is a provider-neutral multi-agent coding runtime. Kimi is one supported provider adapter and remains the most mature authority path in this release-candidate line. We welcome bug reports, feature suggestions, documentation improvements, and code contributions.

## Quick Start

```bash
# Clone and install
git clone https://github.com/dmae97/open-multi-agent-kit.git
cd open-multi-agent-kit
npm ci

# Run the main quality gate (must pass before PR)
npm run verify

# Run release-candidate gates when touching contracts, proof, versioning, or release docs
npm run verify:no-kimi
npm run contract:check
npm run schema:check
npm run version:check
npm run proof:check
```

## Requirements

- **Node.js**: 20.x or later (tested on 20, 22, 24)
- **Git**: 2.30+
- **Platform**: Linux, macOS, Windows (all are CI-tested)

## Project Structure

| Directory | Purpose |
|-----------|---------|
| `src/cli.ts` | Commander.js CLI entrypoint |
| `src/commands/` | Command implementations |
| `src/orchestration/` | DAG executor, scheduler, ensemble runner, parallel UI |
| `src/util/` | Theme, i18n, fs helpers, session/todo sync |
| `src/goal/` | Goal spec intake, scoring, evidence, persistence |
| `src/kimi/` | Kimi adapter compatibility, capability detection, banner replacement |
| `src/mcp/` | MCP server integrations |
| `src/memory/` | Graph memory backends (local, Neo4j, Kuzu) |
| `templates/` | Project scaffolding templates |
| `test/` | Node built-in test runner (`node --test`) |

## Command Maturity

OMK commands have maturity levels. See [`MATURITY.md`](./MATURITY.md), [`docs/versioning.md`](./docs/versioning.md), and [`docs/provider-maturity.md`](./docs/provider-maturity.md) for the current matrices.

| Level | Expectations |
|-------|-------------|
| **Stable** | Full test coverage, documented, safe for production |
| **Alpha** | Basic implementation; tests/docs may be incomplete |
| **Experimental** | Early prototype; API may change without notice |

## Development Workflow

### 1. Create a branch

```bash
git checkout -b feat/your-feature-name
```

### 2. Make changes

- Follow existing TypeScript strict mode conventions
- Use design tokens from `src/util/theme.ts` for CLI output
- Add i18n keys to `src/util/i18n.ts` for new user-facing strings
- Keep changes focused

### 3. Run quality gates

All must pass:

```bash
npm run lint
npm run check
npm run build:clean
npm test
npm run secret:scan
npm run audit:package
```

For release-candidate, contract, proof, provider, or versioning changes, also run:

```bash
npm run verify:no-kimi
npm run contract:check
npm run schema:check
npm run version:check
npm run proof:check
```

Before publish/tag claims, run the full release gate:

```bash
npm run release:check
```

### 4. Commit

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(scope): add new omk command
fix(scope): resolve race condition in state writer
docs(scope): update CLI help text
test(scope): add regression test for parallel UI
chore(scope): bump dependency version
```

### 5. Open a Pull Request

- Ensure CI is green (GitHub Actions runs on Ubuntu, macOS, Windows)
- Link related issues with `Fixes #123`

## Testing

Tests use Node.js built-in test runner. Import from `../dist/...` (tests run against compiled output).

Run a single test file:

```bash
node --test test/goal.test.mjs
```

Run full suite:

```bash
node --test --test-concurrency=1 test/*.test.mjs
```

## CLI Contract Rules

When modifying commands that support `--json`:

- `--json` outputs exactly one JSON document to stdout
- No ANSI, banners, or human text in stdout when `--json` is set
- Human diagnostics go to stderr only
- Command functions must not call `process.exit`; throw `CliError` instead
- Only `src/cli.ts` adapters set `process.exitCode`

## Reporting Issues

- **Bugs**: Include reproduction steps, Node version, OS, and `omk doctor --json` output
- **Features**: Describe the use case and expected behavior
- **Security**: See [`SECURITY.md`](./SECURITY.md) for responsible disclosure

## Questions?

- Open a [Discussion](https://github.com/dmae97/open-multi-agent-kit/discussions)
- Check [`README.md`](./README.md) and [`DESIGN.md`](./DESIGN.md) for architecture context

Thank you for helping make OMK better!
