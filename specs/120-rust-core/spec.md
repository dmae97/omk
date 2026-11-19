# Spec 120 — Rust core through the headless candidate (K0 to K5)

Status: Draft. Part of the 2.0.0 plan.
Base: branch `2.0.0`, `48fb8e33a8`, plus the uncommitted work recorded in `.planning/STATE.md`.
Scope of this file: spec only; no code, no dependency, no CHANGELOG, no version change.
Decisions: [`decisions.md`](decisions.md). K0 work: [`plan.md`](plan.md), [`tasks.md`](tasks.md).
Plan and measured baseline: [`omk-2-rust-core.md`](../../packages/coding-agent/docs/omk-2-rust-core.md).
Related: [spec 108](../108-pi-decoupling/spec.md) (Pi decoupling), [spec 109](../109-binary/spec.md) (single-binary distribution).

## 1. Problem

- The core is TypeScript on Node: 234,804 raw source lines across seven packages. Rust is
  four crates under `native/`, 4,022 lines including tests, and only `omk-execution` has a
  production caller.
- The owner's 2026-11-10 direction is a Rust core with every Pi dependency replaced and
  existing extensions preserved.
- Extensions are written against Node. 81 of 210 extension source files in this checkout
  import `node:` built-ins, and the documented contract promises npm dependencies and
  unrestricted built-ins.
- There is no contract that says what a Rust core must reproduce, how an extension reaches
  it, or what 2.0.0 contains.

## 2. Decisions this spec builds on

Owner, 2026-11-10:

1. 2.0.0 ships at stage K5.
2. Extensions run on Node, in a host process that is a client of the Rust core.
3. The Rust terminal UI takes the look of the OpenTUI status panel header. That is stage
   K6 and outside this spec.
4. The `omk+pi` compatibility adapter is kept and moves entirely to Rust (§5a).
5. The Rust core supports Linux, macOS and Windows (§8a).

The owner delegated 41 further decisions the same day. They are recorded by ID in
[`decisions.md`](decisions.md), and this spec cites those IDs.

## 3. Harness impact: preserve

This spec changes the implementation language of existing behavior. It adds no capability
and claims no improvement. The following cannot regress, and each is a gate in §7:

- Session files, settings, auth and model overlay formats, and the public RPC wire.
- Provider request bodies and headers.
- Tool results, including truncation and sandbox refusal.
- Extension event order, veto and rewrite semantics, and cancellation.
- Default behavior when the Rust core is not selected.
- Per-platform behavior of the Node core, including what it refuses (§8a).

No solve-rate, cost, latency or memory claim follows from passing these gates. A
performance statement needs its own measurement under `packages/coding-agent/docs/metrics.md`.

## 4. Stages

Every stage is opt-in until its gate passes. Each moves ownership once. The Node and Rust
implementations of one side effect are never run together to compare them; comparison uses
recorded fixtures.

| Stage | Deliverable | Depends on |
| --- | --- | --- |
| K0 contracts | One Rust crate owns the types for session JSONL, the public RPC wire and the extension-host wire, plus the compatibility tables of §5a. TypeScript declarations are generated from it. The capability matrix of §6 exists. The crate builds on all three platforms | Nothing |
| K1 providers | Provider clients, streaming parsers, credential storage, catalog and overlay loading | K0, dependency review |
| K2 loop and sessions | Agent loop, session store, branching, queues, compaction, retry, and the resource loading the system prompt needs | K1 |
| K3 tools | Read, write, edit, bash, grep, find, ls. Sandbox supervision per platform as in §8a, reusing `omk-execution` on Linux | K2 |
| K4 extension host | The wire, the read replica, extension discovery and manifest resolution in Rust for both dialects, and the existing loader running as a client | K2 |
| K5 headless candidate | Print, JSON, RPC and ACP served by the Rust core behind an explicit selection, on Linux, macOS and Windows. Pi-zero on both cores | K3, K4 |

K3 and K4 are independent of each other after K2.

## 5. Extension host

- The Rust core is the single writer for sessions, grants, budgets and settlement. The host
  holds no durable state.
- The core starts the host as a child process over private stdio. Frames are bounded and
  versioned. A version the core does not support fails closed before any extension loads.
- The host runs the existing module loading and `ExtensionAPI` on Node `>=22.19.0`, the
  engine floor of `open-multi-agent-kit`. Extension source is not rewritten or transpiled
  differently. Which entries load is decided by the core (§5a).
