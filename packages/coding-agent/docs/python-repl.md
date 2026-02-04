# Python REPL (Jupyter Kernel Gateway)

## Requirements

- Python 3 available on PATH (or via an active virtualenv)
- `jupyter-kernel-gateway` (`kernel_gateway` module) and `ipykernel` installed in the selected Python environment

Install:
```bash
python -m pip install jupyter_kernel_gateway ipykernel
```

## How It Works

The Python tool uses a Jupyter Kernel Gateway and talks to it over REST and WebSocket APIs.
By default it uses a shared local gateway so multiple pi instances reuse the same gateway process.

Shared-gateway startup flow:
1. Filter the environment and resolve the Python runtime (including venv detection)
2. Acquire the shared gateway (reuse a healthy gateway or spawn `python -m kernel_gateway` on 127.0.0.1:PORT)
3. Wait for gateway readiness (`GET /api/kernelspecs`)
4. Create a kernel (`POST /api/kernels`)
5. Connect WebSocket for execution messages
6. Initialize kernel environment, run prelude helpers, and load extension modules

## External Gateway Support

Instead of spawning a local gateway, you can connect to an already-running Jupyter Kernel Gateway:

```bash
# Connect to external gateway
export OMP_PYTHON_GATEWAY_URL="http://127.0.0.1:8888"

# Optional: auth token if gateway requires it (KG_AUTH_TOKEN)
export OMP_PYTHON_GATEWAY_TOKEN="your-token-here"
```

When `OMP_PYTHON_GATEWAY_URL` is set:
- No local gateway process is spawned
- Kernels are created on the external gateway
- The gateway process is not killed on shutdown
- Availability check uses `/api/kernelspecs` endpoint instead of local module check

This is useful for:
- Remote kernel execution
- Shared kernel environments
- Pre-configured gateway setups

## Environment Propagation

- The kernel inherits a filtered environment (explicit allowlist + denylist)
- Allowlisted prefixes include `LC_`, `XDG_`, and `OMP_`; known API-key vars are removed
- `PYTHONPATH` is passed through if present
- Virtual environments are detected via `VIRTUAL_ENV`, `.venv/`, or `venv/` and preferred when present

## Prelude Extensions

Optional `.py` modules are loaded after the prelude from:

- `~/.omp/agent/modules` and `~/.pi/agent/modules`
- `<project>/.omp/modules` and `<project>/.pi/modules`

Project modules override user modules with the same filename.

## Kernel Modes

Settings under `python` control exposure and reuse:
- `toolMode`: `both` (default), `ipy-only`, `bash-only`
- `kernelMode`: `session` (default) or `per-call`
- `sharedGateway`: `true` (default). Setting to `false` throws an error because local (per-process) gateways are not supported; the shared gateway is required.

Mode behavior:
- `session`: reuse kernels per session id, serialize execution, evict after 5 minutes of idle time (max 4 sessions)
- `per-call`: create a fresh kernel per tool call and shut it down afterward

Environment override:
- `OMP_PY=0|bash` → `bash-only`
- `OMP_PY=1|py` → `ipy-only`
- `OMP_PY=mix|both` → `both`

## Shell Helper

The Python prelude exposes `run()` which executes a shell command via `bash -c` (or `sh -c` fallback)
and returns a `ShellResult` with `stdout`, `stderr`, and `code`.

## Output Handling

- Streams `stdout`/`stderr` as text
- `application/x-omp-status` emits structured status events for the TUI
- `image/png` display data renders inline in TUI
- `application/json` display data renders as a collapsible tree
- `text/markdown` is rendered as-is, `text/plain` is used as a fallback
- `text/html` display data is converted to basic markdown

## Troubleshooting

- **Kernel unavailable**: Ensure `python` + `jupyter-kernel-gateway` + `ipykernel` are installed; the session will fall back to bash-only.
- **Python mode override**: Check `python.toolMode` or `OMP_PY` if the Python tool is missing.
- **Shared gateway disabled**: `python.sharedGateway=false` causes the Python tool to error because local (per-process) gateways are not supported.
- **Skip preflight checks**: Set `OMP_PYTHON_SKIP_CHECK=1` to bypass kernel availability checks.
- **External gateway unreachable**: Check the URL is correct and the gateway is running. If auth is required, set `OMP_PYTHON_GATEWAY_TOKEN`.
- **IPC tracing**: Set `OMP_PYTHON_IPC_TRACE=1` to log kernel message flow.
- **Stdin requests**: Interactive input is not supported; refactor code to avoid `input()` or provide data programmatically.
