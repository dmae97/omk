# OMK claims and evidence

This document lists what OMK claims, the current status, and how to verify it. Claims are scoped to the exact adapter, command, and gate that produced them.

## Claim: OMK creates replayable run artifacts

Status: implemented.

Evidence:
- `.omk/runs/<run-id>/input-envelope.json`
- `.omk/runs/<run-id>/dag.json`
- `.omk/runs/<run-id>/dag-compile-report.json`
- loop artifacts on execution: `loop-state.json`, `loop-decisions.jsonl`

Verification:
```bash
omk do "review this repo for release risk" --dry-run --json
omk runs
```

## Claim: OMK can run without Kimi

Status: implemented and tested.

Evidence:
- package name `open-multi-agent-kit`, binary `omk`
- no-Kimi runtime routing and smoke paths

Verification:
```bash
npm run verify:no-kimi
```

## Claim: OMK blocks completion when required evidence is missing

Status: implemented.

Evidence:
- evidence-block proof bundle `proof/verified-runs/006-evidence-block/proof-bundle.json`

Verification:
```bash
npm run proof:check
```

## Claim: OMK scopes provider authority by task

Status: implemented at the routing/contract level; enforcement depends on the adapter path.

Evidence:
- read/write/shell/merge authority metadata in task contracts
- [provider maturity](provider-maturity.md)

Verification:
```bash
omk provider list
omk do "explain this repo" --dry-run --json
```

## Claim: OMK provides OS-level sandboxing

Status: not claimed. Child-env hardening and approval gates exist; OS-level sandboxing is planned.

Evidence:
- [SECURITY.md](../SECURITY.md)

## Claim: OMK is a stable 1.x release

Status: not claimed. Current source version is `0.78.9` (`pre-1.0`); `v1.2` is a runtime contract family.

Evidence:
- [versioning](versioning.md)
- release truthfulness proof `proof/verified-runs/012-release-truthfulness/proof-bundle.json`

Verification:
```bash
npm run version:check
npm run proof:check
```

## Related

- [What is OMK?](what-is-omk.md)
- [Proof index](https://github.com/dmae97/open-multi-agent-kit/blob/main/proof/PROOF_INDEX.md)
- [Provider maturity](provider-maturity.md)
