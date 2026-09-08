<p align="center">
  <img
    src="readmeasset/omk-hero.svg"
    alt="OMK, Open Multi-Agent Kit. Scope the work. Route the right agents. Verify every release. The mark shows a four-stage control loop with three routed lanes."
    width="100%"
  />
</p>

<h1 align="center">OMK</h1>

<p align="center">
  <strong>Open Multi-Agent Kit</strong><br />
  Scope the work. Route the right agents. Verify every release.
</p>

<p align="center">
  A terminal coding agent that lets you switch models without starting a new session.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/open-multi-agent-kit"><img alt="npm version" src="https://img.shields.io/npm/v/open-multi-agent-kit?style=flat-square&label=npm" /></a>
  <a href="https://www.npmjs.com/package/open-multi-agent-kit"><img alt="npm downloads per month" src="https://img.shields.io/npm/dm/open-multi-agent-kit?style=flat-square" /></a><br />
  <a href="https://github.com/dmae97/omk/releases/latest"><img alt="latest GitHub release" src="https://img.shields.io/github/v/release/dmae97/omk?style=flat-square&label=release" /></a><br />
  <a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/npm/l/open-multi-agent-kit?style=flat-square" /></a>
  <img alt="supported Node.js version" src="https://img.shields.io/node/v/open-multi-agent-kit?style=flat-square" />
</p>

<p align="center">
  <a href="#quick-start">Quick start</a> ·
  <a href="#what-runs-by-default">Default or opt-in?</a> ·
  <a href="#evidence-and-limits">Evidence and limits</a><br />
  <a href="#faq">Choosing OMK</a> ·
  <a href="packages/coding-agent/docs/index.md">Documentation</a>
</p>

---

## Why OMK

Choose a model, work on your repository, then switch models with `/model` when
another one suits the next step. The conversation stays in the same session.
You can also stop and return later with `/resume` or `omk -c`.

OMK is a standalone CLI, not a plugin for Claude Code or OpenCode. It supports
[subscription providers, API keys, and local models](packages/coding-agent/docs/providers.md).
Start with one agent that reads files, edits code, and runs commands. Add
subagents or explicit verification workflows when you need them; neither is
required for your first task.

## Quick start

Requires Node.js 22.19 or newer. Start in the repository you want to work on:

```bash
npm install -g open-multi-agent-kit --ignore-scripts
omk --version
cd your-project
omk
```

Without a global install, run `npx --ignore-scripts open-multi-agent-kit` from
that directory.

1. Run `/login` to authenticate a supported subscription or API-key provider.
2. Run `/model` to choose an available model.
3. Try a read-only first task:

```text
Summarize this repository and identify the commands used to check it.
Read the project configuration to support your answer. Do not edit files.
```

After the reply, use `/model` to choose another configured model and ask it to
review the answer. You stay in the same session. This is manual model switching,
not parallel agents or an independent correctness check.

For a bug fix, name the failing behavior and ask for a regression test, the
smallest fix, and the check commands with their exit codes. Review the diff and
those results yourself; a request to run tests does not enable a verification
gate.

