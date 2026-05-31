# Proof bundles

Proof bundles are repo-local evidence manifests for verified OMK runs. A bundle records the exact commands, output artifacts, checksums, and known limitations needed to audit a claim without trusting narrative text.

## Layout

- `proof/verified-runs/<bundle-id>/proof-bundle.json` is the manifest.
- Command output artifacts live beside the manifest.
- `proof/PROOF_INDEX.md` is generated from manifests by `node scripts/build-proof-index.mjs`.

## Validation

Run:

```bash
npm run proof:check
```

`proof:check` fails when a bundle has missing artifacts, mismatched SHA-256 or byte counts, empty limitations, local absolute paths, secret-looking tokens, non repo-relative artifact paths, or unfinished capture markers.
