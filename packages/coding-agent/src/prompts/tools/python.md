Executes Python cells sequentially in a persistent IPython kernel.

## How to use (REPL discipline)

The kernel persists between calls and between cells. **Imports, variables, and functions survive.** Use this.

**Work incrementally:**
- One logical step per cell (imports, define a function, test it, use it)
- Pass multiple small cells in one call—they execute sequentially
- Define small functions you can reuse and debug individually
- Put explanations in the assistant message or cell title, **not** inside code

**When something fails:**
- The error tells you which cell failed (e.g., "Cell 3 failed")
- Earlier cells already ran—their state persists in the kernel
- Resubmit with only the fixed cell (or the fixed cell + remaining cells)
- Do NOT rewrite working cells or re-import modules

**Anti-patterns to avoid:**
- Putting everything in one giant cell
- Re-importing modules you already imported
- Rewriting working code when only one part failed
- Large functions that are hard to debug piece by piece

```python
# BAD: One giant cell
cells: [{
    "title": "all-in-one",
    "code": "import json\nfrom pathlib import Path\ndef process_all_files():\n    # 50 lines...\n    pass\nresult = process_all_files()"
}]

# GOOD: Multiple small cells
cells: [
    {"title": "imports", "code": "import json\nfrom pathlib import Path"},
    {"title": "parse helper", "code": "def parse_config(path):\n    return json.loads(Path(path).read_text())"},
    {"title": "test helper", "code": "parse_config('config.json')"},
    {"title": "use helper", "code": "configs = [parse_config(p) for p in Path('.').glob('*.json')]"}
]
```

## When to use Python

**Use Python for user-facing operations:**
- Displaying, concatenating, or merging files → `cat(*paths)`
- Batch transformations across files → `batch(paths, fn)`, `rsed()`
- Formatted output, tables, summaries
- Any loop, conditional, or multi-step logic
- Anything you'd write a bash script for

**Use specialized tools for YOUR reconnaissance:**
- Reading to understand code → Read tool
- Searching to locate something → Grep tool
- Finding files to identify targets → Find tool

The distinction: Read/Grep/Find gather info for *your* decisions. Python executes *the user's* request.

**Prefer Python over bash for:**
- Loops and iteration → Python for-loops, not bash for/while
- Text processing → `sed()`, `cols()`, `sort_lines()`, not sed/awk/cut
- File operations → prelude helpers, not mv/cp/rm commands
- Conditionals → Python if/else, not bash [[ ]]

**Shell commands:** Use `sh()` or `run()`, never raw `subprocess`:
```python
# Good
sh("bun run check")
run("cargo build --release")

# Bad - never use subprocess directly
import subprocess
subprocess.run(["bun", "run", "check"], ...)
```

## Prelude helpers

All helpers auto-print results and return values for chaining.

{{#if categories.length}}
{{#each categories}}
### {{name}}
```
{{#each functions}}
{{name}}{{signature}}
    {{docstring}}
{{/each}}
```

{{/each}}
{{else}}
(Documentation unavailable — Python kernel failed to start)
{{/if}}

## Examples

```python
# Concatenate all markdown files in docs/
cat(*find("*.md", "docs"))

# Mass rename: foo -> bar across all .py files
rsed(r'\bfoo\b', 'bar', glob_pattern="*.py")

# Process files in batch
batch(find("*.json"), lambda p: json.loads(p.read_text()))

# Sort and deduplicate lines
sort_lines(read("data.txt"), unique=True)

# Extract columns 0 and 2 from TSV
cols(read("data.tsv"), 0, 2, sep="\t")
```

## Notes

- Code executes as IPython cells; users see the full cell output (including rendered figures, tables, etc.)
- Kernel persists for the session by default; per-call mode uses a fresh kernel each call. Use `reset: true` to clear state when session mode is active
- Use `cwd` parameter instead of `os.chdir()` in tool call
- Use `plt.show()` to display figures
- Use `display()` from IPython.display for rich output (HTML, Markdown, images, etc.)
- Output streams in real time, truncated after 50KB

## Rich output rendering

The user sees output like a Jupyter notebook—rich displays are fully rendered:
- `display(JSON(data))` → interactive JSON tree
- `display(HTML(...))` → rendered HTML
- `display(Markdown(...))` → formatted markdown
- `plt.show()` → inline figures

**You will see object repr** (e.g., `<IPython.core.display.JSON object>`) **but the user sees the rendered output.** Trust that `display()` calls work correctly—do not assume the user sees only the repr.
