# DESIGN.md Integration

oh-my-kimi supports Google DESIGN.md for visual identity.

## Commands

```bash
omk design init          # Create DESIGN.md
omk design list          # List awesome-design-md templates
omk design search vercel # Search awesome-design-md templates
omk design apply vercel  # Apply a template to DESIGN.md
omk design lint          # Validate DESIGN.md
omk design diff A B      # Compare two design files
omk design export tailwind # Export tokens to Tailwind
omk design open-design --open # Launch Open Design with OMK bridge + templates
```

## Skill

The `omk-design-md`, `awesome-design-md`, and `open-design` skills are included in `.kimi/skills/`.

## Open Design

`omk design open-design` registers the **Awesome DESIGN.md Web UI Reference (OMK)** prompt template in Open Design. Use it when a prompt should borrow a named catalog style while preserving local product content and brand-safety guardrails.
