---
name: pstack-setup-pstack
description: Configure which models pstack uses per role and at what reasoning budget in OMK. Detects the models available in the OMK catalog and writes ~/.omk/agent/pstack-models.md, which overrides the skill defaults. Use for /skill:pstack-setup-pstack, "configure pstack models", "pstack budget", or changing pstack's model choices.
---

# Setup pstack

Write pstack's model settings, one role per line, to `~/.omk/agent/pstack-models.md`.
OMK does not auto-apply that file as a rule. The pstack skills read it at task start when
they pick a model, and "the settings file" below means that path.

Two values always work:

- `inherit-parent` and `auto` mean the session model. They are the defaults for every role.
- A model id from this session's OMK catalog. Never write an id you have not confirmed.

OMK subagents inherit the session model and effort. A role that names another catalog model
only takes effect where the subagent tool accepts a model override. Where it does not, the
role falls back to the session model and the fallback is reported. Never claim a
cross-model panel, race, or review that did not actually run on different models.

## Steps

### 1. Detect available models

List the models in this session's OMK catalog. That is the dependable source. If you cannot
list the catalog, ask the user to paste the ids they have access to. `inherit-parent` and
`auto` are valid even though they are not catalog ids.

### 2. Ask for a budget

Ask in chat with numbered options, and name the current budget when the file records one.
With no file, say that `large` matches the skill defaults.

1. `unlimited` — max thinking
2. `large` — xhigh thinking
3. `medium` — high thinking
4. `small` — medium thinking

The budget is a recommendation for the parent's thinking level. OMK does not encode effort
in model ids, so do not rewrite ids to carry an effort suffix.

### 3. Show the roles and confirm

Show every role with its value, marking any id that is not in the detected catalog as
needing a choice. On a re-run, keep roles the user changed. Ask whether to accept as-is or
change specific roles, offering the detected ids plus `inherit-parent` and `auto`.

Panel roles (`arena runners`, `architect runners`, `interrogate reviewers`) take a
comma-separated list, and one subagent runs per entry, so the list length sets the count.
`arena cross-judge pool` is also a list, but Arena selects one value from it. `swarm workers`
is the default model for every worker unless a race assigns another model per arm.

### 4. Validate

Every real id written must be in the detected catalog. `inherit-parent` and `auto` always
pass. If a chosen id is not available, stop and ask again.

### 5. Write the settings file

Write a `# budget` line with the chosen label, then one line per role, using the same labels
poteto-mode uses. Plain Markdown, no frontmatter. Overwrite the whole file so re-runs stay
idempotent. Shape:

```
# budget: large
feature, refactoring: inherit-parent
bug-fix: inherit-parent
perf-issue: inherit-parent
hillclimb: inherit-parent
judgment and prose: inherit-parent
hardest tasks: inherit-parent
how explorer: inherit-parent
how explainer: inherit-parent
why investigators: inherit-parent
why synthesizer: inherit-parent
reflect tooling: inherit-parent
reflect judgment, divergent, synthesizer: inherit-parent
arena runners: inherit-parent
arena cross-judge pool: inherit-parent
swarm workers: inherit-parent
architect runners: inherit-parent
interrogate reviewers: inherit-parent
```

### 6. Report

Tell the user which file was written. OMK pstack skills read it when they pick a model, and
re-running this skill updates it. The file is user-level configuration, so it applies to new
tasks in every project on this machine.
