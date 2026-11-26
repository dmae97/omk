# Herdr Integration

OMK includes native first-class support for [Herdr](https://github.com/herdrdev/herdr) and bundles the Apache-2.0 `herdr` skill. No Herdr binary or daemon is bundled; install Herdr separately and run `omk` inside a Herdr pane.

## How it works

When OMK runs in interactive TUI mode inside a Herdr pane (`HERDR_ENV=1`, `HERDR_PANE_ID`, and `HERDR_SOCKET_PATH` set), the built-in `<builtin:herdr-agent-state>` extension reports directly over `HERDR_SOCKET_PATH` (Unix domain socket on Unix, `\\.\pipe\<name>` on Windows):

- `pane.report_agent`: reports `idle`, `working`, and `blocked` states under `source: "omk"`, `agent: "omk"` with monotonically increasing sequence numbers.
- `pane.report_agent_session`: reports the active session file (`agent_session_path`) or in-memory session ID (`agent_session_id`) with `session_start_source`.
- Resume commands (`resume_argv`): attached automatically as `["omk", "--session", "<session-file>"]` for persistent sessions whose paths satisfy Herdr's resume command rules (no apostrophes or control characters, within argument and byte caps). In-memory sessions omit `resume_argv`.
- `pane.release_agent`: sent only when the user quits (`session_shutdown` with `reason: "quit"`), not on reload or session switches.
- Interactive modal prompts (`select`, `confirm`, `input`, `editor`, and custom UI dialogs) emit `herdr:blocked` on OMK's extension event bus so Herdr marks the pane `blocked` with the prompt title until the user responds. Extensions can also emit `omk.events.emit("herdr:blocked", { active: true, label })` and `{ active: false }`.

Outside Herdr (`HERDR_ENV !== "1"`), the built-in registers no handlers and never opens a socket. Non-interactive modes (`-p`, `--mode json`, `--mode rpc`, subagent workers) never claim a Herdr pane.

## Configuration and opt-out

- `OMK_HERDR`: default on. Set `0`, `false`, `off`, `disable`, or `disabled` to disable the built-in Herdr reporter.
- `--no-extensions`: does not disable `<builtin:herdr-agent-state>`; use `OMK_HERDR=0` to turn it off.
- `OMK_BUNDLED_SKILLS=0` or `--no-skills`: suppresses the bundled `herdr` skill. A user or project skill named `herdr` takes precedence over the bundled copy.

## Terminal images

`omk-tui` already detects `TERM_PROGRAM=Herdr` for Kitty graphics protocol support. See [Pi compatibility](pi-compatibility.md).
