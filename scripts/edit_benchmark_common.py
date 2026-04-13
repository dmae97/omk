#!/usr/bin/env python3
"""
Shared helpers for edit benchmark scripts.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import shutil
import sys
import tempfile
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "python/omp-rpc/src"))

from omp_rpc import MessageEndEvent, MessageStartEvent, MessageUpdateEvent, RpcClient, ToolExecutionStartEvent  # noqa: E402

MODELS = [
    "openrouter/moonshotai/kimi-k2.5",
    "openrouter/anthropic/claude-haiku-4.5",
    "openrouter/google/gemini-3.1-flash-lite-preview",
    "openrouter/z-ai/glm-4.7-20251222:nitro"
    # "openrouter/anthropic/claude-sonnet-4.6",
    # "openrouter/google/gemini-3-flash-preview",
    # "openrouter/z-ai/glm-5-turbo",
    # "openrouter/minimax/minimax-m2.7",
]

INITIAL_CONTENT = """\
def divide(a, b):
    return a / b

def greet(name):
    return f"Hello, {name}!"

def main():
    print(divide(10, 2))
    print(greet("World"))
"""

EXPECTED_CONTENT = """\
def divide(a, b):
    if b == 0:
        return None
    return a / b

def multiply(a, b):
    return a * b

def greet(name):
    return f"Hello, {name}!"

def main():
    print(divide(10, 2))
    print(multiply(3, 4))
    print(greet("World"))
"""

EDIT_DIFF = """\
@@ -1,9 +1,14 @@
 def divide(a, b):
+    if b == 0:
+        return None
     return a / b
 
+def multiply(a, b):
+    return a * b
+
 def greet(name):
     return f"Hello, {name}!"
 
 def main():
     print(divide(10, 2))
+    print(multiply(3, 4))
     print(greet("World"))
"""

FEEDBACK_PROMPT = """\
STOP. The editing task is complete. Do NOT make any more edits or tool calls.

This is a survey. Answer these 6 questions about your experience using the editing tool (2-3 sentences each):

