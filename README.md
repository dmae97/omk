<p align="center">
  <img src="readmeasset/omk-control.webp" alt="OMK//CONTROL Night City Ops Console for routing agents, evidence gates, telemetry, MCP scope, and operator control" width="100%" />
</p>

<h1 align="center">OMK</h1>

<p align="center">
  <strong>OMK//CONTROL — provider-neutral multi-agent control plane for coding workflows.</strong>
</p>

<p align="center">
  Models execute. OMK routes, verifies, measures, and controls.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@omk/cli"><img alt="npm version" src="https://img.shields.io/npm/v/%40omk%2Fcli?color=00D6FF"></a>
  <a href="https://www.npmjs.com/package/@omk/cli"><img alt="npm package" src="https://img.shields.io/badge/package-%40omk%2Fcli-FF47B2"></a>
  <a href="docs/versioning.md"><img alt="runtime" src="https://img.shields.io/badge/runtime-v1.2-9D4EDD"></a>
  <a href="https://github.com/dmae97/open_multi-agent_kit/blob/main/proof/PROOF_INDEX.md"><img alt="proof gate" src="https://img.shields.io/badge/proof--gate-passing-00FFC2"></a>
  <a href="LICENSE"><img alt="license" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
</p>

<p align="center">
  <a href="#install">Install</a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="#current-runtime-algorithm">Runtime algorithm</a> ·
  <a href="docs/getting-started.md">Docs</a> ·
  <a href="readmeasset/ASSET_INDEX.md">Visual assets</a>
</p>

`OMK` (`omk`) turns a coding goal into a bounded, evidence-gated agent run.

> Current package source version: `@omk/cli@0.78.0-alpha.1`.
> Runtime contract family: `v1.2`.
> Release channel: `pre-1.0`.
> See [versioning](docs/versioning.md) and [provider maturity](docs/provider-maturity.md).

## Why OMK

Most coding agents optimize for a single prompt/result loop. OMK wraps agent execution with a control-plane algorithm:

- compile the user goal into a DAG coordinator turn;
- inject only scoped MCP servers, skills, hooks, memory, and tools;
- classify task intent and route to compatible runtime adapters;
- execute with timeout, approval, sandbox, and fallback metadata;
- require evidence before completion claims;
- preserve run artifacts for replay, inspection, and audit.

## OMK//CONTROL visual console

The GitHub visual set presents OMK as a Night City Ops Console: route status, DAG lanes, provider fallback, scoped MCP, evidence gates, and replayable run telemetry. Assets are provenance-covered in [`readmeasset/ASSET_PROVENANCE.md`](readmeasset/ASSET_PROVENANCE.md).

<p align="center">
  <img src="readmeasset/omk_tui.png" alt="OMK//CONTROL terminal dashboard — live DAG lanes, provider routing, MCP health, evidence gates, and telemetry in Night City Ops Console style" width="100%" />
</p>

| Operator TUI                                                                                                                                                                                            | Runtime flow                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <img src="readmeasset/omk-tui-0.78.0.webp" alt="OMK//CONTROL TUI for OMK 0.78.0 showing Codex App OAuth routing, GPT Image 2 asset lane, DAG lanes, scoped MCP, and evidence gates" /> | <img src="readmeasset/omk-runtime-flow-0.78.0.webp" alt="OMK 0.78.0 runtime flow diagram: user goal, intent classifier, DAG compiler, runtime router, parallel workers, evidence bundle, verify gate, and merge replay inspect loop" /> |

| Install lane                                                                     | Provider router                                                                       | Evidence gate                                                                     |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| <img src="readmeasset/omk-install-card.png" alt="OMK install quickstart card" /> | <img src="readmeasset/omk-provider-router-card.png" alt="OMK provider router card" /> | <img src="readmeasset/omk-evidence-gate-card.png" alt="OMK evidence gate card" /> |

<p align="center">
  <img src="readmeasset/omk-core-loop.svg" alt="OMK core loop: goal to DAG plan to evidence to verify to replay" width="100%" />
</p>

## Install

Requires Node.js `>=20` and npm `>=10`.

```bash
npm install -g @omk/cli
omk --help
```

