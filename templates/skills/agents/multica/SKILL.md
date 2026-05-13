---
name: multica
description: Managed-agent teamwork, issue assignment, progress tracking, reusable-skill compounding, and handoff workflow adapted from multica-ai/multica for OMK. Use when coordinating multiple agents, converting work into agent-ready tasks, tracking blockers, or turning repeated solutions into skills.
---

# multica

Source basis: multica-ai/multica at commit 24a59098d65e52797df6a4f4e4de2a6299f10afc. This OMK skill is a compact adaptation, not a vendored copy of upstream prompts or code.

## Use when

- Work needs multiple lanes, agent handoffs, reviewer/QA passes, or issue-board style tracking.
- A user asks to coordinate OMX/Kimi/Codex agents or compound reusable skills.
- You need to turn a broad request into assignable, verifiable tasks.

## OMK workflow

1. Define the board: goal, stop condition, lanes, owners, write scopes, verification gates, and worker limit.
2. Split only independent work. Keep blocking critical-path tasks local unless delegation was explicitly requested.
3. For each lane, provide goal, scope, files, constraints, expected output, and proof required.
4. Track lifecycle: queued, in progress, blocked, review, verified, done. Include blocker reason and next action.
5. Merge results through a reviewer/integrator pass. Do not accept agent output without diff review and gates.
6. When a repeated pattern proves useful, convert it into a compact OMK skill with source, trigger, workflow, output contract, and guardrails.

## Output contract

Return:

- lane/task board
- agent or local owner per lane
- status and blockers
- integration decisions
- reusable skill candidates
- verification evidence

## Guardrails

- Respect configured worker limits and user permission for parallel agents.
- Do not run install scripts, Docker, cloud setup, or daemon startup unless the user explicitly requests that operational change.
- Do not let agent parallelism create overlapping write scopes.
