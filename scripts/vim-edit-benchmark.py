#!/usr/bin/env python3
"""
Vim edit benchmark: Tests vim tool across 3 models with simple edit tasks.
Retries up to 10 turns until file matches expected, then asks for feedback.
Outputs JSON results with tokens, feedback, and success status.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import shutil
import sys
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "python/omp-rpc/src"))

from omp_rpc import RpcClient, RpcError  # noqa: E402

MODELS = [
    "openrouter/moonshotai/kimi-k2.5",
    "openrouter/anthropic/claude-haiku-4.5",
    "openrouter/anthropic/claude-sonnet-4.6",
    "openrouter/google/gemini-3-flash-preview",
    "openrouter/z-ai/glm-5-turbo",
    "openrouter/minimax/minimax-m2.7",
]

# Edit task: add error handling and a new method
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

EDIT_PROMPT = f"""\
Apply the following diff to the file `test.py` using the vim tool with the minimum amount of "moves":
```diff
{EDIT_DIFF}```
"""

FEEDBACK_PROMPT = """\
You just used the edit tool in vim mode to make edits. Please share your honest feedback on each point below (2-3 sentences each):

1. **Tool input schema**: Was the input schema intuitive? What could be better?
2. **Tool description**: Was the tool description helpful enough to use it correctly? How could it be improved?
3. **Tool behaviour**: Any improvements or changes to how the tool works that would lead to smoother outcomes?
4. **Tool results & errors**: What could be improved about the tool results or error messages?
5. **Bugs**: Did you encounter any bugs or unexpected behaviour?
6. **Other thoughts**: Anything else worth mentioning?
"""

MAX_TURNS = 10


@dataclass
class BenchmarkResult:
    model: str
    success: bool
    turns_used: int
    token_input: int
    token_output: int
    feedback: str
    error: str | None = None


def require_openrouter_key() -> str:
    key = os.environ.get("OPENROUTER_API_KEY")
    if not key:
        raise SystemExit("OPENROUTER_API_KEY is not set")
    return key


def resolve_omp_bin(raw: str | None) -> str:
    if raw:
        return raw
    found = shutil.which("omp")
    if not found:
        raise SystemExit("Could not find `omp` on PATH. Set --omp-bin or OMP_BIN.")
    return found


def run_benchmark_for_model(
    *,
    model: str,
    omp_bin: str,
    workspace: Path,
    timeout: float,
    openrouter_key: str,
) -> BenchmarkResult:
    """Run the vim edit benchmark for a single model."""
    test_file = workspace / "test.py"
    test_file.write_text(INITIAL_CONTENT)

    token_input = 0
    token_output = 0
    turns_used = 0
    success = False
    feedback = ""
    error_msg: str | None = None

    try:
        with RpcClient(
            executable=omp_bin,
            model=model,
            cwd=workspace,
            env={"OPENROUTER_API_KEY": openrouter_key, "PI_EDIT_VARIANT": "vim", "PI_STRICT_EDIT_MODE": "1"},
            tools=("edit", "read"),
            no_skills=True,
            no_rules=True,
            no_session=True,
            startup_timeout=30.0,
            request_timeout=120.0,
        ) as client:
            client.install_headless_ui()

            # Edit loop: keep prompting until file matches or max turns
            for turn in range(1, MAX_TURNS + 1):
                turns_used = turn

                if turn == 1:
                    client.prompt(EDIT_PROMPT)
                else:
                    current = test_file.read_text()
                    client.prompt(
                        f"The file doesn't match the expected result yet.\n\n"
                        f"Current content:\n```\n{current}```\n\n"
                        f"Expected:\n```\n{EXPECTED_CONTENT}```\n\n"
                        f"Please try again using the edit tool."
                    )

                client.wait_for_idle(timeout=timeout)

                # Check if file matches expected
                current_content = test_file.read_text()
                if current_content.strip() == EXPECTED_CONTENT.strip():
                    success = True
                    break

            # Get token usage from session stats
            stats = client.get_session_stats()
            token_input = stats.tokens.input
            token_output = stats.tokens.output

            # Ask for feedback
            client.prompt(FEEDBACK_PROMPT)
            client.wait_for_idle(timeout=timeout)
            feedback = client.get_last_assistant_text() or ""

            # Update final token counts
            stats = client.get_session_stats()
            token_input = stats.tokens.input
            token_output = stats.tokens.output

    except Exception as e:
        error_msg = f"{type(e).__name__}: {e}"

    return BenchmarkResult(
        model=model,
        success=success,
        turns_used=turns_used,
        token_input=token_input,
        token_output=token_output,
        feedback=feedback.strip(),
        error=error_msg,
    )


async def run_all(args: argparse.Namespace) -> dict:
    openrouter_key = require_openrouter_key()
    omp_bin = resolve_omp_bin(args.omp_bin)

    timestamp = time.strftime("%Y%m%d-%H%M%S")
    workspace_root = Path(tempfile.gettempdir()) / f"vim-benchmark-{timestamp}"
    workspace_root.mkdir(parents=True, exist_ok=True)

    selected_models = args.models or MODELS

    # Create workspaces and tasks
    tasks = []
    for model in selected_models:
        model_slug = model.replace("/", "_")
        workspace = workspace_root / model_slug
        workspace.mkdir(parents=True, exist_ok=True)
        print(f"Starting benchmark for {model}...", file=sys.stderr)
        tasks.append(
            asyncio.to_thread(
                run_benchmark_for_model,
                model=model,
                omp_bin=omp_bin,
                workspace=workspace,
                timeout=args.timeout,
                openrouter_key=openrouter_key,
            )
        )

    # Run all in parallel
    benchmark_results = await asyncio.gather(*tasks, return_exceptions=True)

    results: dict[str, dict] = {}
    for model, result in zip(selected_models, benchmark_results):
        if isinstance(result, Exception):
            results[model] = {
                "tokens_in": 0,
                "tokens_out": 0,
                "model_feedback": "",
                "success": False,
                "turns_used": 0,
                "error": f"{type(result).__name__}: {result}",
            }
            print(f"  {model}: error - {result}", file=sys.stderr)
        else:
            results[model] = {
                "tokens_in": result.token_input,
                "tokens_out": result.token_output,
                "model_feedback": result.feedback,
                "success": result.success,
                "turns_used": result.turns_used,
                "error": result.error,
            }
            status = "success" if result.success else "failed"
            print(f"  {model}: {status} in {result.turns_used} turns", file=sys.stderr)

    return results


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Benchmark vim tool across models with simple edit tasks."
    )
    parser.add_argument("--omp-bin", default=os.environ.get("OMP_BIN"))
    parser.add_argument(
        "--timeout", type=float, default=300.0, help="Per-turn timeout in seconds."
    )
    parser.add_argument(
        "--model",
        dest="models",
        action="append",
        help="Repeat to limit execution to specific models.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    results = asyncio.run(run_all(args))
    print(json.dumps(results, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
