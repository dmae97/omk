# OMK v0.90.2

OMK v0.90.2 lands the full v0.90.2 feature set: a wider model and provider surface, the `!` skill launcher, canonical reverse-skill workflow routing, computer-use MCP preset groundwork, and stronger release-consistency gates.

## Highlights

| Area | Release note |
|------|--------------|
| Models | The `max` thinking level lands above `xhigh` (Claude Opus 4.7/4.8 expose both), Claude Sonnet 5 joins with adaptive thinking and a 1M context window, and Zyloo ships as a built-in OpenAI-compatible provider. |
| Skills | The `!` skill launcher supports `!skill:name` and `!name` turn-scoped invocation with start-of-message autocomplete while preserving `! command` and `!! command` bash shortcuts. |
| Reverse-skill | The canonical reverse-engineering workflow-routing module ships in `omk-agent-core` and is re-exported by the coding agent with a project extension for generating OMK reverse-engineering workflow skills. |
| Computer-use MCP | Preset catalogs (Playwright MCP as the default, browser-use as an optional advanced runner) and public MCP preset metadata with risk/auth policies land as groundwork modules. |
| Startup | The legacy `hooks/` deprecation warning no longer blocks interactive startup; project-level `.omk/hooks/` auto-archives to `hooks.migrated/`. |
| Release gates | Release-consistency checks cover package-backed OMK//CONTROL version display, git tag-lineage drift, and README/`RELEASE_NOTES` release-surface drift, erroring during `--release`. |

## Packages

- `open-multi-agent-kit@0.90.2`
- `omk-ai@0.90.2`
- `omk-agent-core@0.90.2`
- `omk-tui@0.90.2`

## Install

```bash
npm install -g --ignore-scripts open-multi-agent-kit@0.90.2
omk --version
```

Expected output:

```text
0.90.2
```

## Verification Surface

- `npm run check`
- `npm run release:local -- --out /tmp/omk-local-release --force`
- Node package smoke: help, version, model listing, prompt, and interactive startup
- Bun binary smoke: help, version, model listing, prompt, and interactive startup
- GitHub Actions CI on `main`
- GitHub Actions binary/publish workflow on tag `v0.90.2`
- npm registry verification for all four publishable packages
