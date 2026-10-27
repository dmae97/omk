---
name: pstack-poteto-help
description: Guides users through pstack setup, /skill:pstack-poteto-mode, and picking the skill, playbook, or principle for a task. Type /skill:pstack-poteto-help with a question.
disable-model-invocation: true
---

# Poteto help

Answer the user's question about pstack, hand them a prompt they can send, and link the file the answer came from. For a help question, don't start the work. The user asked how, and a pstack run spends real tokens, so let them send the prompt.

A message that asks for work, such as "use pstack to fix this bug", is not a help question. Read [`poteto-mode`](../poteto-mode/SKILL.md), do the work under it, and invoke the skill again at the start of each new task.

This file maps questions to the skills and guide pages that hold the answers. Those files own the details. Read the file you route to before you quote it, and trust it when it disagrees with this map. The links here point into the installed plugin, which the user may not be able to open, so give the user the file's public copy: `https://github.com/dmae97/omk/blob/main/packages/coding-agent/resources/pstack/` followed by its bundle-relative path. For unmerged changes, cite the local file instead of claiming the public copy contains them.

## Find out what they need

Infer the need from the message and the conversation. A named situation, such as "which skill reviews a PR?", goes straight to its section. If the need is still unclear, ask one multiple-choice question with these options, then answer only the section they pick:

- Get set up
- Start a task with `/skill:pstack-poteto-mode`
- Pick a skill for a situation
- Fix a run that went wrong
- Make pstack my own

Check the state that changes the answer, and mention it only when it does:

- No pstack settings file (`~/.omk/agent/pstack-models.md`, written by `/skill:pstack-setup-pstack`) means `/skill:pstack-setup-pstack` hasn't run for this user, so every role uses its default model.
- No `verify-*` skill or other app harness in the project means agents have no scripted way to drive the app. Mention `/skill:pstack-create-verification-skill` when the question is about proving a change works.
- No formal verification skill in the project means no property is checked past what tests reach. Mention `/skill:pstack-create-formal-verification-skill` when the question is about a race, an invariant, or another case tests rarely hit. When one exists and the code it covers changed after the commit it records as last in sync, mention `/skill:pstack-maintain-formal-verification-skill` if the question touches that code.

When the model rule is missing and it matters, ask whether the user wants to pick a model for each role and a reasoning budget now. It matters when the user is new, the question is about setup or cost, or the answer depends on which models run. Ask at most once per chat. If the need is also unclear, ask both questions together. Offer two choices:

- Now: give them `/skill:pstack-setup-pstack` to type, and answer their question too.
- Later: answer their question, and add one line saying every role keeps its default model until they run `/skill:pstack-setup-pstack`.

## Get set up

1. Install with `omk init --project`, which writes the bundled pstack resources into the project's `.omk/` directory without fetching or running upstream code.
2. Run [`/skill:pstack-setup-pstack`](../setup-pstack/SKILL.md). It records a recommended reasoning budget and role preferences in a settings file. Skills read it at task start; it does not automatically switch the session model or effort. Then it offers once each to generate a verification skill and a formal verification skill for the project, unless the project already has one.
3. Start a real task with `/skill:pstack-poteto-mode`, a goal, and a check that can pass or fail.

Installing changes nothing until the user invokes a skill. Only `/skill:pstack-setup-pstack` loads from the user's words. The [poteto-mode](../poteto-mode/SKILL.md) and [setup-pstack](../setup-pstack/SKILL.md) have the details. Offer to word their first prompt with them, per [`references/prompting.md`](references/prompting.md).

If cost is the worry, say where the tokens go and how to spend fewer. pstack spends extra tokens on subagents and review panels. Rerun `/skill:pstack-setup-pstack` and pick a smaller budget or cheaper models. A role set to `auto` or `inherit-parent` runs on the chat's model, which saves tokens when the chat runs on Auto or a cheaper model. A shorter panel list runs fewer subagents, one for each entry. Save `/skill:pstack-poteto-mode` for work that needs rigor.