- The 28 events accepted by `omk.on` and the 24 `ExtensionAPI` methods in
  `packages/coding-agent/src/core/extensions/types.ts` at the base revision are the surface.
  A handler that returns a value is a request the core waits on, in registration order.
- Synchronous reads (`ctx.sessionManager`, `omk.getActiveTools()`, `ctx.getContextUsage()`)
  are served from a read-only replica that the core feeds with ordered events. The replica
  is consistent with the event being handled; it never answers from a later state.
- The built-in extensions under `src/core/extensions/builtin` (25 files at the base
  revision) are not assumed to be hostable. Several import core internals directly
  (`goal-controller.ts` has 10 such imports, `finish-check.ts` 5, `command-safety-gate.ts`
  2), and under the Rust core that state lives in another process. Each is classified in
  the capability matrix as ported, hosted or refused. One that enforces a safety decision
  is never hosted and never silently absent. Decision F4: safety gates are ported to Rust
  by K3, starting with `command-safety-gate.ts`, and the other built-ins are refused under
  the Rust core in 2.0.0. The K0 matrix task classifies all 25 files.
- Extension-registered providers are hosted (F3). The core calls the host for those models
  and applies the same budgets and cancellation as for its own providers.
- Extension-registered tools execute in the host, outside the core's sandbox supervision.
  The capability matrix states this per tool source. It is not presented as sandboxed.
- If the host exits, the core keeps the session, marks extensions unavailable and does not
  replay a handler that may have produced a side effect. Restarting the host is explicit.
- The host contains no Pi-specific name. Compatibility reaches it only as data (§5a).

## 5a. Compatibility adapter in Rust

Owner decision: the `omk+pi` adapter is kept as an explicit opt-in and is owned by Rust.
Today it is TypeScript: the 14-entry alias table, the legacy-import classifier and the
migration hint in `src/core/pi-compat.ts`, the `pi` manifest key in
`src/core/package-manifest.ts`, and the static diagnosis in `src/core/package-doctor*.ts`.

- **Source of truth.** The dialect values, the alias table, the classifier and the hint
  text are defined once in the K0 contract crate. While the Node core exists, its copies
  are generated from that crate and a hand edit fails the drift check.
- **Manifest resolution.** Under the Rust core, Rust reads package manifests, applies the
  selected dialect (including Pi-only rejection under `omk`) and decides which entry files
  load. The host loads the entries it is given.
- **Import mapping.** A JavaScript import is resolved by the engine that runs it, so the
  substitution itself happens in the host's resolver. The host implements one generic
  mechanism, a specifier map received from the core with the load request. Under `omk` the
  map is empty.
- **Diagnosis.** `omk package doctor` moves with the rest: the scan and its verdicts are
  Rust. It still never evaluates or rewrites the inspected package.
- **Selection.** Unchanged: `omk` by default, `omk+pi` per process or per SDK construction.
  No persisted setting is added by this spec.
- **Bounds.** The adapter maps legacy specifiers onto OMK packages. It installs no Pi
  package and is not a sandbox or a declaration check, exactly as today.

## 6. Capability matrix

A headless Rust core will lack subsystems the Node core has: goals and the verified-run
ledger remain Node (K7), and so may MCP, skills admission, the package manager and
subagent lanes. Each user-visible feature is listed once with exactly one disposition:

- **ported**: implemented in Rust and covered by a parity gate;
- **hosted**: runs in the Node extension host;
- **refused**: selecting the Rust core and using the feature fails with an error that names
  the feature and points to the Node core.

The matrix is a K0 deliverable, generated from or checked against source so it cannot
drift silently. A feature that is absent from the matrix, or that degrades without an
error, fails the K5 gate.

## 7. Gates (deterministic, 100% before K5 is called a candidate)

