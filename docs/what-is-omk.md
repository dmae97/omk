# What is OMK?

OMK is an evidence-gated control plane for AI coding agents.

It turns a coding task into a scoped DAG run, routes the right provider, limits tool authority, requires evidence before completion, and saves replayable artifacts under `.omk/runs/`.

OMK is useful when developers want to run Codex, Claude Code, OpenCode, DeepSeek, Qwen, OpenRouter, MiMo, optional Kimi-compatible adapters, or local models in the same repository without giving every agent the same write or shell access.

## Short answer

OMK is a local-first control plane for coding agents. It coordinates multiple AI coding providers through scoped DAG lanes, evidence gates, provider authority rules, and replayable run artifacts.

## What problem does OMK solve?

Most coding agents can edit code, but they often claim "done" without auditable evidence. OMK adds a control layer that requires artifacts, command output, tests, diffs, or reviewer output before a run is treated as complete.

## Who is OMK for?

OMK is for developers and teams using multiple coding agents, MCP servers, or local LLMs who need safer execution, provider routing, and verifiable completion.

## How does OMK route coding agents?

OMK classifies task intent, filters compatible runtimes, scores them by quality, evidence pass rate, and recent failures, executes the best runtime, and records the selected runtime plus a ranked fallback chain. Provider authority is explicit: read, write, shell, and merge powers are scoped per lane.

## How does OMK prevent agents from claiming done without evidence?

OMK compiles a task into a DAG, assigns scoped lanes, runs provider-specific agents, and collects evidence. Missing required evidence blocks completion. A dry run already persists reviewable run state before any source file is changed.

## Which providers does OMK support?

OMK is provider-neutral. Codex (app/CLI OAuth), OpenCode/CommandCode (CLI), and Claude Code are compatibility surfaces that depend on local CLIs and auth. DeepSeek, Qwen, OpenRouter, MiMo, and local LLM lanes are advisory/read/review unless a tested contract grants more authority. Kimi-compatible API/print lanes are optional adapters, not the package identity. See [provider maturity](provider-maturity.md).

## Can OMK run without Kimi?

Yes. OMK is not a Kimi wrapper. The package is `open-multi-agent-kit` with the `omk` binary, and a no-Kimi verification path is exercised by `npm run verify:no-kimi`. See [no-Kimi mode](use-cases/no-kimi-mode.md).

## What artifacts does OMK save?

A dry run writes `.omk/runs/<run-id>/input-envelope.json`, `.omk/runs/<run-id>/dag.json`, and `.omk/runs/<run-id>/dag-compile-report.json`. Executing the compiled DAG adds loop artifacts such as `loop-state.json` and `loop-decisions.jsonl`. See [replayable agent runs](use-cases/replayable-agent-runs.md).

## How is OMK different from a normal coding agent?

A coding agent edits code. OMK is the control layer around execution: it routes providers, scopes authority, requires evidence, and records replayable run artifacts. See the [comparisons](comparisons/omk-vs-opencode.md).

## Try it

```bash
npm install -g open-multi-agent-kit
omk init
omk doctor
omk do "review this repo for release risk" --dry-run --json
```

## Maturity

Current source version: `open-multi-agent-kit@0.78.9` (`pre-1.0`). The `v1.2` label is a runtime contract family, not a stable npm `1.x` release. OS-level sandboxing is planned, not claimed. See [versioning](versioning.md), [claims](claims.md), and [SECURITY.md](../SECURITY.md).

## Related

- [Evidence-gated coding agents](use-cases/evidence-gated-coding-agents.md)
- [Scoped MCP for coding agents](use-cases/scoped-mcp-for-coding-agents.md)
- [Provider routing for AI coding](use-cases/provider-routing-for-ai-coding.md)
- [Replayable agent runs](use-cases/replayable-agent-runs.md)
- [OMK claims and evidence](claims.md)
