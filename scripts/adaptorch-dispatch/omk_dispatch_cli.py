"""CLI for omk_dispatch: plan-only by default, node execution only with --handler-cmd.

    $ADAPTORCH_REPO/.venv/bin/python scripts/adaptorch-dispatch/omk_dispatch_cli.py \
        --input request.json [--handler-cmd CMD ARG...] [--node-timeout 600]

--handler-cmd runs CMD once per ready node, writes the NodeRequest as JSON on stdin and
uses stdout as the node output. Pointing it at ``omk -p`` or any model runner makes
provider calls; that is the caller's explicit choice, never a default.
"""

from __future__ import annotations

import argparse
import asyncio
import dataclasses
import json
import sys
from pathlib import Path

from omk_dispatch import NodeHandler, NodeRequest, dispatch, plan

_STDERR_TAIL = 2000


def command_handler(argv: list[str], node_timeout: float) -> NodeHandler:
    async def handle(node: NodeRequest) -> str:
        proc = await asyncio.create_subprocess_exec(
            *argv, stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE)
        body = json.dumps({**dataclasses.asdict(node), "upstream": dict(node.upstream)}).encode()
        try:
            out, err = await asyncio.wait_for(proc.communicate(body), node_timeout)
        except BaseException:
            if proc.returncode is None:
                proc.kill()
                await proc.wait()
            raise
        if proc.returncode != 0:
            tail = err.decode(errors="replace")[-_STDERR_TAIL:]
            raise RuntimeError(f"node {node.node_id} handler exited {proc.returncode}: {tail}")
        return out.decode(errors="replace")

    return handle


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--node-timeout", type=float, default=600.0)
    parser.add_argument("--handler-cmd", nargs=argparse.REMAINDER)
    args = parser.parse_args(argv)
    try:
        request = json.loads(args.input.read_text(encoding="utf-8"))
        if args.handler_cmd:
            handler = command_handler(args.handler_cmd, args.node_timeout)
            report = asyncio.run(dispatch(request, handler))
        else:
            report = plan(request)[2]
    except (OSError, ValueError, RuntimeError, TimeoutError) as exc:
        sys.stderr.write(f"omk_dispatch: {type(exc).__name__}: {exc}\n")
        return 2
    text = json.dumps(report, ensure_ascii=False, indent=2)
    if args.output:
        args.output.write_text(text + "\n", encoding="utf-8")
    else:
        sys.stdout.write(text + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
