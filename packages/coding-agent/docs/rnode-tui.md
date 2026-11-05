# R·NODE terminal surface (OMK 2.0 TUI)

R·NODE is the terminal TUI view of verified-run nodes. It renders the
`omk.run-graph.v1` snapshot from [`omk run graph`](run-graph.md), the same
versioned observation a planned native DAG view is meant to read, so the
terminal TUI does not fall behind it on graph observation.

It is observation only. It never dispatches, retries, approves, edits the graph
or upgrades VERIFY. A rendered node is not permission to run it.

## Problem

The interactive TUI already projects live session signals through one
`ControlPlaneViewModel`. OMK 2.0 adds a second, differently scoped source: the
verified-run graph from [`readRunGraph()`](run-graph.md). Three constraints shape it.

- The snapshot belongs to one run and one contract, not to the chat session.
  Snapshots arrive as full frames that can skip revisions, so the consumer
  must apply the cursor rules in [`run-graph.md`](run-graph.md): ignore an
  older cursor, reject an incomparable or conflicting one.
- `proofVerdict` is the only verdict. It is never derived from how many nodes
  succeeded.
- The startup header scrolls into scrollback and renders only turn-stable values
  (`DESIGN.md`, Layout). A graph changes during a turn, so R·NODE renders only on
  viewport-anchored surfaces.

## Usage (caller's view)

In an interactive session:

```text
/rnode dag                         bind run `dag` under the default state root
/rnode dag --state-dir ./runs      same, with a state root relative to the session cwd
/rnode                             show the binding and whether the last read succeeded
/rnode off                         unbind and stop polling
```

Without `--state-dir` the state root is `verified-runs` under the OMK agent
directory, the same default as `omk run graph`. The run ID must match the
verified-run ID rule, so a path such as `../x` is rejected before any read.
R·NODE then appears at the bottom of the control-pane overlay, which shows in the
expanded view (Ctrl+O by default) when the status sidebar is not pinned. One
binding exists per session; binding again replaces it.

In code, the pure layer:

```ts
import { EMPTY_RNODE_FEED, reduceRunGraph, buildRNodeViewModel } from "./rnode/rnode-model.ts";
import { renderRNodePanel } from "./rnode/rnode-panel.ts";

let feed = EMPTY_RNODE_FEED;

// Poll or receive a full snapshot. Offering the same frame twice is a no-op.
feed = reduceRunGraph(feed, readRunGraph(stateRoot, runId));
if (feed.last === "conflict") log("rejected a conflicting snapshot; kept the previous one");

// Viewport-anchored surface (overlay or pinned sidebar) only.
const lines = renderRNodePanel(buildRNodeViewModel(feed), { width: 44, maxRows: 20 });
```

The bottom of the 38-column overlay in a real tmux session on 2026-11-05, bound
to a fixture run whose `right` task failed its first attempt (colour stripped):

```text
│─ SESSION ────────────────────────────────│
│ cwd: /tmp/rnode-cwd                │
│ git: ?                             │
│─ R·NODE ─────────────────────────────────│
│   run: dag · rev 14 · gen 1        │
│ proof: ◐ inconclusive              │
│  feed: ✓ live                      │
│  exec: paused/settled              │
│  vrfy: not_requested               │
│   app: not_requested               │
│   pub: none                        │
│─ L0 ─────────────────────────────────────│
│ ✓ done      left  a1               │
│ ! failed    right  a1              │
│─ L1 ─────────────────────────────────────│
│ ? pending   join  a0  ← left, rig… │
└────────────────────────────────────┘
```

`exec` is execution/settlement. `vrfy`, `app` and `pub` are verification,
application and publication, verbatim from `state`, one row each so the longest
value (`reconciliation_required`) fits. They stay independent axes; none of them
is the proof. At 34 terminal rows the same pane keeps its bottom edge and shows
`+3 more` in place of the nodes that do not fit.

## Shape

Data flows one way: `RunGraphSnapshot` → `RNodeFeedState` → `RNodeViewModel` → lines.

- `rnode-model.ts` owns snapshot ordering and projection, both pure.
  - `reduceRunGraph(state, next)` implements those rules: binding mismatch,
    same-cursor conflict, componentwise-older stale, incomparable regression,
    duplicate, and generation regression. A rejected frame keeps the previous
    snapshot and records why in `last`. Applying a frame twice converges to the
    same state.
  - `buildRNodeViewModel(state)` layers nodes by longest dependency path (Kahn).
    The wire validator already rejects cycles and unknown dependencies, but the
    in-process reader is trusted rather than revalidated, so nodes on a cycle go
    to a final unordered layer and absent IDs stay visible instead of vanishing.
  - One function maps each node status to `UiAuthorityState`. A `succeeded` node
    from an older generation reads `~ prior gen`, matching `blockedBy` in
    `dag-explanation.ts`. Proof and feed cells use the same vocabulary, so
    colour still comes only from `authorityStyle`.