Built-in local bash requires `sandbox-exec` on macOS or `bwrap` plus
unprivileged user namespaces on Linux. It blocks network access and fails
closed if the backend is missing. See the [safety boundary](#verification-boundary)
and [full quickstart](packages/coding-agent/docs/quickstart.md) for setup.

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
| Protocol verification and advisory judging | Explicit API/workflow opt-in; not a gate on ordinary prompts | [Run protocol](packages/coding-agent/docs/run-protocol.md) |
| Context budgeting | Off by default | [Settings](packages/coding-agent/docs/settings.md#context-budget) |
| AdaptOrch integration | Optional and separate; no service calls by default | [OMK + AdaptOrch](#omk--adaptorch) |

The internal lane launcher and automatic command-sharding primitives are not
connected to the default CLI path. Installing their packages is not the same
as enabling an orchestration workflow.

## Evidence and limits

No comparative benchmark result is published here yet. We have not established
that OMK solves more tasks than another harness, that multi-agent execution
improves success, or how much verification reduces false completion.

OMK targets state-of-the-art quality as a CLI coding-agent harness.
SOTA is not verified.

The evidence you can inspect today covers specific failure modes:

| Behavior covered | Regression evidence | Scope |
| --- | --- | --- |
| Missing test observations produce `inconclusive`; a required failing test produces `fail` | [Protocol tests](packages/protocol/test/protocol.test.ts) | Explicit protocol evaluation, without a waiver |
| Changed artifacts, wrong command bindings, or missing ledger evidence block acceptance | [Evidence binding tests](packages/coding-agent/test/evidence-gate-binding.test.ts) | Strict evidence gate and selected workspace scope |
| A relevant workspace mutation after verification makes the receipt stale | [Freshness tests](packages/coding-agent/test/evidence-freshness.test.ts) | Configured receipt and mutation tracking |

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

## OMK//CONTROL

The terminal UI shows the selected model, tools, and session status. Additional
signals depend on the integrations you configure.

<p align="center">
  <img
    src="landing/assets/omk_tui.jpg"
    alt="OMK//CONTROL terminal dashboard showing model routing, tools, and session status"
    width="960"
  />
</p>

The header reads `omk v<package.version> · OMK//CONTROL`; the installed package
version is the source of truth.

## Control loop

<details>
<summary>How scope, routing, verification, and replay fit together</summary>

OMK's provider-neutral coding-agent CLI also exposes a multi-agent control
plane for explicitly configured workflows. The diagram describes that design,
not what every prompt automatically runs.

<p align="center">
  <img
    src="readmeasset/omk-control-loop.gif"
    alt="Animated OMK control loop showing Scope, Route, Verify, and Replay"
    width="900"
  />
</p>

1. Scope the goal, paths, resources, and acceptance predicates. A selected
   orchestration workflow may also supply a DAG; an ordinary prompt remains
   one agent/tool loop.
2. Route work to models, agent skills, MCP tools, and extensions without
   changing the evidence contract.
3. Verify declared checks in explicit evidence workflows. Required failing
   checks block those workflows; advisory judging cannot replace them.
4. Preserve receipts and replay state for bounded session recovery; continue
   durable goals from explicit reducer state.

The animation changes once every 1.5 seconds and contains no flashing. The four
steps above are the complete text alternative.

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
omk install npm:omk-book-to-skill@0.97.0
npm install omk-tui
```

</details>

## Repository understanding

<details>
<summary>Optional indexes, retrieval settings, and trust limits</summary>

`v0.97.0` shipped the OpenWiki policy and workflow, but no versioned corpus or
integrity checker. Current Worktree-only hardening remains blocked by the
security gates below:

- **`openwiki/`** — absent. The previous untracked corpus was removed after the
  hardened gate proved it carried fabricated evidence: 8 frontmatter symbols
  that no declared source path defines (`AgentLoop`, `getModel`, `DeepWall`,
  `loadExtensions`, `createExtensionRuntime`, `main`), 45 references to `@omk/*`
  package names this repository does not publish, and a
  restatement of this README's `Scope -> Route -> Verify -> Replay` loop as a
  strict engine state machine, which is not what the source implements.
  CI regenerates the corpus; nothing is lost.
- **`scripts/check-openwiki.mjs`** — worktree checker. An `interrupted` corpus
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

Source and tests remain authoritative. Until the blockers above close and the
corpus ships, treat both generated indexes as untrusted working-tree or local
advisory data.

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

## OMK + AdaptOrch

<a href="https://adaptorch.com/?utm_source=github&utm_medium=readme&utm_campaign=omk">
  <img
    src="readmeasset/omk-adaptorch-banner.svg"
    alt="OMK writes and runs code. AdaptOrch checks what it wrote. correctness_claim: false — it ran, and this is what happened."
    width="100%"
  />
</a>

OMK is this local, MIT-licensed coding agent. AdaptOrch is a separate
proprietary evidence service. Neither requires the other: installing OMK does
not create an AdaptOrch account or make calls to it by default.

For an optional integration, see the [WPL package and clients](packages/adaptorch-wpl/README.md)
and [MCP setup](packages/coding-agent/docs/mcp.md). The WPL package exposes
state, client, and adjudication primitives, not an automatic verification loop
for every CLI prompt.

AdaptOrch's reports carry `correctness_claim=false`; they are not semantic
correctness proofs or OMK harness benchmark results.
[Review AdaptOrch plans](https://adaptorch.com/?utm_source=github&utm_medium=readme&utm_campaign=omk#pricing)
· [Claim boundary](https://adaptorch.com/claim-boundary?utm_source=github&utm_medium=readme&utm_campaign=omk)

<sub>The AdaptOrch name and marks identify that separate proprietary product
and appear here with permission. They are excluded from this repository's MIT
grant — see [LICENSE](LICENSE).</sub>

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
- [Release notes for v0.98.1](.github/RELEASE_NOTES_v0.98.1.md)

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
> section above for the working-tree repair.

<!-- releases:start -->

## Release v0.98.1



Release notes live in [RELEASE_NOTES_v0.98.1.md](.github/RELEASE_NOTES_v0.98.1.md).

## Release v0.98.0

### Added

- Added `omk doctor resources --report [--json]`, a bounded local aggregate of resource-admission journals. It reports pressure/actions, would-throttle counts, reason coverage, probe partial/timeout counts, and a 30-record reason-qualified sample floor without exposing paths, run IDs, decision IDs, digests, a command field, or raw host capacity. Journal discovery and descriptor reads are bounded and reject symlink escapes. The sample flag never promotes `adaptive`; human review remains mandatory.
- Added three repository gates to `npm run check`. `check:import-cycles` is a Tarjan-SCC ratchet whose unit is the module rather than the cycle, because a cycle's identity changes when a single edge merges it while "is this module trapped in a cycle" stays answerable across refactors; entering a cycle fails the build and leaving one tightens the baseline. `check:dep-tree` holds `npm ls` problems against a baseline while never baselining a dangling bin symlink. `check:feature-claims` gained two gates beyond file existence: twelve placeholder tokens are rejected as evidence, and at least one production module under `packages/*/src` must import the evidence module, so a claim can no longer be satisfied by an unwired file containing the word `export`. Importer resolution is path-precise, since this repository holds both `core/hooks/types.ts` and `core/extensions/types.ts` and basename matching would credit one module's wiring to the other.
- Added a conservative type-aware compaction slice for the default compactor. Explicit uppercase user-authored rule/invariant markers are extracted deterministically, credential-redacted, and bound to user-entry/line digests; assistant/tool, attached file/stdin, and model-generated or forged marker sections are rejected. Up to 64 validated source records are persisted in additive compaction details only when their canonical block matches the prior summary, and a five-round property test preserves that block byte-identically. Custom hook summaries, branch summaries, natural-language classification, and cross-session memory remain out of scope.

### Changed

- Interactive TTY completion sounds are enabled by default at final `prompt_settled`. Successful prompts keep the 5-second duration floor, while failed and aborted/stopped prompts notify immediately. Intermediate `agent_end`, retry, continuation, and tool states remain silent; current subagent work stays covered by its enclosing tool call, while future direct child/shard paths must wire the settlement counters before activation; RPC, JSON, print mode, and CI never play sounds. Sound backends now use fixed absolute executables, a minimal environment without inherited `PATH` or credentials, and a neutral temp cwd; WSL uses BEL rather than PATH-resolved PowerShell. Set `notifications.completionSound.enabled: false` or `OMK_COMPLETION_SOUND=0` to opt out, and use `onSuccess`, `onFailure`, or the new `onAbort` switch per terminal outcome.
- Split the failure-classification and message-snapshot cores out of `agent-session.ts` into `core/session-failure-cause.ts` and `core/agent-session-snapshot.ts` (92 pure lines each), dropping the session module from 4,287 to 4,113 pure lines. This is a move-only change with no behaviour difference: session state that the extracted code read off `this` is now passed in as arguments. Both cores carry ordering contracts that are easy to break silently and were previously unreachable from a direct test — provider classification must match quota/billing exhaustion before the generic 401/403 auth patterns, because `403 ... usage limit for this billing cycle` is transient per cycle and must fail over rather than terminate the turn as auth, and it must match upstream 5xx as network before the protocol fallback so guidance points at retry rather than transcript sanitize; the snapshot core rejects a `Date`, class instance, getter, or cycle at replacement time instead of letting it be flattened when SessionManager persists the message as JSON. Twenty-eight characterization tests now pin both orderings. The 512-character termination-message cap now references `MAX_SESSION_TERMINATION_MESSAGE_LENGTH` instead of repeating the literal.
- The reasoning-router weight promotion gate now refuses evidence it cannot trust. Every gold row is replayed under both policies and only rows whose repeated observations agree can carry promotion credit, so a routing "win" that flips between two identical runs is withheld instead of banked. Because the classifier is deterministic the replay doubles as a determinism attestation: if nondeterminism ever reaches the routing path the rows land in the unstable bucket and the gate blocks rather than crediting whichever run scored better. Promotion evidence must also declare that the candidate was measured against the frozen reference policy, closing a hole where a candidate could qualify by beating a caller-chosen weak opponent. The new blockers are `insufficient_replays`, `unstable_evidence`, and `baseline_not_frozen`, and they are reported ahead of the statistical blockers because a p-value computed over unstable rows is not a weaker result but a result about nothing.

### Fixed

- Releases no longer regenerate the model catalogs from live provider APIs. `release.mjs` ran `generate-models` and `generate-image-models` as "release artifacts", but both fetch provider endpoints, so the shipped catalog was a function of which APIs answered the machine cutting the release and which credentials it happened to hold. A v0.98.0 attempt regenerated 1,279 models down to 1,217, losing 26 of 57 Cloudflare entries and 32 OpenRouter entries while other providers gained models — a mixed result that cannot be read as either upstream retirement or local unreachability, which is exactly the ambiguity that must not be resolved silently during a release. The typecheck caught it only because tests happened to reference two of the dropped ids. The catalogs are now committed artifacts refreshed deliberately through `npm run models:refresh` and reviewed as their own change; the release still regenerates the shrinkwrap, which is derived from the lockfile already in the tree.
- The release stalled after the version bump because nothing retargeted the README release pointer. `check-release-consistency.mjs` reads the first `RELEASE_NOTES_v*.md` match in `README.md` as the advertised release surface, and that match is the documentation index entry, which sits above the generated block that `sync-readme-releases.mjs` rewrites — so the value deciding the gate was one no script maintained. The sync now retargets the index entry to the newest release, leaving links inside generated sections pointing at their own versions, and the script gained a main guard so importing it for tests no longer rewrites the repository.
- The release stalled again at `check:dep-tree` because the version scripts run `npm install --package-lock-only`, which updates the lockfile while leaving stale physical copies under each package's `node_modules` that shadow the workspace links. The tree is now rebuilt right after the bump, on both the bump-type and explicit-version paths, so the checks run against the release as it actually is.
- The OpenWiki integrity gate no longer trusts an unreviewed corpus. An `interrupted` generator pass previously warned and passed whenever `.last-update.json` recorded the current `HEAD`, so a partial corpus was trusted right until the next commit — and from that commit on the stale-head branch failed, meaning the repository could not accept any commit at all while a corpus sat in that state. An interrupted corpus now fails unless `openwiki/.manual-review.json` binds a review to the exact corpus digest. Anchoring the record to content rather than to a commit is what lets an approved corpus survive later commits, since code moving on is a staleness warning while any edit to the corpus invalidates the review outright. Frontmatter `symbols:` entries must now bind to one of that page's own `source_paths:` as a whole identifier; the previous check searched one concatenated haystack of the entire repository, which cannot fail for any plausible-looking identifier. Running the hardened gate against the existing corpus reported 8 symbols bound to no declared source path (`AgentLoop`, where the real export is the function `agentLoop`, plus `getModel`, `DeepWall`, `loadExtensions`, `createExtensionRuntime`, and `main`), so that corpus was removed rather than hand-patched, which the next generator run would overwrite. An absent corpus is now a reported warning rather than a failure: it lives in no commit, and one that does not exist cannot mislead a reader.
- Slack `xoxe-` tokens (app-configuration and refresh tokens) escaped secret redaction, because the pattern matched only `xox[abprs]`.
- Release workflows no longer build with write access. The binary job held `contents: write` without needing it; write permission is now isolated to a separate release job that consumes an artifact. The build also verifies that `SOURCE_REF` resolves to the commit `RELEASE_TAG` names, closing a path where an arbitrary ref could be built and published under a tag's name, and every action is pinned to a commit SHA.
- Standing instructions no longer score lowest exactly when the agent is working. `scoreContextFileRelevance()` ranked context files by query/item token overlap, which read "no evidence" two different ways: 0.9 when there was no query at all, but 0.1 when a query existed and simply did not overlap. Measured against this repository's own `AGENTS.md`, a blended score of 0.900 with no query fell to 0.420 for "fix the WSL clipboard paste bug" and "why is the import cycle gate failing". The baseline is now a floor rather than a starting value, with coverage distributing only the headroom above it (`baseline + (1 - baseline) * coverage`), so zero coverage lands exactly on the baseline and both readings of "no evidence" reach the same conclusion. Monotonicity holds, so existing ordering contracts survive. Skills are deliberately left on lexical scoring, which is the correct signal for them because a skill really does have a topic scope. This subsystem is opt-in (`contextBudget.enabled` or `OMK_CONTEXT_GOVERNOR=1`) and off by default.
- Detecting the built-in stream function no longer relies on reference identity. Callers decide whether provider credentials are mandatory by asking whether the stream function is still the built-in one, and `fn === streamSimple` answers that with object identity — which is not dependable, because this package can legitimately load twice in one process (a workspace symlink beside an installed copy, or two dependents resolving different versions). The comparison then reported "custom stream function" for what was really the built-in one and a credential check silently relaxed. The built-in is now branded through `Symbol.for`, whose per-realm registry gives every copy of the module the same symbol.
- Tool-timeout settlement moved out of the agent loop into a pure decision module, and teardown now has a grace window that distinguishes a late-settling tool which may have touched the workspace from one that never started executing. Only the former raises session risk. The bash tool now discloses the timeout in its result so truncated output is not mistaken for a short successful run.
- Extension startup diagnostics now keep every explicitly requested source fatal, including inline factories, direct files, manifest/directory entry points, opaque package sources, and symlinked entries. Only uncorrelated discovered-package failures may downgrade to warnings, so a missing security extension cannot silently disappear while stale optional discovery no longer kills every headless lane.
- Image paste is now reachable inside Windows Terminal. `Ctrl+V` was the only default binding outside native Windows, but Windows Terminal binds that key to its own paste action and never forwards it, so every session running inside it — WSL included — had no working image-paste key at all: the terminal swallowed the keypress, tried to paste clipboard text, and after a `Win+Shift+S` capture there was none. `Alt+V` is now bound alongside `Ctrl+V` on every platform, so whichever key the host terminal actually delivers works.
- Pasting a Windows screenshot into the prompt on WSL no longer fails silently. WSLg publishes the captured image as `image/bmp`, so the Wayland read succeeded and disqualified the PowerShell reader behind it — and when BMP conversion was unavailable (a packaged binary whose image-codec wasm sidecar is missing), the whole read returned nothing and the keypress did literally nothing. Each clipboard source now converts its own read, so an unconvertible format falls through to the next source instead of ending the search; the PowerShell reader returns PNG directly and needs no converter.
- Scrolling back through a finished answer no longer runs into stale copies of the prompt box and footer. On WSL/Windows Terminal every screen-clearing redraw pushed the live frame into scrollback, so long reports were chopped apart by repeated prompt boxes. Redraws now repaint the screen in place.
- Long answers no longer lose their beginning when earlier transcript rows change. Repairing a row above the viewport (a late tool result replacing its loader, an earlier prompt box re-rendering) reprinted the whole transcript from that row down, evicting the start of the current report from the terminal's scrollback. The repair repaint is now bounded to a few screens.

### Removed

- Removed ten unreachable internal modules totalling 1,855 pure lines of code: a superseded context-budget governor and its `lean-ctx` predecessor, an unused sandbox policy evaluator (the live path is the workspace sandbox policy), leftover read-anchor and recovery-checkpoint helpers from the removed OMP seam, and a dead guardrails/lane-grant cluster. None were exported from the package's public entry points, so no import can break; the shipped tarball simply carries less code. Each removal was verified by symbol-level reference search, public-barrel absence, and a full type-check and test run rather than by a dead-code reporter alone. `image-resize-worker`, which is loaded by path and bundled separately, was correctly retained.

Release notes live in [RELEASE_NOTES_v0.98.0.md](.github/RELEASE_NOTES_v0.98.0.md).

## Release v0.97.0

### Added

- Added the repository-understanding default: a generated `openwiki/` evidence index with grounded, staleness-tracked claims, OpenWiki managed blocks in root `AGENTS.md`/`CLAUDE.md`, a scheduled `openwiki-update` GitHub Actions workflow (Gemini provider by default), and a README section describing the local-wiki protocol for fresh sessions. The vendored `oh-my-pi` tree was removed; README now acknowledges pi (badlogic/pi-mono) and oh-my-pi as upstream origins.
- Added global-only `defaultActiveSkills` so operator-selected, user-scoped skill names can stay active in every prompt while full instructions remain on-demand.
- The model registry now keeps a bounded audit trail of every successfully loaded `models.json` (last 10 snapshots) and warns when model entries disappear between loads, so silent config rewrites by other sessions surface immediately instead of losing custom models.
- Images pasted or dragged into the interactive editor now attach as preview chips above the input through a bounded in-memory attachment store instead of per-paste temp files. Attachments are released exactly when their prompt is accepted and stay attached for retry when the turn fails before acceptance.
- Compaction summarization now walks the configured resilience failover chain once when the summarization model hits quota/billing exhaustion; if every candidate is also quota-blocked it fails with a new non-retryable `compaction.quota_exhausted` termination cause whose guidance points at `/model`, `compaction.model`, or waiting for reset.
- Upstream availability failures (gateway 5xx passthroughs, streams ending without a finish reason) are classified as network errors, and the retry path first rotates to another authenticated route serving the same underlying model family before falling back to the standard retry/failover chain.

### Changed

- YOLO mode (`OMK_YOLO` / `OMK_COMMAND_SAFETY=0` / `OMK_DISABLE_COMMAND_SAFETY`) is now evaluated in one place, the shared command-safety gate decision engine: every verdict — including block-tier commands and privilege prompts — runs without prompting, and the RPC headless bash safety floor honors the same opt-out.
- Refreshed the bundled model catalog (new DeepSeek V4 Flash Vision experimental routes and Thinking Machines Inkling free routes; removed dead free-tier aliases).

### Security

- The bash command-safety classifier now extracts command substitutions (`$(...)`, backticks, `<(...)`/`>(...)`) with quote-aware matching and recursively classifies their bodies up to a bounded depth, merging every risk signal by severity instead of returning on the first hit, so a destructive body such as `echo $(rm -rf ~)` can no longer ride behind a benign-looking outer command.

### Fixed

- Empty streamed completions (`stop` with no text, thinking, or tool call) are now treated as dead streams and retried within the existing retry budget instead of being accepted as a successful turn.

Release notes live in [RELEASE_NOTES_v0.97.0.md](.github/RELEASE_NOTES_v0.97.0.md).

<!-- releases:end -->

</details>

## Acknowledgments

OMK builds on [pi](https://github.com/badlogic/pi-mono) — Mario Zechner's
MIT-licensed coding-agent harness — and began from the
[oh-my-pi](https://github.com/can1357/oh-my-pi) fork. The vendored tree was
removed in this release line; OMK `0.9x` is OMK-native (see
[`specs/constitution.md`](specs/constitution.md)), and the design debt to both
projects stands. Thank you.

## License

MIT
