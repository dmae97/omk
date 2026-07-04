# OMK v0.90.4

OMK v0.90.4 ships the opt-in reasoning-router line through v4, OMK hub-aware `!omk` routing, safer vendored skill checks, and a cleaner OMK//CONTROL runtime status surface. It is a lockstep patch release for the OMK package set.

## Highlights

| Area | Release note |
|------|--------------|
| Reasoning | Added `/think auto-v2`, `/think auto-v3`, and `/think auto-v4` as opt-in router generations while keeping `/think auto` on the stable v1 classifier. v4 adds confidence metadata, bounded negation, compound-intent handling, Korean task-signal coverage, and privacy-safe learning/advisory hooks. |
| OMK routing | Added `!omk` bang-launcher routing for OMK role hubs such as frontend, backend, loop, plan, security, workspace, and docs; `!omk` no longer falls through to bash. |
| Skills | Vendors a reviewed `clone-website` skill and six Ponytail markdown skills with dependency checks while keeping unsafe/heavy external runtimes out of the integration path. |
| TUI | Adds `!omk` autocomplete when the OMK hub index is available. |
| Runtime status | OMK//CONTROL now reports stable MCP counts, excludes hub-only routing skills from the visible skill total, and shows the detected installed Headroom version. |
| AdaptOrch | Adaptorch WPL adjudication now carries structured `reason_code` values and deterministic retry-backoff groundwork. |
| Pi+OMK | Shoutout to the Pi+OMK root-coordinator flow: DAG lanes, scoped grants, evidence, and verification stayed in the loop for this release. |

## Packages

- `open-multi-agent-kit@0.90.4`
- `omk-ai@0.90.4`
- `omk-agent-core@0.90.4`
- `omk-tui@0.90.4`

## Install

```bash
npm install -g --ignore-scripts open-multi-agent-kit@0.90.4
omk --version
```

Expected output:

```text
0.90.4
```

## Verification Surface

- `npm run check`
- `npm run release:local -- --out /tmp/omk-local-release --force`
- Node package smoke: help, version, model listing, prompt, and interactive startup
- Bun binary smoke: help, version, model listing, prompt, and interactive startup
- GitHub Actions CI on `main`
- GitHub Actions binary/publish workflow on tag `v0.90.4`
- npm registry verification for all publishable packages
