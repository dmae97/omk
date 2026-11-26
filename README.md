<h1 align="center">OMK</h1>

<p align="center">
  <strong>Open Multi-Agent Kit</strong><br />
  Make “done” pass a check.
</p>

<p align="center">
  An open-source multi-agent coding CLI for your terminal: switch models in one
  session and finish a goal only when your test passes.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/open-multi-agent-kit"><img alt="npm version" src="https://img.shields.io/npm/v/open-multi-agent-kit?style=flat-square&label=npm" /></a>
  <a href="https://www.npmjs.com/package/open-multi-agent-kit"><img alt="npm downloads per month" src="https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2Fdmae97%2Fomk%2Fbadges%2Fnpm-downloads.json&style=flat-square" /></a><br />
  <a href="https://github.com/dmae97/omk/releases/latest"><img alt="latest GitHub release" src="https://img.shields.io/github/v/release/dmae97/omk?style=flat-square&label=release" /></a>
  <a href="https://github.com/dmae97/omk/actions/workflows/ci.yml"><img alt="CI status" src="https://img.shields.io/github/actions/workflow/status/dmae97/omk/ci.yml?branch=main&style=flat-square&label=CI" /></a>
  <a href="https://github.com/dmae97/omk/stargazers"><img alt="GitHub stars" src="https://img.shields.io/github/stars/dmae97/omk?style=flat-square" /></a><br />
  <a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/npm/l/open-multi-agent-kit?style=flat-square" /></a>
  <img alt="supported Node.js version" src="https://img.shields.io/node/v/open-multi-agent-kit?style=flat-square" />
  <a href="https://discord.gg/zgCX5uRy4"><img alt="Join the official OMK Discord" src="https://img.shields.io/badge/Discord-join%20the%20community-5865F2?style=flat-square&amp;logo=discord&amp;logoColor=white" /></a>
</p>

<p align="center">
  <a href="#60-second-start">60-second start</a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="#what-runs-by-default">Default or opt-in?</a> ·
  <a href="#context-cache-and-memory">Context &amp; memory</a> ·
  <a href="#evidence-and-limits">Evidence and limits</a><br />
  <a href="#faq">Choosing OMK</a> ·
  <a href="packages/coding-agent/docs/index.md">Documentation</a> ·
  <a href="https://discord.gg/zgCX5uRy4">Discord</a>
</p>

<!-- Community PR authors: non-owner, non-bot accounts with a pull request directly in dmae97/omk.
     Include open, merged, and closed PRs; keep the profiles in alphabetical order. -->
<h2 align="center">Built with our community</h2>

<p align="center">
  Thank you to everyone who has opened a pull request directly in OMK.<br />
  Your time, ideas, and care help this project grow.
</p>

<table align="center">
  <tr>
    <td align="center"><a href="https://github.com/2409324124"><img src="https://avatars.githubusercontent.com/u/89211418?v=4" width="68" height="68" alt="@2409324124" /><br /><sub><strong>2409324124</strong></sub></a></td>
    <td align="center"><a href="https://github.com/Abhinav3499"><img src="https://avatars.githubusercontent.com/u/143208042?v=4" width="68" height="68" alt="@Abhinav3499" /><br /><sub><strong>Abhinav3499</strong></sub></a></td>
    <td align="center"><a href="https://github.com/AndreIsraelAO"><img src="https://avatars.githubusercontent.com/u/209568354?v=4" width="68" height="68" alt="@AndreIsraelAO" /><br /><sub><strong>AndreIsraelAO</strong></sub></a></td>
    <td align="center"><a href="https://github.com/anhnt256"><img src="https://avatars.githubusercontent.com/u/19179293?v=4" width="68" height="68" alt="@anhnt256" /><br /><sub><strong>anhnt256</strong></sub></a></td>
    <td align="center"><a href="https://github.com/AnushreeKasturi"><img src="https://avatars.githubusercontent.com/u/219416439?v=4" width="68" height="68" alt="@AnushreeKasturi" /><br /><sub><strong>AnushreeKasturi</strong></sub></a></td>
    <td align="center"><a href="https://github.com/arrafipd"><img src="https://avatars.githubusercontent.com/u/125668433?v=4" width="68" height="68" alt="@arrafipd" /><br /><sub><strong>arrafipd</strong></sub></a></td>
  </tr>
  <tr>
    <td align="center"><a href="https://github.com/aryankalantri"><img src="https://avatars.githubusercontent.com/u/184456664?v=4" width="68" height="68" alt="@aryankalantri" /><br /><sub><strong>aryankalantri</strong></sub></a></td>
    <td align="center"><a href="https://github.com/dannyward630"><img src="https://avatars.githubusercontent.com/u/71604164?v=4" width="68" height="68" alt="@dannyward630" /><br /><sub><strong>dannyward630</strong></sub></a></td>
    <td align="center"><a href="https://github.com/HangMine"><img src="https://avatars.githubusercontent.com/u/32837290?v=4" width="68" height="68" alt="@HangMine" /><br /><sub><strong>HangMine</strong></sub></a></td>
    <td align="center"><a href="https://github.com/imsurya26"><img src="https://avatars.githubusercontent.com/u/219236223?v=4" width="68" height="68" alt="@imsurya26" /><br /><sub><strong>imsurya26</strong></sub></a></td>
    <td align="center"><a href="https://github.com/joshuaallgaier2-cmd"><img src="https://avatars.githubusercontent.com/u/285511128?v=4" width="68" height="68" alt="@joshuaallgaier2-cmd" /><br /><sub><strong>joshuaallgaier2-cmd</strong></sub></a></td>
    <td align="center"><a href="https://github.com/laozhej"><img src="https://avatars.githubusercontent.com/u/104217479?v=4" width="68" height="68" alt="@laozhej" /><br /><sub><strong>laozhej</strong></sub></a></td>
  </tr>
  <tr>
    <td align="center"><a href="https://github.com/lj1166"><img src="https://avatars.githubusercontent.com/u/187236931?v=4" width="68" height="68" alt="@lj1166" /><br /><sub><strong>lj1166</strong></sub></a></td>
    <td align="center"><a href="https://github.com/mikeytenji"><img src="https://avatars.githubusercontent.com/u/316991671?v=4" width="68" height="68" alt="@mikeytenji" /><br /><sub><strong>mikeytenji</strong></sub></a></td>
    <td align="center"><a href="https://github.com/Muhtasim-Munif-Fahim"><img src="https://avatars.githubusercontent.com/u/204097607?v=4" width="68" height="68" alt="@Muhtasim-Munif-Fahim" /><br /><sub><strong>Muhtasim-Munif-Fahim</strong></sub></a></td>
    <td align="center"><a href="https://github.com/nova-loop"><img src="https://avatars.githubusercontent.com/u/332996007?v=4" width="68" height="68" alt="@nova-loop" /><br /><sub><strong>nova-loop</strong></sub></a></td>
    <td align="center"><a href="https://github.com/pemalama12"><img src="https://avatars.githubusercontent.com/u/221099317?v=4" width="68" height="68" alt="@pemalama12" /><br /><sub><strong>pemalama12</strong></sub></a></td>
    <td align="center"><a href="https://github.com/prascli"><img src="https://avatars.githubusercontent.com/u/11029197?v=4" width="68" height="68" alt="@prascli" /><br /><sub><strong>prascli</strong></sub></a></td>
  </tr>
  <tr>
    <td align="center"><a href="https://github.com/sanketpatel32"><img src="https://avatars.githubusercontent.com/u/77952740?v=4" width="68" height="68" alt="@sanketpatel32" /><br /><sub><strong>sanketpatel32</strong></sub></a></td>
    <td align="center"><a href="https://github.com/Shellghostt"><img src="https://avatars.githubusercontent.com/u/144815351?v=4" width="68" height="68" alt="@Shellghostt" /><br /><sub><strong>Shellghostt</strong></sub></a></td>
    <td align="center"><a href="https://github.com/shishir2305"><img src="https://avatars.githubusercontent.com/u/87112493?v=4" width="68" height="68" alt="@shishir2305" /><br /><sub><strong>shishir2305</strong></sub></a></td>
    <td align="center"><a href="https://github.com/shoaibriazdev"><img src="https://avatars.githubusercontent.com/u/334688131?v=4" width="68" height="68" alt="@shoaibriazdev" /><br /><sub><strong>shoaibriazdev</strong></sub></a></td>
    <td align="center"><a href="https://github.com/Sudhakar7J"><img src="https://avatars.githubusercontent.com/u/35969068?v=4" width="68" height="68" alt="@Sudhakar7J" /><br /><sub><strong>Sudhakar7J</strong></sub></a></td>
    <td align="center"><a href="https://github.com/Unluckyathecking"><img src="https://avatars.githubusercontent.com/u/111193970?v=4" width="68" height="68" alt="@Unluckyathecking" /><br /><sub><strong>Unluckyathecking</strong></sub></a></td>
  </tr>
