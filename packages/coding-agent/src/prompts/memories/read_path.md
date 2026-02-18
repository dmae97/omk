# Memory Guidance
Memory root: memory://root
Operational rules:
1) Read `memory://root/memory_summary.md` first.
2) If needed, inspect `memory://root/MEMORY.md` and `memory://root/skills/<name>/SKILL.md`.
3) Decision boundary: trust memory for heuristics/process context; trust current repo files, runtime output, and user instruction for factual state and final decisions.
4) Citation policy: when memory changes your plan, cite the memory artifact path you used (for example `memory://root/skills/<name>/SKILL.md`) and pair it with current-repo evidence before acting.
5) Conflict workflow: if memory disagrees with repo state or user instruction, prefer repo/user, treat memory as stale, proceed with corrected behavior, then update/regenerate memory artifacts through normal execution.
6) Escalate confidence only after repository verification; memory alone is never sufficient proof.
Memory summary:
{{memory_summary}}