This bundle targets OMK. Each skill is invoked as `/skill:pstack-<name>`, and a step that needs a tool OMK does not have is skipped with a one-line note.

The OMK adapter section of [`poteto-mode`](../poteto-mode/SKILL.md) maps subagent, question, transcript, and settings paths to OMK's own.

## Start a task with `/skill:pstack-poteto-mode`

`/skill:pstack-poteto-mode` matches the task to a playbook, copies the playbook's steps into the todo list, and runs the other skills as the steps need them. A step it skips stays in the list as `skip: <reason>`. A good prompt states the goal and how to tell it's done. It doesn't list skills, because a hand-written sequence tends to drop or reorder steps the playbook would keep. Read [`references/prompting.md`](references/prompting.md) before you help word one. [poteto-mode](../poteto-mode/SKILL.md) has examples.

Start each new task with `/skill:pstack-poteto-mode`. OMK loads the named skill for that request. Installing pstack does not activate a persistent mode or change keyboard bindings.

Link the [Agent Skills format](https://agentskills.io) when this comes up. Mid-chat, "new task" makes the mode match a fresh playbook. `/skill:pstack-poteto-mode` already uses `pstack-poteto-agent` for the subagents its playbook steps spawn. To get the same style from a subagent of your own, spawn it with `agent: "pstack-poteto-agent"`.

## Pick a skill

The default answer is `/skill:pstack-poteto-mode`, which runs most of the others when its steps need them. Name a skill directly when the user wants more or less of something than the playbook gives. Read the skill before you recommend it, and give one example prompt.

| The user wants to | Skill |
|---|---|
| Do any non-trivial task with rigor | [`/skill:pstack-poteto-mode`](../poteto-mode/SKILL.md) |
| Check that the agent understood their goal and the problem before it starts | [`/skill:pstack-in-your-own-words`](../in-your-own-words/SKILL.md) |
| Get a prompt rewritten deeper, not bigger, before sending it: what a top professional would add, their raw material and methods, and an outside check. It returns the prompt and doesn't do the task | [`/skill:pstack-sharpen`](../sharpen/SKILL.md) |
| Know how code works now, or where new code should live | [`/skill:pstack-how`](../how/SKILL.md) |
| Know why code is shaped this way, or where a number came from | [`/skill:pstack-why`](../why/SKILL.md) |
| Understand a change or subsystem, explained plainly | [`/skill:pstack-teach`](../teach/SKILL.md) |
| Catch up on their own recent work on a topic | [`/skill:pstack-recall`](../recall/SKILL.md) |
| Catch up on what changed in this chat since their last message, in plain words and small visuals, with every item waiting on them listed and decidable from the reply alone | [`/skill:pstack-ketchup`](../ketchup/SKILL.md) |
| Catch up like `/skill:pstack-ketchup`, in a short silent video of slides, with the waiting calls as text under it | [`/skill:pstack-ketchup-video`](../ketchup-video/SKILL.md) |
| Know what a small diff could break outside itself | [`/skill:pstack-blast-radius`](../blast-radius/SKILL.md) |
| Settle types and module shape before code that crosses a function boundary | [`/skill:pstack-architect`](../architect/SKILL.md) |
| Get several attempts at one brief, merged into the best one | [`/skill:pstack-arena`](../arena/SKILL.md) |
| Run local checks over slices, or race isolated workers | [`/skill:pstack-swarm`](../swarm/SKILL.md) |
| Have independent reviewers inspect a diff and try to break it | [`/skill:pstack-interrogate`](../interrogate/SKILL.md) |
| Fix a bug test-first when a cheap local test exists | [`/skill:pstack-tdd`](../tdd/SKILL.md) |
| Apply TypeScript rules to `.ts` or `.tsx` work | [`/skill:pstack-typescript-best-practices`](../typescript-best-practices/SKILL.md) |
| Strip comments before review, using a reviewer that didn't write them | [`/skill:pstack-no-comments`](../no-comments/SKILL.md) |
| Clean AI tells out of prose | [`/skill:pstack-unslop`](../unslop/SKILL.md) |
| Write docs, an RFC, a README, a PR description, or a commit message to a standard | [`/skill:pstack-technical-writing`](../technical-writing/SKILL.md) |
| Hear the last reply again in plain words | [`/skill:pstack-bro`](../bro/SKILL.md) |
| Give agents a scripted way to drive the app and prove behavior | [`/skill:pstack-create-verification-skill`](../create-verification-skill/SKILL.md) |
| Bring a verification skill and its feature map back in line with the app | [`/skill:pstack-maintain-verification-skill`](../maintain-verification-skill/SKILL.md) |
| Formally verify a race, invariant, or other property that tests rarely reach | [`/skill:pstack-create-formal-verification-skill`](../create-formal-verification-skill/SKILL.md) |
| Bring a formal verification back in line after the code it covers changed, and learn whether a failure is drift or a bug | [`/skill:pstack-maintain-formal-verification-skill`](../maintain-formal-verification-skill/SKILL.md) |
| Show a PM or designer what the user sees as a chart checked by a model, with each bug drawn as a numbered path, turn an agreed chart into a TLA+ skeleton, or audit the code against its TLA+ spec | [`/skill:pstack-statechart`](../statechart/SKILL.md) |
| Vet a performance number before reporting or acting on it | [`/skill:pstack-benchmark-checklist`](../benchmark-checklist/SKILL.md) |
| Run a large or cross-cutting change, or one to review after stepping away | [`/skill:pstack-figure-it-out`](../figure-it-out/SKILL.md) |
| Keep a decision log during a run, and review it afterward | [`/skill:pstack-show-me-your-work`](../show-me-your-work/SKILL.md) |
| Pick a model for each role and a reasoning budget | [`/skill:pstack-setup-pstack`](../setup-pstack/SKILL.md) |
| Turn their own working habits into a personal mode skill | [`/skill:pstack-automate-me`](../automate-me/SKILL.md) |
| Turn what a finished task taught into skill edits | [`/skill:pstack-reflect`](../reflect/SKILL.md) |
| Stop agents from repeating the same mistakes in this repo | [`/skill:pstack-correct`](../correct/SKILL.md) |
| Build a page whose buttons wake a Grok Bot over a webhook | [`/skill:pstack-make-bot-ui`](../make-bot-ui/SKILL.md) |
| Find their way around pstack | `/skill:pstack-poteto-help` |

If a skill directory next to this one is missing from the table, read its frontmatter and route by its description. The `principle-*` directories are covered under principles below.

Close calls:

- `/skill:pstack-how` explains what the code does. `/skill:pstack-why` explains the reasons. `/skill:pstack-teach` runs one or both and explains the result plainly.
- `/skill:pstack-arena` gives every worker the same brief and merges the best parts. `/skill:pstack-swarm` splits work into slices or a race and returns one report.
- `/skill:pstack-architect` implements right after it settles the design. Add "with checkpoint" to review the design before it writes code.
- `/skill:pstack-interrogate` reviews the diff. `/skill:pstack-blast-radius` looks for breakage outside the diff and proves the one fact that makes the change safe.
- `/skill:pstack-recall` rebuilds context across recent chats. `/skill:pstack-ketchup` covers only this chat since the user's last message. Resuming one specific chat or branch is the Session pickup playbook.
- `/skill:pstack-figure-it-out` designs one rigorous run. The Orchestrate playbook runs a program that spans days and many PRs. The Autonomous run playbook drives one task to a finish condition.

Not in pstack:

- `omk-aislop` covers deslop; browser control uses Playwright or CDP, and CLI control uses tmux or a PTY.
- Wait between checks with a timed shell command. Skill authoring follows the Agent Skills format or an installed `skill-creator`.
- pstack has no `/orchestrate` skill. Orchestrate is a `/skill:pstack-poteto-mode` playbook. If the slash menu shows `/orchestrate`, another plugin provides it.

## Playbooks and principles

Playbooks are step lists inside `/skill:pstack-poteto-mode`, not skills, so they have no slash command. Inside `/skill:pstack-poteto-mode`, describing the task picks one, and these phrases name one directly:

- "babysit this pr" or "check on pr 123" runs Babysit. It drives the PR to merge-ready and stops there. It doesn't merge unless the user asks to merge, land, or ship.
- "land the stack" runs Shipping.
- "take over this branch" runs Session pickup.
- "pause safely" runs Pause safely.
- "full autopilot on this queue" runs Autopilot-full. "stack them, don't ship" runs Autopilot-stack.
- "run the eval playbook" runs Eval.

Without `/skill:pstack-poteto-mode`, a phrase such as "babysit this pr" can start a different skill for the same job instead. The Playbooks section of [`poteto-mode`](../poteto-mode/SKILL.md) lists every playbook and when it applies. [Opening a PR](../poteto-mode/playbooks/opening-a-pr.md) covers opening, babysitting, and landing a PR.

pstack has no separate planning skill. For work that spans phases or stacked PRs, asking `/skill:pstack-poteto-mode` for a plan runs the [Multi-phase plan playbook](../poteto-mode/playbooks/multi-phase-plan.md), which writes the plan and doesn't implement it. For a design question, the Prototype playbook or `/skill:pstack-architect` settles it in code first.

Principles are one-rule skills that `/skill:pstack-poteto-mode` reads and cites in its replies. The user rarely invokes one. They steer with the names instead, as in "apply prove it works. show me the real output." Typing `/skill:pstack-principle-<name>` still loads one on demand. [the Principles section](../poteto-mode/SKILL.md) lists them.

## Fix a run that went wrong

| Symptom | Fix |
|---|---|
| The mode stopped applying after a few turns | Start each new task with `/skill:pstack-poteto-mode`. |
| A question got treated as the next step of the last task | Say "new task", or say the turn doesn't need the mode. |
| A new model choice had no effect | Role preferences cannot switch the session model. Select it with `/model`; delegates inherit it. |
| Runs cost more than expected | See the cost paragraph under Get set up. |
| A skill didn't load on its own | Only `/skill:pstack-setup-pstack` loads from the user's words. The others load when the user types them or when `/skill:pstack-poteto-mode` runs them, and it doesn't run every skill. |
| Parallel agents overwrote each other | Give each writer its own local worktree or output directory. |
| An overnight run moved but finished nothing | A timed wait loop needs a check that can pass or fail, not a duration. See [Autonomous run](../poteto-mode/playbooks/autonomous-run.md). |
| The reply claims success from a green build | Ask for the real command, flow, stored value, or profile. That's the prove-it-works principle. |

For a run that drifts, [`references/prompting.md`](references/prompting.md) has one-line steers. [recipes](references/recipes.md) has more pitfalls and the recipes worth copying.

## Make pstack my own

- [`/skill:pstack-automate-me`](../automate-me/SKILL.md) drafts a personal mode skill from the user's own history, to use alongside `/skill:pstack-poteto-mode`.
- [`/skill:pstack-reflect`](../reflect/SKILL.md) after a session turns its lessons into skill edits the user approves.
- `/skill:pstack-poteto-mode write a skill for <workflow>` runs the authoring playbook. The eval playbook tests a skill change blind.
- Fix a misbehaving skill in its own PR, not inside the feature work where it went wrong.

[setup-pstack](../setup-pstack/SKILL.md) covers each of these.

## Reply

Lead with the answer. Give at most one example prompt in a code block, adapted from [`references/recipes.md`](references/recipes.md) when one fits, then the link to that file. Keep it short unless the user asked for the whole map.