</table>

<p align="center">
  <sub>Open, merged, and closed pull requests · <a href="https://github.com/dmae97/omk/pulls?q=is%3Apr">Explore OMK pull requests</a></sub>
</p>

<p align="center">
  <a href="https://adaptorch.com/?utm_source=github&utm_medium=readme&utm_campaign=omk-community">
    <img
      src="readmeasset/adaptorch/omk-adaptorch-banner.svg"
      alt="OMK writes and runs code. AdaptOrch checks what it wrote. correctness_claim: false — it ran, and this is what happened."
      width="100%"
    />
  </a>
</p>

<p align="center">
  <strong>OMK writes and runs the code. AdaptOrch checks what it wrote.</strong><br />
  When an agent's “done” is not enough for your review, AdaptOrch keeps a record of what actually ran
  and what happened, and every report says <code>correctness_claim=false</code>.<br />
  <sub>A separate, optional product: OMK never calls it by default.
  <a href="#omk--adaptorch">How it fits</a> |
  <a href="https://adaptorch.com/?utm_source=github&utm_medium=readme&utm_campaign=omk-community#pricing">Plans</a> |
  <a href="https://adaptorch.com/claim-boundary?utm_source=github&utm_medium=readme&utm_campaign=omk-community">Claim boundary</a></sub>
</p>

<h3 align="center">AdaptOrch on arXiv</h3>

<p align="center">
  <a href="https://arxiv.org/abs/2602.16873"><img alt="arXiv 2602.16873" src="https://img.shields.io/badge/arXiv-2602.16873-b31b1b?style=flat-square" /></a>
  <a href="https://adaptorch.com/research/?utm_source=github&utm_medium=readme&utm_campaign=omk-community"><img alt="AdaptOrch research summary" src="https://img.shields.io/badge/adaptorch.com-research-111111?style=flat-square" /></a><br />
  <em>AdaptOrch: Task-Adaptive Multi-Agent Orchestration in the Era of LLM Performance Convergence</em><br />
  Geunbin Yu, 2026 · cs.MA
</p>

The paper routes each task to a parallel, sequential, hierarchical or hybrid
topology from its dependency graph. It reports 12-23% over static
single-topology baselines with the same underlying models.

| Benchmark (paper Table 2) | Metric | Single best | AdaptOrch | Gain over single best |
| :--- | :--- | ---: | ---: | ---: |
| SWE-bench Verified (500) | pass@1 | 42.8 | **52.6** | +22.9% |
| GPQA Diamond (198) | accuracy | 46.2 | **53.1** | +14.9% |
| HotpotQA distractor (500) | F1 | 68.3 | **76.4** | +11.9% |

<sub>Paper-reported results, not reproduced by OMK. Per the paper, a single top model with
self-consistency voting at the same token budget (Self-MoA, matched) recovers 89% of the gain
over single best. The paper limits its scope to three benchmarks and notes that results depend
on decomposition quality. OMK does not call AdaptOrch by default.</sub>

---

| **CONTROL** | **CHOICE** | **EVIDENCE** |
| :--- | :--- | :--- |
| Keep the work in your terminal and repository. | Switch providers and models in one session. | Define a check before a goal can complete. |

OMK is a lightweight, MIT-licensed AI coding agent for your terminal, written in
TypeScript. Switch models in one session, add subagents when you need them, and
mark a goal done only when your own check passes. It is a standalone CLI, so it
can serve as an open-source alternative to a single-provider agent such as
Claude Code.

