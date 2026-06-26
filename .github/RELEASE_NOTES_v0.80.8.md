# OMK v0.80.8

OMK v0.80.8 is the hard-fork release that aligns the CLI, TUI, package metadata, release pipeline, and docs around the OMK identity.

## Highlights

| Area | Release note |
|------|--------------|
| OMK//CONTROL TUI | The startup dashboard now presents `omk v0.80.8 · OMK//CONTROL` from the package version source, with the Night City Ops control layout for route, evidence, loop, MCP, runtime, skills, and context state. |
| OMK-only package identity | Active Pi-era naming was removed from current package metadata, runtime defaults, docs, and user-facing release surfaces. |
| MCP policy inventory | MCP tools, resources, prompts, sampling, and auth are surfaced as deterministic capability metadata with fail-closed trust boundaries. |
| Hooks policy | Hook metadata now models stages, effects, fail-closed failure mode, and bounded timeout policy without executing hook scripts during inventory. |
| Skill provenance | Skill discovery keeps source, scope, origin, path, and collision diagnostics while hiding raw skill contents from default startup. |
| Harness algorithms | Context headroom, compaction, token budget, and tool execution evidence flows were tightened with focused regression coverage. |
| Release gates | Lockstep package versions, shrinkwrap verification, local release smoke tests, CI checks, GitHub release notes, and npm publish validation are documented in the release path. |

## Packages

- `open-multi-agent-kit@0.80.8`
- `@earendil-works/omk-ai@0.80.8`
- `@earendil-works/omk-agent-core@0.80.8`
- `@earendil-works/omk-tui@0.80.8`

## Install

```bash
npm install -g --ignore-scripts open-multi-agent-kit@0.80.8
omk --version
```

Expected output:

```text
0.80.8
```

## Verification Surface

- `npm run check`
- `npm run build`
- `npm run release:local`
- TUI startup smoke via `tmux`
- GitHub Actions CI and binary/publish workflow on tag `v0.80.8`
- npm registry verification for all four publishable packages
