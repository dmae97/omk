# OMK 2.0.0 execution roadmap

This is the GSD execution index for the existing OMK migration. The root
`ROADMAP.md` contains earlier harness history; preserve it as historical evidence.
The constitution and existing specifications remain authoritative.

## Milestone v2.0.0: Pi-independent OMK

- [x] **Phase 1: Pi-independent core boundary** (completed 2026-11-05)
- [ ] **Phase 2: Native extensions and explicit migration**
- [ ] **Phase 3: Observation ownership and TUI redesign** (after 2.0.0, merged into K6; decision D2)
- [ ] **Phase 4: Independent R parity and recovery** (limited to policies ported in K0 to K5; decision D3)
- [ ] **Phase 5: Native workbench and Rust host slices** (remainder after 2.0.0; decisions D1, D4)
- [ ] **Phase 6: Platform and milestone release acceptance**
- [ ] **Phase 7: Rust core through headless candidate** (added 2026-11-10; required for 2.0.0)
- [ ] **Phase 8: Rust terminal UI, remaining subsystems and default flip** (added 2026-11-10; after 2.0.0)

Phases 7 and 8 were added by the owner's 2026-11-10 direction: replace every
remaining Pi dependency, migrate the core to Rust, keep extensions working. They
keep their numbers out of execution order so existing phase references stay valid.
The plan is `packages/coding-agent/docs/omk-2-rust-core.md`; stage names K0 to K8
come from it. The contract for Phase 7 is `specs/120-rust-core/spec.md`.

Owner decisions, 2026-11-10: 2.0.0 ships at K5, so Phase 7 gates the release and
Phase 8 follows it. Extensions run on Node in a host process. The Rust terminal UI
takes the look of the OpenTUI status panel header. The `omk+pi` adapter is kept and
moves entirely to Rust. The Rust core supports Linux, macOS and Windows.

The owner then delegated 41 further decisions. `specs/120-rust-core/decisions.md`
records them by ID. D1 to D4 change this index: 2.0.0 depends on Phase 2, Phase 4
as limited, Phase 7 and Phase 6. Phases 3, 5 and 8 follow the release. No phase was
renumbered, checked off or deleted.

### Research-backed execution order, 2026-11-12

K0/T012 is locally complete under the owner's explicit I1 G0 baseline change.
The four empty skill markers remain suppressed; request/RPC/archive bytes stay
unchanged. `sh specs/120-rust-core/verify-k0.sh` passes, and `npm run check` now
compares fresh contracts. This is not green overall CI or K5 platform acceptance.

Post-K0 work is refined in spec 121 and
`packages/coding-agent/docs/harness-roadmap-2026-11.md`, with primary-source
research, existing implementation mapping, measurable promotion/rollback gates
and per-stage K1–K8 deliverables. Existing phase numbers and release dependencies
are preserved. The execution order is:

1. H1 historical-checkpoint labels and H2 repeat-result audits: implemented locally,
   no claimed model-performance gain or installed-runtime activation.
2. K1 B1 dependency review bundle and H3/H7 synthetic recovery/security corpora.
3. First K1 provider recorder, then independent Rust replay after bundle approval.
4. Freeze held-out tasks, model/conditions, trial isolation, analysis and dollar cap.
5. Test one H4 context, H5 delegation or H6 evaluator candidate at a time; H8 removes
   scaffolding that no longer pays for itself. No default-on promotion without evidence.

The broader user request does not authorize external model spend without a cap,
new Rust dependencies without B1 review, workflow edits, publication or a second
scheduler. Pending studies remain pending, not hidden inside completed K0 work.

### Phase 1: Pi-independent core boundary

**Goal:** Deliver the first tested native/legacy boundary and align the migration
contract while preserving the current release baseline and unrelated local work.
**Depends on:** Nothing.
**Requirements:** V2-BOUNDARY-01
**Plans:** 1/1 plans complete — `phases/01-pi-independent-core-boundary/01-01-PLAN.md`.

Plans:
- [x] 01-01-PLAN.md — Explicit native managed-package resolution.

### Phase 2: Native extensions and explicit migration

**Goal:** Remove implicit Pi compatibility from the final default core, migrate
owned resources, and verify OMK's extension/provider/tool API across artifacts.
**Depends on:** Phase 1.
**Requirements:** V2-CORE-01, V2-MIGRATE-01, V2-API-01

### Phase 3: Observation ownership and TUI redesign

**Goal:** Separate service lifecycle from rendering and verify the shared status
contract and visual/input behavior on native TUI, OpenTUI and tmux surfaces.
**Depends on:** Phase 2.
**Requirements:** V2-UI-01, V2-UI-02
**Release:** After 2.0.0. Its work merges into stage K6 (decision D2).

### Phase 4: Independent R parity and recovery

**Goal:** Expand required finite oracle slices and verify ownership, budget and
settlement behavior at real runtime entry points.
**Depends on:** Phase 2.
**Requirements:** V2-R-01, V2-RECOVERY-01
**Release:** Gates 2.0.0 only for the policies stages K0 to K5 port (decision D3).

### Phase 5: Native workbench and Rust host slices

