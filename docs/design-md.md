# DESIGN.md Integration

open-multi-agent-kit supports Google DESIGN.md for visual identity.

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
omk design open-design --doctor --json # Diagnose bridge readiness without side effects
```

## Skill

The `omk-design-md`, `awesome-design-md`, and `open-design` skills are included in `.kimi/skills/`.

## Open Design

`omk design open-design` registers the **Awesome DESIGN.md Web UI Reference (OMK)** prompt template in Open Design. Use it when a prompt should borrow a named catalog style while preserving local product content and brand-safety guardrails.

Bridge hardening:

- Default public checkout remains `--branch main`; reproducible runs can pin `--ref <branch|tag|sha>` or `OMK_OPEN_DESIGN_REF`. OMK records tested upstream ref `3f7a05e7462f097bf38b7cbac0d4a4593deecd80`.
- `--doctor --json` checks Node 24, Corepack/pnpm, git, ports, checkout layout compatibility, `OMK_BIN`, app-config, prompt template, and smoke path without clone/install/start side effects.
- Open Design image/screenshot inputs are forwarded to `open-design-agent --image <path>` as local paths only; Kimi is instructed to use `ReadMediaFile` when available.
- Timeout success only counts artifacts inside `.omk/open-design-artifacts/<run-id>/` or the explicit `--artifact-dir`; unrelated repo file changes do not mask failures.
- The bridge filters secret-like child env vars by default. `OPENAI_API_KEY`, OAuth tokens, `*_TOKEN`, `*_SECRET`, and `*_KEY` are not passed to Kimi unless `OMK_OPEN_DESIGN_TRUST_SECRET_ENV=1` is explicitly set.

Open Design outputs must prioritize the local `DESIGN.md` tokens and product constraints. Catalog styles are references, not replacement brand systems.
