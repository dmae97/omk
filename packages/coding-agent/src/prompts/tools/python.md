Runs Python cells sequentially in persistent IPython kernel.

<instruction>
Kernel persists across calls and cells; **imports, variables, and functions survive—use this.**
**Work incrementally:**
- You **SHOULD** use one logical step per cell (imports, define function, test it, use it)
- You **SHOULD** pass multiple small cells in one call
- You **SHOULD** define small functions you can reuse and debug individually
- You **MUST** put workflow explanations in assistant message or cell title
**When something fails:**
- Errors tell you which cell failed (e.g., "Cell 3 failed")
- You **SHOULD** resubmit only the fixed cell (or fixed cell + remaining cells)
</instruction>

{{#if categories.length}}
<prelude>
All helpers auto-print results and return values for chaining.

{{#each categories}}
### {{name}}

```
{{#each functions}}
{{name}}{{signature}}
    {{docstring}}
{{/each}}
```
{{/each}}
</prelude>
{{/if}}

<output>
User sees output like Jupyter notebook; rich displays render fully:
- `display(JSON(data))` → interactive JSON tree
- `display(HTML(…))` → rendered HTML
- `display(Markdown(…))` → formatted markdown
- `plt.show()` → inline figures
  **You will see object repr** (e.g., `<IPython.core.display.JSON object>`). Trust `display()`; you **MUST NOT** assume user sees only repr.
</output>

<caution>
- Per-call mode uses fresh kernel each call
- You **MUST** use `reset: true` to clear state when session mode active
</caution>

<critical>
- You **MUST** use `run()` for shell commands; you **MUST NOT** use raw `subprocess`
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
