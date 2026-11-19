# OMK 2.0.0 requirements

Existing specifications define detailed behavior. These IDs connect GSD execution
to that source of truth; they are not a replacement specification framework.

## Requirements

- [x] **V2-BOUNDARY-01**: Classify and test native versus legacy extension resolution without accidentally releasing breaking 2.0 semantics as 1.x.
- [ ] **V2-CORE-01**: Final default production core has no reachable Pi runtime dependency or implicit legacy import aliases; verify source and installed artifacts.
- [ ] **V2-MIGRATE-01**: Legacy resources have explicit migration diagnostics; preserve originals and never turn compatibility into approval.
- [ ] **V2-API-01**: OMK owns its versioned extension/provider/tool contract and tests source, packaged Node and bundled entry points.
- [ ] **V2-UI-01**: Rendering consumes a common observation model; renderer choice and visibility do not own service polling/reconnection.
- [ ] **V2-UI-02**: Preserve input, IME, accessibility, image fallback and terminal ownership; verify actual target surfaces.
- [ ] **V2-R-01**: Actual Node outputs pass independent R fixtures for each required mathematical slice; named skips are not acceptance.
- [ ] **V2-RECOVERY-01**: Preserve unknown outcomes, ownership fencing, exactly-once accounting and bounded retry semantics at real entry points.
- [ ] **V2-HOST-01**: Migrate one execution boundary at a time with one authority owner and no duplicate side effects.
- [ ] **V2-DESKTOP-01**: Native workbench uses reviewed dependencies and real runtime observations; graph edits do not manufacture authority.
- [ ] **V2-PLATFORM-01**: Verify installation, upgrade, input, reconnect, recovery and rollback on every claimed desktop platform.
- [ ] **V2-RELEASE-01**: All milestone gates and constitution release conditions pass before lockstep versioning and separately authorized publication.

## Traceability

| Requirement | Phase | Status |
|---|---|---|
| V2-BOUNDARY-01 | Phase 1 | Complete |
| V2-CORE-01 | Phase 2 | Pending |
| V2-MIGRATE-01 | Phase 2 | Pending |
| V2-API-01 | Phase 2 | Pending |
| V2-UI-01 | Phase 3 | Pending |
| V2-UI-02 | Phase 3 | Pending |
| V2-R-01 | Phase 4 | Pending |
| V2-RECOVERY-01 | Phase 4 | Pending |
| V2-HOST-01 | Phase 5 | Pending |
| V2-DESKTOP-01 | Phase 5 | Pending |
| V2-PLATFORM-01 | Phase 6 | Pending |
| V2-RELEASE-01 | Phase 6 | Pending |
