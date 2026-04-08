# omp-rpc

Typed Python bindings for the `omp --mode rpc` protocol used by the coding agent.

This package wraps the newline-delimited JSON RPC transport exposed by the CLI and
provides:

- typed command methods for the stable RPC surface
- typed protocol models for state, bash results, compaction, and session stats
- a process-backed client that manages request correlation over stdio
- helpers for collecting prompt runs and handling extension UI requests

## Basic Usage

```python
from omp_rpc import RpcClient

with RpcClient(provider="anthropic", model="claude-sonnet-4-5") as client:
    state = client.get_state()
    print(state.model.id if state.model else "no model")

    turn = client.prompt_and_wait("Reply with just the word hello")
    print(turn.require_assistant_text())
```

By default the client runs:

```bash
omp --mode rpc
```

You can also point it at a custom command, which is useful inside this repo while
developing against the Bun entrypoint:

```python
from omp_rpc import RpcClient

with RpcClient(
    command=[
        "bun",
        "packages/coding-agent/src/cli.ts",
        "--mode",
        "rpc",
        "--provider",
        "anthropic",
        "--model",
        "claude-sonnet-4-5",
    ],
) as client:
    print(client.get_state().session_id)
```

## Extension UI Requests

Extensions in RPC mode can ask the host for input. Those requests are available as
typed `ExtensionUiRequest` instances:

```python
request = client.next_ui_request(timeout=5.0)

if request.method == "confirm":
    client.send_ui_confirmation(request.id, True)
elif request.method in {"input", "editor"}:
    client.send_ui_value(request.id, "approved")
```

## Protocol Reference

The canonical wire protocol still lives in the repo at
[`docs/rpc.md`](../../docs/rpc.md).
