# OMK v0.98.5

This patch adds terminal diagnostics and opt-in verified-run recovery workflows.
Unrelated pending work is excluded from the release candidate.

## Changes

- The coding-agent TUI provides read-only `/debug` inspection and explicit,
  metadata-only `/debug save` reports. Typed failures show cause, impact and next
  action before expandable details. Reports exclude transcripts, configuration,
  paths, routing names and session/run IDs. See [usage](../packages/coding-agent/docs/usage.md#diagnostics-and-failure-details).
- Runtime inspection separates source/dist entry kind, initialization-time file
  observations and resource reload. It does not infer an executed build revision
  from checkout HEAD or claim that `/reload` replaces core code.
- Opt-in verified-run CLI/SDK paths support protected verification, immutable
  candidate recovery, checkpoint-based writer restart and bounded static DAG task
  retry. Approval, generation, ownership and budget checks remain in force;
  artifacts are not automatically applied to the original workspace.
- Tool timeout messages distinguish requested cancellation from observed termination.
  The teardown grace period uses a monotonic clock. Execution-ownership wrappers
  preserve lazy context-sensitive timeouts and reject stale contexts.
- Pre-commit checks preserve the exact selected index, including partially staged files.

The verified-run contract types are in `omk-protocol`. Other unchanged packages
receive the lockstep version update. Pending parallel-frontier, resource-label and
provider changes in the working tree are not promoted into these release notes.

## Verification and boundaries

The diagnostics commit was checked as an isolated staged snapshot: type checking
and 104 focused tests passed. The canonical launcher was also exercised offline
at 120 and 80 columns without credentials or model prompts. Version preparation
checks align package metadata, internal dependency ranges, lockfiles, shrinkwrap
and the document compiler's source version constant.

These checks are not a benchmark, correctness proof or release authorization.
Live-provider behavior and other operating systems were not verified by this task.
See the [release audit](../packages/coding-agent/docs/release-audit-0.98.5.md) for
candidate scope and observed checks. The official tag workflow owns builds, tests,
npm publication and GitHub Release creation; local preparation alone does not
establish publication. Existing CI authentication is unchanged; no OIDC/Sigstore
provenance claim is introduced.
