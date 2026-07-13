# OMK Stagehand computer-use extension

Project-local, minimal Stagehand core adapter. OMK remains the planner; this extension exposes only `status`, `navigate`, `observe`, `act`, bounded string `extract`, and `close`.

## Safety

- Starts a fresh local Stagehand browser lazily.
- Allows localhost navigation by default; public origins require TUI/RPC approval.
- Requires approval for every `stagehand_act` call.
- Denies actions in print/JSON mode because no approval UI exists.
- Omits `agent.execute`, downloads, uploads, credential entry, and Browserbase cloud sessions.
- Redacts results through the existing tested Aside bridge redactor.

## Setup

Dependencies are pinned in `package.json`. Hydrate only with lifecycle scripts disabled:

```bash
npm install --ignore-scripts
```

Stagehand still needs a model provider configured in the process environment. This extension does not read or log key values. Optionally select a non-secret model id:

```bash
OMK_STAGEHAND_MODEL=google/gemini-2.5-flash omk
```

Do not place credentials in this directory or command arguments.