| Gate | Stage | Check |
| --- | --- | --- |
| G0 | all | Rust core not selected: `test/suite/g0-session-hash.ts` and existing suites unchanged against the base |
| RC1 | K0 | Recorded sessions and RPC transcripts decode and re-encode byte-identically. Regenerating the TypeScript declarations produces no diff; a hand edit fails the check |
| RC2 | K1 | For each provider, request bodies and headers equal fixtures recorded from the TypeScript implementation. The gate makes no network call. Live-credential checks stay opt-in |
| RC3 | K2 | On the offline faux provider corpus, session entries and tool-call order from the Rust core equal the Node core's. Crash and resume at real entry points lose no committed entry and duplicate none |
| RC4 | K3 | Tool results equal the Node core's on the fixture corpus, including truncation markers. With no sandbox available, bash refuses instead of running unsandboxed |
| EH1 | K4 | Conformance corpus: the 80 entries under `examples/extensions`, the project extensions under `.omk/extensions`, and the owner's must-pass list, which stays outside the repository (F1). Event order, tool calls, tool results and session entries equal the Node core's. Every case passes; the owner approves each exception by name (F2). Excepted cases are counted, never dropped |
| EH2 | K4 | Synchronous reads inside a handler return the state of the event being handled |
| EH3 | K4 | `agent_settled`, prompt settlement and session replacement keep their documented order |
| EH4 | K4 | An abort reaches a handler that is running in the host |
| EH5 | K4 | Host killed mid-handler: session intact, extensions reported unavailable, zero handler replays |
| CM1 | K5 | Every feature in the matrix has one disposition. Each `refused` feature has a test that observes the named error |
| RB1 | K5 | A session written by the Rust core is read and continued by the Node core, and the reverse |
| PZ1 | K5 | Packaged Node and compiled artifacts of both cores resolve and require no Pi package. The inventory's `src` scope is empty. `PI_*` variables are classified |
| PA1 | K4 | Under `omk+pi`, the Pi-dialect cases of the conformance corpus equal the Node core's results. Under `omk`, the specifier map is empty and a Pi-only manifest is rejected with the same hint text. The host source contains none of the legacy specifiers |
| PA2 | K0 | Regenerating the Node core's compatibility tables from the contract crate produces no diff |
| WC1 | K4 | The wall time and event throughput the wire adds are measured and reported. The pass threshold is approved before K5 (F5) |
| PL1 | K5 | Gates RC1 to RC4, EH1 to EH5, CM1 and RB1 pass on Linux, macOS and Windows, each run natively on a GitHub-hosted runner (C4, C5). WSL2 counts as Linux. A platform with no run is a failure, not a skip |
| PL2 | K3 | On each platform the Rust core's sandbox decision for bash equals the Node core's on the same machine, including refusal |
| D1 | all | Every crate added to a lockfile has a recorded review covering license, build scripts and procedural macros |

Rules for the gates:

- Never regenerate a golden fixture or widen a tolerance to make a port pass.
- A skipped case is not a pass. Gates that need a tool that is missing fail.
- Fixtures contain no credentials, private prompts or absolute user paths.

## 8. Selection and rollback

- The Rust core is selected explicitly per process with `OMK_RUST_CORE` set to an absolute
  path (E2). Unset means the Node core. There is no persisted setting and no automatic
  selection in 2.0.0.
- The binary ships as a GitHub Release asset for the six targets of C2. The seven npm
  packages are unchanged (E1).
- The selected binary is pinned the way `OMK_RUST_EXECUTION_HOST` is today: an absolute
  path, ownership and mode checks, and a recorded digest. A changed or missing binary is an
  error, never a fallback to the Node core mid-session.
- The core finds `node` on `PATH`, checks the version, and accepts an explicit path
  override (E3). The Bun-compiled binary is not a host (E4).
- Interactive mode on the Rust core is refused until K6.
- The Node SDK (`AgentSession` used in-process) stays on the Node core.
- Rollback is removing the selection. RB1 proves sessions survive it.

## 8a. Platforms

Owner decision: Linux, macOS and Windows are all supported by the Rust core in 2.0.0.
Support here means parity with the Node core on the same platform, which is what a
`preserve` spec can promise. Observed at the base revision:

| Platform | Node core bash sandbox | Verified-run | Rust today |
| --- | --- | --- | --- |
| Linux | bubblewrap, enforced by default | Supported | `omk-execution` supervises it |
| macOS | `sandbox-exec` | Refused (`process.platform !== "linux"`) | Nothing |
| Windows | No backend. Bash is refused under the default `enforce`; the documented path is WSL2 or an explicit `audit` | Refused | Nothing |

Consequences:

- K3 needs a macOS supervisor built on `sandbox-exec`. That is new Rust work with no
  existing slice behind it.
