---
gsd_state_version: "1.0"
milestone: v2.0.0
milestone_name: Pi-independent OMK
current_phase: 02
current_phase_name: Native extensions and explicit migration
current_plan: Not started
status: planning
last_updated: "2026-11-05T08:52:06.101Z"
state_head: 0d6e74b0d21cdb810c88c42381457eff944b935f
progress:
  total_phases: 6
  completed_phases: 1
  total_plans: 1
  completed_plans: 1
---

# Project state

## Current position

Milestone: v2.0.0 Pi-independent OMK
Phase: 02 of 6 (Native extensions and explicit migration)
Status: Ready to plan
Current plan: Not started

## Decisions

- Preserve existing spec-kit governance; use GSD for execution/state tracking.
- Do not equate absence of Pi npm packages with absence of compatibility coupling.
- Start with the smallest end-to-end boundary slice and RED/GREEN evidence.
- Keep versions at 1.5.10 until full milestone release acceptance.
- GSD defaults do not authorize commits, model overrides or publication.

## Evidence

- Baseline `npm run check`: passed, script tests 555 passed / 30 skipped / 0 failed.
- `node scripts/pi-inventory.mjs --check`: passed before implementation;
  9 broad namespace manifest entries, 44 imports/mentions, 4 alias consumers.
- Existing affected source/docs were backed up outside the checkout.
- GSD plan checker: PASS after recognizing two complete typed tasks and their
  supporting artifacts/key links; no remaining plan blockers.
- Existing targeted baseline: 176 tests passed across seven files.
- Initial 239-test and 258-test passes missed review counterexamples; their
  observed RED corrections and history are retained in the phase-1 summary.
- Latest main run: 266 tests passed across ten explicit files, exit 0.
- Latest main `npm run check`: exit 0, 555 script tests passed / 30 skipped / 0 failed.
- Final independent code review: PASS, CR-01/CR-02/CR-03 resolved; 27 selected
  tests and nine real-filesystem assertions passed. Security register: six closed.
- Post-check source digests, preserved backup files, HEAD and Git index entries match.
- Final goal verifier: passed, 4/4 truths, 29 selected cases passed, no blockers.
  Report covers 16 frozen inputs; owner `verification.status` returned passed.
- GSD `phase.complete 1` completed one plan and advanced to phase 02. Its ID parser
  rejected `V2-BOUNDARY-01`, so main updated that single checkbox/traceability row
  from the accepted report. IDs and validation gates were not renamed or weakened.

## Open limitations

- `Rscript` is not on PATH and `OMK_RSCRIPT` is unset.
- Windows blueprint is outside current accessible project files.
- Actual TUI/native visual and installed-artifact acceptance have not run.
- Substantial pre-existing dirty work must remain untouched.

## Continuation, 2026-11-06

The metadata above records the earlier phase-1 handoff, not completion of the
subsequent phase-2 source work. Existing phase-2 summaries and review were read;
no plan or broad requirement was marked complete in this continuation.

- Added extension-memory lifecycle fixes: failed factories release recorded event
  subscriptions; retired runtimes release bound action/provider callbacks, pending
  payloads, maps and inventory references. Shared live runtimes remain usable.
- RED: six intended assertion failures. GREEN: 87 tests in eight explicit files,
  zero skipped; coverage for the two new modules is 100% lines and 88.88% branches.
- Root `tsgo --noEmit`: exit 0. `npm run check`: exit 1, script tests 579 passed,
  one failed, 30 skipped. The blocker is existing orphaned
  `dist/core/subscription-usage-cache.*` output, not modified by this slice.
- Verification ran sequentially with one Vitest worker and two-CPU root checks.
  No global setting, installed engine, version, commit or publication changed.
- Evidence: `/tmp/omk-v2-memory-20261106-01a1b084/`, including RED/GREEN logs,
  focused coverage, root-check log and compiler log. See
  `packages/coding-agent/docs/extension-memory-lifecycle.md` for scope and limits.

## Next action

Reconcile the phase-2 source summaries with current bytes, resolve the generated
output ownership/blocker, then freeze the public candidate for the documented
packaged Node/compiled Bun acceptance gate. Historical review and source tests
are not current artifact receipts. Preserve current defaults and existing dirty
work. Independent R, desktop/platform and Rust execution gates remain open;
the 2.0 milestone is not complete.