- `rnode-panel.ts` renders with the existing rail helpers (`sidebarRule`,
  `semanticBoxTextLine`, `boxTextLine`). Every ID passes through
  `singleLineDisplayText`. When rows run out it prints `+N more` instead of
  clipping silently, and an over-long ID or dependency list ends in `…`.
- `rnode-controller.ts` owns the session's one binding. `bind` reads once,
  then polls `readRunGraph` every 2 s through an unref'd timer; `clear` and
  `dispose` stop it. A failed read keeps the last snapshot and turns `feed`
  into `~ unreadable`. It records only the error code (`run_missing`,
  `ENOENT`), because raw messages can carry local paths. A repaint is
  requested only when the panel input changes.
- `rnode-command.ts` parses `/rnode` and resolves the state root. It never
  accepts execution, approval or retry flags.
- `renderControlPanelRightPane(content, width, rows)` appends R·NODE after
  SESSION when `content.rnode` returns a binding. It gives R·NODE at most 16
  rows and never more than the terminal leaves below the rail. The header
  renderer never calls `content.rnode`.

The pure layer's public surface is four names: `EMPTY_RNODE_FEED`,
`reduceRunGraph`, `buildRNodeViewModel` and `renderRNodePanel`. The session
adds `RNodeController` and `parseRNodeCommand`/`runRNodeCommand`. Cursor rules,
layering, status mapping, polling and truncation stay behind them.

What it deliberately does not do: no session tool DAG, no subagent lanes, no
AdaptOrch remote DAG. [`run-graph.md`](run-graph.md) forbids fabricated agent
nodes, and those graphs have different owners.

## Synthesis decision

Three whole shapes were compared.

- **A. Sibling feed and model (base).** A separate pure reducer and view model
  next to `ControlPlaneViewModel`. It keeps the run-scoped, stateful cursor rules
  out of the session-scoped, stateless builder.
- **B. Fold into `ControlPlaneViewModel`.** Add `runGraph` to the signals and a
  `graph` section to the rail. Grafted from B: the shared authority vocabulary,
  `authorityStyle` as the only state-to-colour mapping, and `railFits` as the only
  layout gate. Rejected as the base because `buildControlPlaneViewModel` is a
  pure function of one read, while the graph needs memory of the previous cursor.
  Folding it in would make the builder stateful or push the cursor rules into
  the adapter.
- **C. Everything is a node.** Render turns, tools and subagents as one session
  graph. Rejected because it mixes graphs with different owners and invents
  nodes that `omk.run-graph.v1` does not contain.

## Tradeoffs accepted

- We accept a TypeScript implementation of the cursor rules in exchange for an
  in-process consumer that needs no native binary. A native consumer would
  need its own copy. On 2026-11-05 a one-off local harness fed this reducer and
  an uncommitted Rust consumer prototype the same 434 wire-valid frame pairs;
  every outcome matched. That prototype and harness are not in this
  repository, so CI does not repeat the comparison.
- We accept a vertical layered list instead of a drawn edge graph in exchange
  for correct rendering at 44 columns and in tmux captures.
- We accept polling full snapshots in exchange for no new event channel. The
  roadmap leaves durable event replay to a later connection contract. Each poll
  is a synchronous journal read on the UI thread. This is cheap for the 16-task
  verified-run profile but was not measured on a large journal.
- We accept that R·NODE shows only in the expanded, unpinned overlay in
  exchange for keeping it off the scrollback header. Users with a pinned status
  sidebar must unpin it (Ctrl+Q) to see R·NODE.

## Alternatives considered

- Rendering by spawning `omk run graph --json` and parsing stdout. It hides the
  same complexity but adds a process boundary and a JSON parse for data the
  in-process reader already returns typed.
- A two-dimensional box-and-arrow layout. It exposes edge routing, crossings and
  width negotiation to every surface, and breaks below MD widths.

## Open questions and risks

- Should the pinned status sidebar also show R·NODE, so pinned users do not
  have to unpin?
- Should the binding survive `/new` and `/resume`? Today it lasts for the
  process and is not saved with the session.
- When a native consumer lands, should both reducers read one shared frame
  fixture so the comparison above runs in CI?

## Next implementation step

Capture the overlay in the paper light theme and add it to the visual QA gate
in `DESIGN.md`.
