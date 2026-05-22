---
name: open-design
description: Launch nexu-io Open Design on localhost so OMK/Kimi can generate prototypes, decks, and design artifacts in a local web UI.
---

# /open-design

Open the local Open Design workspace for OMK/Kimi-assisted design work.

## Command

Run:

```bash
omk design open-design --open
```

This clones or reuses `nexu-io/open-design` under `.omk/open-design`, installs the pinned pnpm workspace when needed, starts the Open Design daemon + web app, and prints the localhost URL.
OMK also registers an **Awesome DESIGN.md Web UI Reference (OMK)** prompt template so Open Design prompts can use VoltAgent `awesome-design-md` catalog names such as `vercel`, `linear.app`, `stripe`, or `voltagent`.

## Defaults

- Web UI: `http://localhost:5175`
- Daemon: `http://localhost:7457`
- Checkout: `.omk/open-design`
- Agent: choose **OMK CLI** in the UI; it runs Kimi through the local OMK bridge.
- Tested Open Design ref: `3f7a05e7462f097bf38b7cbac0d4a4593deecd80`; use `--ref` or `OMK_OPEN_DESIGN_REF` for reproducible checkouts.
- Prompt template: choose **Awesome DESIGN.md Web UI Reference (OMK)** when the task should borrow a cataloged `DESIGN.md` style.

## Options

```bash
omk design open-design --web-port 5175 --daemon-port 7457
omk design open-design --dir .omk/open-design --update
omk design open-design --ref 3f7a05e7462f097bf38b7cbac0d4a4593deecd80
omk design open-design --doctor --json
omk design open-design --foreground
omk design open-design --print-only
omk open-design --print-only
```

## Rules

- Keep secrets out of prompts, logs, and generated artifacts.
- The bridge filters secret-like env vars by default. Do not pass OAuth or API keys unless `OMK_OPEN_DESIGN_TRUST_SECRET_ENV=1` is intentionally set for a trusted local run.
- Treat `awesome-design-md` entries as references; adapt the visual system instead of cloning a trademarked site.
- Local `DESIGN.md` tokens and product rules win over Open Design catalog style references.
- Image/screenshot inputs are forwarded as local `--image` paths; Kimi should use `ReadMediaFile` when available and fall back to advisory notes when not.
- Timeout success is limited to artifacts under `.omk/open-design-artifacts/<run-id>/` or an explicit `--artifact-dir`.
- Use Node.js 24.x; OMK auto-detects NVM Node 24 when available, or set `OMK_OPEN_DESIGN_NODE24=/absolute/path/to/node`.
- Run `omk design open-design --doctor --json` before troubleshooting; it checks Node 24, Corepack/pnpm, git, port conflicts, checkout compatibility, OMK_BIN, app-config, prompt template, and smoke path without cloning/installing/starting.
- On WSL, `--open` should open the Windows browser via `wslview` or `cmd.exe /c start`; if that is blocked, open the printed URL manually.
- If localhost does not open, report the printed URL plus:
  - `cd .omk/open-design && corepack pnpm tools-dev status`
  - `cd .omk/open-design && corepack pnpm tools-dev check web`
  - `cd .omk/open-design && corepack pnpm tools-dev logs`
