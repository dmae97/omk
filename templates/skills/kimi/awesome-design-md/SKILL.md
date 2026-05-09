---
name: awesome-design-md
description: Use VoltAgent awesome-design-md as a curated DESIGN.md template catalog for OMK, Kimi, and Open Design UI/prototype work.
---

# /awesome-design-md

Use the VoltAgent `awesome-design-md` catalog when a UI, prototype, or visual task needs a named reference style.

## Commands

```bash
omk design list
omk design search <keyword>
omk design apply <name>
omk design lint DESIGN.md
omk design diff DESIGN.md DESIGN.next.md
```

## Workflow

1. Read the local `DESIGN.md` first when it exists.
2. If the user requests a style reference, search the catalog:

   ```bash
   omk design search vercel
   ```

3. Apply only when replacing the project design source is intended:

   ```bash
   omk design apply vercel
   ```

4. For exploratory work, copy the selected template into `DESIGN.next.md`, compare it, then adapt.
5. In Open Design, choose the **Awesome DESIGN.md Web UI Reference (OMK)** prompt template, set the catalog name, and run it with the OMK CLI agent.

## Guardrails

- Treat catalog entries as design-system references, not brand-cloning permission.
- Preserve product-specific content, accessibility, responsive behavior, and local tokens.
- Do not paste secrets, credentials, private screenshots, or private customer data into prompts.
- Cite the selected catalog name and any local files inspected in the final result.

## Output

```txt
Catalog source:
Selected template:
Local DESIGN.md action:
Open Design template:
Commands run:
Risk:
```
