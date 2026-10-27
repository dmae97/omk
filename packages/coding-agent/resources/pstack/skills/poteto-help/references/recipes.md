# Prompts worth copying

Swap in the real paths, skills, and done checks. Informal wording works.

## Understand

- `/skill:pstack-poteto-mode read <thread>. restate the underlying issue in your own words, in plain english.`
- `/skill:pstack-in-your-own-words <long or messy ask>`
- `/skill:pstack-sharpen <the prompt you're about to send>`
- `/skill:pstack-poteto-mode investigate why <symptom>. give me what we know, what data you used, and your best hypotheses. don't change any code yet.`
- `use /skill:pstack-how to understand <subsystem>. then use /skill:pstack-why to find out why it broke recently.`
- `/skill:pstack-recall my work on <topic> from last week, then read <issue>.`
- `/skill:pstack-teach me why you implemented it this way and not <other way>. what did you trade off?`
- `/skill:pstack-poteto-mode take over this branch. read the decision log, find what's done, and continue. don't redo finished work.`

## Build

- Bug: `/skill:pstack-poteto-mode <symptom>. repro first, then fix and verify.`
- Bug in an app: `/skill:pstack-poteto-mode repro this with /verify-<app>. if it repros on main, fix it and show me a video as proof.`
- Bug with a cheap test: `/skill:pstack-poteto-mode repro <bug> first. if there's a cheap test path, /skill:pstack-tdd it. then fix and rerun.`
- Feature: `/skill:pstack-poteto-mode add <behavior>. <current output> stays byte-identical. verify both.`
- Refactor: `/skill:pstack-poteto-mode move <code> into one module, zero behavior change. record the current output first and prove it's unchanged after.`
- Perf: `/skill:pstack-poteto-mode <operation> takes <time> on <fixture>. trace it, fix the measured cause, show me before and after.`

## Design and plan

- `/skill:pstack-poteto-mode prototype a few options for <feature>. take screenshots or videos for me to compare.`
- `/skill:pstack-poteto-mode we need <feature>. /skill:pstack-architect it first, and answer open questions with prototypes. let me review before proceeding.`
- `/skill:pstack-poteto-mode write a tutorial for how i would use <new package> first. then /skill:pstack-teach me why it beats the current one.`
- `ask /skill:pstack-arena for a second opinion on this thread and our approach.`
- `/skill:pstack-poteto-mode turn this design into a plan. small verifiable PRs, each with its own verification steps.`
- `/skill:pstack-poteto-mode plan the migration of <library> to <target>. small verifiable PRs. the result must match the original exactly, bugs included.`

## Review and ship

- `/skill:pstack-interrogate the whole branch, but skeptically. don't change anything yet. no nitpicks unless it's a real bug or regression.` Read the dismissals too.
- `/skill:pstack-create-formal-verification-skill prove <property> holds in <module>, even when <steps> interleave or retry.` After merges or refactors in that code: `/skill:pstack-maintain-formal-verification-skill`.
- `/skill:pstack-swarm check every package under <dir> against its check script. one worker per package. one report.`
- `/skill:pstack-poteto-mode open the pr. small ordered commits, evidence in the description.`
- `/skill:pstack-poteto-mode babysit this pr. get it green.` For status only: `/skill:pstack-poteto-mode check on pr <number>. anything outstanding?`
- `/skill:pstack-poteto-mode land the stack.`

## Away and back

- `/skill:pstack-poteto-mode im going to bed. <goal> in a fresh worktree off <base>. done means <checks>. keep a decision log. don't ask me before committing. keep a timed wait loop until done. if you're truly stuck after a few hours, stop and write up why.`
- `/skill:pstack-show-me-your-work catch me up on what you did last night.` Read its Attention section first.
- `/skill:pstack-ketchup` catches you up on this chat since your last message and lists every call that waits on you.
- `/skill:pstack-poteto-mode full autopilot on this queue. each item is independent.`
- `/skill:pstack-poteto-mode autopilot these changes but stack them, don't ship. i'll land the stack.`
- `/skill:pstack-reflect capture what we learned so the next run doesn't repeat it.` Approve only edits that change a future decision.
- `/skill:pstack-bro` restates the last reply in plain words.
