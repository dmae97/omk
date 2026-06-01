# /speckit-plan

Generate an OMK-optimized implementation plan.

Output: `specs/[###-feature]/plan.md`

This plan must align with the current OMK runtime surface:

- Agent roles: `explorer`, `planner`, `architect`, `coder`, `reviewer`, `qa`; use extra local roles only when `.omk/agents/root.yaml` or `chat-agent-harness.json` exposes them.
- Skills: reference relevant `.kimi/skills` or `.agents/skills` entrypoints by name; do not paste full skill bodies.
- MCP: prefer project-scoped `omk-project`; all-scope/global MCP is runtime-only and must not leak secrets.
- Harness: if the run has `chat-agent-harness.json`, use it for active skills/MCP/hooks, worker limits, gates, and authority boundaries.

This plan includes:
- Agent routing hints for each phase
- Expected project structure
- Quality gate commands
- Complexity check
- Evidence and replay hooks (`omk verify --json`, run artifacts, screenshots when relevant)

The plan is consumed by `tasks-template.md` to generate DAG-ready task lists.
