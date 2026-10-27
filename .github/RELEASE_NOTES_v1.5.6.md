# OMK v1.5.6

OMK 1.5.6 is a patch release. It adds four opt-in harness features from spec 106
(#207), all off by default, plus two fixes and a license file cleanup. With every
new flag off, behavior is the same as 1.5.5.

## Opt-in features (default off)

- **Lane ready frontier (`OMK_LANE_READY_QUEUE=1`).** A lane starts as soon as
  its dependencies finish, up to the lane-width limit. Frontier counts are
  logged to `subagent-lane-frontier.jsonl` (#212).
- **Lane failure scope (`OMK_LANE_FAILURE_SCOPE=1`).** A lane that fails without
  writing anything blocks only its descendants. Adds `allLanesCompleted` (#208).
- **Session skill admission (`OMK_SKILL_ADMISSION=1`, also `true` or `on`).** A
  session admits at most 10 unique skill bodies, and the count survives resume
  and compaction. It covers explicit, steer and follow-up skill loads,
  `SKILL.md` reads through the `read` tool, and skills handed to workers.
  Workers start with `--no-skills` and get only admitted skills (#209, #210).
  Not gated yet: reading `SKILL.md` through bash, and `SKILL.md` reads inside a
  worker.
- **Evidence lifecycle, observe-only (`OMK_EVIDENCE_LIFECYCLE=observe`).**
  Reports what would be deleted and deletes nothing. The trace stores only
  hashes and counts (#211).

## Fixed

- **Required-tools contract listener.** No longer leaks or fires twice on
  dispose and re-install (#204).
- **`npm run check` exits 0 again** (#206).

## License

- **GitHub detects MIT.** The trademark notice moved out of `LICENSE`. AdaptOrch
  logo files moved to `readmeasset/adaptorch/` with a `NOTICE` saying they are
  not MIT-licensed (#205).

## Not yet measured

- There is no on/off benchmark for the lane ready frontier yet.
- The skill cap of 10 is a chosen contract value, not a measured one (#207).

## Upgrade

```bash
npm install -g open-multi-agent-kit@1.5.6 --ignore-scripts
```
