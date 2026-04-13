#!/usr/bin/env python3
"""
Chunk edit benchmark: tests chunk-mode edit tool usage across models with a simple edit task.
"""
from __future__ import annotations

from edit_benchmark_common import BenchmarkSpec, EDIT_DIFF, EXPECTED_CONTENT, run_benchmark_main

EDIT_PROMPT = f"""\
Use the `read` tool to inspect `test.py`, then use the `edit` tool in chunk mode to make `test.py` exactly match the requested change.

Apply this diff:
```diff
{EDIT_DIFF}```

Final expected file content:
```python
{EXPECTED_CONTENT}```
"""

CHUNK_BENCHMARK = BenchmarkSpec(
    description="Benchmark chunk-mode edit tool across models with simple edit tasks.",
    workspace_prefix="chunk-benchmark",
    tools=("edit", "read"),
    env={"PI_EDIT_VARIANT": "chunk", "PI_STRICT_EDIT_MODE": "1"},
    initial_prompt=EDIT_PROMPT,
    retry_instruction='Use `read(path="test.py")` to refresh chunk selectors if needed, then try again using the edit tool.',
)


def main() -> int:
    return run_benchmark_main(CHUNK_BENCHMARK)


if __name__ == "__main__":
    raise SystemExit(main())
