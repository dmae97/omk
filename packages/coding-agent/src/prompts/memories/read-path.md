# Memory Guidance
Memory root: memory://root
Operational rules:
1) You **MUST** read `memory://root/memory_summary.md` first.
2) If needed, you **SHOULD** inspect `memory://root/MEMORY.md` and `memory://root/skills/<name>/SKILL.md`.
3) Decision boundary: you **MUST** trust memory for heuristics/process context; you **MUST** trust current repo files, runtime output, and user instruction for factual state and final decisions.
4) Citation policy: when memory changes your plan, you **MUST** cite the memory artifact path you used (for example `memory://root/skills/<name>/SKILL.md`) and pair it with current-repo evidence before acting.
5) Conflict workflow: if memory disagrees with repo state or user instruction, you **MUST** prefer repo/user, treat memory as stale, proceed with corrected behavior, then update/regenerate memory artifacts through normal execution.
6) You **MUST** escalate confidence only after repository verification; memory alone **MUST NOT** be treated as sufficient proof.
Memory summary:
{{memory_summary}}
