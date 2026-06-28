# OMK v0.90.1

OMK v0.90.1 keeps the OMK release surface aligned with the standalone package line, the OMK//CONTROL TUI version source, autopilot automation, and the materialized context-cache optimizer work.

## Highlights

| Area | Release note |
|------|--------------|
| OMK//CONTROL TUI | The startup dashboard presents `omk v0.90.1 · OMK//CONTROL` from the package version source, keeping the release badge, README copy, and published CLI in sync. |
| Standalone packages | `open-multi-agent-kit`, `omk-ai`, `omk-agent-core`, and `omk-tui` remain lockstep through npm metadata, changelogs, shrinkwrap, and release docs. |
| Autopilot automation | Browser-use automation now has a local automation profile for repeatable operator workflows. |
| Optimizer cache reuse | Materialized context-budget v2 cache entries raise reuse for representation and plan work while keeping validation and telemetry boundaries explicit. |
| Release gates | Local release smoke tests, `npm run check`, CI, binary publishing, GitHub release creation, and npm trusted publishing remain part of the release path. |

## Packages

- `open-multi-agent-kit@0.90.1`
- `omk-ai@0.90.1`
- `omk-agent-core@0.90.1`
- `omk-tui@0.90.1`

## Install

```bash
npm install -g --ignore-scripts open-multi-agent-kit@0.90.1
omk --version
```

Expected output:

```text
0.90.1
```

## Verification Surface

- `npm run check`
- `npm run release:local -- --out /tmp/omk-local-release --force`
- Node package smoke: help, version, model listing, prompt, and interactive startup
- Bun binary smoke: help, version, model listing, prompt, and interactive startup
- GitHub Actions CI on `main`
- GitHub Actions binary/publish workflow on tag `v0.90.1`
- npm registry verification for all four publishable packages
