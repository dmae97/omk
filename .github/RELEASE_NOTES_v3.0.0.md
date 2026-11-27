# OMK v3.0.0

Owner-declared milestone release (`OMK_ALLOW_MAJOR_RELEASE=1`). OMK 3.0.0 ships a terminal IDE TUI workspace with a default-on left repository file explorer, Paper Academic hairline chrome, chat transcript mouse wheel scrolling, built-in `/plan` and `/branch` workflows, self-contained single-file standalone binaries, and runtime/security hardening.

## TUI Highlights

- **Default-on left Files sidebar and preview drawer**: Browse your repository beside the active conversation with recursive search across collapsed folders (`/files <query>`), live `↑`/`↓` filter navigation, `Enter` preview, one-key `Tab`/`Space`/`@` path insertion, a scrollable line-numbered code preview drawer (`FilePreviewDrawerComponent`), and SGR mouse click/wheel support (`Ctrl+B`/`Alt+B` to toggle, `Alt+E` to focus, `OMK_FILES_SIDEBAR=0` to opt out, `OMK_TUI_MOUSE=0` or `/files mouse off` to disable mouse).
- **Chat transcript mouse wheel scrolling**: Scroll up and down through long conversations with the mouse wheel (`Shift`/`Ctrl` + wheel for half-page fast scroll) while keeping the left Files sidebar, right status rail, and bottom prompt pinned. Includes a Paper Academic `HISTORY` hairline, streaming scroll lock with a live `below` counter, and one-click `[Latest ▾]` / `Enter` return to tail.
- **Paper Academic TUI chrome and status header**: Refined hairline framing, 4-line `OMK · STATUS` header with `◧ Files ◂/▸` chrome, readable working spinner, `/open` local path opener, and `TUI.setLeftGutter()` layout support in `omk-tui`.
- **Built-in `/plan`, `/branch`, `/metacog`, and Herdr integration**: Native `<builtin:pstack-workflow>` read-only planning and git worktree branching, built-in `<builtin:metacog>` monitoring, and `<builtin:herdr-agent-state>` socket reporting when running inside Herdr.

## Runtime, Binary & Security Highlights

- **Standalone single-file binary bootstrap**: Compiled `omk` binaries materialize embedded metadata and built-in themes into an owner-only (`0700`) cache when executed standalone without adjacent asset files.
- **Harness reliability and resource controls**: Added goal restart recovery (`goal-restart-recovery.ts`), final request budget enforcement, tool output compaction, dynamic reasoning budget, multi-session fleet inspection (`omk doctor resources --fleet`), verified memory pruning, unified multi-agent dispatch, typed Rust core runtime bridge, and SHA-256 release artifact verification gate.
- **Security hardening**:
  - Hardened `/plan` read-only shell guards to block `env`/`command` execution wrappers, multiline newlines, background `&`, process substitution (`<(`/ `>(`), `sort -o`/`--output`, and `git --output`/`--ext-diff`/`--textconv`.
  - Hardened sandbox/workspace write guards against symlink secret bypasses and `.git/hooks` writes, filtered escaping symlinks from file explorer listings, and expanded blocked secret file patterns (`.npmrc`, `.netrc`, `.pypirc`, `secrets.*`, `id_ecdsa`, `id_dsa`, `*.jks`, `*.keystore`).
- **Fixes and performance**: Fixed `ModelRegistry.refreshIfChanged()` same-tick edits on coarse-clock filesystems, fixed next-task Tab suggestion availability across completed todos, proxy effort variants, and quota snapshots, and added long-session virtualization and bounded caches.

All eight public npm packages move to `3.0.0` in lockstep. See the [coding-agent changelog](../packages/coding-agent/CHANGELOG.md#300---2026-11-27) for full details.
