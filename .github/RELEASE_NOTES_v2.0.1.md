# OMK v2.0.1

OMK 2.0.1 is a patch release from `main`. It makes setup failures diagnosable,
reduces false-positive skill matches, shortens opt-in next-task suggestions,
and waits for npm registry propagation before completing a release.

## Contributors

Thank you to the community contributors whose pull requests were merged in this cycle:

- [@anhnt256](https://github.com/anhnt256) added unit tests for the code-point
  predicates (#437), `tryAcquireLaneDispatch` (#438), the legacy resource
  helpers (#439), HTTP idle timeouts (#441), context-budget tier allocation
  (#459) and the Grok playbook loader (#460).
- [@joshuaallgaier2-cmd](https://github.com/joshuaallgaier2-cmd) added unit tests
  for context-budget ordering (#450) and coverage gaps (#455).

## Fixed

- `omk init --global` and a bare `omk` launch report why bundled pstack agent
  installation failed, including the affected path, instead of `(unknown)`.
  Errors without an operating-system code, such as
  `pstack destination is not a real directory`, previously lost their message.
  Existing files are still never replaced (#451).
- An extension load failure for a module under another installation's
  `node_modules` tree, such as a wrapper that points at a deleted temporary
  install, no longer suggests `omk install --allow-scripts`. Running install
  scripts cannot fix a stale path. A missing file in a package's own `build/`,
  `dist/` or `lib/` output and missing `.node` bindings still get the hint
  (#451).
- Skill selection rejects fuzzy matches between words with different initial
  characters unless one contains the other, and no longer treats path-only
  fragments as independent capability clauses. Filename tokens still count
  toward whole-request relevance (#453).
- The release workflow waits for each package's npm `latest` dist-tag before it
  verifies the publish, so registry propagation delay no longer skips the
  GitHub Release (#442).

## Changed

- Next-task suggestions (`OMK_NEXT_SUGGESTIONS`, flag, default off) use the v3
  format: a title and three labelled lines for context, scope and completion
  criteria. Skill selection for an accepted suggestion uses its title and
  scope rather than the host's context and check wording (#454).

## Verification scope

The setup fixes are covered by offline regression tests for `omk init`, the
bare launch path and the install-script hint classifier. They were not
exercised on macOS.

## Packages

All eight public packages move to `2.0.1` in lockstep: `open-multi-agent-kit`,
`omk-ai`, `omk-agent-core`, `omk-tui`, `omk-protocol`, `omk-adaptorch-wpl`,
`omk-book-to-skill` and `omk-speak-like-you-eat`. No dependency changed. Full
details are in each package's `CHANGELOG.md`.
