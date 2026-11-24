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
- [ ] **V2-RUSTCORE-01**: Contracts, providers, agent loop, sessions and built-in tools run in Rust with fixture parity against the TypeScript reference; headless modes are served by the Rust core behind an explicit selection, with verified rollback. (added 2026-11-10)
- [ ] **V2-EXTHOST-01**: Existing extensions run unchanged through a versioned extension-host wire; the conformance corpus compares event order, tool calls, results, session entries and rendered lines, and counts blocked cases. (added 2026-11-10)
- [ ] **V2-PIZERO-01**: The default binary and its declarations resolve, alias and require no Pi package, verified on packaged artifacts; any compatibility adapter is opt-in and outside the core. (added 2026-11-10)
- [ ] **V2-PICOMPAT-01**: The `omk+pi` adapter stays an explicit opt-in and is owned by Rust: tables defined once in the contract crate, manifest resolution and doctor in Rust, and a host that applies a generic specifier map and names no Pi package. (added 2026-11-10)
- [ ] **V2-RUSTPLAT-01**: The headless Rust core passes its gates natively on Linux, macOS and Windows, at parity with the Node core's per-platform behavior including refusals; a platform with no run is a failure. (added 2026-11-10)
- [ ] **V2-RUSTUI-01**: The Rust terminal UI preserves input, IME, images, keybindings and extension-rendered components, in the OpenTUI status panel header look, verified on real terminals. (added 2026-11-10; after 2.0.0)
- [ ] **V2-FLIP-01**: The Rust core becomes the default and the Node core is removed only after every subsystem's acceptance suite passes against the Rust owner. (added 2026-11-10; after 2.0.0)

Decision IDs in the table below refer to `specs/120-rust-core/decisions.md`. A
requirement moved after 2.0.0 is still required; it no longer gates that release.

## Traceability

| Requirement | Phase | Status |
|---|---|---|
| V2-BOUNDARY-01 | Phase 1 | Complete |
| V2-CORE-01 | Phase 2 | Pending |
| V2-MIGRATE-01 | Phase 2 | Pending |
| V2-API-01 | Phase 2 | Pending |
| V2-UI-01 | Phase 3 | Pending, after 2.0.0 (D2) |
| V2-UI-02 | Phase 3 | Pending, after 2.0.0 (D2) |
| V2-R-01 | Phase 4 | Pending, limited to policies ported in K0 to K5 (D3) |
| V2-RECOVERY-01 | Phase 4 | Pending, limited to policies ported in K0 to K5 (D3) |
| V2-HOST-01 | Phase 5 | Pending; remainder after 2.0.0 (D4) |
| V2-DESKTOP-01 | Phase 5 | Pending, after 2.0.0 (D1) |
| V2-PLATFORM-01 | Phase 6 | Pending, after 2.0.0 for the desktop application (D1) |
| V2-RELEASE-01 | Phase 6 | Pending |
| V2-RUSTCORE-01 | Phase 7 | Pending |
| V2-EXTHOST-01 | Phase 7 | Pending |
| V2-PIZERO-01 | Phase 7 | Pending |
| V2-PICOMPAT-01 | Phase 7 | Pending |
| V2-RUSTPLAT-01 | Phase 7 | Pending |
| V2-RUSTUI-01 | Phase 8 | Pending, after 2.0.0 |
| V2-FLIP-01 | Phase 8 | Pending, after 2.0.0 |
