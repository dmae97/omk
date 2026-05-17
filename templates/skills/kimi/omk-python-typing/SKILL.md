---
name: omk-python-typing
description: Python typed development standards using type hints, pytest, ruff, pyright, uv, and maintainable package structure.
---

## Python Rules

- Use type hints for public functions.
- Prefer `Path` over raw string paths.
- Prefer dataclasses or Pydantic models for structured data.
- Avoid mutable default arguments.
- Do not silence type errors without reason.
- Keep IO, business logic, and CLI boundaries separate.

## Tooling

Prefer existing project tools. If missing, suggest:

```bash
ruff check .
ruff format .
pyright
pytest
```

## Output

```txt
Typing issues:
Runtime risks:
Test gaps:
Fix plan:
```
