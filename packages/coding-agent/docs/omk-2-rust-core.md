# OMK 2.0 Rust core plan

Status: **plan, not implementation**. Recorded 2026-11-10 on branch `2.0.0` at
`48fb8e33a8`. Workspace and published versions are 1.5.10 and stay there until the
release gates in [the migration roadmap](omk-2-migration.md) pass. The contract for
stages K0 to K5 is spec 120, `specs/120-rust-core/spec.md`. Every decision behind
it is recorded by ID in `specs/120-rust-core/decisions.md`, and the K0 work is laid
out in `plan.md` and `tasks.md` in the same directory.

## Owner direction, 2026-11-10

The owner set three targets for 2.0:

1. Replace every remaining Pi dependency. Nothing in the default core may resolve,
   alias or require a Pi package.
2. Migrate the core from TypeScript to Rust.
3. Keep extensions working. Existing TypeScript extensions are a preserved surface,
   not a casualty of the rewrite.

This widens the earlier target. Until now the roadmap moved one execution boundary
at a time to Rust and left Node as the production owner. The staging rule survives:
one authority owner per boundary, no dual execution of side effects, and no default
flip without acceptance evidence. What changes is the end state. Node stops being
the owner of the core and becomes the runtime of the extension host.

This document is a plan for review. It approves no dependency, starts no port, and
does not replace `specs/constitution.md` or
[spec 108](../../../specs/108-pi-decoupling/spec.md).

## Owner decisions, 2026-11-10

The owner answered five of the open questions the same day.

