# Release audit: v0.98.5

Date: 2026-09-12. This records candidate preparation and verification, not proof of
semantic correctness, comparative performance or completed publication.

## Scope and changelog audit

The candidate retains the public v0.98.4 ancestry and the committed implementation
range through `b84d0d9b8e`. The audit covers index-preserving Git checks, execution
ownership/shared budgets, protected verified runs and candidate recovery, input
checkpoint writer restart, static DAG retry, and TUI diagnostics. Tool timeout
messages now distinguish requested cancellation from observed termination and use
a monotonic teardown grace period.

Preparation adds release metadata, this audit, and focused verification fixes:
initial failure-card expansion is applied at construction, execution wrappers
preserve lazy context-sensitive timeouts, and the commit hook handles changed-file
status under Husky's errexit mode. Existing dirty provider, retry,
parallel-frontier, resource-label and TB changes are excluded.
Their working files are preserved, and their pending changelog entries stay out of
the candidate. Published v0.98.4 and earlier changelog bodies remain unchanged.
Model catalogs are reused rather than fetched or regenerated. Credentials, private
agent-home configuration and the user's running TUI are not changed.

## Version and artifact contract

All seven public packages target 0.98.5: `open-multi-agent-kit`, `omk-ai`,
`omk-agent-core`, `omk-tui`, `omk-protocol`, `omk-adaptorch-wpl` and
`omk-book-to-skill`. Root/example manifests and locks, internal dependency ranges,
the book compiler's source version constant, CLI shrinkwrap and README pointers
are synchronized. External dependency versions and integrity values are unchanged.

The release candidate is selected by path/hunk and inspected as a complete staged
diff. Verification uses an isolated candidate, not the mixed working tree. Temporary
homes contain no provider credentials; live inference and benchmarks are not run.

## Observed verification

- The diagnostics implementation passed type checking and 104 focused tests in its
  staged snapshot. Its canonical installed launcher passed offline 120/80-column
  inspection, save, failure, reload and quit checks without model prompts.
- Version preparation passed 13-manifest/root-lock parity, source-version tests,
  book metadata tests and the canonical `omk --version` check for 0.98.5.
- The isolated candidate build and `npm run check` exited 0. Module-size and
  import-cycle baselines were not raised.
- The final full offline run exited 0: 8,181 passed, 837 environment/live-condition
  skips, no failures. Package passes were WPL 149, agent 870, AI 631, book compiler
  22, coding-agent 5,653, protocol 126 and TUI 730. Vitest workers were bounded at
  four; the TUI package used its Node test runner.
- Seven-package npm pack dry runs and release-surface checks passed. They checked
  package version/file metadata without publication or lifecycle scripts.
- Gitleaks found no leaks in the staged changes or the six implementation commits
  since v0.98.4. Reports were redacted; this is not clearance for private histories
  outside that range.

## Verification repairs

The isolated candidate exposed a two-line module-size overrun that the mixed tree
hid. Passing initial expansion to the failure-card constructor avoids a redundant
rebuild and keeps the existing size baseline; both initial states are tested.

The full suite exposed an execution wrapper spreading a tool's dynamic timeout
getter into a fixed value. The wrapper now projects tool metadata and forwards
that getter lazily. Regression checks cover no eager evaluation, timeout changes,
stale-context rejection and retained execution metadata.

The commit hook had only been tested under plain `sh`, while Husky invokes `sh -e`.
A changed-file `git diff --quiet` status of 1 therefore stopped valid release
commits. Capturing that status in an OR-list preserves errexit for real failures;
all six hook fixtures now run under `sh -e`, including changed paths with spaces,
index preservation and a fatal git-diff error.

An initial test launch resolved to the wrong checkout and was cancelled, not counted
as candidate evidence. Subsequent launches fix both process cwd and npm prefix.
An isolated HOME also hid the installed Rust toolchain: explicitly supplying its
location restored the real cargo diagnostic check without changing the test or
copying credentials. Neither fixture failure was treated as a product pass.

## CI environment recovery

The first v0.98.5 tag run built the binaries, but its test step could not find
`/usr/bin/bwrap`. npm publication was not attempted and GitHub Release creation
was skipped. The default-branch CI workflows now install `bubblewrap` and run an
unprivileged namespace probe before the suite. Ubuntu 24.04 subsequently refused
loopback setup inside the namespace. The runtime-test jobs are pinned to Ubuntu
22.04 LTS, with the same namespace and capability-drop checks. They do not skip
verified-run tests, disable host security controls or enable a sandbox fallback.

Recovery dispatches the official workflow from `main` with both `tag` and
`source_ref` fixed to `v0.98.5`. The release tag and its source commit stay unchanged;
the existing source/tag equality checks remain mandatory.

A source-file fingerprint is not an executed-build attestation. Linux observations
do not establish behavior on every target platform. CI must validate the exact tag,
build the six platform archives, run checks/tests, publish all seven npm packages
and create the GitHub Release. Existing token-based CI authentication is unchanged;
OIDC/Sigstore provenance is not claimed. Publication is complete only when the main
tag, GitHub Release and seven npm `latest` values agree.