**Goal:** Reuse existing observation prototypes, resolve dependency obligations,
and migrate execution ownership only at verified boundaries.
**Depends on:** Phase 3, Phase 4.
**Requirements:** V2-HOST-01, V2-DESKTOP-01
**Release:** Slices H1 to H2i stay as delivered. Grant ledger and scheduler
ownership moves to stage K7, and the desktop workbench follows 2.0.0 (decisions D1,
D4).

### Phase 6: Platform and milestone release acceptance

**Goal:** Verify actual installations and rollback on claimed platforms, close
documentation gaps, then follow the constitution's milestone release procedure.
**Depends on:** Phase 2, Phase 4 as limited, Phase 7. Phases 3, 5 and 8 are not
dependencies (decisions D1 to D4).
**Requirements:** V2-RUSTPLAT-01 for the headless core, V2-RELEASE-01.
V2-PLATFORM-01 covers the desktop application and follows 2.0.0.

### Phase 7: Rust core through headless candidate

**Goal:** Stages K0 to K5. One Rust contract crate with generated TypeScript types,
providers, agent loop and sessions, built-in tools, the extension-host wire with
the existing loader as its client, and print/JSON/RPC/ACP served by the Rust core
behind an explicit selection, on Linux, macOS and Windows. Pi-zero on packaged
artifacts. Compatibility tables, manifest dialect and doctor owned by Rust.
**Depends on:** Phase 1 and the accepted Phase 2 native-loader/API boundary,
not full Phase 2 closure. That closure joins at K5/Phase 6; making it a K0
prerequisite would block the already completed contract stage on later Pi-zero
work. K0 is locally complete. J1 permits only temporary resolution and review;
the concurrent K1 lane now records scoped B1 adoption in `k1-adoption.json` under
spec 120, with graph/build/replay validation still separate from approval.
G1 clipboard review and the source-implemented G2 aliases are separate Pi-zero units. Phase 4's independent oracle
applies to each numeric policy as it is ported.
**Requirements:** V2-RUSTCORE-01, V2-EXTHOST-01, V2-PIZERO-01, V2-PICOMPAT-01,
V2-RUSTPLAT-01

### Phase 8: Rust terminal UI, remaining subsystems and default flip

**Goal:** Stages K6 to K8, after the 2.0.0 release. Rust terminal UI in the OpenTUI
header look with extension compositing, the remaining subsystems including the
grant ledger and scheduler that Phase 5 leaves on Node, then the default flip and
removal of the Node core. The K6 spec owns the `DESIGN.md` change from square
hairline frames.
**Depends on:** Phase 5, Phase 7.
**Requirements:** V2-RUSTUI-01, V2-FLIP-01

## Progress

| Phase | Status | Evidence |
|---|---|---|
| 1 | Complete | Final goal verification 4/4, all three review findings resolved, 266 targeted tests and root check passed. |
| 2 | Historical native-default artifact pass; current candidate acceptance and phase closure open | Node/Bun/types/source acceptance and exact-origin revalidation passed for frozen candidate `019d076c…` on 2026-11-08, not today's changed source. Native default is `omk`, explicit compatibility remains. Fresh receipts, clipboard replacement and D5b change splitting remain required; D5a waived tokens-per-turn. See [acceptance](phases/02-native-extensions-and-explicit-migration/02-ACCEPTANCE-20261108.md). |
| 3 | Not started | Existing TUI observations are not native visual acceptance. |
| 4 | Partial finite mathematical acceptance | Existing R 4.4.3 ran 6,566 host-budget traces and TS/R/Rust DAG/allocation acceptance. Sixty oracle/negative-control tests passed without skips. Broader policy and recovery gates remain open. |
| 5 | Bounded H1–H2i source acceptance, native supervision/reconnect opt-in and explicit GC | Rust supervises Linux commands and publishes durable execution-record prefixes. Coordinator/CLI reconnect preserves original writer/verifier grants, candidates, generation and phase budgets. Explicit native-record GC keeps recoverable/unprovable records and retires only independently proven terminal data; interrupted deletion is retryable. Node retains authority, scheduling and publication. Native snapshots stream with bounded state. Start/revocation provenance and recoverable settled grants survive compaction; Rust enforces original boot-bound phase caps after parent loss. Dropped-grant recovery, native authorization revocation, witness retention, DAG/scripted-agent/session reconnect, desktop and full Rust ledger/scheduler ownership remain incomplete. See [H1](RUST-HOST-01-RESULT.md), [H2b](RUST-HOST-02B-RESULT.md), [H2c](RUST-HOST-02C-RESULT.md), [H2d](RUST-HOST-02D-RESULT.md), [H2e](RUST-HOST-02E-RESULT.md), [H2f](RUST-HOST-02F-RESULT.md), [H2g](RUST-HOST-02G-RESULT.md), [H2h](RUST-HOST-02H-RESULT.md), [H2i](RUST-HOST-02I-RESULT.md) and [stream results](WORKBENCH-STREAM-01-RESULT.md). |
| 6 | Not started | Workspace version is 1.5.11 at the 2026-11-12 source checkpoint; no release performed. |
| 7 | K0 locally complete; first K1 unit in progress, not accepted | T012/I1 and local K0 gate pass. A separate K1 lane is adding the first provider unit and records scoped B1 adoption; current graph/build/replay validation is not complete. No Rust agent runtime is selected. T011 results are historical, not K5 platform acceptance. |
| 8 | Planned, not started | After 2.0.0. Depends on Phase 5 and Phase 7. |
