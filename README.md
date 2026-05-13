# oh-my-kimi (OMK)

<div align="center">

[![MseeP.ai Security Assessment Badge](https://mseep.net/pr/dmae97-oh-my-kimi-badge.png)](https://mseep.ai/app/dmae97-oh-my-kimi)

<!-- Open Graph -->
<meta property="og:image" content="https://raw.githubusercontent.com/dmae97/oh-my-kimi/main/readmeasset/omk-social-preview.png" />
<meta property="og:title" content="oh-my-kimi" />
<meta property="og:url" content="https://oh-my-kimi.sbs/" />
<meta property="og:description" content="Verified agent runtime for Kimi Code. Stable daily-use core with alpha orchestration surfaces." />

<!-- Twitter -->
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:image" content="https://raw.githubusercontent.com/dmae97/oh-my-kimi/main/readmeasset/omk-social-preview.png" />

<img src="./readmeasset/kimicat.gif" alt="oh-my-kimi mascot and CLI demo" width="720" />

<h1>oh-my-kimi</h1>

<p><strong>Verified agent runtime for Kimi Code.</strong></p>
<p><sub>Stable daily-use core with alpha orchestration surfaces.</sub></p>
<p><sub>Kimi writes. OMK coordinates, verifies, remembers, and guards.</sub></p>
<p><a href="https://oh-my-kimi.sbs/"><strong>oh-my-kimi.sbs</strong></a> · <a href="https://github.com/dmae97/oh-my-kimi">GitHub</a> · <a href="https://www.npmjs.com/package/@oh-my-kimi/cli">npm</a></p>

<p>
  <a href="https://github.com/dmae97/oh-my-kimi/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/dmae97/oh-my-kimi/ci.yml?branch=main&amp;style=for-the-badge&amp;logo=githubactions&amp;label=CI" alt="GitHub CI" /></a>
  <a href="https://github.com/dmae97/oh-my-kimi/releases"><img src="https://img.shields.io/github/package-json/v/dmae97/oh-my-kimi?style=for-the-badge&amp;logo=github&amp;label=GitHub%20version" alt="GitHub package version" /></a>
  <a href="https://www.npmjs.com/package/@oh-my-kimi/cli"><img src="https://img.shields.io/npm/v/@oh-my-kimi/cli?style=for-the-badge&amp;color=cb3837&amp;logo=npm" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/@oh-my-kimi/cli"><img src="https://img.shields.io/npm/dm/@oh-my-kimi/cli?style=for-the-badge&amp;color=brightgreen&amp;logo=npm" alt="npm downloads" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/npm/l/@oh-my-kimi/cli?style=for-the-badge&amp;color=blue" alt="license" /></a>
</p>

<p>
  <img src="https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&amp;logo=typescript&amp;logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Node.js-20+-339933?style=flat-square&amp;logo=node.js&amp;logoColor=white" alt="Node.js" />
  <img src="https://img.shields.io/badge/Kimi_Code-K2.6-7C3AED?style=flat-square" alt="Kimi Code K2.6" />
  <img src="https://img.shields.io/badge/DAG-runtime-111827?style=flat-square" alt="DAG runtime" />
  <img src="https://img.shields.io/badge/Evidence-gated-059669?style=flat-square" alt="Evidence gated" />
</p>

</div>

---

## The 10-second version

OMK turns Kimi Code CLI into a bounded coding team with isolated worktrees, DAG-based execution, evidence gates before completion, local graph memory, and a live HUD/cockpit for operator control.

- Not a prompt pack.
- Not a model buffet.
- A Kimi-native control plane for shipping code with verification.

```bash
npm install -g @oh-my-kimi/cli
omk init
omk doctor
omk chat
```

Public site and install landing page: **[oh-my-kimi.sbs](https://oh-my-kimi.sbs/)**.

Need the full agent harness?

```bash
omk parallel "refactor auth module with tests"
omk verify --json
omk summary-show
omk cockpit
```

> Current stable package: **v1.1.13**. Stable daily-use core with alpha orchestration surfaces; release-gated and evidence-gated flows are labelled in CLI help and docs.

> **Share your verified run:** open a **Verified run** issue with your raw prompt, generated diff, `omk verify --json`, replay screenshot, and known limitation so others can inspect real evidence.

---

## Why OMK

| Problem | OMK answer |
| --- | --- |
| Agents say "done" too early | Evidence gates require files, diffs, summaries, or passing commands before completion is accepted. |
| Parallel workers corrupt context | Run-scoped state and Git worktrees keep agent lanes isolated until review or merge. |
| Long sessions lose memory | Local graph memory stores goals, decisions, risks, commands, files, evidence, and concepts. |
| Kimi needs operator visibility | HUD and cockpit expose run state, TODOs, ETA, usage, workers, and changed files. |
| Extra models create chaos | Kimi keeps write/merge authority; provider lanes stay advisory, review, QA, or research scoped. |
| Hooks, MCP, and skills drift | `omk doctor`, `omk skill`, `omk mcp`, and generated project assets make the runtime inspectable. |

**Mental model:** Kimi writes. OMK coordinates, verifies, remembers, and guards.

---

## CLI screenshots

### Live HUD

<img src="./readmeasset/omk-hud-screenshot.png" alt="OMK terminal HUD showing run status, workers, usage, and TODOs" width="720" />

### Sidecar cockpit

<img src="./readmeasset/readmeomkcockpit.png" alt="OMK cockpit showing a vertical operator view of run state and tasks" width="720" />

### Graph memory viewer

<img src="./readmeasset/omk_ontology.png" alt="OMK ontology graph viewer for files, goals, decisions, risks, and evidence" width="720" />

### Open Design bridge

<img src="./readmeasset/open-design-localhost.png" alt="Open Design localhost launched from OMK" width="720" />

### Parallel execution

<img src="./readmeasset/parallelmod.png" alt="OMK parallel execution showing worker lanes and progress" width="720" />

---

## Current CLI shape

```text
Start Here
  omk menu       Interactive OMK main menu
  omk init       Project scaffold: AGENTS.md, DESIGN.md, .omk/
  omk doctor     Environment check: CLI, Git, hooks, MCP, skills
  omk chat       Kimi interactive execution
  omk plan       Plan-only execution
  omk hud        Execution status and system usage HUD
  omk mode       Switch execution presets (agent, plan, chat, debug, review)

Stable / daily-use
  omk cockpit    Sidecar cockpit for run state, TODOs, and ETA
  omk design     DESIGN.md and Open Design integration
  omk lsp        Built-in TypeScript LSP run/config output
  omk runs       List past OMK runs with status and dates
  omk history    Alias for runs with filters and export

Advanced / inspectable
  omk graph      Inspect OMK ontology graph
  omk mcp        Inspect MCP configuration and server health
  omk replay     Timeline-based run replay from artifacts
  omk inspect    Forensic run inspection with deep-dive flags
  omk diff-runs  Structural diff between two runs for reproducibility
  omk agent      Agent role listing/show/create/doctor
  omk snip       Snippet save/get/list/search/delete

Alpha / Experimental
  omk parallel   Parallel Kimi coordinator + workers + reviewer
  omk run        DAG-based long-running task execution
  omk verify     Evidence-gate verification for a run
  omk goal       Goal lifecycle management
  omk team       tmux-based multi-agent team execution
  omk research   Kimi-native web research wrapper
  omk spec       GitHub Spec Kit bridge
```

Stable and daily-use commands are the normal operator path. Advanced, alpha, and experimental commands expose stronger orchestration primitives without pretending every surface has the same maturity level.

---

## How the engine works

```mermaid
flowchart LR
  U[User prompt] --> I[OMK intake]
  I --> P[Prompt shaping + project rules]
  P --> G[Goal / DAG compiler]
  G --> S[Scheduler]
  S --> A[Agents, skills, hooks, MCP]
  A --> K[Kimi writer]
  A --> D[Advisory lanes]
  K --> E[Evidence gates]
  D --> E
  E --> M[Graph memory + run state]
  M --> H[HUD / cockpit]
  H --> U
```

### 1. Kimi-native control plane

OMK is built around Kimi Code instead of treating Kimi as a generic backend. Project rules, generated agents, hooks, slash skills, MCP configuration, and run state are shaped so Kimi remains the primary writer and merger.

### 2. DAG execution

A request can become a task graph instead of a single linear prompt. Nodes can carry roles, dependencies, retries, fallback routing, timeout presets, heartbeat monitoring, and evidence requirements. This makes long-running work explicit enough to inspect, resume, verify, or block.

### 3. Evidence gates

OMK does not accept completion by narration alone. A node can require evidence such as:

- file exists
- command passes
- git diff is non-empty
- summary or evidence marker is present

If evidence fails, the runtime can retry, skip, block dependents, or route to fallback handling.

### 4. Decision trace coverage

Every policy decision — routing, context brokering, repair, scheduling, provider selection, ensemble decisions, and skill assignment — is recorded in `.omk/runs/<runId>/decisions.jsonl`. This makes runs inspectable and reproducible rather than opaque.

### 5. Context brokering and budget optimization

OMK manages context as bounded capsules rather than unbounded conversation history. The context broker shapes what each agent receives based on role and task, while the budget optimizer estimates tokens before expensive calls to prevent runaway context accumulation.

### 6. Local graph memory

OMK stores durable project memory as a graph: goals, decisions, risks, tasks, commands, files, evidence, and concepts. The graph gives Kimi a smaller, safer context target before it edits a large repository.

### 7. Worktree isolation

Parallel lanes can run in isolated Git worktrees. That keeps experiments reversible and makes review/merge a deliberate step instead of a side effect of several agents editing the same files at once.

### 8. Skills, hooks, MCP, and agents as runtime inputs

OMK treats project instructions, agent skills, generated hooks, and MCP servers as part of the control plane:

- `AGENTS.md` and `DESIGN.md` define project behavior and UI taste.
- `.omk/` stores run state, memory, plans, reports, and generated runtime assets.
- `omk skill` manages Kimi-facing skills and slash workflows.
- **Skill Assigner** automatically matches skills, MCP servers, tools, and hooks to DAG nodes based on intent and role (14 rules covering web-design, diagram-design, code-review, security-audit, debugging, and more).
- `omk mcp` inspects project and user MCP configuration.
- `omk doctor` checks Kimi, Git, hooks, MCP, skills, and runtime health.

### 9. Ensemble decisions and repair policy

When multiple agents can work on the same node, the ensemble runner evaluates progress, risk, resource utilization, and quality across weighted analytical perspectives. If evidence fails, the repair policy decides whether to retry with context, skip, block dependents, or route to fallback handling — all recorded in decision traces.

### 10. Live operator visibility

`omk hud` and `omk cockpit` expose active work instead of hiding agent state inside logs. The goal is simple: humans should see what is running, what changed, what is blocked, and what still needs proof.

### 11. Advisory provider lanes

OMK can route research, review, QA, or risk analysis through provider lanes such as DeepSeek, but the run stays bounded. Kimi keeps write/merge authority, and external model output is advisory evidence rather than uncontrolled patch authority.

### 12. Open Design bridge

`omk design open-design --open` launches a local Open Design workflow and connects it back to OMK. Use it when the task needs a visual design surface, then bring the output through DESIGN.md-aware implementation and quality gates.

### 13. Run replay and inspection

`omk replay`, `omk inspect`, and `omk diff-runs` turn run artifacts into an inspectable timeline. Replay reconstructs chronology; inspect deep-dives into context, evidence, decisions, and repair chains; diff-runs compares two manifests for reproducibility debugging.

### 14. Native safety path

OMK includes a Rust native safety loader path and CI-backed artifact matrix. JavaScript remains the CLI surface; native safety helpers are selected when available and fall back safely when they are not.

---

## Five operating rituals

| Ritual | Use when | Commands |
| --- | --- | --- |
| **Ship** | You want Kimi to implement with verification | `omk chat`, `omk parallel "..."`, `omk verify` |
| **Inspect** | You need run history or current state | `omk runs`, `omk replay`, `omk inspect`, `omk diff-runs`, `omk summary-show`, `omk hud` |
| **Design** | You need visual/product direction | `omk design`, `omk design open-design --open` |
| **Remember** | You need durable project context | `omk graph view --open`, `omk index` |
| **Guard** | You need safety and release confidence | `omk doctor`, `npm run release:check`, `omk review` |

---

## Example: one prompt to a verified run

```bash
omk init
omk doctor
omk plan "Add a settings page with tests"
omk parallel "Implement the settings page from the plan"
omk verify --json
omk summary-show
```

Expected operator loop:

1. OMK loads project rules, skills, hooks, MCP status, and current Git state.
2. Kimi receives a shaped prompt with explicit constraints.
3. The scheduler creates bounded lanes for implementation, review, or QA.
4. Evidence gates check required files, diffs, summaries, or commands.
5. Graph memory records decisions, risks, files, and evidence for the next run.
6. HUD/cockpit shows progress and remaining blockers.

---

## Reproducible examples

| Example | Prompt -> output | Artifact |
| --- | --- | --- |
| [One-prompt landing page](https://github.com/dmae97/oh-my-kimi/tree/main/examples/one-prompt-landing-page) | Next.js + Tailwind landing page from a single sentence | `RUN_REPORT.md`, video, known limitations |
| [Neon Courier 2D](https://github.com/dmae97/oh-my-kimi/tree/main/examples/neon-courier-2d) | Browser 2D runner game in TypeScript | `RUN_REPORT.md`, source, known limitations |
| [Neon Courier FPS](https://github.com/dmae97/oh-my-kimi/tree/main/examples/neon-courier-fps) | Three.js first-person prototype | `RUN_REPORT.md`, source, known limitations |

<img src="./readmeasset/oneprompt.gif" alt="One-prompt landing page generated through OMK" width="720" />

OMK examples are intentionally honest: prompts, generated outputs, run reports, and known limitations stay visible.

---

## How OMK differs from other oh-my harnesses

| Harness | Best when | Core idea |
| --- | --- | --- |
| OMC | You live inside Claude Code | Team-first Claude Code orchestration |
| OMX | You want a stronger Codex CLI workflow | Codex workflow layer with reusable modes |
| OMO | You want open multi-model routing | Open multi-model agent team with aggressive routing |
| OMK | You want Kimi Code with verification | Kimi-native DAG runtime with evidence gates and graph memory |

OMK is intentionally Kimi-first. Other models can advise, review, or QA, but the run remains bounded by OMK state, safety hooks, graph memory, and evidence gates.

---

## Installation

```bash
npm install -g @oh-my-kimi/cli
omk --version
omk doctor
```

Requirements:

- Node.js 20+
- Git
- Kimi Code CLI installed and authenticated
- tmux for team/HUD workflows on Unix-like systems
- Node.js 24 when launching upstream Open Design locally

Project bootstrap:

```bash
mkdir my-project
cd my-project
omk init
omk doctor
```

Optional DeepSeek advisory setup:

```bash
printf '%s' "$DEEPSEEK_API_KEY" | omk deepseek api
omk deepseek doctor --soft
```

Do not commit provider keys. Keep secrets in environment variables, local keychains, or ignored local config.

---

## Command map

| Area | Commands |
| --- | --- |
| Bootstrap | `omk init`, `omk doctor`, `omk menu`, `omk update`, `omk star` |
| Kimi execution | `omk chat`, `omk plan`, `omk parallel`, `omk run` |
| Verification | `omk verify`, `omk review`, `npm run verify`, `npm run release:check` |
| Operator UI | `omk hud`, `omk cockpit`, `omk runs`, `omk summary`, `omk summary-show` |
| Replay & diff | `omk replay`, `omk inspect`, `omk diff-runs` |
| Context | `omk index`, `omk graph`, `omk sync`, `omk skill` |
| Providers | `omk provider`, `omk deepseek`, `omk research` |
| Design | `omk design`, `omk design open-design --open`, `omk open-design-agent` |
| Advanced | `omk goal`, `omk dag`, `omk team`, `omk merge`, `omk screenshot`, `omk cron`, `omk specify` |
| Tools & presets | `omk mode`, `omk snip`, `omk agent` |
| Workflow presets | `omk feature`, `omk bugfix`, `omk refactor` |

---

## Safety and maturity

OMK has a stable daily-use core, with advanced surfaces explicitly labelled by maturity:

- **Stable / daily-use core:** init, doctor, chat, plan, mode, runs, history, index-show, cockpit, HUD, design, LSP, index, star, update, google, and project inspection surfaces.
- **Advanced inspection:** graph, MCP, replay, inspect, diff-runs, snip, screenshots, provider diagnostics, and design bridges are inspectable but may depend on local project assets.
- **Alpha orchestration:** parallel, run, verify, review, goal, sync, summary, and long-running evidence-gated flows.
- **Experimental surfaces:** tmux team mode, merge automation, agent registry, skill manager, research, feature/bugfix/refactor workflows, spec/DAG/cron, open-design-agent, and provider-routing integrations.

Release confidence is built from local and CI gates:

```bash
npm run verify
npm run native:build
npm run pack:dry
npm run audit:package
npm run smoke:pack
npm run release:check
```

The v1.1.13 release line is release-gated and evidence-gated: bundled MCP server entrypoints, ACP/host transport groundwork, package audit, smoke-pack checks, Rust native artifact normalization, replay/inspect/diff-runs, skill assigner, decision trace coverage, and CI release gates.

---

## Documentation

- [Getting started](./docs/getting-started.md)
- [Verified-run demo evidence skeleton](./docs/demo/verified-run/README.md)
- [Local graph memory](./docs/local-graph-memory.md)
- [HUD and parallel UX](./docs/hud-and-parallel-ux.md)
- [Design and Open Design workflow](./docs/design-md.md)
- [Kimi OAuth and usage status](./docs/kimi-oauth-usage-status.md)
- [Roadmap](./ROADMAP.md)
- [Maturity](./MATURITY.md)
- [Security](./SECURITY.md)

---

## Repository topics

`kimi-code` · `verified-agent-runtime` · `dag-execution` · `evidence-gates` · `graph-memory` · `worktree-isolation` · `mcp` · `agent-skills` · `safety-hooks` · `open-design` · `deepseek-advisory`

---

## Acknowledgements

OMK is part of the broader oh-my agent harness family and is built specifically for Kimi Code users who want stronger execution state, verification, memory, and operator visibility without giving up Kimi as the primary coding authority.

---

## Star history

[![Star History Chart](https://api.star-history.com/svg?repos=dmae97/oh-my-kimi&type=Date)](https://www.star-history.com/#dmae97/oh-my-kimi&Date)
