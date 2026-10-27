# DeepSeek harness

OMK's `deepseek_harness` is a local, DeepSeek-only engine implemented through the
existing `before_agent_start` and `context` extension hooks. It does not install,
launch, or embed the separate DeepSeek Harness (`dsh`) application.

## Assessment and upstream scope

Reviewed on 2026-10-22 against upstream commit
[`687f282e8625c6b8d11ff58211a90524be2e4317`](https://github.com/deepseek-ai/deepseek-harness/tree/687f282e8625c6b8d11ff58211a90524be2e4317)
(committed 2026-10-17, MIT).

| Upstream feature | OMK decision |
| --- | --- |
| Cordis plugin runtime and separate session/event format | Do not embed a second runtime; use OMK's existing lifecycle and extensions |
| Pressure-triggered tool-result head/tail pruning | Adapt as a model-gated outbound projection, retaining original OMK history |
| Reasoning replay, tool pairing and effort selection | Keep the existing provider adapters and tool-pair repair rather than duplicate them |
| DeepSeek Messages API, Files API and in-history system/tool updates | Not ported; existing OMK Chat Completions routes keep their wire contracts |
| Session-log upload and plugin inventory request extensions | Not ported; this engine adds no uploads or request metadata |
| Agent teams, Web/Desktop UI and plugin manager | Not ported; outside this model-specific engine |

Recommendation: selective adaptation is preferable to replacing OMK's runtime.
The upstream project labels itself an unaudited developer preview with breaking
changes. Its native adapter uses a different Messages protocol, and its shipped
profiles mount default-on session-log upload. Neither should silently become an
OMK dependency or change OMK's credential and data-transfer boundaries.

Primary sources at the reviewed revision:
[architecture](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/docs/architecture.md),
[safety notice](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/SAFETY.md),
[tool-result pruner](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/compaction/compaction-tool-result-pruner/README.md),
[native transport](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/llm/llm-deepseek/README.md),
[session-log upload](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/session/session-log-deepseek/README.md).

## Activation

The default resource loader registers `<builtin:deepseek-harness>`, including with
`--no-extensions`. It acts only when the current selected model is:

- On the native `deepseek` provider, or
- Named `deepseek-v<digit>...`, `deepseek-r<digit>...`, `deepseek-chat`,
  `deepseek-reasoner`, `deepseek-flash`, `deepseek-pro`, or `deepseek-coder`, with
  supported suffixes and optional namespace. Matching is case-insensitive and
  also accepts `_` or `.` in place of the first `-`.

Examples include `openrouter/deepseek/deepseek-v4.1-flash`,
`opencode-go/deepseek-v4.1-flash`, and
`nvidia/deepseek-ai/deepseek-v3.2`. The engine does not infer a model from its
provider's display name, URL, `thinkingFormat`, or a router's eventual response.
Anonymous aliases such as `auto` are not guessed. Custom resource loaders own
their extension inventory and do not automatically receive this built-in.

Use the configured provider and credentials as before:

```bash
omk --provider deepseek --model deepseek-flash --thinking high
# Independently disable this engine at startup:
OMK_DEEPSEEK_HARNESS=0 omk --provider deepseek --model deepseek-flash
```

`OMK_DEEPSEEK_HARNESS` defaults on. `0`, `false`, `off`, `disable`, and `disabled`
disable it, ignoring case and surrounding whitespace. `OMK_PROMPT_PRESET` controls
the separate model-preset built-in, not this engine. Credentials remain governed
by [Providers](providers.md); the engine never selects an account or changes an
endpoint, model, reasoning effort, context window, or output limit.

## Behavior and limits

- At each new request, matching models receive a fixed
  `<model_harness id="deepseek_harness">` section: inspect source, make scoped
  changes, verify results, use actual tool IDs, and preserve approval/sandbox
  boundaries. Model switches rebuild guidance from the normal base prompt.
- At each model call, when OMK reports finite context usage of at least 80%,
  successful tool results exceeding 8,192 Unicode code points of combined text
  retain the first 4,096 and last 1,024 points plus an explicit omission marker.
  Error results, short results, non-text blocks, user messages, and assistant
  reasoning/tool calls are not pruned. Surrogate pairs are not split; grapheme
  clusters can still split.
- Projection does not mutate messages, tool IDs, metadata, or persisted session
  history, create files, or call another model. Once pruned, an unchanged source
  message reuses its projected copy even if pressure drops, avoiding alternating
  full/trimmed prefixes. This identity cache is process-local; a resume, reload,
  or extension that clones messages may require a new pressure-triggered pass.
- Missing/unknown pressure leaves new results unchanged. This is a syntactic
  context reduction, not semantic compression, a tokenizer, or an overflow
  recovery guarantee. It does not replace automatic/manual compaction or alter
  prompt admission; compaction may run before this hook. Inspect the original
  result or re-read a relevant range when omitted details matter.
- Switching to a non-DeepSeek model stops both guidance and projection; the
  original history remains available to its provider. Other provider loadouts,
  permissions, tools and skills are unchanged.

Local coverage includes the real default loader, a tool-executing `AgentSession`
loop, model switching, opt-out, immutable rich results, Unicode boundaries, and
mock-SSE replay through the public native/OpenRouter stream APIs. These tests do
not establish live account access, billing, cache hit rates, or benchmark gains.
No performance improvement is claimed without a same-model controlled run.

Core source changes require the appropriate build and a restarted OMK process to
reach an installed launcher. `/new` does not reload core modules. Source-mode
execution and local tests do not update an already-running session.
