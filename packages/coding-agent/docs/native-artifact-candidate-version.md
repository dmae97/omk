# Native artifact candidate versions

The native-extension artifact gate validates the version of the frozen candidate,
not a historical release constant. Preparing a candidate requires:

- a nonempty version in the frozen root `package.json`;
- the same version in both root records of `package-lock.json`;
- that version and the expected package name in all eight public workspace
  manifests and their corresponding lockfile records;
- MIT package licenses and no package `preinstall`, `install`, `postinstall` or
  `prepare` hooks.

Package identity, license and lifecycle checks run before the candidate build and
again before each package is packed. A build cannot substitute a different package
name or version to obtain a passing artifact receipt.

This removes the old `1.5.10` restriction. It does not bump versions, update locks,
approve dependencies, authorize publication or change the installed engine.
Explicit input freezing, source/output digests, exact consumer tarball checks and
all Node/Bun/types/source acceptance stages remain required. Source changes need a
new candidate and receipts; earlier receipts cannot be relabeled.

## Focused verification

From the repository root:

```sh
node --test scripts/test/native-extension-candidate-version.test.mjs scripts/test/native-extension-artifact-gate.test.mjs scripts/test/native-extension-consumer-lock.test.mjs
```

The version regression uses disposable synthetic repositories. Positive controls
for `1.5.10`, `1.5.11` and `2.0.0` reach a deliberately stopped build command;
negative controls reject inconsistent root/workspace versions, missing lock
records, changed identities/licenses and lifecycle hooks. Separate synthetic
builds change package metadata and must fail before packing.

These tests exercise the preparation boundary, not a complete real-package build,
platform certification or 2.0.0 release acceptance.
