# Cua Driver route

## Scope

Use host `cua-driver` for native GUI apps and signed-in host browser sessions. Keep CUA sandboxes, SDKs, benchmarks, and the host driver conceptually separate.

At the pinned source revision, `cua-driver mcp` exposes 38 snake_case tools over stdio. The core roster includes app/window inspection, screenshots plus accessibility trees, mouse/keyboard actions, session management, recording, permissions, and health reporting. It does **not** expose an arbitrary host shell tool.

## Preflight

1. Run the local inventory:

```bash
node scripts/check-runtime.mjs --json --probe
```

2. Discover the live tool roster through the MCP client.
3. Call `health_report` and require:
   - `schema_version` understood
   - `overall` equal to `ok`, or explicitly accepted `degraded`
   - core checks `binary_version`, `platform_supported`, and `session_active` passing
4. On macOS, call `check_permissions` with `prompt: false` for read-only status. Permission prompts require explicit approval.
5. On Windows, verify that the daemon is attached to an interactive Session 1+ desktop when the MCP process is launched from SSH or another non-interactive context.

`doctor`, MCP initialization, and tool discovery are necessary but not sufficient. Run a read-only `list_apps` or `list_windows` smoke with a timeout because upstream Windows enumeration hangs have been reported even when health checks pass.

## Action loop

1. Locate the app/window with `list_apps` and `list_windows`.
2. Call `get_window_state` once per turn for the target `(pid, window_id)` before any element-indexed action.
3. Cross-check the structured accessibility elements and screenshot.
4. Prefer an `element_token` or fresh `element_index` action.
5. Use window-local pixel coordinates only when accessibility action is unavailable or disproved.
6. Re-run `get_window_state` or another read-only observation after every mutation.
7. Prefer cooperative close. Never use `kill_app` without explicit approval because unsaved state is lost.

## WSL2 to Windows

The stable fact is that the Linux Cua Driver build inside WSL cannot control Windows UI. Upstream issue `trycua/cua#2099` tracks the proposed route:

```text
OMK in WSL
  → Windows cua-driver.exe mcp via WSL interop stdio
  → Windows interactive-session daemon via named pipe
  → Windows desktop apps
```

This path remains unvalidated upstream at the pinned source revision. Treat it as experimental:

1. Prefer running OMK or its MCP client on Windows.
2. If the user accepts an experiment, install/start the driver on Windows—not in WSL—and locate the Windows `.exe` without copying credentials.
3. Prove `--version`, MCP initialization, `health_report`, `list_windows`, one harmless action, and post-action verification end to end.
4. Add bounded timeouts and a manual rollback/stop path.
5. If stdio interop fails, stop. Do not invent a TCP bridge; upstream streamable-HTTP/WSL support is still tracked work.

## Lifecycle resilience

- Pin a tested Cua Driver version for repeatable automation.
- Run `health_report` at session start.
- Restart only the owned MCP/driver process and only after approval.
- After a Windows upgrade, verify the daemon version matches the CLI version. Upstream issue `#2137` reports stale scheduled-task daemon paths after upgrades.
- Keep action timeouts. Upstream issues `#2110` and `#2113` report Windows app/window enumeration hangs.
