# /speckit-tasks

Generate an OMK-optimized task list.

Output: `specs/[###-feature]/tasks.md`

Each task includes OMK Execution Metadata:
- `role` — exposed agent role that executes the task
- `deps` — topological dependencies for DAG scheduling
- `files` — expected output files for evidence gates
- `verify` — post-task verification command
- `gate` — evidence gate type (file-exists, command-pass, diff-nonempty, summary-present)
- `risk` — checkpoint trigger (high = D-Mail/checkpoint before execution)

Runtime rules:
- Use only roles exposed by `.omk/agents/root.yaml` or `chat-agent-harness.json`.
- Keep Kimi as writer/merger/final authority unless the harness explicitly delegates otherwise.
- Use `chat-agent-harness.json` for active MCP/skills/hooks and worker limits.
- Do not copy global MCP/skill inventories or secret-like values into tasks.

This metadata improves `tasks.md` → DAG conversion accuracy and evidence-gated completion.
