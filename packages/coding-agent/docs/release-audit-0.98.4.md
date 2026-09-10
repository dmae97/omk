# Release audit: v0.98.4

Date: 2026-09-10. This records pre-publication checks and approved history cleanup,
not a semantic-correctness/performance claim. The tag workflow and registry versions
remain the evidence for completed publication.

## Scope and history

The candidate retains the public v0.98.3 ancestry and the reviewed local implementation
commits. Preparation uses only committed implementation files plus explicit release
metadata. Twelve existing modified files and two untracked test files were snapshotted
and isolated before preparing the candidate; they are not part of this candidate.
Credentials, the active model, private agent-home settings and stopped benchmarks are
not modified. Catalogs are reused from the reviewed commit, not regenerated.

The deletion commit alone did not remove the internal research document from history.
After explicit approval, only the unpublished range of `main` was filtered in a separate
bare repository. The cleaned branch has no path history or reachable blob for that
document. The resulting candidate tree is byte-identical to the previously checked tree;
the public main ancestor, other local refs and existing tags are unchanged. A scoped
compare-and-swap updated local main without resetting working files. Private recovery
material remains outside the repository and is not published.

The cleaned unpublished history also passed gitleaks with no findings. Publication uses
only the explicit main and v0.98.4 refs, without force-pushing or sending other local refs.

## Changelog audit

The audit compares committed changes since v0.98.3. New entries cover model contracts,
DeepSeek V4.1 routes and provider thinking, metrics v2, gate/sandbox narrowing, shared-DAG
repairs and witness policy, CLI/skill/provider changes, clipboard/Markdown links, and WPL
submission checks. User-visible lower-level changes are also summarized in the CLI
changelog. Already released lifecycle/advisory changes are not advertised as new.
Unrelated pending retry/timeout/TB changes are not included. Published changelog sections
at v0.98.3 and earlier must remain byte-identical after the version bump.

## Package/version contract

The seven public packages are `open-multi-agent-kit`, `omk-ai`, `omk-agent-core`, `omk-tui`,
`omk-protocol`, `omk-adaptorch-wpl`, and `omk-book-to-skill`, all at candidate version
0.98.4. Root/example manifests and locks, internal dependency ranges, the book compiler's
version constant, CLI shrinkwrap and README pointers are synchronized in the same unit.

The checks below ran on the isolated 0.98.4 candidate. Tests and pack/build commands
used no real provider credentials. Catalogs remained byte-identical to the reviewed
committed snapshot.

## Verification status

| Gate | Observed status |
| --- | --- |
| Workspace version bump | `npm run version:patch` exited 0; seven public versions are 0.98.4 |
| Published changelog preservation | Seven histories at v0.98.3 and earlier byte-preserved |
| Workspace build/typecheck | Build exited 0; six changed runtime files and the version constant confirmed clean by primary LSP |
| Full offline tests | Second run exited 0: 7,859 passed, 837 skipped, no failed tests or collection failures |
| `npm run check` | Candidate-index check exited 0; module-size and import-cycle gates passed without broader baselines |
| Release consistency | `check-release-consistency.mjs --release` exited 0 for version/ancestry/README consistency; history cleanup is checked separately below |
| npm package inspection | Seven local packs declared 0.98.4 and contained manifests/changelogs; restricted path matches 0; local seven-package install exited 0 |
| Standalone binary smoke | Linux x64 archive built; clean-environment Node CLI and standalone binary both reported 0.98.4 |
| Native initcheck | Go vet, race/shuffle tests and debug-symbol validation exited 0 |
| Candidate secret scan | gitleaks on the candidate source snapshot exited 0, findings 0; not a history-clearance claim |
| Dependency audit | Production dependencies: 0 vulnerabilities. Including development dependencies: 3 existing moderate Vitest-family advisories; suggested fix is a major upgrade, not applied implicitly |
| Public Git history | Scoped cleanup verified: forbidden path/blob reachability 0, candidate tree unchanged, public ancestor and other refs/tags preserved; unpublished-history gitleaks exited 0 |

Package test counts were WPL 149, agent 868, AI 631, book compiler 22,
coding-agent 5,425, protocol 34, and TUI 730. AI skipped 786 and coding-agent
skipped 51 live/environment-gated tests. These counts are verification coverage,
not measured harness quality.

### Failures found and repaired during preparation

The first full run exposed 31 failed tests and five collection failures; those results
were not counted as a pass. Narrow reruns separated stale fixtures from runtime defects:

- Pre-aborted requests already stopped before authentication/provider dispatch. The old
  test expected the provider to run after abort. It now checks zero auth/provider calls,
  preserved cancellation reason and coherent stream termination. Queued steering input
  remains in the transcript without starting another provider after cancellation.
- The native legacy Flash alias now serves a vision model. Vision-routing tests use an
  explicit text-only fixture instead of asserting a volatile catalog alias is text-only.
- Four hoisted mocks used a not-yet-initialized namespace import; they now load the real
  source through `vi.importActual`. The provider-doctor wiring check exercises the actual
  source CLI rather than an obsolete import string in `main.ts`.
- Invalid tokenizer results now fail at their boundary and trigger the existing noted
  fallback. Non-finite estimates fall back to the heuristic; optional-context sorting
  remains antisymmetric/transitive instead of returning NaN.
- Domain matching normalizes whitespace without changing its deliberate repeated-keyword
  scoring policy. Metamorphic regressions cover spaces, tabs and line breaks.
- Redaction preserves narrowly recognized non-secret references, placeholders and nearby
  type annotations. Known credential patterns and literal values still mask; adversarial
  suffix/literal cases are tested. The documented global persistence opt-out was incorrect:
  the existing alias affects input only, and forced persistence/report masking remains on.
  No global safety setting was enabled or weakened.

The corrective changes were committed separately. After scoped history cleanup their
IDs are `ec6db009df` (token counts/order), `f88b791a53` (whitespace routing),
`23e4b75d14` (redaction and its actual contract), and `779447c883` (current-runtime
test fixtures). Their source content and the recorded test results are unchanged.
Release metadata is a separate unit.

Full tests use the repository's `test.sh` with an isolated HOME, a credential-free
allowlisted environment and bounded Vitest workers. Toolchain locations may be passed
without credentials. Live provider tests, paid inference, benchmark execution and TUI
session restarts are excluded. A Linux smoke does not validate all target platforms.

## Publication procedure

Review the final source tree, check the approved history, and tag the
exact main commit. The existing `build-binaries.yml` CI path owns npm publication and
GitHub Release creation; local pack/build commands are not publication. CI authentication
is unchanged and does not claim OIDC/Sigstore provenance. Completion requires the main tag,
GitHub Release and npm latest for all seven packages to agree.
