# Python

Runs Python cells sequentially in persistent IPython kernel.

<instruction>
Kernel persists across calls and cells; **imports, variables, and functions survive—use this.**
**Work incrementally:**
- One logical step per cell (imports, define function, test it, use it)
- Pass multiple small cells in one call
- Define small functions you can reuse and debug individually
- Put explanations in assistant message or cell title, **not** in code
**When something fails:**
- Errors tell you which cell failed (e.g., "Cell 3 failed")
- Resubmit only fixed cell (or fixed cell + remaining cells)
</instruction>

<prelude>
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
</prelude>

<output>
Streams in real time, truncated after 100KB; if truncated, full output stored under $ARTIFACTS and referenced as `artifact://<id>` in metadata.

User sees output like Jupyter notebook; rich displays render fully:
- `display(JSON(data))` → interactive JSON tree
- `display(HTML(...))` → rendered HTML
- `display(Markdown(...))` → formatted markdown
- `plt.show()` → inline figures
  **You will see object repr** (e.g., `<IPython.core.display.JSON object>`). Trust `display()`; do not assume user sees only repr.
</output>

<caution>
- Per-call mode uses fresh kernel each call
- Use `reset: true` to clear state when session mode active
</caution>

<critical>
- Use `run()` for shell commands; never raw `subprocess`
</critical>

<example name="good">
```python
# Multiple small cells
cells: [
    {"title": "imports", "code": "import json\nfrom pathlib import Path"},
    {"title": "parse helper", "code": "def parse_config(path):\n    return json.loads(Path(path).read_text())"},
    {"title": "test helper", "code": "parse_config('config.json')"},
    {"title": "use helper", "code": "configs = [parse_config(p) for p in Path('.').glob('*.json')]"}
]
```
</example>