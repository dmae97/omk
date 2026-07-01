# omk-adaptorch-wpl (experimental, design-stage)

> **Status**: Experimental. Not wired into the `open-multi-agent-kit` CLI. Not published. This
> package implements the AdaptOrch-native Work Packet Loop (WPL) design, an original execution
> loop whose only work-producing action is AdaptOrch's `adaptorch_run` tool. See
> [AdaptOrch](https://adaptorch.com) for the backend product this integrates with; AdaptOrch is
> still under active development and this integration currently targets its free **Start** tier.

## Design documents

The full design (state machine, verification layer, integration mapping, and the adversarial
review that shaped the safety gates below) lives outside this package at
`.omk/runs/adaptorch-native-loop-algorithm-20260701/`:

- `final-part1-core-algorithm.md` — Work Packet state machine, termination conditions, cancellation policy
- `final-part2-verification-layer.md` — the Outcome Adjudicator (5-state verification)
- `final-part3-integration.md` — the projection/bridge between the two

## Modules

- `src/types.ts` — Work Packet, Dispatch Record, state enums (as string literal unions), on-disk schema types
- `src/state-machine.ts` — the packet lifecycle state machine and transition guards
- `src/adaptorch-client.ts` — thin typed wrapper around AdaptOrch's 10 MCP tools
- `src/adjudicator.ts` + `src/adjudicator-registry.ts` — the Outcome Adjudicator and its per-`kind` registry
- `src/loop.ts` — the integration layer wiring the state machine, AdaptOrch client, and adjudicator together

## Safety notes (do not remove without updating the design docs)

- `ESCALATED` packets never resume automatically; only an explicit external unblock signal moves them on.
- The first Dispatch Record of any payload that differs from the last human-approved baseline
  (an `augmented_payload` was applied, or a `REROUTE` changed topology) requires human approval
  (`AWAITING_APPROVAL`), unless the loop is explicitly launched in pre-approved-batch mode.
- Loop-level budgets (`max_dispatch_attempts`, `max_loop_duration`, dispatch-call budget) are
  immutable for a loop instance's lifetime; raising them requires a new instance under the same review.