| Question | Decision | Consequence |
|---|---|---|
| What 2.0.0 means | 2.0.0 ships at stage K5 | Stages K6 to K8 follow in later releases. See [2.0.0 release scope](#200-release-scope) |
| Extension runtime | Extensions run on Node | Tier 1 below is the 2.0 design. An embedded engine is not 2.0 work |
| Terminal UI | The look of the OpenTUI status panel header | Recorded as the K6 visual direction. See [Terminal UI direction](#terminal-ui-direction) |
| Pi compatibility adapter | Kept, and moved entirely to Rust | The tables, manifest dialect and doctor are owned by Rust. See [Compatibility adapter](#compatibility-adapter) |
| Platforms | Linux, macOS and Windows | Three-platform acceptance gates K5. See [Platforms](#platforms) |

The owner then delegated the 41 remaining decisions. The agent applied the
recommendations it had already stated, and `decisions.md` records each one. This
document cites them by ID.

## Measured baseline

Measured in this checkout on 2026-11-10. Line counts are raw `wc -l` over
non-generated `.ts` under each package's `src/`, so they include blank lines and
comments.

| Area | Size |
|---|---|
| `packages/coding-agent/src` | 174,884 lines |
| `packages/ai/src` | 21,546 lines |
| `packages/agent/src` | 18,276 lines |
| `packages/tui/src` | 13,487 lines |
| `packages/adaptorch-wpl/src` | 3,419 lines |
| `packages/protocol/src` | 2,462 lines |
| `packages/book-to-skill/src` | 730 lines |
| Rust under `native/` (`src` and `tests`, four crates) | 4,022 lines |

The four Rust crates are `omk-execution` (opt-in Linux sandbox supervisor, the only
one wired into production code), `omk-workbench` (run-graph observation consumer),
`omk-policy` (finite DAG policy port with no production caller) and `omk-runtime`
(offline wire fixture). Each pins `serde` and `serde_json` exactly and has no other
dependency.

The Rust share of the codebase is under two percent. A full core port is a
multi-release effort. Treat any schedule that assumes otherwise as unreviewed.

## Remaining Pi surface

From `node scripts/pi-inventory.mjs --check` (exit 0) and
`specs/108-pi-decoupling/pi-inventory.generated.json`: 9 manifest dependencies,
74 imports or mentions, 14 runtime aliases, 4 alias consumers.

| Surface | Observed today | Replacement |
|---|---|---|
| `@mariozechner/clipboard` | `optionalDependencies` of `packages/coding-agent`, required from `src/utils/clipboard-native.ts`; seven more rows in `scripts/cross-platform-clipboard/package.json` | Clipboard access in the Rust core. `arboard` is a candidate, not an approved dependency. OSC 52 stays as the fallback |
| `@earendil-works/gondolin` | Dependency of the `gondolin` example extension and one root `overrides` entry | A separate project used by one example. Owner decides whether the example stays; it is not a core dependency either way |
| Runtime aliases | 14 specifiers in `LEGACY_PI_RUNTIME_ALIASES` (`src/core/pi-compat.ts`). Consumers: `packages/ai/src/index.ts`, `bundled-virtual-modules.ts`, `loader.ts`, `package-doctor-runtime-imports.ts` | Kept behind the explicit `omk+pi` opt-in. The table is defined in the Rust contract crate; the host receives it as a generic specifier map |
| `pi` manifest key | Accepted only under the explicit `omk+pi` dialect | Manifest resolution for both dialects moves to Rust. `omk package doctor` remains the migration path and moves with it |
| `PI_*` environment variables | Six. Five are exported to bash child processes by `src/core/tools/bash.ts`: `PI_SESSION_ID`, `PI_SESSION_FILE`, `PI_PROVIDER`, `PI_MODEL`, `PI_REASONING_LEVEL`. One is read: `PI_CLIPBOARD_OSC52`. No `OMK_*` equivalent is exported. Three more `PI_*` identifiers in source are not variables OMK uses: two strings in a doctor detection pattern and one code constant | Scripts and extensions may read the five exported names, so they stay, and `OMK_*` counterparts are exported alongside them (G2) |
| Imports and mentions | 74 rows: 68 in test scope, 5 in `src` (one `require`, four mentions), 1 in `scripts` | Ratchet the `src` scope to zero. Test fixtures that prove rejection of legacy imports stay |
| Fork lineage | `omk-ai`, `omk-agent-core`, `omk-tui` and `open-multi-agent-kit` started as a fork of Pi (MIT), recorded in `NOTICE` | A Rust port of MIT code is still derived work. `LICENSE` and `NOTICE` keep the original copyright after the port |

"Pi-zero" is a 2.0.0 gate, so it has to hold for the Node core as well as the Rust
core. It is met when all of the following are verified on packaged artifacts and
not only on source:

- The default install resolves and requires no Pi package. In practice this means
  the clipboard dependency is replaced in the Node core before K5.
- Aliases and the `pi` manifest key are unreachable without an explicit opt-in.
  That is already true since the native default, and the opt-in stays.
- Every `PI_*` variable is classified, and the five exported to bash have `OMK_*`
  counterparts.
- The `src` scope of the inventory has zero rows.

## Target architecture

```text
┌──────────────────────── omk (Rust binary) ────────────────────────┐
│ CLI and modes: interactive, print, json, rpc, acp                 │
│ Session store, agent loop, compaction, goals, budgets, authority  │
│ Providers and model catalog        Built-in tools and sandbox     │
│ MCP client, skills, packages       Terminal UI                    │
└───────┬───────────────────────────────────────────┬───────────────┘
        │ extension-host wire (versioned, private)  │ public RPC / ACP
┌───────▼──────────────────────────┐        ┌───────▼──────────────┐
│ Extension host (Node)            │        │ IDEs, SDK clients,   │
│ Module loading and ExtensionAPI  │        │ native workbench     │
│ User extensions, npm deps,       │        └──────────────────────┘
│ specifier map supplied by core   │
└──────────────────────────────────┘
```

The Rust process is the single writer for sessions, grants, budgets and settlement.
The extension host is a client. It can propose, veto where the API already allows a
veto, and render, but it holds no durable state of its own.

### Why an extension host and not an embedded engine

Two Rust ports of Pi run TypeScript extensions inside an embedded QuickJS engine
with Node API shims (see `harness-survey-2026-11.md` in this directory). That removes
Node from the install. It also changes the engine under every extension, and one of
those ports lists the resulting differences in its own README: error text, `Intl`,
missing language features, and a `globalThis` that no longer survives a reload.

What OMK extensions actually use, counted in this checkout:

- 210 TypeScript files under `packages/coding-agent/examples/extensions` and
  `.omk/extensions`, excluding `node_modules`.
- 81 of them import `node:` built-ins. 14 import `node:http`, `node:https`,
  `node:net`, `node:worker_threads` or `node:child_process`.
- The documented contract promises npm dependencies resolved from `node_modules`
  and unrestricted Node built-ins ([Available Imports](extensions.md#available-imports)).

A shim layer would have to reproduce all of that before the first extension loads
unchanged. An out-of-process host runs the same loader on the same engine, so
compatibility starts at parity and the risk moves to one place: the wire.

| Tier | Runtime | Role |
|---|---|---|
| 1 | Node extension host over a private wire | Decided 2026-11-10. Full compatibility with existing extensions |
| 2 | Embedded JavaScript engine | Not 2.0 work. A later option for installs without Node, with its own conformance evidence |
| 3 | MCP servers | Already supported. The right home for heavy integrations |

The cost of tier 1 is that Node stays an install requirement whenever a JavaScript
extension is loaded, and that built-in extensions under
`src/core/extensions/builtin` must be ported to Rust before the core can run
without it. For 2.0.0 the Node requirement is accepted. Whether a given built-in
extension can run in the host is not: several import core internals directly, so
each is classified in the capability matrix. Safety gates are ported to Rust by
K3, and the other built-ins are refused under the Rust core in 2.0.0 (F4).

## Extension compatibility contract

Observed in `src/core/extensions/types.ts` and [extensions.md](extensions.md). The
Rust core must preserve all of it across the wire.

- **Events**: 28 names accepted by `omk.on`, from `resources_discover` and
  `session_start` through `tool_call`, `tool_result`, `user_bash` and `input`.
  Handlers that return a value (blocking a tool call, rewriting input, editing
  context) are requests the core waits on, in registration order.
- **API methods**: 24 on `ExtensionAPI`, including `registerTool`,
  `registerCommand`, `registerShortcut`, `registerFlag`, `registerProvider`,
  `registerMessageRenderer`, `sendMessage`, `sendUserMessage`, `appendEntry`,
  `exec`, `setModel` and `setActiveTools`.
- **Context**: `ctx.ui`, `ctx.sessionManager`, `ctx.modelRegistry`, `ctx.signal`,
  `ctx.compact()`, `ctx.getContextUsage()`, `ctx.getSystemPrompt()` and the command
  context's session replacement calls (`newSession`, `fork`, `navigateTree`,
  `switchSession`, `reload`).
- **Imports**: `open-multi-agent-kit`, `omk-ai`, `omk-agent-core`,
  `omk-agent-core/node`, `omk-tui`, `typebox`. These packages keep shipping as the
  host-side SDK even after their core logic moves to Rust.
- **Custom UI**: dialogs, widgets, status, footer, autocomplete providers, custom
  components, custom editor and message renderers.
- **Providers**: `registerProvider` supplies streaming functions that run in the
  extension. The core must call out to the host for those models.

### Known hard problems

1. **Synchronous reads.** `ctx.sessionManager`, `omk.getActiveTools()` and
   `ctx.getContextUsage()` return synchronously today. Over a wire they cannot ask
   the core. The host needs a read-only replica fed by ordered events from the
   single writer, and a rule for how stale that replica may be inside one handler.
2. **Rendering.** Custom components return terminal lines for a given width and
   receive key input. The Rust UI has to composite lines produced in another
   process, forward input, and survive a host that renders slowly or throws. The
   existing isolation of extension render failures is the behavior to keep.
3. **Ordering and cancellation.** `agent_settled`, prompt settlement and session
   replacement have documented ordering. An abort must reach a handler that is
   mid-flight in the host.
4. **Host loss.** If the host dies, the core keeps its session and reports the
   extensions as unavailable. It must not replay side-effecting handlers on
   restart.
5. **Extension-registered tools.** A tool that executes in the host is outside the
   core's sandbox supervision. Its permission and truncation rules need an explicit
   statement, not an inherited assumption.

### Conformance gate

Compatibility is measured, not asserted. The corpus is the 80 entries under
`examples/extensions`, the project extensions under `.omk/extensions`, and an
owner-supplied must-pass list of installed packages. Each case runs against the
current Node core and the Rust core with the offline provider, and the gate compares
event order, tool calls, tool results, session entries and rendered lines. A case
that cannot run on the Rust core is recorded as blocked or excepted, never dropped
from the count.

## Migration order

Every stage is opt-in until its gate passes, and each moves ownership exactly once.
Stage names continue the `H` series in [the roadmap](omk-2-migration.md#milestones-and-gates).

| Stage | Deliverable | Gate |
|---|---|---|
| K0 contracts | One Rust crate defines session JSONL, public RPC, the extension-host wire and the compatibility tables. TypeScript types are generated from it | Existing sessions and RPC transcripts decode and re-encode byte-identically. No hand-maintained duplicate types |
| K1 providers | Provider clients, streaming parsers, auth storage and catalog loading in Rust | Request bodies and headers match recorded TypeScript fixtures per provider. Live-credential checks stay opt-in |
| K2 loop and sessions | Agent loop, session store, branching, queues, compaction, retry | The G0 session hash matches on the offline provider. Crash and resume tests at real entry points |
| K3 tools | Read, write, edit, bash, grep, find, ls. Reuse `omk-execution` supervision on Linux; new `sandbox-exec` supervision on macOS | Tool output parity including truncation. The sandbox decision equals the Node core's on Linux, macOS and Windows |
| K4 extension host | The wire, the read replica, extension discovery and manifest resolution in Rust, and the current module loading running as a client | The conformance gate above, including its Pi-dialect cases. Host-crash and abort tests |
| K5 headless release candidate | Print, JSON, RPC and ACP modes served by the Rust core behind an explicit selection, on Linux, macOS and Windows. Pi-zero on both cores | Packaged-artifact acceptance on Node and compiled builds, run natively on each platform. Rollback to the Node core verified |
| **2.0.0** | Released after K5 | The roadmap's other release gates and the constitution's milestone procedure |
| K6 terminal UI | Rust renderer, editor, IME, images, keybindings, extension compositing, in the OpenTUI header look | Fixture renders reviewed against the new design rules, then real-terminal checks: IME, clipboard, tmux, reduced motion |
| K7 remaining subsystems | Goals, verified-run ledger and scheduler (continuing H2), MCP, skills, package manager, subagent lanes | Each subsystem's existing acceptance suite, run against the Rust owner |
| K8 default flip | Rust core is the default. Node core removed | All of the above |

K0 comes first because every later stage is judged against fixtures it produces.
K4 is deliberately ahead of the UI: a headless Rust core with working extensions is
independently useful and independently rejectable.

### 2.0.0 release scope

With the release at K5, 2.0.0 contains:

- **Default**: the Node core with the existing terminal UI, Pi-zero.
- **Opt-in**: the Rust core for print, JSON, RPC and ACP modes, selected explicitly
  per process, with extensions running in the Node host.
- **Not included**: a Rust terminal UI (K6), Rust ownership of goals, the
  verified-run ledger and scheduler, MCP, skills, packages and subagent lanes (K7),
  and the default flip (K8).

A headless Rust core that lacks a subsystem the Node core has is only acceptable
if the gap is explicit. Spec 120 requires a capability matrix that marks every
feature as ported, hosted in the Node extension host, or refused with an error
that names it. Silent degradation is a gate failure.

Decisions D1 to D4 narrow the release gates to match. The desktop workbench (U1),
its platform acceptance (P0) and the terminal observation phase move after 2.0.0.
The remaining execution-host ownership slices move to K7. The independent oracle
stays, limited to the policies K0 to K5 port. 2.0.0 then depends on Phase 2,
stages K0 to K5 and three-platform acceptance of the headless core.

### Compatibility adapter

The owner kept the `omk+pi` adapter and asked for it to be fully Rust. Today it is
TypeScript: `src/core/pi-compat.ts` (alias table, legacy-import classifier,
migration hint), the `pi` key in `src/core/package-manifest.ts`, and the static
diagnosis in `src/core/package-doctor*.ts`.

- The dialect values, alias table, classifier and hint text are defined once, in
  the K0 contract crate. While the Node core exists its copies are generated.
- Under the Rust core, Rust reads manifests, applies the dialect and decides which
  entries load. `omk package doctor` moves with it.
- One part cannot leave Node. A JavaScript import is resolved by the engine that
  runs it, so the substitution happens in the host's resolver. "Fully Rust" is
  therefore read as: all Pi-specific policy and data live in Rust, and the host has
  one generic mechanism, a specifier map it receives with the load request. The
  host source names no Pi package.

This pulls extension discovery and manifest resolution forward into K4. The
installer half of the package manager (npm and git operations) stays K7.

### Platforms

The owner decided that Linux, macOS and Windows are all supported. Observed today:

| Platform | Node core bash sandbox | Rust today |
|---|---|---|
| Linux | bubblewrap, enforced by default | `omk-execution` supervises it |
| macOS | `sandbox-exec` | Nothing |
| Windows | No backend. Bash is refused under the default `enforce`; the documented path is WSL2 | Nothing |

Spec 120 is a `preserve` spec, so support means parity with the Node core on the
same platform. Two points follow:

1. macOS needs a new Rust supervisor on `sandbox-exec`. No existing slice covers it.
2. On native Windows parity is refusal, because that is what the Node core does.
   Decision C1 keeps it. A native Windows sandbox is a new capability and a later
   spec.

Every CI job runs on Ubuntu today and none runs cargo. Decisions C3 to C7 add a
macOS job, a Windows job and a cargo job, and build releases natively on those
runners. The release targets are the six the Bun build already ships (C2).

### Terminal UI direction

The owner asked for the look of the OpenTUI header. In this repository that is the
header of the pinned status panel, built in
`src/modes/interactive/opentui-status-render.ts`:

- A rounded-border box on the `surface` background with one cell of horizontal
  padding.
- A label and value row laid out at opposite ends (`OMK` and `Status`), then the
  model in bold ink, then the provider in muted ink.
- Below it, label and value pairs, muted section headings, and meters drawn with
  `━` over a `╌` trough.

For K6 this becomes the language of the whole Rust UI rather than of one panel.
Three points need care:

1. `DESIGN.md` for the terminal UI currently requires square hairline frames, and
   the OpenTUI panel is the one rounded exception. Adopting the header look
   reverses that rule. The `DESIGN.md` change belongs to the K6 spec, not to this
   plan. Until then the existing rules govern the existing UI.
2. Palette roles, accent dosage and the status vocabulary (glyph plus text, never
   color alone) are independent of frame shape and carry over.
3. This is a visual direction, not an engine choice. `@opentui/core` is a Node
   package that needs Node 26.4 and FFI, so the Rust binary cannot link it as it
   stands. Whether K6 ports the existing differential renderer or builds on a Rust
   library is still open, and no longer blocks 2.0.0.

This reading takes "header feel" as the look of that panel. If the owner meant
restyling the current TypeScript UI for 2.0.0, that is separate work on the Node
core and is not planned here.

Rules that carry over unchanged:

- Never run the Node and Rust implementations of one side effect to compare them.
  Compare recorded fixtures.
- Never regenerate a golden fixture or widen a tolerance to make a port pass.
- R stays a development oracle for numeric policy. It is not part of the product.
- Each stage updates docs and tests in the same change.

## What does not move

- The seven npm packages keep their names. `open-multi-agent-kit` becomes the
  installer for the Rust binary plus the extension host; the library packages
  become the extension SDK.
- `packages/initcheck` and `packages/promptguard` are Go modules outside the
  lockstep version. Folding them into the Rust workspace is a separate decision.
- Session files, `settings.json`, `auth.json`, `models.json` and the `~/.omk`
  layout. A user must be able to roll back to the last Node core and read the same
  sessions.
- The Orbit and gpui-flow desktop work. It is a client of the public RPC and does
  not depend on this plan.

## What is still open

The owner's questions are closed in `specs/120-rust-core/decisions.md`. Three
things still need the owner before the stage that uses them:

1. **The K1 dependency review.** `tokio`, `reqwest` and `rustls` are selected as
   candidates (B2 to B4). None enters a lockfile until the owner approves the review
   bundle (B1). K0 needs no new crate.
2. **The wire cost threshold.** K4 measures and reports it. The pass threshold is
   approved before K5 (F5).
3. **The terminal UI engine.** Port the existing renderer or build on a Rust
   library. It is K6 work and does not block 2.0.0.

## Verification status of this document

Checked: version, branch and head; Pi inventory script exit status and counts;
line counts; extension file and import counts; event and method counts from
`types.ts`; native crate dependencies from each `Cargo.toml`.

Corrected 2026-11-10: an earlier revision counted nine `PI_*` environment
variables and assumed built-in extensions could run in the host unchanged. Both
were wrong and are fixed above.

Not checked: what each internal import of a built-in extension does, whether every
one of the 28 events has a blocking return path, and any claim about another project beyond what its
README or the cited survey states. No code was built or run for this plan.
