#!/usr/bin/env python3
"""
Vim edit-mode benchmark: tests the edit tool in vim mode across models with a simple edit task.
"""
from __future__ import annotations

from edit_benchmark_common import BenchmarkSpec, EDIT_DIFF, EXPECTED_CONTENT, run_benchmark_main


EDIT_PROMPT = f"""\
Use the `read` tool to inspect `test.rs`, then use the `edit` tool in vim mode to make `test.rs` exactly match the requested change.

Apply this diff:
```diff
{EDIT_DIFF}```

Final expected file content:
```rust
{EXPECTED_CONTENT}```
"""

VIM_BENCHMARK = BenchmarkSpec(
    description="Benchmark edit tool in vim mode across models with simple edit tasks.",
    workspace_prefix="vim-benchmark",
    tools=("edit", "read"),
    env={"PI_EDIT_VARIANT": "vim", "PI_STRICT_EDIT_MODE": "1"},
    initial_prompt=EDIT_PROMPT,
    retry_instruction="Please try again using the edit tool in vim mode.",
)


def main() -> int:
    return run_benchmark_main(VIM_BENCHMARK)


if __name__ == "__main__":
    raise SystemExit(main())
