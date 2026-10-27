---
name: pstack-how
description: "Use for \"how does X work\", code walkthroughs before changing something, and placement / ownership / layering questions (\"where should this live\", \"which package owns this\", \"is this the right layer\"). Explains subsystem architecture, runtime flow, onboarding mental models. Use why for motivation."
disable-model-invocation: true
---

# How

Explore the codebase to answer "how does X work?" questions. Produce architectural explanations at the level of a senior engineer onboarding onto a subsystem, enough to build a working mental model, not so much that it reads like annotated source code.

Every spawn is a `subagent` call with read-only exploration scope. Explorers use the `how explorer` line in the pstack settings file (`~/.omk/agent/pstack-models.md`, written by `/skill:pstack-setup-pstack`), and every explainer uses the `how explainer` line. OMK subagents inherit the session model, so a missing file or line, or an `auto` or `inherit-parent` entry, means the session model. If a configured model is not in the OMK catalog, run that seat on the session model and say so; never claim a cross-model seat you did not run. OMK subagents inherit the session model and effort; pass no model, effort, or speed fields.

## 1. Assess complexity

If the scope is ambiguous, state your interpretation and explore. The user can redirect.

- **Simple** (a single module, a small utility, a narrow question such as "how does function X work"): no explorers. Spawn one explainer that explores and explains in one pass, built from `references/explainer-prompt.md` without the explorer-findings section. Go to step 4.
- **Complex** (a subsystem spanning multiple files or services, a cross-cutting feature, a full architectural overview): go to step 2.

When in doubt, take the simple path.

**Subagent tool.** Spawns in this skill use OMK's `subagent` extension. Call it with `agent`, `task`, and `agentScope`, and use `tasks: [{agent, task}, ...]` for a parallel fan-out. Keep the prompt and the model. Drop parameters your tool doesn't have. If the `subagent` extension is not loaded or the project is not trusted, run each role yourself, one after another.

## 2. Explore (complex only)

Decompose the question into 2 to 4 angles, each a distinct slice of the subsystem. Spawn all explorers in a single message, each with `references/explorer-prompt.md` and its angle filled in.

## 3. Synthesize (complex only)

Once all explorers have returned, spawn one explainer with `references/explainer-prompt.md` and every explorer's findings filled in.

## 4. Present

Present the explainer's output. Light edits for clarity or context from the conversation are fine. Do not substantially rewrite it.

## Output format

The explanation uses the sections defined in `references/explainer-prompt.md`, dropping any that do not apply: Overview, Key Concepts, How It Works, Where Things Live, Gotchas.
