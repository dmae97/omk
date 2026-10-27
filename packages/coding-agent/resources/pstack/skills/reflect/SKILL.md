---
name: pstack-reflect
description: Spawn three parallel review subagents over the active transcript, surface learnings, and route each to a concrete edit on an existing skill. Use when the user says reflect.
disable-model-invocation: true
---

# Reflect

Mine the current conversation for durable learnings, then route them into skill edits.

Invoke when the user says "reflect" or "/skill:pstack-reflect". Skip when the conversation is trivial, off-topic, or already covered by an existing skill the parent followed correctly. One-offs are not learnings.

## 1. Locate the active transcript

Before fanning out, find this conversation's transcript in the active workspace's session directory. Do not glob across every project's directory. That crosses workspace boundaries and reads private chats from unrelated projects.

Use `PI_SESSION_FILE` when the host provides it. Otherwise list only the active workspace's directory under `~/.omk/agent/sessions/--<slug>--/`, with the leading slash dropped and path separators replaced by hyphens. The first JSONL record is a `type: "session"` header with `cwd`, not a user message. Confirm that cwd matches the workspace, then find the first `type: "message"` record whose message role is `user`. Do not assume that the first content part is text or that another harness's nested layout exists.

Take the newest candidates first and confirm one by finding the conversation's opening user prompt in its first user message. If none matches, pass a tight digest of the session instead.

## 2. Spawn three reviewers in parallel

One message, three `subagent` calls with write access inside the assigned scope. Check which MCP tools reviewers actually have before assigning external lookups. Missing tools are coverage gaps, not permission to widen access.

**Subagent tool.** Spawns in this skill use OMK's `subagent` extension. Call it with `agent`, `task`, and `agentScope`, and use `tasks: [{agent, task}, ...]` for a parallel fan-out. Keep the prompt and inherit the session model. Pass no model, effort, or speed fields. If the `subagent` extension is not loaded or the project is not trusted, run each role yourself, one after another.

Each reviewer and the synthesizer name a role line in the pstack settings file (`~/.omk/agent/pstack-models.md`, written by `/skill:pstack-setup-pstack`) and a default. Use that entry to name the role, but inherit the session model even when the entry names another catalog model. If a configured model is not in the OMK catalog, run that seat on the session model and say so; never claim a cross-model seat you did not run. OMK subagents inherit the session model and effort; pass no model, effort, or speed fields.

| Lens | Role line | Default `model` | Prompt template |
|---|---|---|---|
| Judgment | `reflect judgment, divergent, synthesizer` | `inherit-parent` | `references/judgment-reviewer.md` |
| Tooling | `reflect tooling` | `inherit-parent` | `references/tooling-reviewer.md` |
| Divergent | `reflect judgment, divergent, synthesizer` | `inherit-parent` | `references/divergent-reviewer.md` |

Pass each template verbatim, substituting the transcript path or digest where marked. Reviewers return findings in the `subagent` response body.

## 3. Synthesize

One `subagent` call using the `reflect judgment, divergent, synthesizer` line, defaulting to the session model. It spot-verifies citations through available MCP tools and reports inaccessible sources. Pass `references/synthesizer.md` verbatim, with each reviewer's full output inlined where marked. It returns an Accepted / Rejected / Backlog list.

## 4. Structural enforcement check

Move any Accepted item that a lint rule, script, metadata flag, or runtime check would enforce more reliably to Backlog. See the **encode-lessons-in-structure** principle skill.

## 5. Apply

Present the synthesizer's full Accepted / Rejected / Backlog output and wait for explicit approval before applying any Accepted edit. The user picks the subset and may redirect routings. Skill changes affect every future agent in the org. Do not auto-apply.

File each Backlog item to your team's devex or backlog tracker without waiting. Only the Accepted list waits for approval.

Never edit a skill inside the vendored bundle. Before approval, show its destination: `.omk/skills/<skill>/` for the project or `~/.omk/agent/skills/<skill>/` for the user. After approval, copy the skill folder there and edit the copy. Never open a PR or push.

Follow each approved row's Routing exactly:

- Trivial existing-skill edit (a one-line bullet, a tightened sentence, a stale fact corrected): the parent does it directly.
- Substantive existing-skill edit (a new section, a new pattern table, more than ~10 lines): hand to your harness's skill-authoring skill and run its draft / test / iterate loop. That is an installed `skill-creator` skill when present, otherwise the Agent Skills format at agentskills.io. "`create-skill`" below means whichever of these you use.
- `tune description: <skill path>` (the skill exists but didn't trigger when it should have): hand to `create-skill` and run its description-optimization loop.
- `new skill via create-skill: <kebab-name>`: hand creation to `create-skill`. Do not invent the shape ad hoc.

If your environment ships a SKILL.md validator, run it on every touched skill before declaring done.

## 6. Summarize for the user

Short list, no preamble:

- Edits applied: `<skill path>`. What changed, one line each.
- New skills created: `<skill path>`. One line each (rare).
- Backlog filed to the devex tracker: `<issue title>` (`<tags>`). One line each.
- Dropped: one line per rejected finding + reason from the synthesizer.
