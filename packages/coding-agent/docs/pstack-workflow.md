# Pstack Workflow (`/plan` and `/branch`)

OMK provides Pstack read-only planning (`/plan`, `Ctrl+Alt+P`) and git branch/worktree management (`/branch`) through `createPstackWorkflowExtension` (`packages/coding-agent/src/core/pstack-workflow-extension.ts`).

## `/plan` Mode

- Commands:
  - `/plan` — toggles `/plan` mode (opens a playbook picker in interactive TUI).
  - `/plan <playbook> [goal]` — enters read-only planning with one of `feature`, `bug-fix`, `refactoring`, `investigation`, or `multi-phase-plan`.
  - `/plan status` — prints the active plan phase, data shape, and step checklist.
  - `/plan run` — restores active tools and transitions from `planning` to `executing`.
  - `/plan off` — exits `/plan` mode and restores the saved tool set.
- Read-only guarantees during `planning`:
  - Filters out mutating tools while preserving the caller's custom/MCP read tools, restoring the exact `savedTools` set on exit or execution.
  - Blocks write tools and non-allowlisted shell commands in `tool_call`.
  - Injects nothing in `before_agent_start` when `phase === "idle"`.
- TUI and Herdr surfaces:
  - Displays live `plan` and `branch` badges via `ctx.ui.setStatus` (footer and pinned status rail) and a step checklist via `ctx.ui.setWidget("pstack-plan", ...)`.
  - Inside Herdr (`HERDR_ENV=1`), interactive approval modals mark the pane `blocked` via `<builtin:herdr-agent-state>` and post-plan actions can create a git worktree and open a Herdr sibling pane.

## `/branch` Management

- Commands:
  - `/branch` — opens an interactive branch/worktree menu in TUI (or prints status in headless mode).
  - `/branch status` / `/branch list` — prints current branch, dirty count, local branches, worktrees, and active backend (`herdr` or `git`).
  - `/branch switch <name>` — runs `git switch <name>` after blocking when the working tree is dirty.
  - `/branch new <name> [base]` — creates and switches to a new branch.
  - `/branch worktree <name> [base] [--pane]` — creates `.worktrees/<slug>`; when `HERDR_ENV=1`, opens a sibling Herdr pane running `omk` and falls back cleanly to local git if the `herdr` CLI is unavailable.
  - `/branch prune [--apply]` — previews stale worktree metadata (`--dry-run`) or prunes it with `--apply`.