1. Tool input schema: Was the input schema intuitive? What confused you?
2. Tool description: Was the description clear enough? What was missing?
3. Tool behaviour: What would make the tool easier to use?
4. Tool results & errors: Were error messages helpful? What could improve?
5. Bugs: Did anything behave unexpectedly?
6. Other thoughts: Anything else?
"""

DEFAULT_MAX_TURNS = 20
_PRINT_LOCK = threading.Lock()


@dataclass(frozen=True)
class BenchmarkSpec:
    description: str
    workspace_prefix: str
    tools: tuple[str, ...]
    env: dict[str, str]
    initial_prompt: str
    retry_instruction: str


@dataclass
class BenchmarkResult:
    model: str
    success: bool
    turns_used: int
    prompt_attempts: int
    edit_calls: int
    token_input: int
    token_output: int
    feedback: str
    error: str | None = None


class VerbosePrinter:
    def __init__(self, model: str):
        self._label = model.removeprefix("openrouter/")
        self._open_kind: str | None = None
        self._seen_block_lengths: dict[tuple[str, int], int] = {}

    def _prefix(self, kind: str) -> str:
        return f"[{self._label}] {kind}> "

    def flush(self) -> None:
        with _PRINT_LOCK:
            if self._open_kind is None:
                return
            sys.stderr.write("\n")
            sys.stderr.flush()
            self._open_kind = None

    def emit_delta(self, kind: str, delta: str, content_index: int | None = None) -> None:
        if not delta:
            return

        if content_index is not None:
            key = (kind, content_index)
            self._seen_block_lengths[key] = self._seen_block_lengths.get(key, 0) + len(delta)

        with _PRINT_LOCK:
            if self._open_kind != kind:
                if self._open_kind is not None:
                    sys.stderr.write("\n")
                sys.stderr.write(self._prefix(kind))
                self._open_kind = kind

            parts = delta.splitlines(keepends=True)
            for index, part in enumerate(parts):
                if index > 0:
                    sys.stderr.write(self._prefix(kind))
                sys.stderr.write(part)

            if delta.endswith("\n"):
                self._open_kind = None

            sys.stderr.flush()

    def emit_tool_call(self, tool_name: str, args: Any) -> None:
        rendered_args = json.dumps(args, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        with _PRINT_LOCK:
            if self._open_kind is not None:
                sys.stderr.write("\n")
                self._open_kind = None
            sys.stderr.write(f"{self._prefix('tool')}{tool_name} {rendered_args}\n")
            sys.stderr.flush()

    def reset_message(self) -> None:
        self.flush()
        self._seen_block_lengths.clear()

    def emit_missing_from_message(self, message: dict[str, Any]) -> None:
        content = message.get("content")
        if not isinstance(content, list):
            return

        for content_index, block in enumerate(content):
            if not isinstance(block, dict):
                continue

            block_type = block.get("type")
            if block_type == "text":
                text = block.get("text")
                kind = "text"
            elif block_type == "thinking":
                text = block.get("thinking")
                kind = "thinking"
            else:
                continue

            if not isinstance(text, str) or not text:
                continue

            key = (kind, content_index)
            seen = self._seen_block_lengths.get(key, 0)
            if seen < len(text):
                self.emit_delta(kind, text[seen:], content_index)

    def emit_redacted_thinking_notice(self, message: dict[str, Any]) -> None:
        content = message.get("content")
        if not isinstance(content, list):
            return

        has_redacted = any(isinstance(block, dict) and block.get("type") == "redactedThinking" for block in content)
        if not has_redacted:
            return

        with _PRINT_LOCK:
            if self._open_kind is not None:
                sys.stderr.write("\n")
                self._open_kind = None
            sys.stderr.write(f"{self._prefix('thinking')}[redacted by provider]\n")
            sys.stderr.flush()


def resolve_repo_omp_bin() -> str | None:
    cli_path = REPO_ROOT / "packages/coding-agent" / "src/cli.ts"
    if not cli_path.exists():
        return None
    return str(cli_path)


def resolve_omp_bin(raw: str | None) -> str:
    if raw:
        return raw
    repo_bin = resolve_repo_omp_bin()
    if repo_bin:
        return repo_bin
    found = shutil.which("omp")
    if not found:
        raise SystemExit("Could not find `omp` on PATH and could not resolve the repo CLI. Set --omp-bin or OMP_BIN.")
    return found


def build_retry_prompt(spec: BenchmarkSpec, current_content: str) -> str:
    return (
        "The file doesn't match the expected result yet.\n\n"
        f"Current content:\n```\n{current_content}```\n\n"
        f"Expected:\n```\n{EXPECTED_CONTENT}```\n\n"
        f"{spec.retry_instruction}"
    )


def install_verbose_logging(
    client: RpcClient,
    model: str,
    mode: str | None,
    thinking: str | None,
) -> Callable[[], None] | None:
    if mode is None:
        return None

    printer = VerbosePrinter(model)
    include_messages = mode == "verbose"

    if include_messages and thinking is None:
        with _PRINT_LOCK:
            sys.stderr.write(
                f"[{model.removeprefix('openrouter/')}] verbose> "
                "no thinking level requested; pass --thinking low|medium|high|xhigh if the provider exposes reasoning.\n"
            )
            sys.stderr.flush()

    def handle_message_start(event: MessageStartEvent) -> None:
        if not include_messages:
            return
        if event.message.get("role") == "assistant":
            printer.reset_message()

    def handle_message_update(event: MessageUpdateEvent) -> None:
        if not include_messages:
            return
        if event.message.get("role") != "assistant":
            return
        message_event = event.assistant_message_event
        event_type = message_event["type"]
        if event_type == "text_delta":
            printer.emit_delta("text", message_event["delta"], message_event["contentIndex"])
        elif event_type == "thinking_delta":
            printer.emit_delta("thinking", message_event["delta"], message_event["contentIndex"])

    def handle_message_end(event: MessageEndEvent) -> None:
        if not include_messages:
            return
        if event.message.get("role") == "assistant":
            printer.emit_missing_from_message(event.message)
            printer.emit_redacted_thinking_notice(event.message)
        printer.flush()
        printer.reset_message()

    def handle_tool_start(event: ToolExecutionStartEvent) -> None:
        printer.emit_tool_call(event.tool_name, event.args)

    removers = [
        client.on_message_start(handle_message_start),
        client.on_message_update(handle_message_update),
        client.on_message_end(handle_message_end),
        client.on_tool_execution_start(handle_tool_start),
    ]

    def cleanup() -> None:
        for remove in reversed(removers):
            remove()
        printer.flush()

    return cleanup


def run_benchmark_for_model(
    *,
    spec: BenchmarkSpec,
    model: str,
    omp_bin: str,
    workspace: Path,
    timeout: float,
    log_mode: str | None,
    thinking: str | None,
    max_turns: int,
) -> BenchmarkResult:
    """Run a single edit benchmark for one model."""
    test_file = workspace / "test.py"
    test_file.write_text(INITIAL_CONTENT)

    prompt_attempts = 0
    token_input = 0
    token_output = 0
    turns_used = 0
    edit_vim_tool_calls = 0
    success = False
    feedback = ""
    error_msg: str | None = None
    counting_edit_turns = True

    try:
        with RpcClient(
            executable=omp_bin,
            model=model,
            cwd=workspace,
            env={**spec.env},
            thinking=thinking,
            tools=spec.tools,
            no_skills=True,
            no_rules=True,
            no_session=True,
            startup_timeout=30.0,
            request_timeout=120.0,
        ) as client:
            client.install_headless_ui()
            verbose_cleanup = install_verbose_logging(client, model, log_mode, thinking)

            def handle_tool_count(event: ToolExecutionStartEvent) -> None:
                nonlocal edit_vim_tool_calls, turns_used
                if counting_edit_turns:
                    turns_used += 1
                if event.tool_name in {"edit", "vim"}:
                    edit_vim_tool_calls += 1

            tool_count_remover = client.on_tool_execution_start(handle_tool_count)

            try:
                for turn in range(1, max_turns + 1):
                    prompt_attempts = turn

                    if turn == 1:
                        client.prompt(spec.initial_prompt)
                    else:
                        client.prompt(build_retry_prompt(spec, test_file.read_text()))

                    client.wait_for_idle(timeout=timeout)

                    current_content = test_file.read_text()
                    if current_content.strip() == EXPECTED_CONTENT.strip():
                        success = True
                        break

                stats = client.get_session_stats()
                token_input = stats.tokens.input
                token_output = stats.tokens.output

                counting_edit_turns = False
                client.prompt(FEEDBACK_PROMPT)
                client.wait_for_idle(timeout=timeout)
                feedback = client.get_last_assistant_text() or ""

                stats = client.get_session_stats()
                token_input = stats.tokens.input
                token_output = stats.tokens.output
            finally:
                tool_count_remover()
                if verbose_cleanup is not None:
                    verbose_cleanup()
    except Exception as exc:
        error_msg = f"{type(exc).__name__}: {exc}"

    return BenchmarkResult(
        model=model,
        success=success,
        turns_used=turns_used,
        prompt_attempts=prompt_attempts,
        edit_calls=edit_vim_tool_calls,
        token_input=token_input,
        token_output=token_output,
        feedback=feedback.strip(),
        error=error_msg,
    )


async def run_all(spec: BenchmarkSpec, args: argparse.Namespace) -> dict[str, dict[str, Any]]:
    omp_bin = resolve_omp_bin(args.omp_bin)

    timestamp = time.strftime("%Y%m%d-%H%M%S")
    workspace_root = Path(tempfile.gettempdir()) / f"{spec.workspace_prefix}-{timestamp}"
    workspace_root.mkdir(parents=True, exist_ok=True)

    selected_models = args.models or MODELS

    tasks = []
    for model in selected_models:
        model_slug = model.replace("/", "_")
        workspace = workspace_root / model_slug
        workspace.mkdir(parents=True, exist_ok=True)
        print(f"Starting benchmark for {model}...", file=sys.stderr)
        tasks.append(
            asyncio.to_thread(
                run_benchmark_for_model,
                spec=spec,
                model=model,
                omp_bin=omp_bin,
                workspace=workspace,
                timeout=args.timeout,
                log_mode="verbose" if args.verbose else ("print" if args.print else None),
                thinking=args.thinking,
                max_turns=args.max_turns,
            )
        )

    benchmark_results = await asyncio.gather(*tasks, return_exceptions=True)

    results: dict[str, dict[str, Any]] = {}
    for model, result in zip(selected_models, benchmark_results):
        if isinstance(result, Exception):
            results[model] = {
                "tokens_in": 0,
                "tokens_out": 0,
                "model_feedback": "",
                "success": False,
                "turns_used": 0,
                "prompt_attempts": 0,
                "edit_calls": 0,
                "error": f"{type(result).__name__}: {result}",
            }
            print(f"  {model}: error - {result}", file=sys.stderr)
            continue

        results[model] = {
            "tokens_in": result.token_input,
            "tokens_out": result.token_output,
            "model_feedback": result.feedback,
            "success": result.success,
            "turns_used": result.turns_used,
            "edit_calls": result.edit_calls,
            "prompt_attempts": result.prompt_attempts,
            "error": result.error,
        }
        status = "success" if result.success else "failed"
        print(f"  {model}: {status} in {result.turns_used} turns", file=sys.stderr)

    return results


def parse_args(description: str) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=description)
    parser.add_argument(
        "--omp-bin",
        default=os.environ.get("OMP_BIN"),
        help="Executable to launch. Defaults to the repo checkout CLI, then falls back to `omp` on PATH.",
    )
    parser.add_argument(
        "--timeout", type=float, default=300.0, help="Per-turn timeout in seconds."
    )
    parser.add_argument(
        "--max-turns",
        type=int,
        default=DEFAULT_MAX_TURNS,
        help=f"Maximum edit/retry turns before the benchmark gives up (default: {DEFAULT_MAX_TURNS}).",
    )
    parser.add_argument(
        "--model",
        dest="models",
        action="append",
        help="Repeat to limit execution to specific models.",
    )
    logging_group = parser.add_mutually_exclusive_group()
    logging_group.add_argument(
        "--print",
        action="store_true",
        help="Print tool calls to stderr while the benchmark runs.",
    )
    logging_group.add_argument(
        "--verbose",
        action="store_true",
        help="Print assistant text, thinking, and tool calls to stderr while the benchmark runs.",
    )
    parser.add_argument(
        "--thinking",
        choices=["off", "minimal", "low", "medium", "high", "xhigh"],
        default="medium",
        help="Request a specific thinking level for models that support reasoning (default: medium).",
    )
    return parser.parse_args()


def run_benchmark_main(spec: BenchmarkSpec) -> int:
    args = parse_args(spec.description)
    results = asyncio.run(run_all(spec, args))
    print(json.dumps(results, indent=2))
    return 0