No global install:

```bash
npx -p @omk/cli omk doctor
```

## Quick start

```bash
omk init                         # scaffold AGENTS.md, DESIGN.md, .omk/
omk doctor                       # check runtime, providers, MCP, skills, hooks
omk codex auth --choice plus-pro # prefer official Codex app/CLI OAuth for Codex lanes
omk chat --provider codex --mode agent
omk orchestrate "ship feature" --workers 4 --dry-run
```

## Current runtime algorithm

The canonical algorithm definitions live in [Native Root Runtime Algorithms](docs/native-root-runtime-algorithms.md). README summary:

### 1. Native root turn execution

```text
Read user input
  → dispatch slash commands locally
  → build scoped MCP/skills/hooks capability injection
  → build prompt envelope
  → materialize a DAG coordinator node
  → run selected runtime with timeout/abort handling
  → stream output, sync TODOs, attach evidence
```

This is the interactive root loop used by `omk chat`. It treats shell exits, slash commands, prompt envelopes, TODO sync, and recent output as controlled runtime state instead of loose chat text.

### 2. Native root turn node construction

```text
User prompt
  → infer risk: read | write | shell | merge
  → normalize scoped capabilities
  → choose provider-neutral routing policy
  → attach approval/sandbox metadata
  → produce coordinator DAG node
```

Read-only turns stay read-only. Write, shell, and merge turns get explicit capability metadata. DeepSeek-style advisory lanes are kept read/review when the risk is not safe for write authority.

### 3. Runtime-backed task runner

```text
DAG node
  → run state
  → context capsule
  → provider-neutral AgentTask
  → RuntimeRouter.execute(task)
  → TaskResult with selected runtime + fallback chain
```

OMK converts DAG context into an adapter-neutral task so Codex, MiMo, Kimi API/print lanes, DeepSeek, Qwen, OpenRouter, local adapters, or future runtimes can participate through the same contract.

### 4. Intent-aware runtime routing and fallback

```text
Classify intent
  → filter compatible runtimes
  → score by quality, evidence pass rate, and recent failures
  → execute best runtime
  → fallback in ranked order when a runtime fails
  → record selected runtime, intent, scores, and fallback chain
```

Provider routing is evidence-aware, not just provider-name matching. Failed or low-evidence lanes are penalized; compatible healthy lanes can take over.

### 5. Secure worker transport and scoped environment

```text
Worker prompt
  → stdin transport where supported, not process argv
  → scoped agent file when needed
  → sanitized child environment
  → OMK_RUN_ID / OMK_NODE_ID / OMK_NODE_ROLE metadata
```

Kimi worker prompts use stdin with `--input-format text` where that adapter path applies. All worker environment claims are scoped to the exact adapter and evidence gates; private prompt envelopes and run artifacts remain trusted local data.

## Core loop

```text
Goal → DAG plan → parallel lanes → evidence bundle → verify gate → merge / replay / inspect
```

## What OMK controls

| Surface            | What OMK does                                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------------- |
| DAG orchestration  | Plans, routes, executes, merges, replays, and inspects agent work.                                      |
| Evidence gates     | Requires command output, diff, artifact, metric, or review proof before “done”.                         |
| Provider routing   | Selects compatible runtimes with intent, capability, evidence, and fallback metadata.                   |
| MCP scope          | Keeps project MCP, skills, hooks, and graph memory scoped instead of importing global secrets silently. |
| Worktree isolation | Keeps parallel lanes bounded, reviewable, and recoverable.                                              |
| Operator telemetry | Exposes route, status, blockers, TODOs, run health, and evidence state through CLI/HUD/TUI surfaces.    |
| Security boundary  | Sanitizes child env, protects secrets, and makes workspace-write routes explicit.                       |

## Provider lanes

OMK is provider-neutral. The configured runtime decides which adapters are available, but the control plane is the same:

- **Codex app / CLI OAuth lanes** for Codex-backed coding sessions;
- **MiMo** as the default provider path when configured;
- **Kimi API / print lanes** as explicit provider adapters, not the root identity;
- **DeepSeek, Qwen, OpenRouter, local adapters** for advisory or execution lanes when capability contracts match;
- **GPT Image 2 asset lane** for visual assets when the image workflow is explicitly selected.

