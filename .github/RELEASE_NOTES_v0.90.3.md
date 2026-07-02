# OMK v0.90.3

OMK v0.90.3 removes the jailbreak subsystem that had shipped in the 0.90.x line and fixes a CI-only visual-QA test. It is a safety and hygiene release with no new features.

## Highlights

| Area | Release note |
|------|--------------|
| Safety | Removed the cross-provider jailbreak/godmode payload toolkit: the `omk jailbreak` command, `--jailbreak-mode`/`--jailbreak-target` CLI flags, `jailbreak-extension`, `agents/jailbreak/`, `utils/jailbreak/`, `types/jailbreak.ts`, and the `fuzzing/`, `routing/`, `encoding/`, `multiturn/`, and `modules/` attack modules. This generated cross-provider godmode/parseltongue/LRL-bypass payloads and is not a legitimate OMK feature. |
| Safety | Retained defensive GOD Mode resistance in the system prompt and the context-file sanitization marker. No production code imported the removed modules. |
| Tests | The 96-column control-panel visual-QA test now runs its live-render coherence assertion unconditionally and only compares the recorded `.omo/` visual-QA artifact when it is present, so CI checkouts (where the gitignored artifact is absent) no longer fail. |

## Packages

- `open-multi-agent-kit@0.90.3`
- `omk-ai@0.90.3`
- `omk-agent-core@0.90.3`
- `omk-tui@0.90.3`

## Install

```bash
npm install -g --ignore-scripts open-multi-agent-kit@0.90.3
omk --version
```

Expected output:

```text
0.90.3
```

## Verification Surface

- `npm run check`
- `npm run release:local -- --out /tmp/omk-local-release --force`
- Node package smoke: help, version, model listing, prompt, and interactive startup
- Bun binary smoke: help, version, model listing, prompt, and interactive startup
- GitHub Actions CI on `main`
- GitHub Actions binary/publish workflow on tag `v0.90.3`
- npm registry verification for all four publishable packages
