#!/usr/bin/env python3
"""
Vim edit benchmark: tests the vim tool across models with a simple edit task.
"""
from __future__ import annotations

from edit_benchmark_common import BenchmarkSpec, EDIT_DIFF, run_benchmark_main

EDIT_PROMPT = f"""\
Apply the following diff to the file `test.py` using the vim tool with the minimum amount of "moves":
```diff
{EDIT_DIFF}```
"""

VIM_BENCHMARK = BenchmarkSpec(
    description="Benchmark vim tool across models with simple edit tasks.",
    workspace_prefix="vim-benchmark",
    tools=("edit", "read"),
    env={"PI_EDIT_VARIANT": "vim", "PI_STRICT_EDIT_MODE": "1"},
    initial_prompt=EDIT_PROMPT,
    retry_instruction="Please try again using the vim tool.",
)


def main() -> int:
    return run_benchmark_main(VIM_BENCHMARK)


if __name__ == "__main__":
    raise SystemExit(main())
