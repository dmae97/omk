# OMK Speak Like You Eat

`omk-speak-like-you-eat` is an optional OMK extension that adds a plain-language companion after a completed assistant response. The original response stays unchanged and the companion is display-only: it does not enter later LLM context.

The package adapts [SLYE](https://github.com/wtfzambo/speak-like-you-eat) 1.6.1 for OMK. Upstream source is MIT-licensed and pinned in `upstream.json`.

## Install

From this source checkout:

```bash
npm run build --workspace packages/speak-like-you-eat
omk install ./packages/speak-like-you-eat
```

For a published npm release, install `npm:omk-speak-like-you-eat` with the normal OMK package manager. Run `/reload` if the session was already open. This package is not loaded by the default OMK installation.

## Commands

| Command | Behavior |
| --- | --- |
| `/slye` | Rewrite the latest eligible completed response on demand. |
| `/slye model` | Select an authenticated model without changing the current automatic on/off state. First-time setup saves automatic rewriting off. |
| `/slye on` | Enable automatic rewrites, selecting a model first when needed. |
| `/slye off` | Disable automatic rewrites while keeping manual `/slye` available. |

A manual target must be the latest conversational entry, a normally completed assistant response with no tool call, and contain prose outside fenced code. A newer user message makes an older response ineligible. Automatic mode additionally requires at least 200 non-whitespace prose characters.

Each target gets at most one persistent companion. Duplicate manual attempts do not call the model. An automatic target is attempted at most once; a failed automatic attempt can be retried manually.

## ELI5 and Light

Every rewrite makes two independent provider requests in parallel:

- **ELI5**, selected initially, rebuilds the answer with the conclusion first, followed by applicable actions, facts, and open decisions. It preserves technical terms, commands, paths, links, fenced code, and Markdown tables while removing secondary detail and workplace jargon.
- **Light** stays close to the original wording and Markdown structure while replacing jargon, filler, and stock contrasts with plain language.

Press `ctrl+\` to switch all companion cards between ELI5 and Light. The selection resets when OMK restarts. OMK currently uses the keyboard shortcut rather than upstream Pi's clickable tabs. The model name appears on the card heading when the terminal is wide enough.

The two requests have separate provider cost and latency. SLYE selects the lowest thinking level supported by the chosen model and uses a fresh session ID with cache retention disabled. Each request contains only the selected target, the relevant system prompt, and a rewrite reminder. It does not include session history, project files, skills, tools, or other extensions' prompts. Provider-side processing remains outside the package's control.

## Configuration

Model and automatic settings are stored in `slye.json`:

- Global: `~/.omk/agent/slye.json`
- Trusted project: `<cwd>/.omk/slye.json`

A trusted project file completely overrides the global file. Untrusted project files are ignored. The model picker starts with session-scoped models when available; Tab switches between scoped and all authenticated models. Settings are written atomically.

Example:

```json
{
  "enabled": false,
  "model": {
    "provider": "anthropic",
    "id": "your-configured-model-id"
  }
}
```

## Custom Light prompt

Create `slye-prompt.md` to replace the built-in Light system prompt. ELI5 always keeps its built-in prompt.

- Global: `~/.omk/agent/slye-prompt.md`
- Trusted project: `<cwd>/.omk/slye-prompt.md`

The project file takes precedence when the project is trusted. Write the complete system prompt as plain Markdown without frontmatter or an enclosing code fence. The file is reread for every attempt, so no restart is needed. A blank file or read error blocks the rewrite instead of silently falling back. Remove the file to restore the previous prompt.

## Cancellation and failure

Escape cancels a manual rewrite. Requests also have a 45-second deadline. Cancellation, timeout, provider errors, and companion persistence errors leave the original response unchanged. Manual retry remains available after failure. TUI-only behavior is disabled in print, JSON, and RPC modes.

## Development

```bash
npm test --workspace packages/speak-like-you-eat
npm run build --workspace packages/speak-like-you-eat
```

Tests use synthetic completions and make no provider calls. The package does not include upstream's Pi/OMP compatibility adapter, historical backlog, release workflows, or paid benchmark runner.
