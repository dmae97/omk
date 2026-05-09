---
name: omk-design-md
description: Generate, read, validate, diff, and apply Google DESIGN.md files for Kimi UI/frontend tasks, Tailwind themes, screenshots, and visual coding.
---

## Use When

Use this skill when:

- creating UI
- modifying frontend components
- reviewing screenshots
- converting mockups into code
- generating landing pages
- working with Tailwind, shadcn/ui, React, Next.js, or design tokens

## Rules

1. Read `DESIGN.md` before UI implementation if it exists.
2. If `DESIGN.md` does not exist, infer a minimal design system from existing UI.
3. Do not invent arbitrary colors if tokens exist.
4. Validate `DESIGN.md` when the CLI is available:

```bash
npx @google/design.md lint DESIGN.md
```

5. For major design changes, create `DESIGN.next.md` and compare:

```bash
npx @google/design.md diff DESIGN.md DESIGN.next.md
```

6. When using Tailwind, export tokens if needed:

```bash
npx @google/design.md export --format tailwind DESIGN.md > tailwind.theme.json
```

7. When a named visual reference is requested, use the bundled `awesome-design-md` skill and OMK catalog commands:

```bash
omk design search <keyword>
omk design apply <name>
```

## Output

```txt
Design source:
Tokens used:
Components affected:
Accessibility risk:
Commands run:
```
