---
name: pstack-swarm
description: "Fan out N parallel workers, drain them, and return one report. Use for /skill:pstack-swarm, 'swarm this', or parallel coverage, races, gauntlets, and exploration."
disable-model-invocation: true
---

# Swarm

## Start

Open a todolist with one entry per phase before launching anything.

1. Frame
2. Fan out
3. Aggregate
4. Report

## Phase A: Frame

1. State the done predicate and the artifact or report the swarm must return.
2. Choose the shape. Partition into slices, race N workers on identical briefs, or mix both. For a race or mixed shape, declare `first pass`, `rank all`, or `best-of` before spawning.
3. Pick the worker model from the `swarm workers` line in the pstack settings file (`~/.omk/agent/pstack-models.md`, written by `/skill:pstack-setup-pstack`). If the file or that line is missing, run the workers on the session model. `auto` and `inherit-parent` also mean the session model. If a configured model is not in the OMK catalog, run that seat on the session model and say so; never claim a cross-model seat you did not run. For a model race, name each arm's model up front. OMK subagents inherit the session model and effort; pass no model, effort, or speed fields.
4. Give each worker its own writable output when it writes. When workers verify or measure commits, each brief names the exact SHAs. A measurement brief also names the method (sample count, what one sample is, order). The worker records both in its result.

## Phase B: Fan out

Spawn all N workers in one message as parallel `subagent` calls (`tasks: [{agent, task}, ...]`) using the step 3 model choice. Every worker runs locally, so give each its own git worktree or output path, and keep on this machine only the work that needs its files, auth, or running apps.

When a worker must start from a non-default branch, create its local worktree from that explicit ref and include its absolute path in the brief.

**Subagent parameters.** Pass only `agent`, `task`, and `agentScope`. Workers run locally, so give each one its own worktree or output path. Keep the brief. If the `subagent` extension is not loaded or the project is not trusted, run the workers yourself, one after another.

Every brief stands alone. Include the goal, scope, exact slice or race arm, how to verify, and what to report. Reports use `PASS`, `ISSUES`, or `BLOCKED` with evidence. A worker that can prove a defect reports `ISSUES` and lists every issue it can prove, not only the first.

If a worker drops out, proceed with N-1 and note it.

## Phase C: Aggregate

Read the terminal results. Drop a result that does not record the SHAs and method its brief names, and respawn that worker once. After a second miss, record a gap. A gap does not count as a pass. For coverage, every required slice needs a result. For a race, apply the selection rule declared up front. Use first pass, rank all, or best-of. Do not paste raw worker dumps.

## Phase D: Report

Return one consolidated in-chat report with a result table, issue one-liners, gaps or dropouts, and the race rule when used.