## Codex app / OAuth first

For Codex lanes, OMK delegates auth to the official Codex app/CLI and never reads or prints `~/.codex/auth.json` tokens.

```bash
codex login
omk codex auth --choice plus-pro --run
omk provider doctor codex --soft
```

Codex/ChatGPT OAuth is for Codex CLI sessions. `omk image generate/edit --model gpt-image-2` remains an OpenAI Images API call and requires a separate OpenAI Platform project API key. See [Codex OAuth setup](docs/codex-oauth-setup.md) and [OpenAI image keys](docs/openai-platform-image-keys.md).

## CLI and package contract

The npm package is intentionally package-safe:

| Contract          | Value                                                                                                                                                                                                                          |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Package           | [`@omk/cli`](https://www.npmjs.com/package/@omk/cli)                                                                                                                                                                           |
| Version           | `0.78.0-alpha.1`                                                                                                                                                                                                               |
| Runtime family    | `v1.2`                                                                                                                                                                                                                         |
| Bins              | `omk`, `omk-project-mcp`, `omk-acp`, `omk-mcp-host`                                                                                                                                                                            |
| Packaged docs     | `README.md`, `docs/`, `SECURITY.md`, `ROADMAP.md`, `MATURITY.md`, `DESIGN.md`                                                                                                                                                  |
| Packaged branding | Canonical hero/social/TUI/runtime images plus the curated derivative gallery documented in [`readmeasset/ASSET_INDEX.md`](readmeasset/ASSET_INDEX.md) and [`readmeasset/ASSET_PROVENANCE.md`](readmeasset/ASSET_PROVENANCE.md) |
| Excluded          | source-only tests, scripts, local state, logs, secrets, private runtime directories                                                                                                                                            |

Release checks:

```bash
npm run version:check
npm run proof:check
npm run pack:dry
npm run audit:package
```

## Contract versions

Machine-readable contracts currently include:

- `omk.contract.v1`
- `omk.evidence.v1`
- `omk.decision.v1`
- `omk.run-manifest.v1`
- `omk.provider.v1`
- `omk.version.v1`
- `omk.proof-bundle.v1`

Schemas live in the source-tree `schemas/` directory and are checked with:

```bash
npm run schema:check
```

## Known implementation caveats

The runtime algorithms are the current contract target, with adapter-specific hardening still tracked in docs and tests:

- `/provider` is restart-only in the native root loop.
- `/model` is UX debt until live mutation or restart-only behavior is enforced consistently.
- Approval and sandbox metadata are preserved in task contracts; enforcement depends on the adapter path.
- Provider health probes do not yet uniformly separate binary/API presence, auth, model support, and quota state across every adapter.
- Safety claims are scoped to exact adapter, command, evidence, and package-audit results.

## Brand system

Public copy stays OMK-owned: **OMK//CONTROL**, **NEON GRID ONLINE**, route/evidence/loop/control language, and the **Night City Ops Console** palette. The README/NPM hero, social preview, TUI mock, runtime-flow diagram, and derivative gallery are package-safe brand assets with provenance in [`readmeasset/ASSET_PROVENANCE.md`](readmeasset/ASSET_PROVENANCE.md).

## Docs

- [Getting started](docs/getting-started.md)
- [Runtime versioning](docs/versioning.md)
- [Provider maturity](docs/provider-maturity.md)
- [Native root runtime algorithms](docs/native-root-runtime-algorithms.md)
- [Codex OAuth setup](docs/codex-oauth-setup.md)
- [Security policy](SECURITY.md)

## Security

Safe by default: child env is sanitized, ambient secrets are dropped, and workspace-write routes require approval. OS-level sandboxing is planned, not claimed; see [SECURITY.md](SECURITY.md).

## Links

- GitHub: <https://github.com/dmae97/open_multi-agent_kit>
- NPM: <https://www.npmjs.com/package/@omk/cli>
- Releases: <https://github.com/dmae97/open_multi-agent_kit/releases>

## License

[MIT](LICENSE)
