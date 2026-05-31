# Versioning

OMK uses two version fields in release artifacts:

| Field | Current value | Source | Meaning |
| --- | --- | --- | --- |
| Package version | `1.2.0-rc.0` | `package.json`, `package-lock.json` | npm/package release candidate version. |
| Runtime version | `v1.2` | `src/version.ts`, JSON schemas | Contract/runtime family used by OMK envelopes. |
| Release channel | `rc` | `src/version.ts` | Release candidate channel; not a GA claim. |

`v1.2.0-rc.0` is the package release candidate for the `v1.2` runtime contract family.
Do not describe it as a stable `v1.2` release until the release gates pass and a final tag/package is published.

## Contract versions

Current source declares these machine-readable contracts:

- `omk.contract.v1`
- `omk.evidence.v1`
- `omk.decision.v1`
- `omk.run-manifest.v1`
- `omk.provider.v1`
- `omk.version.v1`
- `omk.proof-bundle.v1`

The JSON schemas live in `schemas/` and are checked by `npm run schema:check`.

## Commands

Check package, lockfile, source constants, and schema version constants:

```bash
npm run version:check
```

After building, inspect the runtime version envelope:

```bash
npm run build:clean
node dist/cli.js version --json
```

The `version --json` command emits one `omk.contract.v1` envelope whose data payload uses `omk.version.v1`.

## Documentation rules

- Use `v1.2.0-rc.0` when referring to the current package source version.
- Use `v1.2 RC` when referring to the release-candidate milestone or runtime-family work.
- Use `v1.2` only for the runtime contract family or future stable milestone.
- Keep historical changelog entries unchanged unless the text is not clearly historical.
- Include the release-candidate limitation when writing README, roadmap, maturity, or issue-template copy.
