# OMK v2.0.1

OMK 2.0.1 is a patch release from `main`. It makes two setup failures
diagnosable on a new machine, makes the release workflow's npm check wait for
registry propagation, and carries the test coverage our community contributed
in this cycle.

## Contributors

Thank you to everyone whose pull requests were merged in this cycle:

- [@anhnt256](https://github.com/anhnt256) added unit tests for the code-point
  predicates (#437), `tryAcquireLaneDispatch` (#438), the legacy resource
  helpers (#439) and the HTTP idle timeout helpers (#441).

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
- The release workflow waits for each package's npm `latest` dist-tag before it
  verifies the publish, so registry propagation delay no longer skips the
  GitHub Release (#442).

## Verification scope

The setup fixes are covered by offline regression tests for `omk init`, the
bare launch path and the install-script hint classifier. They were not
exercised on macOS.

## Packages

All eight public packages move to `2.0.1` in lockstep: `open-multi-agent-kit`,
`omk-ai`, `omk-agent-core`, `omk-tui`, `omk-protocol`, `omk-adaptorch-wpl`,
`omk-book-to-skill` and `omk-speak-like-you-eat`. No dependency changed. Full
details are in each package's `CHANGELOG.md`.
