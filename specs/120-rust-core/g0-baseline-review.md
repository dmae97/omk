# K0 G0 baseline review — decision I1

Date: 2026-11-12. Source HEAD: `3045c4ca2f548865b4638759a4e253cd23333688`.
Authority: the owner's explicit follow-up request, recorded in [decision I1](decisions.md#i-g0-baseline-disposition-2026-11-12).
This is an approved behavior-baseline update, not a Rust parity waiver.

## Reviewed delta

The recorder (`node scripts/record-contract-fixtures.mjs`) ran with its existing
isolated home, cleared inherited environment, faux provider and normalization.
No normalizer, provider, session serializer or skill-admission implementation was changed.

| Artifact | Before | After |
| --- | --- | --- |
| Fixture origin HEAD | `437ae8fdf79e05fb374e88d15509b6e969680c63` | `3045c4ca2f548865b4638759a4e253cd23333688` plus the recorder's input digest |
| `g0/session.jsonl` entries | 24 | 20 |
| Header / message / custom counts | 1 / 14 / 9 | 1 / 14 / 5 |
| Session SHA-256 | `007f16e6a7e8ed4bc5e1b8bf709499516ad3700250c8504454357473c35d1ef2` | `c1dc0e813cc4583ecee8ca8d58332f478e6064f2e266b8a96083578995d56a30` |
| Other fixture data files | Nine files | All byte-identical |

The only removed rows are four `custom` entries with
`customType: "skill_admission_turn"` and `data: {"schemaVersion":1}`.
After omitting those four rows for this one-time review, every remaining field
except entry `id`/`parentId` is equal in order. Both original and new parent chains
were checked independently: every entry points to its predecessor, starting at
null. IDs and parents change because the removed markers consumed IDs.

The six provider requests, 35 directional RPC rows and seven archived
session-equivalence files are byte-identical. The manifest updates the source
identity and the one changed data-file digest. Its schema stays v2; this is not
a wire schema change. The prior corpus remains available in Git history.

## Tests and acceptance

- RED: the new no-empty-marker Rust assertion failed against the old fixture
  (exit 101). After recording the reviewed delta, all round-trip tests passed.
- Rust still tests byte-exact round trips, all nine entry variants, unknown fields,
  malformed inputs and legacy marker decoding. No failure path was relaxed.
- The generated declaration test's old total of 101 included four repeated marker
  rows. Its reviewed total is now 98: 20 session rows, 35 RPC rows, 29 commands and
  14 explicit boundary shapes, including a separate legacy-marker example.
  All ten negative type-check cases remain unchanged.
- `node scripts/record-contract-fixtures.mjs --check` compares fresh runtime bytes
  against the approved files. It does not filter markers, repair IDs, update the
  manifest or regenerate goldens in check mode.
- `npm run check:contracts` now makes drift, matrix coverage and fresh recording
  checks part of every `npm run check`, after native toolchain setup. A successful
  hash-printing script alone is not accepted as a comparison.
- `sh specs/120-rust-core/verify-k0.sh` is the full local entry point: existing
  K0 unit verifier, skill-admission/session-equivalence suites, then repository
  checks including fresh G0/RPC comparison. Platform CI remains separate.

Final command results and T012 disposition are recorded in [tasks.md](tasks.md).
The historical native CI run is evidence for the crate version it tested; it is
not a claim of green overall CI, a new native-platform run, or K5 acceptance.
