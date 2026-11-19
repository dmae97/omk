# Harness survey, November 2026

Input for [the 2.0 roadmap](omk-2-migration.md) and the Rust core plan in
`omk-2-rust-core.md`. It lists open-source coding-agent harnesses and Rust libraries
checked on 2026-11-10, what each offers that OMK could adopt, and under which terms.

This is a reading list with licenses attached. It approves no dependency and
proposes no feature as accepted work. It makes no ranking or performance claims.

## Copy policy

`AGENTS.md` sets the rule: code may be copied only from MIT or Apache-2.0 projects,
with the source named at the top of the file and `NOTICE` updated for Apache-2.0.
Everything else is a reference for ideas. "Ideas only" below means read the
documentation, design our own, and copy no code, prompts or tests.

A license on a repository is not a license on every file in it. Check the file and
any bundled third-party notices before copying.

## Harnesses

License as reported by the GitHub API on 2026-11-10.

| Project | Language | License | Terms for OMK |
|---|---|---|---|
| [openai/codex](https://github.com/openai/codex) | Rust | Apache-2.0 | Copy allowed with header and `NOTICE` |
| [aaif-goose/goose](https://github.com/aaif-goose/goose) | Rust | Apache-2.0 | Copy allowed with header and `NOTICE` |
| [anomalyco/opencode](https://github.com/anomalyco/opencode) | TypeScript | MIT | Copy allowed with header |
| [google-gemini/gemini-cli](https://github.com/google-gemini/gemini-cli) | TypeScript | Apache-2.0 | Copy allowed with header and `NOTICE` |
| [QwenLM/qwen-code](https://github.com/QwenLM/qwen-code) | TypeScript | Apache-2.0 | Copy allowed with header and `NOTICE` |
| [cline/cline](https://github.com/cline/cline) | TypeScript | Apache-2.0 | Copy allowed with header and `NOTICE` |
| [Aider-AI/aider](https://github.com/Aider-AI/aider) | Python | Apache-2.0 | Copy allowed with header and `NOTICE`. Last push 2026-05-22 |
| [vstaln/gray-pi](https://github.com/vstaln/gray-pi) | Rust | MIT | Copy allowed with header |
| Pi (upstream of OMK's fork) | TypeScript | MIT | Already credited in `NOTICE` |
| [charmbracelet/crush](https://github.com/charmbracelet/crush) | Go | Reported as "Other"; described elsewhere as FSL-1.1-MIT | Ideas only |
| [Dicklesworthstone/pi_agent_rust](https://github.com/Dicklesworthstone/pi_agent_rust) | Rust | Reported as "Other"; its README badge says "MIT + Rider" | Ideas only until the rider is read and cleared |
| [lassejlv/pi-rs](https://github.com/lassejlv/pi-rs) | Rust | No license detected. The README says MIT, the repository root has no license file | Ideas only until a license file exists |
| Claude Code, Cursor | Closed | Not open source | Ideas only, from public documentation |

## What other harnesses do

Sources: a cross-harness teardown published by Loams on
[2026-10-18](https://loams.dev/blog/coding-agent-harnesses), which links a primary
source for each claim; the
[subagent comparison](https://harnessnotes.com/subagents) on Harness Notes; OpenAI's
[app-server write-up](https://openai.com/index/unlocking-the-codex-harness/); and the
READMEs of pi-rs and pi_agent_rust. Read the primary source before writing a spec
from any row.

The "OMK today" column is a keyword search of `packages/coding-agent/src`,
`packages/agent/src` and `packages/ai/src` on 2026-11-10. "Not found" means the
search found nothing, which is weaker than "absent".

### Architecture

| Capability | Seen in | OMK today | Note for 2.0 |
|---|---|---|---|
| Core as a long-lived server with thin clients | Codex `app-server`: JSON-RPC 2.0 over stdio JSONL, with websocket and unix-socket transports marked experimental. OpenCode: HTTP server with an OpenAPI spec and an event stream | `--mode rpc` and `--mode acp` exist. No long-lived shared daemon | This is the shape of the Rust core plan: one owner process, UI and extension host as clients |
| Schema generated from the core's types | Codex exports TypeScript schema from its Rust protocol crate | Wire types are authored in TypeScript in `omk-protocol` | Stage K0 of the plan. Generating in one direction removes a class of drift |
| Submission queue and event queue protocol | Codex `protocol.rs` describes an SQ/EQ pattern between client and agent | Steering and follow-up queues exist in the session layer | Compare semantics before designing the extension-host wire |
| TypeScript extensions without Node | pi-rs and pi_agent_rust embed QuickJS through `rquickjs`, strip types with `oxc`, and shim Node APIs. gray-pi does the same as a plugin | Extensions load in-process through `jiti` | The plan recommends an out-of-process host first. See its tier table |
| Parity fixtures generated from the reference implementation | pi-rs renders golden fixtures from the TypeScript version and checks the Rust output line by line | G0 session hash; no cross-implementation fixtures | Idea worth taking for K0, K2 and K6 |
| Extension conformance corpus | pi_agent_rust runs a vendored extension corpus with a must-pass list and per-extension status | Example extensions are tested individually | The conformance gate in the plan follows this idea |

### Safety

| Capability | Seen in | OMK today | Note for 2.0 |
|---|---|---|---|
| OS sandbox on Linux | Codex: bubblewrap plus seccomp, Landlock kept as a legacy path | bubblewrap, enforced by default. One file mentions seccomp; Landlock not found | A syscall filter is the visible gap. Verify what the one seccomp reference does first |
| OS sandbox on macOS | Codex, Claude Code and Cursor use Seatbelt through `sandbox-exec` | Seatbelt references found in four files | Confirm coverage before claiming macOS |
| Protected paths inside writable roots | Codex keeps `.git` and its own config directories read-only | Not searched | Cheap to specify and test |
| Network off by default in the write sandbox | Codex disables network in `workspace-write` unless enabled | The verified-run sandbox isolates network. Interactive bash not checked | State the default per mode in one place |
| Egress allow-list through a host proxy | Claude Code routes sandboxed traffic through a proxy with an allow-list | Not found | Ideas only |
| Per-tool allow, ask, deny rules with globs | OpenCode | One file matches a permission-policy pattern | Compare with the existing approval gates before adding a second vocabulary |
| A reviewer model in the approval gate | Codex `auto_review`; Claude Code and Cursor have equivalents | Not found | Each vendor states this does not replace the sandbox. Treat it as prompt reduction, not a boundary |
| Repeated-call detection | OpenCode asks after three identical tool calls | One file matches | Check behavior against that description |
| Denials the model can read | Cursor names the sandbox constraint in the tool output after agents retried blocked commands | Not searched | Applies to every denial path in the Rust tools |
| Fetched pages summarized by a separate call | Claude Code's web fetch returns a model summary, not the page | Not searched | Ideas only |

### Editing and context

| Capability | Seen in | OMK today | Note for 2.0 |
|---|---|---|---|
| Patch envelope edit tool | Codex `apply_patch`: add, delete and update sections, context anchors, no line numbers, lenient marker parsing. OpenCode offers one too | Not found. Exact-text replacement is the edit tool | Candidate second edit format for models trained on it. Codex's parser is Apache-2.0 Rust |
| Repository map | Aider ranks symbols over a tree-sitter dependency graph and sends about a thousand tokens | Not found | Candidate for the Rust core. Measure before adopting |
| Tool outputs cleared before summarizing | Claude Code clears older tool outputs first; OpenCode prunes and keeps a reserved buffer | Compaction exists; ordering not compared | Compare against the current compaction policy |
| Compaction that stops when it thrashes | Claude Code stops auto-compaction after repeated refills | Not searched | Small rule, testable |
| File checkpoints and rewind | Claude Code checkpoints per prompt. Cline and OpenCode keep a shadow git repository. T3 Code writes hidden git refs | `checkpoint` matches are in metacognition, not file state. Three files match a shadow-git pattern | Largest visible gap for interactive use. Hidden refs leave the user's branch untouched |
| Tool definitions loaded on demand | Claude Code loads MCP tool definitions on demand and caps MCP output | Not found | Matters as MCP server counts grow |

### Orchestration and operations

| Capability | Seen in | OMK today | Note for 2.0 |
|---|---|---|---|
| Subagent caps | Codex caps open subagent threads per session, default 6. Claude Code caps nesting at three levels. Goose subagents cannot spawn their own | Concurrency limits found in eleven files | Compare defaults; no change implied |
| One worktree per agent | Claude Code `--worktree`; Cursor runs one model per worktree | Worktree references in 27 files | Present; not compared feature by feature |
| Named presets | Codex added `/presets` in 0.164, per a third-party write-up | Model contracts and loadouts exist | Check overlap before adding a name |
| Telemetry export | Codex ships an OpenTelemetry crate; prompt logging is off by default | Not found | Opt-in only, if at all |
| Acting as an MCP server | Claude Code and T3 Code can be driven by outside agents | Not searched | Follows naturally from a server-shaped core |

## Rust libraries

Version and license from the crates.io API on 2026-11-10. These are candidates for
dependency review. None is approved, and the existing native crates depend on
`serde` and `serde_json` only.

| Need | Crate | Version | License |
|---|---|---|---|
| Async runtime | `tokio` | 1.54.1 | MIT |
| HTTP client | `reqwest` | 0.13.5 | MIT OR Apache-2.0 |
| Server-sent events | `eventsource-stream` | 0.2.3 | MIT OR Apache-2.0 |
| JSON | `serde_json` | 1.0.154 | MIT OR Apache-2.0 |
| CLI parsing | `clap` | 4.6.7 | MIT OR Apache-2.0 |
| Structured logging | `tracing` | 0.1.44 | MIT |
| Terminal UI | `ratatui` | 0.30.2 | MIT |
| Terminal backend | `crossterm` | 0.29.0 | MIT |
| Pseudo-terminal | `portable-pty` | 0.9.0 | MIT |
| Markdown parsing | `pulldown-cmark` | 0.13.6 | MIT |
| Syntax highlighting | `syntect` | 5.3.0 | MIT |
| Clipboard | `arboard` | 3.7.0 | MIT OR Apache-2.0 |
| Credential storage | `keyring` | 4.2.0 | MIT OR Apache-2.0 |
| MCP | `rmcp` | 3.9.0 | Apache-2.0 |
| JSON Schema from types | `schemars` | 1.2.3 | MIT |
| TypeScript types from Rust | `ts-rs` | 12.0.1 | MIT |
| Node addon bridge | `napi` | 3.16.1 | MIT |
| Embedded JavaScript | `rquickjs` | 0.14.0 | MIT |
| Embedded JavaScript | `boa_engine` | 0.22.0 | Unlicense OR MIT |
| Embedded V8 | `deno_core` | 0.413.0 | MIT |
| TypeScript transform | `oxc` | 0.158.0 | MIT |
| WebAssembly host | `wasmtime` | 50.0.1 | Apache-2.0 WITH LLVM-exception |
| Parsing for a repository map | `tree-sitter` | 0.27.2 | MIT |
| Gitignore-aware walking | `ignore` | 0.4.34 | Unlicense OR MIT |
| Content search | `grep` | 0.4.1 | Unlicense OR MIT |
| Text diff | `similar` | 3.2.1 | Apache-2.0 |
| Git | `gix` | 0.90.0 | MIT OR Apache-2.0 |
| SQLite | `rusqlite` | 0.41.1 | MIT |
| File watching | `notify` | 8.2.2 | CC0-1.0 |
| Fuzzy matching | `nucleo` | 0.5.0 | MPL-2.0 |
| Linux Landlock | `landlock` | 0.4.7 | MIT OR Apache-2.0 |
| Linux seccomp | `seccompiler` | 0.5.0 | Apache-2.0 OR BSD-3-Clause |

Notes:

- `nucleo` (MPL-2.0), `notify` (CC0-1.0) and `wasmtime` (LLVM exception) fall
  outside the plain MIT and Apache-2.0 set. Using a crate as a dependency is not
  the same act as copying code, but each still needs a license decision.
- A license on the top-level crate says nothing about its transitive graph. The
  earlier GPUI review inventoried 549 locked dependencies for one UI sample. Expect
  the same order of work for a terminal and HTTP stack.
- `napi` is listed because it allows the reverse bridge: Rust components loaded
  into the current Node core one at a time. That is an alternative staging route to
  the process boundary the plan recommends, and the two can coexist.

## Suggested order of adoption

Ordered by how little each depends on the Rust port.

1. File checkpoints on hidden git refs with a rewind command. Independent of the
   port and useful in the current Node core.
2. Readable denials and the repeated-call rule. Small, testable, and they carry
   into the Rust tools unchanged.
3. Generated protocol types (K0). Unblocks everything after it.
4. A patch-envelope edit tool, offered per model.
5. A syscall filter and protected paths for the Linux sandbox.
6. Repository map and on-demand tool definitions, each behind a measurement.

Nothing here is scheduled. Each item needs a spec, and items that change defaults
need the owner's decision.

## Not verified

The rows above were not checked against each project's source at a pinned commit.
Version-specific details (the Codex subagent default, the `/presets` release, the
OpenCode repeated-call threshold) come from secondary sources and can be stale.
The "OMK today" column is a keyword search and can miss an implementation that
uses different words.
