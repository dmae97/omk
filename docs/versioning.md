# Versioning

OMK uses two version fields in release artifacts:

| Field | Current value | Source | Meaning |
| --- | --- | --- | --- |
| Package version | `0.78.9` | `package.json`, `package-lock.json` | npm/package source version. |
| Runtime version | `v1.2` | `src/version.ts`, JSON schemas | Contract/runtime family used by OMK envelopes. |
| Release channel | `pre-1.0` | `src/version.ts` | Pre-1.0 package channel. |

`0.78.9` is the package source version for the `v1.2` runtime contract family.
Use `v1.2` only for runtime contracts; do not substitute it for the package version.

## Contract versions

Current source declares these machine-readable contracts:

- `omk.contract.v1`
- `omk.command.v1`
- `omk.evidence.v1`
- `omk.evidence-bundle.v1`
- `omk.decision.v1`
- `omk.run-manifest.v1`
- `omk.provider.v1`
- `omk.version.v1`
- `omk.proof-bundle.v1`

The JSON schemas live in `schemas/` and are checked by `npm run schema:check`.

`omk.command.v1` is the automation-facing command envelope for new CI/agent integrations. `omk.contract.v1` remains the established CLI JSON envelope for existing commands while command outputs migrate incrementally. To inspect the new envelope without breaking existing automation, run `node dist/cli.js version --json --command-envelope` after `npm run build:clean`.

Runtime event logs are standardized as `.omk/runs/<runId>/events.ndjson`. OMK also mirrors `.omk/runs/<runId>/events.jsonl` for compatibility with existing replay/read tooling during the migration window.

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

- Use `0.78.9` when referring to the current package source version.
- Use `v1.2` only for the runtime contract family.
- Keep historical changelog entries unchanged unless the text is not clearly historical.
