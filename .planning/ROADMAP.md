# OMK 2.0.0 execution roadmap

This is the GSD execution index for the existing OMK migration. The root
`ROADMAP.md` contains earlier harness history; preserve it as historical evidence.
The constitution and existing specifications remain authoritative.

## Milestone v2.0.0: Pi-independent OMK

- [x] **Phase 1: Pi-independent core boundary** (completed 2026-11-05)
- [ ] **Phase 2: Native extensions and explicit migration**
- [ ] **Phase 3: Observation ownership and TUI redesign**
- [ ] **Phase 4: Independent R parity and recovery**
- [ ] **Phase 5: Native workbench and Rust host slices**
- [ ] **Phase 6: Platform and milestone release acceptance**

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

### Phase 4: Independent R parity and recovery

**Goal:** Expand required finite oracle slices and verify ownership, budget and
settlement behavior at real runtime entry points.
**Depends on:** Phase 2.
**Requirements:** V2-R-01, V2-RECOVERY-01

### Phase 5: Native workbench and Rust host slices

**Goal:** Reuse existing observation prototypes, resolve dependency obligations,
and migrate execution ownership only at verified boundaries.
**Depends on:** Phase 3, Phase 4.
**Requirements:** V2-HOST-01, V2-DESKTOP-01

### Phase 6: Platform and milestone release acceptance

**Goal:** Verify actual installations and rollback on claimed platforms, close
documentation gaps, then follow the constitution's milestone release procedure.
**Depends on:** Phase 5.
**Requirements:** V2-PLATFORM-01, V2-RELEASE-01

## Progress

| Phase | Status | Evidence |
|---|---|---|
| 1 | Complete | Final goal verification 4/4, all three review findings resolved, 266 targeted tests and root check passed. |
| 2 | Native default and combined artifact gates passed; phase closure remains open | Node/Bun/types/source acceptance passed for candidate `019d076c…`; exact-origin revalidation and current package fingerprint match passed. Native default is `omk`, explicit compatibility remains. Remaining spec-108 criteria are separate. See [acceptance](phases/02-native-extensions-and-explicit-migration/02-ACCEPTANCE-20261108.md). |
| 3 | Not started | Existing TUI observations are not native visual acceptance. |
| 4 | Partial finite mathematical acceptance | Existing R 4.4.3 ran 6,566 host-budget traces and TS/R/Rust DAG/allocation acceptance. Sixty oracle/negative-control tests passed without skips. Broader policy and recovery gates remain open. |
| 5 | Bounded H1–H2g source acceptance, native supervision/reconnect opt-in and explicit GC | Rust supervises Linux commands and publishes durable execution-record prefixes. Coordinator/CLI reconnect preserves original writer/verifier grants, candidates, generation and phase budgets. Explicit native-record GC keeps recoverable/unprovable records and retires only independently proven terminal data; interrupted deletion is retryable. Node retains authority, scheduling and publication. Native snapshots stream with bounded state. Start/revocation provenance survives compaction for retained grants; dropped-grant recovery, witness retention, DAG/scripted-agent/session reconnect, desktop and full Rust ownership remain incomplete. See [H1](RUST-HOST-01-RESULT.md), [H2b](RUST-HOST-02B-RESULT.md), [H2c](RUST-HOST-02C-RESULT.md), [H2d](RUST-HOST-02D-RESULT.md), [H2e](RUST-HOST-02E-RESULT.md), [H2f](RUST-HOST-02F-RESULT.md), [H2g](RUST-HOST-02G-RESULT.md) and [stream results](WORKBENCH-STREAM-01-RESULT.md). |
| 6 | Not started | Version remains 1.5.10. |
