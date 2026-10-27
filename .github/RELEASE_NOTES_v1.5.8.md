# OMK v1.5.8

OMK 1.5.8 is a patch release. It adds three opt-in features, all off by default,
plus two fixes. With every new flag off, behavior is the same as 1.5.7.

## Opt-in features (default off)

- **Goal autonomy (`OMK_GOAL_AUTONOMY=1`).** `/goal budget` sets a user-only
  cost/deadline budget (subagent lanes included). A goal stops with
  `budget-limit`, `deadline`, `outcome-unknown` or `scope-changed`; steering
  pauses it and only `/goal resume` restarts it. `omk.goal.v1` is unchanged
  (#266, #268).
- **Skill auto-load (`OMK_SKILL_AUTO_LOAD`).** Strong-only auto-load with an
  observe-only log (#262).
- **Evidence delete-after-use (`OMK_EVIDENCE_LIFECYCLE=delete`).** `observe`
  only records (#263).

## Fixed

- Evidence delete recovery can no longer fail `session_start` (#264).
- `session_info` JSON test flake (#265).

## Tooling and docs

- Research count scripts and fixes (#267, #269, #271); spec 118 D3 addendum (#272).
- `AGENTS.md` lists goal autonomy.

## Not yet measured

- There is no on/off benchmark for any of the new flags yet.
