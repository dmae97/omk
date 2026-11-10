# OMK 2.0.0 migration roadmap

## Target and current status

The owner-declared milestone is **Orbit-based native desktop UI + gpui-flow DAG
views + Rust execution host**, with R as an independent development/CI oracle.
Windows, Linux/WSLg and macOS are target platforms, not currently certified platforms.

The current delivery includes the read-only [run graph observation bridge](run-graph.md)
and an opt-in [Rust sandbox execution host](#h1-real-rust-execution-supervision-2026-11-08) for Linux
verified-run writer/verifier commands. Default execution, durable authority and
scheduling remain Node. There is no migrated desktop application or full Rust
agent controller. Package versions remain unchanged until release gates pass.

This is not a fresh specification framework or a replacement for existing specs.
The repository constitution, existing runtime contracts and accepted N02 fixture remain authoritative.

## Responsibility contract

| Component | Responsibility | Must not do |
|---|---|---|
| Orbit-derived UI | Windows/panels, transcript, files, diff, input, explicit user intents | Manufacture approvals, execution state or verification evidence |
| gpui-flow | Render task nodes and dependency edges; keep coordinates/selection as UI preferences | Turn node movement, deletion or drawing into an execution-graph mutation |
| Rust host, target | Single writer for owned local execution, grants, budgets, settlement and recovery | Run a second scheduler for the same AdaptOrch-owned subgraph |
| AdaptOrch | Explicit policy/advisory or external-run adapter | Acquire local execution authority merely by returning a recommendation |
| R | Independent reference calculations and finite-input checks | Run inside the production agent loop or certify process cleanup from numeric parity |

AdaptOrch integration has two distinct modes. In **policy/advisory** mode the
host schedules the local DAG. In **external-run** mode the host tracks one external
run; AdaptOrch owns its internal work. A lost response is not approval to submit it again.
Existing tool DAG, subagent lanes, verified-run DAG and WPL lifecycle remain distinct.

## Preservation floor

| Existing surface | Required migration evidence |
|---|---|
| CLI, print, JSON, RPC, SDK and terminal TUI | Existing entry points and serialized contracts remain usable |
| Sessions, branches/forks, queues, steering, compaction and retry | Same retained history and explicit input/termination semantics |
| Providers, models, thinking and authentication | Same provider behavior; no credential copying or new remote calls by default |
| Tools, MCP, skills, hooks, extensions and project trust | Inventory and permission parity; custom TUI components need a tested native mapping or an explicitly approved exception |
| Goals, budgets, authority, evidence and publication | Preserve units, ownership, unknown outcomes and approval boundaries |
| Keyboard, IME, clipboard, accessibility and reduced motion | Real application checks on every claimed OS |
| Installation, update, rollback and old sessions | Installed-artifact tests, reversible schema handling and preserved prior engines |

A TUI fallback alone does not make a missing desktop feature complete. Features
are recorded as preserved, natively mapped, explicitly excepted, blocked or unverified;
absence is not counted as success. Existing dirty/staged work is not a disposable baseline.

## Upstream baseline and dependency gate

- Orbit: [`5059142a0b0c8f1431ee4ee2096087d68758040d`](https://github.com/imrj05/orbit/tree/5059142a0b0c8f1431ee4ee2096087d68758040d), Apache-2.0.
- gpui-flow: [`cfa578758ee251657f15f281d893a08b85aedbff`](https://github.com/pacifio/gpui-flow/tree/cfa578758ee251657f15f281d893a08b85aedbff), MIT.
- Orbit uses registry GPUI `0.2.2`; gpui-flow's manifest uses the Zed Git source.
  Select one compatible source/revision and verify the resolved lock before integration.
- Review the selected dependency graph, build scripts/procedural macros, licenses and
  assets. Preserve Apache notices and modification attribution; do not bulk-copy fonts,
  artwork, branding, marketing or upstream update endpoints.
- Orbit's base client passes `--approve` for project trust. Do not inherit it as
  OMK authorization. UI file/Git/terminal operations require explicit actor and scope boundaries.
- gpui-flow's pinned example explicitly selects `MacPlatform`; it is not an
  all-platform launch recipe. Its keyboard handler invokes undo/redo without a
  read-only guard. Node deletion flags alone do not make the component an
  observation-only view. Gate every graph mutation path before native integration.
- No browser/webview substitute is considered a completed GPUI migration.

## Milestones and gates

| Milestone | Independently rejectable deliverable | Gate | Status |
|---|---|---|---|
| C0 observation bridge | Versioned graph output from real OMK journal/evidence | Targeted source CLI tests; no new scheduler or journal mutation | Implemented; scoped checks below |
| C1 Rust observation consumer | Bounded typed decoding and monotonic full-snapshot view | Rust RED/GREEN and actual Node CLI to Rust binary tests | Implemented; not an execution host |
| U0 compatibility spike | One Orbit/gpui-flow panel from reviewed pinned sources | Resolved GPUI graph; native build and input checks | Partial: adapted GPUI/gpui-flow sample renders on WSLg; Orbit shell and platform parity remain open |
| R0 policy parity | Scope mathematical functions before porting them | Independent expected values, fixed inputs and decision/state checks | Partial: inactive finite DAG port and exact TS/R/Rust gate; broader policy parity remains open |
| H0 host ownership slices | Move one existing execution boundary at a time | Approval, stale-owner fencing, cancellation/settlement, budget and crash tests | Partial: no-execution admission fixture plus opt-in Linux Rust sandbox supervision. Durable grants, scheduling, recovery journal and publication remain Node |
| U1 live workbench | Session/chat/model/skills/MCP/diff/goal views and DAG observations | Feature matrix, real runtime events and reconnect tests | Not implemented |
| P0 platform acceptance | Windows, Linux/WSLg and macOS installation paths | Installed-app behavior, IME/clipboard, recovery and resource checks | Not verified |
| Release 2.0.0 | Feature and documentation closure | All required gates; constitution's milestone release procedure | Not eligible |

U0 and R0 can proceed independently after their inputs are fixed. C1 does not
imply H0: receiving an observation is not executing a tool. Node/Rust ownership
handover happens only at a verified boundary; do not dual-execute side effects to compare implementations.

## UI/host connection rules

1. Version UI/host control separately from the existing public RPC and private N02 wire.
   The current `omk.run-graph.v1` is a full observation, not a control protocol.
2. Control messages need command/run/node/attempt identity, host epoch, graph revision,
   expected state and grant binding. Unsupported commands fail closed.
3. A durable event cursor and snapshot boundary define resynchronization. This bridge
   currently provides run and authority journal revisions/digests, not a resumable host event channel.
4. Bound frames, queues and retained data. Coalesce disposable visual progress only;
   never silently drop authority, terminal or evidence records.
5. Separate UI detach, cancel request, observed settlement and host shutdown. An
   unobserved external effect remains unknown and blocks unsafe retry.
6. Execution, settlement, verification, application and publication are independent
   axes. A completed animation or successful graph read grants none of them.

An inactive [no-execution control boundary](workbench-control.md) now implements
a separate `validate-start` envelope and comparison with out-of-band trusted
host/peer lifetimes, identity, epoch and exact command bindings. It issues no
grant and has no production caller or active transport. Production peer enrollment,
durable reconnect, execution handover and the U1 workbench remain open; validation is not
approval or dispatch authority.

The inactive [ownership-bound connection](workbench-control.md#ownership-bound-context)
now derives that context from caller-owned authority/session leases, a reconciled
durable epoch and the exact incarnation. It rechecks released ownership and fresh
committed bytes before a no-execution reply. This adds no peer-authentication
transport, durable reconnect channel or Rust execution owner.

An inactive [local peer adapter](workbench-control.md#local-bearer-authenticated-peer-adapter)
now authenticates a credential frame on a caller-accepted private POSIX socket and
binds its registered peer/lifetime to that connection. It reuses the existing
same-user bearer trust model, not kernel peer credentials. It starts no listener
and adds no workbench frame route, Windows ACL support or durable reconnect.

An inactive [authenticated socket handler](workbench-control.md#inactive-authenticated-socket-handler)
now takes an explicit one-time auth handoff and routes bounded `validate-start`
frames through that connection. It sends ready before reading control input,
retains at most four waiting frames and one response in flight, caps connection
requests at 64 and honors write completion/backpressure. It starts no listener or
production caller and grants no execution. Durable reconnect, U1, Rust execution
ownership and all three platform acceptance gates remain open.

## Numerical verification

The local base-R corpus exercises finite DAG reductions, allocation boundaries and
WPL state pairs. It is separate baseline work, not integrated or shipped by this
observation slice. It does not cover a Rust scheduler, arbitrary numeric policies
or process recovery. R0 must bind and independently review its required artifacts
before claiming a portable verification gate.

Each added mathematical slice fixes input domains/units, missing/non-finite values,
tie-breaking, numeric tolerance and exact decision/state expectations. Consume fixed
random draws/observations rather than relying on cross-language seeds. Independent
small answers and semantic negative controls accompany parity tests. Never regenerate
gold fixtures or widen tolerance merely to make a port pass.

R is optional for running OMK, but a required R acceptance gate must fail when its
executable is unavailable. Start with base R; review `renv`/`testthat` only when needed.
Provider/model/budget-controlled evaluation is a separate product-effectiveness gate.

## Implementation and evidence checklist

- [x] Preserve the existing source/index baseline outside the checkout.
- [x] Add graph CLI/projection tests and observe RED for missing functionality.
- [x] Implement `readRunGraph()`, its pure projection and `omk run graph ID` without changing dispatch.
- [x] Complete `native/omk-workbench` typed consumer and snapshot cache against malformed/stale inputs.
- [x] Exercise actual CLI JSON through the Rust binary; record unavailable optional gates explicitly.
- [x] Run adjacent verified-run regressions, primary diagnostics and `npm run check`.
- [x] Review the scoped diff and update C0/C1 status with observed results.

Each implementation change updates relevant documentation and tests together. Keep
existing `DESIGN.md` TUI rules; add native rules only with the native surface. Roadmap
status is not test evidence, and numeric/version milestones are not release authorization.

### Scoped observations, 2026-11-03

- Before the authority-cursor correction, focused Node tests and adjacent verified-run regressions: **19 passed, zero skipped**,
  including actual source CLI output consumed by the Rust release executable and
  malformed-input rejection. Set `WORKBENCH_TEST_BINARY` explicitly for that gate;
  the test environment intentionally removes unapproved `OMK_*` variables.
- Before that correction, Rust integration tests: **5 passed, zero ignored**; offline/locked check, Clippy
  with warnings denied, release build and formatting check passed.
- The earlier Node run skipped the wire test because its initial environment key
  was scrubbed; it is not counted as interoperability evidence. The corrected run
  executed it. The first Rust GREEN attempt rejected an inconsistent test fixture;
  the fixture was corrected without relaxing the validator.
- Independent review rejected the run-only cursor: unresolved authority grants
  can change proof at an unchanged run revision. A real CLI regression reproduced
  verified/inconclusive/verified with one identical cursor. The corrected contract
  binds both committed journals and rejects mixed-order or genuine conflicts.
- After correction: **21 Node tests passed, zero skipped; 6 Rust tests passed,
  zero ignored**. The source CLI regression also covers authority compaction.
  Offline/locked Rust check, Clippy, release build and formatting passed; primary
  TypeScript diagnostics were clear and `npm run check` exited `0`. Independent
  review is recorded separately against the corrected source digests.
- The scoped documentation links and license notices no longer depend on unrelated
  untracked baseline files. All eleven locked archives' applicable license texts
  were checked against this crate's own notices.
- The initial GPUI offline metadata attempt failed because the Git source was
  absent. A later task-local probe selected one registry GPUI `=0.2.2`, disabled
  gpui-flow's default features and resolved without Git dependencies. This
  supersedes the acquisition blocker, not the remaining U0 gates below.

### U0 local compatibility observations, 2026-11-03

- Locked registry archives and extracted files were compared for 549 dependencies.
  A bounded static operation review inventoried 69 build scripts and 47 procedural
  macro packages; it is not a complete supply-chain or vulnerability audit.
  Native prerequisites were extracted into task-local storage without system
  installation or maintainer scripts. Compilation was offline with private home
  and repository access excluded.
- The unmodified selected combination failed with 46 API errors. The local MIT
  gpui-flow adaptation uses `From<Pixels> for f32` and omits the pinch handler
  unavailable in GPUI 0.2.2. A separate minimal xattr compatibility patch maps
  absent-attribute errors to `ENODATA` on Linux/Android only; two Linux tests
  distinguish absence, value roundtrip and nonexistent files. Other OS behavior
  and native pinch parity remain unverified.
- Nine tests passed through GPUI handlers and the state boundary: destructive
  keyboard input, both connection releases, connection start, observation refresh,
  editable positive controls, selection/layout/pan, modifier-scroll anchoring and
  zoom limits. Disabling protection in a separate seven-test copy produced three
  real assertion failures while four controls passed. This is not per-guard
  mutation coverage or native OS input/IME acceptance.
- A synthetic 960-by-640 native sample rendered under WSLg/X11 with requested
  Mesa software Vulkan and no GPU-device mount. Capture was limited to a unique
  per-run app class with matching process identity. The child exited normally.
  Visual inspection found dark node labels; selecting an explicit node renderer
  corrected the contrast and a fresh owned-window capture confirmed it.
- GPUI's public Linux `window_handle()` panicked as unimplemented on the first
  capture attempt. The harness now identifies its own window using bounded X11
  identity properties instead of patching GPUI or capturing the desktop. No
  authenticated window-control or cross-platform handle guarantee follows.
- This is not an Orbit-derived shell or a live OMK session. It is not installed,
  activated, released or certified on any OS. Some archive license texts and
  additional MPL/test-support redistribution obligations remain unresolved;
  dependency redistribution and a repository GPUI dependency addition are not
  approved. The unavailable UX-audit tooling has no claimed pass.

### R0 finite policy slice

The additive [policy parity gate](policy-parity.md) reuses the original TS/R
corpus and oracle without changing them. The separate dependency-free Rust crate
has no production caller and no authority, execution or host-control surface.
Its acceptance is limited to the documented finite DAG and allocation domain;
WPL, stochastic policies, budgets/charges and crash recovery are not Rust ports.

### H0 no-execution admission slice

The [admission fixture](host-admission-fixture.md) reuses the start input/approval
gate and real durable authority and session-owner primitives. Successful requests
cancel their unused reservation and retain only a dry disposition. Exact retries
return that disposition without another reservation or command execution. Tests
cover stale ownership, epoch/incarnation, authorization expiry, changed meaning,
storage failures and revocation during admission.

The fixture lives under `test/`, with no production caller, control transport or
Rust executor. It is not the workspace/base/sandbox acceptance gate. Production
remains Node, including the correction that now fences cached authority admission
replies against released ownership and changed durable bytes. Authenticated UI
control, reconnect, execution handover, settlement and platform acceptance remain
open. `VerifiedRunApproval` still has no expiry field; the fixture's trusted host
authorization deadline is a separate boundary.

### H1 real Rust execution supervision, 2026-11-08

The Linux execution host is wired into the existing
verified-run broker, not only a test fixture. With an explicit trusted binary
selection, Rust owns each sandbox process, the commit gate, output/time budgets,
cancellation and termination observation. Node commits approval/authority/journal
state before release and independently checks termination. Lost native outcomes
remain quarantined, with no fallback dispatch.

The production budget reducer has an independent base-R prefix-sum/first-violation
oracle and boundary tests. Existing DAG reduction/allocation TS/R/Rust parity is
also executable with an explicitly selected R installation. These finite checks
are not a proof of arbitrary policy correctness or process recovery.

This does not complete the host milestone: durable grant ownership, multi-run
scheduling, sessions/providers, workbench/UI, publication and other platforms
remain on their previous paths or unimplemented. The default and installed engine
are unchanged.

## Pi-independent core staging

The approved 2.0 target also removes implicit Pi compatibility from OMK's default
production core. OMK already owns its runtime packages; absence of a Pi npm
dependency does not establish that legacy import aliases and resource discovery
have been removed. Keep the existing spec-kit governance and
[spec 108](../../../specs/108-pi-decoupling/spec.md) as the contract; GSD tracks
bounded execution slices rather than replacing that specification.

The first slice added `packageManifestDialect: "omk" | "omk+pi"` to
`DefaultPackageManager` construction. Omission preserves current 1.x behavior.
Explicit `omk` mode rejects Pi-only managed-package manifests without falling
through to conventional files. It still accepts native manifests and packages
with neither resource key, and preserves authoritative `omk` precedence and path
validation. This is a package-manager construction boundary, not a CLI setting
or an automatically propagated session SDK policy.

That initial slice did not remove Node/Jiti or Bun aliases, inspect extension dependency
graphs, change direct-loader discovery, replace the native clipboard, or migrate
execution authority to Rust. It adds no R parity coverage and does not satisfy
the milestone's required R acceptance gates. A package-manifest dialect is neither
an import firewall nor a sandbox. Installation, project trust and command approval retain
their separate existing contracts.

Before switching the final 2.0 default, verify the remaining import boundary with
installed-package sentinels, transitive imports and subpaths, plus actual packaged
Node and compiled-binary entry points. Preserve original sessions and notices;
same-publisher dependencies are not automatically Pi runtime dependencies. Keep
the current lockstep version until all milestone release gates pass.

### Explicit native consumer staging, 2026-11-05

The next source slice wires `packageManifestDialect` through native extension
loading and `DefaultResourceLoader`. CLI users can select
`--package-manifest-dialect omk` or `--package-manifest-dialect=omk+pi`.
`omk package doctor <source>` accepts the same syntax before or after its source
to select a static diagnostic target. Invalid or repeated selections fail before
evaluation/preparation. SDK users construct and reload a `DefaultResourceLoader`
and pass it through the existing `createAgentSession({ resourceLoader })` option;
there is no new top-level SDK flag or persisted/environment switch.
See [packages](packages.md#explicit-native-manifest-dialect) for examples.

Native `omk` removes implicit legacy aliases, not ordinary module resolution.
Boundary A allows user-installed Pi dependencies and their transitive imports to
keep their actual package identity. It is not declaration enforcement or a
sandbox. The static doctor distinguishes undeclared legacy literals from exact
runtime dependency declarations, but a declaration warning cannot establish
installation, safe execution or runtime compatibility. It never evaluates or
rewrites the inspected package, and prepares with compatibility selection so
legacy resources remain inspectable.

That staging record kept omission at `omk+pi`. The native default below supersedes it.

### Native default, 2026-11-08

The owner approved switching the default after the Phase 2 combined acceptance.
Omission and `undefined` now select `omk` for the package manager, resource loader,
direct extension loaders, Bun virtual modules and `omk package doctor`.
Compatibility is still available, unchanged, through
`--package-manifest-dialect omk+pi` or `packageManifestDialect: "omk+pi"`. It is
not removed. A native load failure that names a legacy Pi package appends a
migration hint pointing to that option and to the doctor. Doctor preparation
still uses compatibility, so legacy resources stay inspectable.

What breaks without opting in: extensions that import `@earendil-works/pi-*`,
`@mariozechner/pi-*` or `@oh-my-pi/pi-*` without installing them, and packages
that declare only a `pi` manifest. Migrate the imports to `open-multi-agent-kit`,
`omk-ai`, `omk-tui` or `omk-agent-core`, and rename the manifest key to `omk`.
There is no persisted setting or environment switch yet; the opt-in is per
process or per SDK construction.

spec-108 disposition for this switch: the free Terminal-Bench equivalence
criterion was waived by the owner on 2026-11-08. The other 108-2/108-3 criteria
are recorded in the Phase 2 acceptance record. Versions remain 1.5.10 until the
milestone release gates pass.

The six authorized source-work steps are inventory, native wiring,
repository/example migration, local-user preservation, diagnostics/documentation
and verification including real artifacts. They are not ROADMAP Phase 6 or the
whole 2.0 milestone. Desktop/platform acceptance, independent R acceptance and
Rust execution ownership remain required roadmap work. The older spec-108
equivalence, benchmark and module-swap obligations still need an explicit
disposition before activation; they have not been waived or satisfied here.

### Extension memory ownership, 2026-11-06

The next source slice [releases failed-factory subscriptions and retired runtime
references](extension-memory-lifecycle.md). Both manifest dialects retain their
existing behavior, including custom-loader runtime reuse. Six initial regressions
reproduced retained callbacks/listeners; the final focused suite passed 87 tests
and the root compiler passed. The complete root check remains blocked by unrelated
stale subscription-usage build outputs. This is a bounded lifecycle correction,
not a measured whole-process memory reduction or completion of artifact, native
UI, independent R or Rust execution gates.
