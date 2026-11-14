# K0 fixture drift: temporary input path widths

Date: 2026-11-12. Baseline HEAD: `3045c4ca2f548865b4638759a4e253cd23333688`,
with the existing uncommitted K0/K1 and other session work preserved.
Scope: fix fresh-recording reproducibility without regenerating any golden.

## Diagnosis

The unchanged recorder passed under the ordinary environment and failed under
the credential-free environment used for the K1 repository check. Toggling only
the effective temporary-root shape reproduced the difference. Diagnostic copies
of fresh recordings were retained outside the repository without publishing them.

The temporary parent was 16 UTF-16 code units long in the approved recording,
but 4 in the isolated `/tmp` environment. `mkdtemp` fixed only its random suffix,
not the entire work path. Its child `TMPDIR`, the harness cwd and the G0 package
symlink therefore all became 12 code units shorter.

Textual path normalization produced identical prompt strings in both recordings,
but it happened **after** the runtime calculated these fields:

| Observed difference under the short root | Approved recording | Short-root recording |
| --- | ---: | ---: |
| G0 `systemPromptCacheBoundary` | 2372 | 2336 |
| First G0 faux input tokens | 1236 | 1224 |
| First RPC faux input tokens | 1822 | 1819 |

The boundary covers three package documentation paths, so it moved by 36. Faux
usage estimates depend on pre-normalized prompt lengths, so their values and
subsequent copied usage totals also changed. Only the two G0 files and RPC
transcript differed. The seven copied session-equivalence archives did not.
This is a synthetic recorder input defect, not a provider or session-format change.

## Minimal correction

`createRecordingWorkDir` in `scripts/fixtures/contract-fixture-utils.mjs` preserves
the reviewed **actual input** widths: work directory 45, child temporary root 49,
and G0 package link 67 UTF-16 code units. It pads or shortens the directory prefix
beneath the selected temporary parent, retaining a fresh six-character random
suffix. The recorder uses this directory before either real Node entry point runs.

No cache offset, token count, content, event or comparison tolerance is changed.
`normalizeJsonl` is unchanged. No golden data or manifest is rewritten. Existing
I1 baseline semantics and strict comparisons remain intact.

An absolute temporary parent longer than the input budget can support is refused
before directory creation, with an instruction to select a shorter
`TMPDIR`/`TEMP`/`TMP` (at most 35 normalized code units). This deliberately exposes
a fixture-input limitation instead of hiding it by changing observed numbers.
A native platform needs its own suitable writable temporary root and actual run;
this change is not macOS/Windows acceptance. A future corpus with different input
widths requires an explicit baseline review, not an automatic fallback.

## Regression evidence

- RED: the real `--check` integration test failed with
  `fixture bytes or file set differ from fresh recording` (exit 1) before the fix.
- GREEN: 13 fixture tests passed after the fix, including two complete fresh
  recordings under differently sized temporary parents. Both matched all ten
  stored data files. The integration test snapshots and checks all data digests
  and the exact manifest bytes before and after execution.
- Direct path tests cover all three input widths, retained parent containment,
  relative/overlong-root refusal and no directory creation on invalid roots.
- The normalizer regression explicitly preserves observed cache offsets and token
  usage while replacing a path string. Existing malformed-input, privacy,
  inventory/hash, RPC error/timeout and child-cleanup tests remain in force.
- All eleven original golden/manifest SHA-256 values were independently captured
  before diagnosis and remain unchanged after the focused tests.

## Final verification

Full `npm run check`: **exit 0**, in the allowlisted, credential-free environment
with the short temporary-root shape that reproduced the original failure. This
includes all six crates' fmt, Clippy and tests, the K1 frozen-graph/16-case checks,
K0 declaration/matrix checks, all ten freshly compared contract fixtures and the
remaining repository/type/browser-smoke guards. The script test suite reported
718 tests: 687 passed, 0 failed, 31 skipped. Existing optional R/Bun skips are not
new acceptance evidence and are not counted as passes.

Focused `node --test scripts/test/contract-fixtures.test.mjs`: **exit 0**, 13
passed, 0 skipped. `git diff --check`: **exit 0**. Final independent comparison of
all eleven pre-investigation SHA-256 values confirmed no golden/manifest change.
Active LSP probes for the three changed scripts were inconclusive (silent-on-clean
server); they are not counted as compiler or lint evidence. The actual Node
regressions and repository check ran against the changed scripts.

Direct self-review checked that path-length arithmetic uses the same UTF-16 units
as prompt offsets, the selected parent is retained, all temporary directories are
uniquely allocated, invalid roots fail before writes, numeric normalization stays
unchanged, and both real recorder entry points are exercised. The explicit long
parent limitation above remains; no cross-platform acceptance is claimed.

Raw local logs are retained under temporary `omk-k0-drift-*` names, including the
RED, GREEN and complete repository-check output. Diagnostic work directories were
owned synthetic recordings only and were cleaned after comparison. Other sessions'
preexisting changes are preserved. No install, provider call, workflow edit, commit,
publication or golden regeneration occurred.

## Integration continuation, 2026-11-14

An isolated integration checkout exposed a second input-width dependency: the RPC
driver set `OMK_PACKAGE_DIR` to its real checkout. A 90-code-unit package path,
instead of the reviewed 46, increased each faux input count by 33 tokens. G0 and
all seven archived files remained identical. The real fresh-recording regression
failed before the correction; this was not a stored-golden digest failure.

The recorder now supplies a uniquely allocated package alias of exactly 46 code
units to the RPC driver. It uses the actual candidate package through a directory
symlink (junction on Windows), and the driver honors this explicit fixture input.
G0 keeps its original separate alias. The existing helper supports the 44-unit
RPC work directory plus `/p`; the common temporary parent must be absolute and at
most 34 units long. Both owned directories are removed on exit.

All ten data files and the pre-integration manifest bytes remain unchanged. The
14 focused fixture/declaration tests passed, including fresh comparisons under
two temporary-root lengths from the longer integration checkout. Numeric usage,
cache boundaries, normalization rules and comparison tolerances were not changed.
This is Linux source evidence, not native macOS/Windows acceptance.

Proposed commit message: `fix: K0 recorder 입력 경로 길이 고정과 golden 보존 회귀 검증`.
