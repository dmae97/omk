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
| 2 | Ready to plan | Context, research, test-pattern map and draft validation exist; no runtime/default activation performed. |
| 3 | Not started | Existing TUI observations are not native visual acceptance. |
| 4 | Not started | R executable unavailable in the current session. |
| 5 | Partial pre-existing prototypes | No Rust execution-owner migration claimed. |
| 6 | Not started | Version remains 1.5.10. |
