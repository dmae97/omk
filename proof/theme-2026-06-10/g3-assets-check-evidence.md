# Lane G3-ASSETS-CHECK — asset provenance drift gate evidence

Date: 2026-06-10
Scope: read-only provenance drift gate for the 5 theme-derived SVG assets, wired into CI.

## Files changed

- `scripts/assets-check.mjs` (new) — pure read-only verifier (Node ESM stdlib, zero
  writes). Computes the current theme hash (first 12 hex of sha256 over
  `themes/night-city.theme.json`), then checks: (a) each of the 5 SVGs embeds the
  `derived-from: omk.theme.v1/night-city@<hash>` comment with the current hash;
  (b) every `derived-from` line in `readmeasset/ASSET_PROVENANCE.md` carries the
  current hash; (c) the ledger table byte-size and SHA-256 cells match the files on
  disk. On drift it prints each stale item as `<item>: expected <x> actual <y>`,
  sorted for determinism, plus the remediation hint, and exits 1; on success it prints
  one summary line and exits 0.
- `test/assets-check.test.mjs` (new) — mirrors the temp-dir pattern from
  `test/no-legacy-identity-surface.test.mjs`. Four cases: checker passes on the real
  repo; tampered ledger hash in a temp copy exits non-zero; tampered SVG in a temp copy
  exits non-zero; `package.json` wires `assets:check` to the script.
- `.github/workflows/ci.yml` — single step inserted immediately after the
  `color literal gate` step.

Not touched (per scope): `scripts/assets-build.mjs`, `readmeasset/**`, `package.json`,
`themes/`, `src/**`. No `git add`/`git commit` run.

## CI hunk (`.github/workflows/ci.yml`)

```yaml
      - name: color literal gate
        run: npm run color:gate
      - name: asset provenance gate
        run: npm run assets:check
      - run: npm run proof:check
```

## Commands run + exit codes

| Command | Exit |
| --- | ---: |
| `npm run assets:check` | 0 |
| `node --test test/assets-check.test.mjs` (4/4 pass) | 0 |
| `npm run yaml:check` (13 files checked) | 0 |
| `node scripts/no-legacy-identity-surface.mjs` (943 files checked) | 0 |

Pass output:

```
[assets:check] OK — 5 SVGs match omk.theme.v1/night-city@e5daf40d789d; ledger byte-size/SHA-256/derived-from current.
```

Test summary: `# tests 4 / # pass 4 / # fail 0`.

## Tamper-test evidence

Synthetic drift (temp copy: ledger hash rewritten to `@deadbeefcafe` and one byte
appended to `omk-core-loop.svg`) produced sorted output and exit 1:

```
[assets:check] provenance drift detected (7 stale items):
- readmeasset/ASSET_PROVENANCE.md byte-size omk-core-loop.svg: expected 2732 actual 2731
- readmeasset/ASSET_PROVENANCE.md derived-from omk-badges.svg: expected e5daf40d789d actual deadbeefcafe
- readmeasset/ASSET_PROVENANCE.md derived-from omk-core-loop.svg: expected e5daf40d789d actual deadbeefcafe
- readmeasset/ASSET_PROVENANCE.md derived-from omk-evidence-ledger.svg: expected e5daf40d789d actual deadbeefcafe
- readmeasset/ASSET_PROVENANCE.md derived-from omk-logo-mark.svg: expected e5daf40d789d actual deadbeefcafe
- readmeasset/ASSET_PROVENANCE.md derived-from omk-provider-lanes.svg: expected e5daf40d789d actual deadbeefcafe
- readmeasset/ASSET_PROVENANCE.md sha256 omk-core-loop.svg: expected 55df69bc6612db6e2bf46058d6b2a2f8a5aab34d166644ed68df0ec042c023e5 actual 0f60a453833c541a05db3b509f9d56fae02c38c89334c7c57357f281cad439f2
run: npm run assets:build && refresh ASSET_PROVENANCE.md
```

The two in-suite tamper cases (`tampered ledger hash`, `tampered SVG`) both assert
`exit code 1` plus the remediation hint in stderr.

## MCP lanes

- `omk-project`, `filesystem-readonly`: not invoked for this lane (local read-only
  stdlib verifier only). No unreachable-server impact on the deliverable.

## Remaining risk

- The checker pins the theme path and 5 SVG basenames to match `assets:build`. If a
  future asset is added to the build manifest, both files must be extended together;
  otherwise the new asset is unguarded (the existing 5 stay enforced).
- The ledger table parser keys on the File cell basename and fixed columns (byte-size
  = column 6, SHA-256 = column 7). A future column reorder in `ASSET_PROVENANCE.md`
  would need a matching parser update.
- Gate is read-only and deterministic; it asserts drift but never mutates the ledger or
  SVGs, so remediation stays an explicit `npm run assets:build` step.