- On native Windows, parity is refusal: the Rust core refuses bash under `enforce` with the
  same message and honors the same explicit `audit` and `off` choices. A native Windows
  sandbox would be an `advance` change and needs its own spec. It is not promised here.
- The binary pin in §8 is written for ELF files and Unix ownership. macOS and Windows each
  need an equivalent check defined before K5, not a weaker one inherited by default.
- The host is a child process over stdio on every platform. Path handling, line endings
  and process-tree termination are tested per platform, not assumed.
- Clipboard replacement (§9) covers the same six targets the current dependency ships:
  darwin arm64 and x64, linux arm64 and x64 (gnu), win32 arm64 and x64.
- All CI jobs currently run on Ubuntu runners, and none runs cargo. Decisions C3 to C7 add
  a macOS job, a Windows job and a cargo job, and build releases natively on those runners.
  No other workflow edit is covered. A run that did not happen is reported as missing.

## 9. Pi-zero

Required for 2.0.0 on both cores:

- `@mariozechner/clipboard` is replaced. The Node core needs a replacement before K5; it
  cannot wait for the Rust UI. Decision G1 selects a native addon built on `arboard` for
  the six targets, subject to dependency review.
- The 14 runtime aliases and the `pi` manifest key are unreachable without the explicit
  `omk+pi` opt-in. They are owned by Rust as §5a describes.
- `PI_*` environment variables are classified. A search of `packages/*/src` finds nine
  `PI_*` identifiers, of which six are environment variables: five are exported to bash
  child processes (`PI_SESSION_ID`, `PI_SESSION_FILE`, `PI_PROVIDER`, `PI_MODEL`,
  `PI_REASONING_LEVEL`, with inherited values deleted first) and one is read
  (`PI_CLIPBOARD_OSC52`). The other three are two strings in a doctor detection pattern and
  one code constant. No `OMK_*` equivalent is exported today. Decision G2: the five exported
  names gain `OMK_*` counterparts and keep their `PI_*` names. The existing removal of
  inherited values applies to both sets.
- `LICENSE` and `NOTICE` keep the original Pi copyright. A Rust port of MIT code is still
  derived work.

## 10. Dependencies

- K0 uses `serde` and `serde_json` only, pinned exactly as the existing native crates pin
  them. If declaration generation needs another crate, that crate goes through review
  first; otherwise the generator is written in the repository.
- K1 cannot start inside that limit. Decisions B2 to B4 select `tokio`, `reqwest` and
  `rustls` as candidates. None enters a lockfile until the owner approves its review bundle
  (B1). Versions and licenses checked on 2026-11-10 are in `harness-survey-2026-11.md` next
  to the plan.
- Code copied from another project must be MIT or Apache-2.0, with the source named at the
  top of the file and `NOTICE` updated for Apache-2.0.

## 11. Test plan

- K0: round-trip tests over a recorded corpus of sessions and RPC transcripts; a
  declaration drift check wired into `npm run check`.
- K1 to K3: fixture recorders that run against the TypeScript implementation, and Rust
  tests that replay them. Recorders and replays live in separate changes so a fixture is
  never produced by the code it judges.
- K4: the conformance runner, plus targeted tests for EH2 to EH5 using a real host process.
- K5: packaged-artifact acceptance in the style of the existing native-extension artifact
  gate, on packaged Node and the compiled binary.
- Every stage: targeted tests, `cargo` check, Clippy with warnings denied and format check
  for touched crates, then `npm run check`.

## 12. Out of scope

- The Rust terminal UI and its design rules (K6).
- Rust ownership of goals, the verified-run ledger and scheduler, MCP, skills, packages and
  subagent lanes (K7). Bounded execution-host slices H1 to H2i are prior work and continue
  there.
- The default flip and removal of the Node core (K8).
- An embedded JavaScript engine.
- The Orbit and gpui-flow desktop workbench.
- Publishing, release tags and version changes. Those follow the constitution.

## 13. Open items

The owner decisions this section listed are closed in [`decisions.md`](decisions.md). What
remains:

- The B1 review bundle for K1. It needs the owner's approval before any crate is added.
- The WC1 threshold, set from the K4 measurement.
- The macOS and Windows equivalents of the binary pin, defined before K5.
- How spec 109 changes when the distributed binary is Rust and the Node host is a
  separate artifact.
- The terminal UI engine. It is K6 work and outside this spec.
