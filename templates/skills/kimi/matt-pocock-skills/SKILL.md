---
name: matt-pocock-skills
description: Real-engineering alignment, shared-language, TDD, diagnosis, and architecture-review workflow adapted from mattpocock/skills for OMK. Use before non-trivial implementation, ambiguous product work, debugging loops, test-first changes, or codebase architecture cleanup.
---

# matt-pocock-skills

Source basis: mattpocock/skills at commit f304057d61d3df3c9fd992ac2b6e3833cb9325fb. This OMK skill is a compact adaptation, not a vendored copy of upstream prompts or code.

## Use when

- The request is underspecified and a wrong interpretation would waste work.
- Product language, domain terms, or acceptance criteria are unclear.
- A bugfix or feature needs a test-first loop.
- The codebase is becoming hard to reason about and needs a scoped architecture pass.

## OMK workflow

1. Grill lightly: identify goal, non-goals, impacted users, constraints, and proof required. Ask only blocking questions; otherwise state assumptions.
2. Create shared language: capture domain terms, abbreviations, and project-specific meanings in the plan or relevant docs.
3. Convert the request into verifiable outcomes: failing test, typecheck, lint, screenshot, replay, or JSON gate.
4. Work in small slices. After each slice, run the cheapest useful feedback loop before widening.
5. For debugging, reproduce first, isolate the failing boundary, patch the smallest cause, then prove the original failure is gone.
6. For architecture cleanup, map module responsibilities and seams before editing; avoid rewrites not tied to the user goal.

## Output contract

Return:

- clarified assumptions or questions asked
- shared terms or acceptance criteria
- smallest implementation slice
- feedback loop commands and results
- follow-up architecture risks, if any

## Guardrails

- Do not turn a small task into a process-heavy spec unless ambiguity is material.
- Do not invent product requirements.
- Do not skip verification because the plan was detailed.
