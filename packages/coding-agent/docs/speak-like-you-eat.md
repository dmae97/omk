# Speak Like You Eat

[`omk-speak-like-you-eat`](https://github.com/dmae97/omk/tree/main/packages/speak-like-you-eat) is an optional OMK extension for plain-language companion rewrites. It keeps the original assistant response unchanged and displays the rewrite without adding it to later LLM context.

## Install and configure

From a source checkout:

```bash
npm run build --workspace packages/speak-like-you-eat
omk install ./packages/speak-like-you-eat
```

For a published npm release, use `omk install npm:omk-speak-like-you-eat`. Run `/reload` in an existing session. The package is not part of the default OMK runtime.

Use `/slye model` to choose an authenticated model. The picker starts with session-scoped models when available, and Tab switches between scoped and all authenticated models. SLYE selects the model's lowest supported thinking level.

Settings live in `~/.omk/agent/slye.json` globally or `.omk/slye.json` in a trusted project. The trusted project file completely overrides the global file. Untrusted project files are ignored.

## Rewrite responses

| Command | Behavior |
| --- | --- |
| `/slye` | Rewrite the latest eligible response manually. |
| `/slye model` | Choose a model without changing a valid automatic on/off state. |
| `/slye on` | Enable automatic rewrites. |
| `/slye off` | Disable automatic rewrites but keep manual rewriting available. |

Manual rewriting targets only the latest conversational entry: a normally completed assistant response with prose and no tool call. A newer user message disqualifies older responses. Automatic rewriting also requires at least 200 non-whitespace prose characters outside fenced code.

Each target gets at most one companion. Duplicate manual commands do not call the model, and automatic mode attempts each target once. A failed automatic attempt can be retried manually.

## ELI5 and Light tabs

Every rewrite performs two provider requests in parallel:

- **ELI5** reorganizes the answer around the conclusion, actions, key facts, and open decisions. It can shorten secondary evidence while preserving technical terms, exact commands, paths, URLs, fenced code, and Markdown tables.
- **Light** stays close to the original structure while replacing jargon, filler, stock metaphors, and empty negation contrasts with plain wording.

Press `ctrl+\` to switch all cards between ELI5 and Light. The choice resets on restart. OMK uses the keyboard shortcut instead of upstream Pi's clickable tabs. Each request has its own cost and latency.

SLYE sends an isolated target-only payload with a fresh session ID and cache retention disabled. It does not send conversation history, project files, project instructions, skills, or tools. The original response is never replaced.

## Custom Light system prompt

Write a complete replacement prompt in one of these files:

- `~/.omk/agent/slye-prompt.md`
- `<cwd>/.omk/slye-prompt.md` in a trusted project

The trusted project prompt wins. ELI5 always uses the built-in ELI5 prompt. The file is read on every attempt, and blank or unreadable files block rewriting instead of falling back silently. Remove the file to restore the inherited or built-in prompt.

## Failure behavior

Escape cancels manual rewriting. Requests time out after 45 seconds. Cancellation, timeout, provider failure, and persistence failure leave the original response unchanged and permit a manual retry. SLYE is inactive in print, JSON, and RPC modes.

The package adapts MIT-licensed [SLYE 1.6.1](https://github.com/wtfzambo/speak-like-you-eat) at the commit recorded in `packages/speak-like-you-eat/upstream.json`. Pi/OMP compatibility layers, historical benchmarks, and upstream release automation are not included. Tests use synthetic completions and make no provider calls.
