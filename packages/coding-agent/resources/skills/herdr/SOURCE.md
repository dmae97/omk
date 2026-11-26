# Source contract

- Repository: https://github.com/herdrdev/herdr
- Inspected default-branch revision: `e8d7d9705a7a2c89cef4dd42079379f05685af87` (Herdr v0.9.5).
- Vendored skill: `skills/herdr/SKILL.md` copied unmodified under Apache-2.0.
- Protocol contract: `src/api/schema/panes.rs` (`pane.report_agent`, `pane.report_agent_session`, `pane.release_agent`) and the [Add Herdr support](https://herdr.dev/docs/add-herdr-support/) guide.
- License: Apache License 2.0. See [LICENSE](LICENSE) and the root `NOTICE` file.

OMK implements a native TypeScript socket reporter (`src/core/herdr-client.ts` and `src/core/extensions/builtin/herdr-agent-state.ts`) against the documented socket API; no Herdr Rust binary, daemon, or terminal emulator is bundled. When `HERDR_ENV=1`, `HERDR_PANE_ID`, and `HERDR_SOCKET_PATH` are present in TUI mode, OMK reports `idle`, `working`, and `blocked` state, persistent session resume commands (`omk --session <path>`), and `pane.release_agent` on quit. Outside Herdr, the built-in registers no handlers and opens no sockets.
