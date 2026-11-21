# OMK v2.0.2

OMK 2.0.2 is a patch release from `main`. It adds an opt-in consumer for
AdaptOrch routing results in subagent lane dispatch and fixes the standalone
installer's version check when `OMK_PACKAGE_DIR` points at another
installation.

## Contributors

Thank you to the community contributors whose pull requests were merged in this cycle:

- [@anhnt256](https://github.com/anhnt256) added unit tests for `rawCtrlChar`
  (#476), `normalizeReverseSkillText` and `normalizeReverseSkillName` (#477) and
  `shortenImagePath` (#478).
- [@arrafipd](https://github.com/arrafipd) added unit tests for
  `warnDeprecation` (#467).
- [@prascli](https://github.com/prascli) added unit tests for
  `countOverlappingOccurrences` (#466).

## Added

- `OMK_SUBAGENT_ADAPTORCH` (experimental, default off) lets subagent lane
  dispatch use the result of an actually executed, authorized
  `adaptorch_route_topology` MCP call. `shadow` (or `1`) only records proposals;
  `enforce` can prioritize ready lanes and narrow sequential execution to one
  lane. A receipt must match the same prompt's task IDs, descriptions and
  dependencies and still be fresh; missing or incompatible results fall back to
  the local plan. The consumer adds no service or model calls (#404).

## Fixed

- The standalone installer reads the downloaded binary's version with
  `OMK_PACKAGE_DIR` unset, so an `OMK_PACKAGE_DIR` in the environment that
  points at another installation no longer makes the check read that
  installation's version (#470).

## Verification scope

The installer fix is covered by `scripts/test/install-upgrade.sh`, which runs
the launcher switch in a disposable installation without provider credentials.
The AdaptOrch consumer is covered by offline receipt and native-routing tests;
it was not exercised against a live AdaptOrch service in this release.

## Packages

All eight public packages move to `2.0.2` in lockstep: `open-multi-agent-kit`,
`omk-ai`, `omk-agent-core`, `omk-tui`, `omk-protocol`, `omk-adaptorch-wpl`,
`omk-book-to-skill` and `omk-speak-like-you-eat`. Only the dev-only `fast-uri`
lock entry changed (#469). Full details are in each package's `CHANGELOG.md`.
