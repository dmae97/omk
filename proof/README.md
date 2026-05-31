# Proof bundles

Proof bundles are repo-local evidence manifests for verified OMK runs. A bundle records the exact commands, output artifacts, checksums, and known limitations needed to audit a claim without trusting narrative text.

## Layout

- `proof/verified-runs/<bundle-id>/proof-bundle.json` is the manifest.
- Command output artifacts live beside the manifest.
- `sha256sums.txt` records the SHA-256 of each referenced artifact except itself.
- `proof/PROOF_INDEX.md` is generated from manifests by `node scripts/build-proof-index.mjs`.

## Validation

Run:

```bash
npm run proof:check
```

`proof:check` fails when a bundle has missing or unreferenced artifacts, mismatched manifest or `sha256sums.txt` hashes, empty limitations, local absolute paths, secret-looking tokens, non repo-relative artifact paths, unfinished capture markers, fabricated-placeholder markers, invalid evidence/decision JSONL records, or broken runId/commit/version/evidence/decision references.