> **OMK 2.0 is released; the Rust core is still in progress.** The 2.0.x
> versions are regular releases on GitHub and npm. The shipped breaking change is
> native `omk` package loading. The default agent still runs on Node, and complete
> Pi removal and Rust/platform acceptance remain open.
> See [why 2.0.0](#why-200-and-what-changed).

## 60-second start

You need Node.js 22.19 or newer and a git repository that has a test command.

```bash
npm install -g open-multi-agent-kit --ignore-scripts
cd your-project
omk
```

On the first run OMK opens `/login` (subscription, API key, or local model).
Then, inside OMK, give it a goal and name the check:

```text
/goal Fix the failing test without changing its assertions.
/goal verify npm test
```

OMK asks you to approve the command, runs it, and runs it again after each
settled turn. The goal completes only when it exits 0. Swap `npm test` for your
project's own check.

No global install? Run `npx --ignore-scripts open-multi-agent-kit`. The
standalone binary and the setup details are in [Quick start](#quick-start).

<!-- TODO: terminal demo GIF goes here (install, `omk`, a `/goal verify` run passing).
     Record a real session; do not use a mock-up. -->

If omk helps you, a ⭐ on GitHub helps other people find it.

## Why OMK

An AI saying “done” is not an acceptance check. With `/goal verify`, you choose
the command that checks your goal. OMK runs it after each settled turn and
completes the goal only when it passes on the current workspace. A later edit
makes that evidence stale. The result is only as strong as the check you choose.

```text
/goal Fix the failing test without changing its assertions.
/goal verify node --test check.test.mjs
```

Use a test that exists in your project, or follow the
[small, reproducible goal demo](packages/coding-agent/docs/goal-demo.md).
This is an explicit workflow; ordinary prompts do not enable the gate.

Choose a model, work on your repository, then switch models with `/model` when
another one suits the next step. The conversation stays in the same session.
You can also stop and return later with `/resume` or `omk -c`.

OMK is a standalone CLI, not a plugin for Claude Code or OpenCode. It supports
[subscription providers, API keys, and local models](packages/coding-agent/docs/providers.md).
Start with one agent that reads files, edits code, and runs commands. Add
subagents or explicit verification workflows when you need them; neither is
required for your first task.

### Why 2.0.0 and what changed

2.0.0 marks the move to OMK-native packages by default, rather than silently
loading legacy Pi manifests and substituting Pi SDK imports. That breaks some
existing extension installations, so the owner declared a milestone version.
It does not mean the Rust rewrite is complete. The 2.0.x versions are regular
releases on GitHub and npm, but that release status is not Rust-core acceptance
evidence. The Rust core work below is still open.

| Area | What shipped in the 2.0.0 milestone | What remains |
| --- | --- | --- |
| Native packages | The default manifest dialect is `omk`; Pi-only manifests and imports that relied on implicit aliases no longer load by default | Migrate extension manifests and imports, then check them with `omk package doctor <source>`. Native mode is not proof that every Pi dependency is gone |
| Extension SDK | Session-scoped models and `registerEntryRenderer()` for display-only persisted entries; optional `omk-speak-like-you-eat` companions | Existing extensions still need migration and compatibility checks |
| Suggestions and skills | Next-task suggestions with Tab insertion (`OMK_NEXT_SUGGESTIONS`, flag, default off); clause-aware automatic skill selection | These do not enable multi-agent execution or verify an answer |
| Rust core | K0 contract types and generated TypeScript declarations | Provider, loop, tool and extension-host migration, the K5 headless candidate, and packaged-artifact acceptance on Linux, macOS and Windows |

For native extensions, rename the `pi` manifest key to `omk` and replace legacy
SDK imports with the matching `open-multi-agent-kit`, `omk-ai`, `omk-tui` or
`omk-agent-core` API. Do not enable `omk+pi` just to hide migration failures.
The explicit compatibility adapter remains available for installations that
choose it; it is not the native migration path or the default.

The standalone download bundles the current JavaScript runtime. Needing no
separate Node installation does not make it a Rust-owned agent core. The
opt-in Linux Rust sandbox supervisor is also a separate, bounded capability,
not the full core. The Rust terminal UI and remaining subsystem ownership follow
the headless candidate in the existing staged plan. Upstream copyright and
license notices remain required throughout the port.

See the [migration guide](packages/coding-agent/docs/omk-2-migration.md),
[Rust core plan](packages/coding-agent/docs/omk-2-rust-core.md) and
[published milestone notes](https://github.com/dmae97/omk/releases/tag/v2.0.0) for the scope and gates.
This status note was checked on 2026-11-21; it does not retag or republish 2.0.0.

### At a glance

- **Done means a passing check.** `/goal verify <command>` completes a goal only when your check passes on the current workspace.
- **One session, many models.** Switch with `/model` mid-conversation; resume later with `/resume` or `omk -c`.
- **Sandboxed by default.** Built-in bash runs under `sandbox-exec` or `bwrap`, without network, and fails closed.
- **Opt-in power.** Subagents, MCP servers, skills and extensions load only when you configure them.
- **Honest evidence.** Claims below link to the docs that back them, and the limits are stated next to them.

```mermaid
flowchart TD
  P["Prompt or goal"] --> A["Agent loop"]
  A --> S["Settled turn"]
  S --> R["Response"]
  S -->|"goal verification configured"| V["Run acceptance check"]
  V -->|"pass on current workspace"| D["Goal complete"]
  V -->|"fail"| A
```

The loop uses your selected model and available tools. Subagents, MCP, skills,
and extensions depend on your configuration.

## Quick start

Install from npm (Node.js 22.19 or newer), then start in your repository:

```bash
npm install -g open-multi-agent-kit --ignore-scripts
cd your-project
omk
```

Or run `npx --ignore-scripts open-multi-agent-kit` without a global install.

Or install the standalone binary, which needs no Node.js (macOS, Linux):

```bash
curl -fsSL https://github.com/dmae97/omk/releases/latest/download/install.sh | sh
```

The script checks the download against the release's `SHA256SUMS` and installs
to `~/.omk/bin`; add that folder to your `PATH` as it tells you. Windows builds
are attached to each [release](https://github.com/dmae97/omk/releases/latest).

1. On a first run OMK opens `/login` for you: sign in with a subscription or an
   API key. An existing Claude Code or Codex CLI login can be reused with
   `omk provider adopt`.
2. Run `/model` to choose another available model at any time.
3. Try a read-only first task:

```text
Summarize this repository and identify the commands used to check it.
Read the project configuration to support your answer. Do not edit files.
```

After the reply, use `/model` to choose another configured model and ask it to
review the answer. You stay in the same session. This is manual model switching,
not parallel agents or an independent correctness check.

Ready to see a test-backed goal? Try the [goal demo](packages/coding-agent/docs/goal-demo.md),
then share your result or a reproducible failure in a
[GitHub issue](https://github.com/dmae97/omk/issues). If this workflow is useful,
[star OMK](https://github.com/dmae97/omk) to help other developers find it.

For a bug fix, name the failing behavior and ask for a regression test, the
smallest fix, and the check commands with their exit codes. Review the diff and
those results yourself; a request to run tests does not enable a verification
gate.

Built-in local bash requires `sandbox-exec` on macOS or `bwrap` plus
unprivileged user namespaces on Linux (`sudo apt install bubblewrap` on Debian
and Ubuntu). It blocks network access and fails closed if the backend is missing.
`omk doctor` checks the runtime, credentials, the model a first session would
pick, and the sandbox, and prints the fix for this machine. See
[Bash sandbox setup](packages/coding-agent/docs/sandbox-setup.md), the
[safety boundary](#verification-boundary) and the
[full quickstart](packages/coding-agent/docs/quickstart.md).

## What runs by default

A fresh install starts one agent/tool loop after provider setup. It does not
turn each prompt into a multi-agent workflow or automatically certify its
answer.

| Capability | Fresh-install behavior | Where to start |
| --- | --- | --- |
| File editing, shell commands, saved sessions | Built in; tools run when called by the agent | [Usage](packages/coding-agent/docs/usage.md), [sessions](packages/coding-agent/docs/sessions.md) |
| Tool-call scheduling | `dag-v2` schedules resource conflicts within the agent loop; it does not launch a team | [Runtime algorithms](packages/coding-agent/docs/runtime-algorithms.md#tool-scheduling-and-settlement) |
| Subagents | Optional extension; load it and supply agent definitions | [Subagent setup and examples](packages/coding-agent/examples/extensions/subagent/README.md) |
| MCP servers, extra skills and extensions | Require configured servers or installed resources | [MCP](packages/coding-agent/docs/mcp.md), [skills](packages/coding-agent/docs/skills.md), [extensions](packages/coding-agent/docs/extensions.md) |
| Durable goals | Built in; `/goal <objective>` continues after each settled turn, up to 8 rounds. With `/goal verify <command>` the goal completes only when that check passes on the current workspace | [Acceptance checks](packages/coding-agent/docs/run-protocol.md#acceptance-checks) |
| Protocol verification and advisory judging | Explicit API/workflow opt-in; not a gate on ordinary prompts | [Run protocol](packages/coding-agent/docs/run-protocol.md) |
| Verified runs (`omk run`) | Opt-in CLI and SDK on Linux with `bwrap`; runs an approved command in an isolated copy, checks the result, and supports resume, cancel and cleanup | [Verified run](packages/coding-agent/docs/verified-run.md) |
| Context budgeting | Off by default | [Settings](packages/coding-agent/docs/settings.md#context-budget) |
| AdaptOrch integration | Optional and separate; no service calls by default | [OMK + AdaptOrch](#omk--adaptorch) |

The internal lane launcher and automatic command-sharding primitives are not
connected to the default CLI path. Installing their packages is not the same
as enabling an orchestration workflow.

## Context, cache and memory

OMK manages several distinct resources. A prompt-cache boundary, a local cache,
and the process's RAM are not the same thing; provider cache hits and costs
depend on the provider and the request.

| Layer | What OMK does | Default and scope |
| --- | --- | --- |
| **Prompt prefix** | Preserves the cache boundary when an extension changes only the dynamic tail and the prefix matches byte for byte. | On by default; this does not guarantee a provider cache hit. [`OMK_PREFIX_BOUNDARY`](packages/coding-agent/docs/environment-variables.md) |
| **Context Budget V2** | Reserves response and safety space, keeps required items, and selects representations of optional context that fit. | Off by default; enable globally or for a process. [Context selection](packages/coding-agent/docs/runtime-algorithms.md#context-selection) |
| **Local context cache** | Reuses eligible representation and negative-result entries; cached plans stay in session memory. | Only when Context Budget V2 is enabled. Representations persist per workspace by default; a memory-only option is available. [Settings](packages/coding-agent/docs/settings.md#context-budget) |
| **Session history** | Compaction can summarize earlier context; saved sessions support resume. | Compaction and its settings are separate from persistent knowledge and provider-side caches. [Sessions](packages/coding-agent/docs/sessions.md) |
| **Host resources** | The resource governor can observe host capacity and admission decisions. | `observe` is the default; adaptive throttling requires configuration. [Resource governor](packages/coding-agent/docs/settings.md#resource-governor) |

For one process, opt into context budgeting and keep its cache in session memory:

```bash
OMK_CONTEXT_GOVERNOR=1 OMK_CONTEXT_GOVERNOR_CACHE=memory omk
```

Memory-only changes where entries are kept; it is not a guarantee of lower RAM
use. Cache effectiveness, memory use, latency and cost depend on the workload.
Measure them before claiming an improvement; [turn metrics](packages/coding-agent/docs/metrics.md)
show what can be recorded.

## Evidence and limits

One dated comparison is available below: OMK and mini-SWE-agent on
Terminal-Bench 2.1 with the same base model. The observed success-rate
difference is not statistically significant, and the time budgets differed.
It does not establish overall harness superiority, multi-agent gains, or how
much verification reduces false completion.

OMK targets state-of-the-art quality as a CLI coding-agent harness.
SOTA is not verified.

The evidence you can inspect today covers specific failure modes:

| Behavior covered | Regression evidence | Scope |
| --- | --- | --- |
| Missing test observations produce `inconclusive`; a required failing test produces `fail` | [Protocol tests](packages/protocol/test/protocol.test.ts) | Explicit protocol evaluation, without a waiver |
| Changed artifacts, wrong command bindings, or missing ledger evidence block acceptance | [Evidence binding tests](packages/coding-agent/test/evidence-gate-binding.test.ts) | Strict evidence gate and selected workspace scope |
| A relevant workspace mutation after verification makes the receipt stale | [Freshness tests](packages/coding-agent/test/evidence-freshness.test.ts) | Configured receipt and mutation tracking |
| A durable goal with an approved acceptance check completes only on a passing receipt, and an edit after the check makes that receipt stale | [Goal acceptance tests](packages/coding-agent/test/goal-controller-acceptance.test.ts), [live loop tests](packages/coding-agent/test/suite/goal-acceptance-loop.test.ts) | Approval held by the running OMK process; git work tree; static command lines |
| An effect that may still be live keeps its resource claims through expiry, cancellation and authority restart, until a supervisor confirms termination | [Coordination broker tests](packages/coding-agent/test/coordination-broker.test.ts) | In-process broker with canonical claim keys; no OS fencing |
| A publication is refused unless its read versions, parent revision and receipt binding all still match | [Publication tests](packages/coding-agent/test/coordination-integration.test.ts) | Single accepted snapshot pointer; no multi-file filesystem atomicity |
| Cancellation after dispatch is never reported as cancelled-before-dispatch; the outcome stays unknown until settled | [Operation lifecycle tests](packages/coding-agent/test/coordination-operation.test.ts) | Pure state machine; does not itself stop a remote effect |
| Zero trials is reported as absent evidence rather than zero risk, and a point estimate is not an error rate | [Risk bound tests](packages/coding-agent/test/metacognition-risk.test.ts) | Binomial model under a fixed policy and adequately independent samples |

These tests exercise the gates, not the rate at which they catch real bugs.
An ordinary prompt finishes when its tool loop and queued work settle;
`prompt_settled` is not a correctness verdict.

A useful comparison must hold the model, provider configuration, tasks, budget,
and tool permissions constant, and label default versus opt-in workflows.
Report task success, cost, latency, and false completion (reported complete but
failing the declared checks), with its denominator and per-task outcomes.
The [measurement protocol](packages/coding-agent/docs/metrics.md#controlled-comparison-contract)
defines the reproducibility and privacy requirements. `omk stats` shows local
turn costs and tool failures; it does not score task correctness.

If you evaluate OMK, share a sanitized report and reproduction steps in a
[GitHub issue](https://github.com/dmae97/omk/issues). Include failed and
interrupted runs, not just successful examples.

### Terminal-Bench 2.1 · R8

| Self-measured result | OMK evaluation build | mini-SWE-agent 2.4.6 |
| --- | ---: | ---: |
| Observed success | 75.8% (200/264) | 71.6% (189/264) |
| Recorded cost per trial | $0.581 | $0.759 |
| Median wall time per trial | 482 s | 376 s |

**75.8% observed success · approximately 23% lower recorded model cost per
graded trial.** OMK took longer: 482 s median, compared with 376 s for
mini-SWE-agent. Both used xAI `grok-4.7` at reasoning effort `xhigh` in a
2026-10-05–06 KST run of 89 tasks, with 3 trials per task per harness.

The +4.2 percentage-point success difference is **not statistically significant**
(95% task-level paired-bootstrap CI: −1.9 to +10.2 pp). OMK alone had **150 s
extra per trial** for snapshots, so the time budgets were unequal. This result
covers the **1.3.0 evaluation build `78cc483`**, including unmerged changes,
rather than the published npm package. It is not an official leaderboard result.

<details>
<summary>Benchmark data and evaluation limits</summary>

| Harness | Success rate (88 tasks × 3 trials) | Cost per trial (all 267 trials) | Median wall time per trial (all 267 trials) |
| --- | --- | --- | --- |
| OMK | 75.8% (200/264) | $0.581 | 482 s |
| mini-swe-agent 2.4.6 | 71.6% (189/264) | $0.759 | 376 s |

- The difference is +4.2 percentage points with a 95% confidence interval of
  [−1.9, +10.2] (task-level paired bootstrap). The interval includes zero, so
  this is **not** a statistically significant improvement.
- OMK cost about 23% less per trial but was slower: 482 s median per trial
  against 376 s.
- Audit corrections: trials that tried to read Terminal-Bench sources or
  answers score 0, which turned 4 mini-swe-agent passes and 1 OMK pass into
  failures.
  `prove-plus-comm` is excluded from both sides because our OMK adapter failed
  to start in that task's working directory. Two transient provider errors were
  retried; no trial was excluded.
- OMK failed all three `pytorch-model-recovery` trials because the CLI rejected
  an instruction starting with a dash and a space (fixed in #84). Without that
  task the difference is +5.4 pp [0.0, +10.7].
- Not a leaderboard run: 3 trials instead of the official 5, our own network
  allowlist and apt cache proxy, and OMK alone had 150 s extra for a workspace
  snapshot used in rescoring.

- Costs count only the graded attempt, excluding prior failed retry attempts and
  42 auxiliary model calls made by code inside one mini-SWE-agent task. They are
  not total experiment spend.

Method, per-difficulty results, audit and reproduction notes:
[Terminal-Bench 2.1 report](packages/coding-agent/docs/benchmarks/r8-terminal-bench-2.1.md).

</details>

[Editable figure](readmeasset/omk-terminal-bench-r8.svg) · [Original report review](https://github.com/dmae97/omk/pull/86)

## OMK//CONTROL

The terminal UI shows the selected model, tools, and session status. Additional
signals depend on the integrations you configure.

| In the terminal | What it shows |
| --- | --- |
| Model | Selected provider and model |
| Tools | Available tools and their activity |
| Session | Status and the current conversation |

The header reads `omk v<package.version> · OMK//CONTROL`; the installed package
version is the source of truth.

## Control loop

<details>
<summary>How scope, routing, verification, and replay fit together</summary>

OMK's provider-neutral coding-agent CLI also exposes a multi-agent control
plane for explicitly configured workflows. The stages describe that design,
not what every prompt automatically runs.

| **01 SCOPE** | **02 ROUTE** | **03 VERIFY** | **04 REPLAY** |
| --- | --- | --- | --- |
| Define the task and boundaries. | Choose models and configured tools. | Run the declared checks. | Retain state and evidence for recovery. |

The v0.98.3 SDK rejects incomplete first-party judge responses and exposes
deterministic ties; it is not an automatic TUI judge.

1. Scope the goal, paths, resources, and acceptance predicates. A selected
   orchestration workflow may also supply a DAG; an ordinary prompt remains
   one agent/tool loop.
2. Route work to models, agent skills, MCP tools, and extensions without
   changing the evidence contract.
3. Verify declared checks in explicit evidence workflows. Required failing
   checks block those workflows; advisory judging cannot replace them.
4. Preserve receipts and replay state for bounded session recovery; continue
   durable goals from explicit reducer state.

</details>

## Verification boundary

`AgentSession` built-in local bash uses OS sandbox enforcement by default:
`sandbox-exec` on macOS and `bwrap` plus unprivileged user namespaces on Linux.
Local shell spawns restrict writes to the workspace and OS temporary directory,
disable network access, and fail closed with `sandbox.backend_missing` when an
enforcement backend is unavailable.

This is **not** read-confidentiality or whole-process containment. Other file
tools, extension and custom-tool code, injected or remote `BashOperations`, and
the OMK process keep the permissions of the process running them. Use
[containerization](packages/coding-agent/docs/containerization.md) when the
boundary must cover more than built-in local bash. Explicit evidence workflows
cannot treat missing required evidence as a verified result.

## Providers

<details>
<summary>Provider integrations and published packages</summary>

OMK keeps routing separate from control and evidence. Codex, Claude Code,
OpenCode Zen/Go, Kimi, GLM/ZAI, native xAI/Grok, NVIDIA NIM, and local providers
can participate through `omk-ai` while the run contract stays stable.

Native `xai` keeps subscription OAuth and `XAI_API_KEY` billing separate. See
[provider setup](packages/coding-agent/docs/providers.md),
[provider resilience](packages/coding-agent/docs/provider-resilience.md), and
[Grok integration](packages/coding-agent/docs/grok-harness.md).

## Published packages

| Package | Purpose |
| --- | --- |
| [`open-multi-agent-kit`](packages/coding-agent) | Interactive coding-agent CLI and control plane |
| [`omk-agent-core`](packages/agent) | Agent runtime, tool execution, and DAG scheduling |
| [`omk-ai`](packages/ai) | Unified multi-provider LLM API |
| [`omk-protocol`](packages/protocol) | Versioned run contracts and semantic reducers |
| [`omk-adaptorch-wpl`](packages/adaptorch-wpl) | Work Packet Loop runtime |
| [`omk-book-to-skill`](packages/book-to-skill) | Optional document-to-skill compiler |
| [`omk-tui`](packages/tui) | Differential-rendered terminal UI library |

```bash
npm install omk-agent-core
npm install omk-ai
npm install omk-protocol
omk install npm:omk-book-to-skill@0.98.3
npm install omk-tui
```

</details>

## Repository understanding

<details>
<summary>Optional indexes, retrieval settings, and trust limits</summary>

`v0.97.0` shipped the OpenWiki policy and workflow, but no versioned corpus or
integrity checker. The following integrity/output guards shipped in v0.98.0;
the generated corpus remains optional and is not bundled:

- **`openwiki/`** — absent. The previous untracked corpus was removed after the
  hardened gate proved it carried fabricated evidence: 8 frontmatter symbols
  that no declared source path defines (`AgentLoop`, `getModel`, `DeepWall`,
  `loadExtensions`, `createExtensionRuntime`, `main`), 45 references to `@omk/*`
  package names this repository does not publish, and a
  restatement of this README's `Scope -> Route -> Verify -> Replay` loop as a
  strict engine state machine, which is not what the source implements.
  CI regenerates the corpus; nothing is lost.
- **`scripts/check-openwiki.mjs`** — shipped integrity checker. An `interrupted` corpus
  now fails unless `openwiki/.manual-review.json` binds a review to the exact
  corpus digest, and every frontmatter symbol must bind to one of that page's
  own `source_paths` as a whole identifier.
- **`scripts/check-openwiki-output.mjs`** — output gate. The scheduled workflow
  may write, upload, and open a PR for `openwiki/` and nothing else, so a model
  reading this repository cannot reach `AGENTS.md`, `CLAUDE.md`, or the workflow
  that runs it. The gate runs once before the artifact leaves the read-only
  generating job and again before the PR, because the publishing job holds write
  permissions the first one does not.
- **`.understand-anything/`** — optional local structural graph used by Pi Lens;
  it is not published or injected into prompts by default. To reach a session,
  attach it through OMK's [MCP client](packages/coding-agent/docs/mcp.md) like
  any other server; there is no second, bespoke path for it.

Source and tests remain authoritative. Shipped guards do not turn a generated
index into authority: treat corpus pages as local advisory data and recheck source.

### Retrieval

A corpus no session can read is documentation of a plan, not a feature, so the
pages are now candidates for prompt budgeting. Enable `contextBudget.openwiki`
alongside `contextBudget.enabled`
([settings](packages/coding-agent/docs/settings.md#repository-wiki-retrieval))
and each page becomes a low-priority `evidence` item ranked against the turn's
query. Pages compete for leftover budget and can never displace instructions or
skills; most turns carry titles and declared symbols alone, and a page's text
arrives only when the query earns it.

Admission mirrors `scripts/check-openwiki.mjs` rather than restating it. A
complete corpus at the current `HEAD` offers page text; one whose `HEAD` has
moved offers titles only and is marked stale; an interrupted corpus is refused
unless a review binds to its exact digest. The default is off, and with the
setting off the prompt is byte-identical to one built without a corpus.

</details>

## Prior art

<details>
<summary>Research references, not OMK benchmark results</summary>

The design decisions behind OMK's context, routing, memory, and orchestration
layers are grounded in published work rather than invented in isolation. Each
row below was retrieved and read directly; claims are at abstract level, which
is the evidence grade this table asserts and no more.

| Paper | Mechanism it establishes | OMK implementation or design reference |
| --- | --- | --- |
| [arXiv:2608.22752](https://arxiv.org/abs/2608.22752) — *The Compaction Cliff in Long-Running AI Agent Memory* | Uniform summarization erodes rules and episodic logs at the same rate; measured safety-rule retention falls to 53% after one compaction and 10% after five. Type-tagged deterministic operators fix it. | Type-aware compaction triage: rule-typed items survive N rounds byte-identical |
| [arXiv:2608.23023](https://arxiv.org/abs/2608.23023) — *Most of the LLM Routing Gap Is Task Type* | Most routing gain is reachable with a fixed task-type table; run-to-run flips must not be credited as wins. | Frozen task-class table plus the 2-run stability rule in the promotion gate |
| [arXiv:2506.16655](https://arxiv.org/abs/2506.16655) — *Arch-Router: Aligning LLM Routing with Human Preferences* | Indirection: a classifier emits a label, a policy table maps label to decision, so models change without retraining. | `classifyTaskV4` plus `TASK_CLASS_THINKING_LEVELS` |
| [arXiv:2605.09894](https://arxiv.org/abs/2605.09894) — *Deterministic vs. LLM-Controlled Orchestration* | Holding model, prompts, and tools constant and varying only execution control, deterministic orchestration matched accuracy, improved worst-case robustness, and cut tokens up to 3.5x. | Deterministic scheduler and planned lanes; execution control is never delegated to the model |
| [arXiv:2608.15565](https://arxiv.org/abs/2608.15565) — *Admission Without Answers* | Label-free admission on execution success alone admits substantial contamination; an accept/abstain/escalate decision is required. | Verified-memory admission design (spec 019), abstain is not stored |
| [arXiv:2608.23471](https://arxiv.org/abs/2608.23471) — *InjecMEM: Memory Injection Attack on LLM Agent Memory Systems* | Single-interaction memory injection is a reproduced attack frame against agent memory. | Retrieved memory is injected only as provenance-tagged data, never fused into instruction position |

Entries include implemented mechanisms and design proposals; check the
[runtime status guide](packages/coding-agent/docs/runtime-algorithms.md) for
availability. The wider survey, including approaches not adopted, is working
material that is not published with the repository.

</details>

## Documentation

- [Documentation index](packages/coding-agent/docs/index.md)
- [Usage](packages/coding-agent/docs/usage.md)
- [Turn metrics and harness evaluation](packages/coding-agent/docs/metrics.md)
- [Providers and models](packages/coding-agent/docs/providers.md)
- [Automation and SDK](packages/coding-agent/docs/sdk.md)
- [Run protocol](packages/coding-agent/docs/run-protocol.md)
- [Runtime algorithms and direction](packages/coding-agent/docs/runtime-algorithms.md)
- [Specification index](specs/README.md)
- [Sessions and recovery](packages/coding-agent/docs/sessions.md)
- [Security](packages/coding-agent/docs/security.md)
- [Containerization](packages/coding-agent/docs/containerization.md)
- [Public skill catalog](SKILLS.md)
- [Changelog](packages/coding-agent/CHANGELOG.md)
- [Release notes for v2.0.4](.github/RELEASE_NOTES_v2.0.4.md)
- Latest public release: [GitHub Releases](https://github.com/dmae97/omk/releases/latest). The source-version notes linked above can describe a candidate until its tag workflow completes.

## Development

```bash
npm ci --ignore-scripts
npm run build
npm run check
npm test
npm run release:local
```

Direct dependencies are pinned, CI installs with `--ignore-scripts`, and the
published CLI includes a generated `npm-shrinkwrap.json`. Read
[CONTRIBUTING.md](CONTRIBUTING.md) and the
[development guide](packages/coding-agent/docs/development.md) before sending a
change.

## FAQ

### What is OMK?

OMK (Open Multi-Agent Kit) is an open-source coding agent CLI for the terminal.
It reads files, edits code, and runs commands in your repository. You can switch
models inside one session, add subagents when a task needs them, and use
`/goal verify` so a goal only counts as done when your chosen check passes. It
is MIT-licensed and written in TypeScript.

### How do I install OMK?

With Node.js 22.19 or newer, run
`npm install -g open-multi-agent-kit --ignore-scripts`, then `omk` in your
project. Without Node.js, use the standalone installer on macOS or Linux:
`curl -fsSL https://github.com/dmae97/omk/releases/latest/download/install.sh | sh`.
See [Quick start](#quick-start).

### Why use OMK instead of Claude Code?

Use it for provider choice within one CLI session, or to build workflows
against its public runtime and evidence APIs. For a single-provider workflow,
your current agent may be sufficient. Try the [read-only task above](#quick-start)
before moving existing work.

### How is this different from OpenCode with plugins?

OMK is a separate runtime with its own CLI, sessions, tool scheduler, and SDK.
One reason to choose it is to build your own acceptance workflow: define
required test observations in the [run protocol](packages/coding-agent/docs/run-protocol.md),
then have your automation reject `fail` or `inconclusive` results. Receipt
integrity and freshness still need their own configured checks.

For adding a tool or prompt to an existing OpenCode setup, a plugin may be the
smaller change. OMK's protocol is opt-in, not proof of better performance.

### Does multi-agent mean better results or automatic verification?

Not automatically. Subagents require setup, and verification must be part of
the chosen workflow. Its result covers the declared checks, not all behavior. See
[what runs by default](#what-runs-by-default) and [evidence and limits](#evidence-and-limits).

## Recent releases

<details>
<summary>Release notes and historical corrections</summary>

> Historical correction: the immutable v0.97.0 notes below announced a
> versioned OpenWiki corpus, but that release still ignored `/openwiki/` and did
> not contain the corpus or checker. See the current repository-understanding
> section above for the shipped guards and optional-corpus boundary.

<!-- releases:start -->

## Release v2.0.4

### Fixed

- Release in-memory evidence deletion holds when a session closes.
- Report a provider stream that closes without a final result instead of leaving the turn pending.
- Show a `/login` hint without leaking a failed OAuth refresh's raw error during a turn or compaction.
- Avoid repeated transcript normalization in session search and redundant status panel serialization while a frame is in flight.

Release notes live in [RELEASE_NOTES_v2.0.4.md](.github/RELEASE_NOTES_v2.0.4.md).

## Release v2.0.3

### Changed

- With `OMK_OPENTUI_STATUS_RAIL` on (the default), the `Ctrl+O` control pane overlay and the built-in footer also render with OpenTUI, each in its own offscreen worker with its own native fallback. `FooterComponent` still decides every footer segment, drop and truncation; extension footers (`setFooter`) stay native. A standalone Bun binary (Bun 1.3.14+) starts the worker from its own executable. See [TUI](packages/coding-agent/docs/tui.md#hybrid-opentui-status-panel).
- The pinned status rail now shows from 108 columns (previously 120) and 16 rows. The control pane overlay keeps the MD/LG breakpoints.
- Fresh settings pin the status rail, and `Ctrl+Q` saves the choice, including a hidden rail. `/debug` and `/debug save` report the rail layout, the requested renderer and the last render; an earlier OpenTUI frame does not count as the rail being visible now.
- Next-task suggestions (`OMK_NEXT_SUGGESTIONS`, flag, default off) return to the v1 form: the model's next request on one line, at most 200 characters, with a 128-token output budget. The host no longer adds context, scope or checklist lines or a local startup/error suggestion; an empty, malformed, timed-out or failed reply shows nothing and is not retried. The next open task of the latest todo snapshot takes precedence over model text, and after a successful workspace check (`npm run check`, `npm test`, ...) the editor stays empty until another edit or failure. Late replies after a turn, session, branch, model or compaction change are discarded. See [environment variables](packages/coding-agent/docs/environment-variables.md).
- Skill selection treats Markdown headings in a request as explicit sections: a body clause keeps its heading path, so `## React frontend` above `Fix spacing` can match a frontend skill, and at most one skill is granted per section. Automatic loading no longer fills unused slots from an already covered section. With automatic loading on, a sectioned prompt adds a visible `skill-sections` message that lists each section's grants, their actual load status, and why a section stayed uncovered, with a pointer to the matching `!omk` hub. The message is for the operator only and is never sent to the model or into summaries; it lists at most 16 sections with headings cut to 120 characters. The three-skill cap, thresholds, body budget and admission rules are unchanged, and unsectioned prompts behave as before. See [Skills](packages/coding-agent/docs/skills.md).

### Added

- The package manager reapplies the bundled, version-pinned repairs after installing or updating a managed native package: `pi-subagents` 0.78.0 (subagent admission, disposal and checkpoint handling) and `@aeondave/pi-skill-optimizer` 3.1.2 (persistence). Repairs apply only to an explicit native `omk` manifest at that exact version, and unknown versions, changed hunk contexts or unsafe paths fail before any file is written. See [Packages](packages/coding-agent/docs/packages.md#native-package-repairs).
- `OMK_NEXT_SUGGESTIONS_DIAGNOSTICS` (default off, requires `OMK_NEXT_SUGGESTIONS`) writes a turn-metrics record for every skipped suggestion and adds `quotaReadMs` (quota lookup time). Records hold enums and numbers only and change no request or display behavior.

### Fixed

- Standalone release binaries now ship the locked `@opentui/core` runtime and its native library for their platform, so the status rail renders an OpenTUI frame instead of falling back with `dependency-error`. `scripts/build-binaries.sh` stages it from `package-lock.json` (archives with integrity only; `--skip-deps` stages offline).
- Selecting a `/name` or `/skill:name` skill in autocomplete with Enter or Tab no longer submits the prompt; the draft stays editable. Ordinary slash commands such as `/help` still run on Enter.
- An accepted legacy (v2/v3) suggestion prompt that the user extended is matched for skills by the user's words, including text typed after the last line, instead of the host's context and completion wording.
- The startup warning about a global `tools/` directory now fires only for legacy custom-tool entries (a top-level `.ts`, `.js`, `.mjs` or `.cjs` file, or a directory with an `index.*` file), not for unrelated checkouts or binaries stored there.
- A main-turn request whose OAuth token the provider rejects (`401 token_expired`, `token_revoked`) now forces one token refresh and retries once, as compaction already did. A failed refresh reports the original error with a `/login <provider>` hint. API keys, non-auth errors, and rejections that arrive after output started are not retried.
- Verified runs accept a workspace created under umask 002: group write on files (`0664`, `0775`) and directories (`0775`) is dropped before the mode check, so these candidates no longer fail with `mode_unrepresentable` or `file_type`. Modes that Git would widen, such as `0600`, `0640` and `0660`, are still refused.
- With context budgeting on, a short follow-up with no skill signal of its own ("fix it", "이어서 해줘") now ranks `<relevant_skills>` against the session's last two user prompts as well (weights 0.8 and 0.64), so the list no longer drops the skills the conversation is about. Prompts with their own skill signal rank as before.

Release notes live in [RELEASE_NOTES_v2.0.3.md](.github/RELEASE_NOTES_v2.0.3.md).

## Release v2.0.2

### Added

- `OMK_SUBAGENT_ADAPTORCH` (experimental, default off) lets subagent lane dispatch use the result of an actually executed, authorized `adaptorch_route_topology` MCP call. `shadow` (or `1`) only records proposals; `enforce` can prioritize ready lanes and narrow sequential execution to one lane. A receipt must match the same prompt's task IDs, descriptions and dependencies and still be fresh; missing or incompatible results fall back to the local plan. The consumer adds no service or model calls. See [AdaptOrch subagent routing](packages/coding-agent/docs/adaptorch-subagent-routing.md).

### Fixed

- The standalone installer reads the downloaded binary's version with `OMK_PACKAGE_DIR` unset, so an `OMK_PACKAGE_DIR` in the environment that points at another installation no longer makes the check read that installation's version.

Release notes live in [RELEASE_NOTES_v2.0.2.md](.github/RELEASE_NOTES_v2.0.2.md).

<!-- releases:end -->

</details>

## Contributing

Issues and pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md)
first, run `npm run check` and `npm test` before opening a pull request, and
report security issues as described in [SECURITY.md](SECURITY.md).

## Sponsor

[AdaptOrch.com](https://adaptorch.com/) sponsors OMK.
Explore its [plans](https://adaptorch.com/#pricing) to support OMK's sponsor.
OMK remains [MIT-licensed](LICENSE); an AdaptOrch subscription is not required to use it.

## Star OMK

If a check-backed “done” is useful to you, a
[star on GitHub](https://github.com/dmae97/omk/stargazers) helps other
developers find OMK.

<p align="center">
  <a href="https://star-history.com/#dmae97/omk&Date">
    <img alt="Star history chart for dmae97/omk" src="https://api.star-history.com/svg?repos=dmae97/omk&type=Date" width="600" />
  </a>
</p>

## Acknowledgments

OMK builds on [pi](https://github.com/badlogic/pi-mono) — Mario Zechner's
MIT-licensed coding-agent harness — and began from the
[oh-my-pi](https://github.com/can1357/oh-my-pi) fork. The vendored tree was
removed in this release line; OMK `0.9x` is OMK-native (see
[`specs/constitution.md`](specs/constitution.md)), and the design debt to both
projects stands. Thank you.

## OMK + AdaptOrch

AdaptOrch is a separate, optional product and is not called by default. See
[OMK + AdaptOrch](packages/coding-agent/docs/omk-adaptorch.md) for the optional integration and
[TRADEMARKS.md](TRADEMARKS.md) for the name and marks.

## License

MIT
