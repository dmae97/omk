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
- Agent: Open Design auto-detects local code-agent CLIs; choose **Kimi CLI** in the UI if it is not selected automatically.
- Prompt template: choose **Awesome DESIGN.md Web UI Reference (OMK)** when the task should borrow a cataloged `DESIGN.md` style.

## Options

```bash
omk design open-design --web-port 5175 --daemon-port 7457
omk design open-design --dir .omk/open-design --update
omk design open-design --foreground
omk design open-design --print-only
```

## Rules

- Keep secrets out of prompts, logs, and generated artifacts.
- Treat `awesome-design-md` entries as references; adapt the visual system instead of cloning a trademarked site.
- Use Node.js 24.x; Open Design enforces this in its package metadata.
- On WSL, `--open` should open the Windows browser via `wslview` or `cmd.exe /c start`; if that is blocked, open the printed URL manually.
- If localhost does not open, report the printed URL plus:
  - `cd .omk/open-design && corepack pnpm tools-dev status`
  - `cd .omk/open-design && corepack pnpm tools-dev check web`
  - `cd .omk/open-design && corepack pnpm tools-dev logs`
