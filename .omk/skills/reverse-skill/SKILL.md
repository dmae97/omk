---
name: omk-reverse-skill
description: Alias of omk-reverse-skill. Use when adapting external reverse-engineering packs or routing APK/binary/JS/browser/API/protocol/CTF tasks.
---

# omk-reverse-skill (project alias)

This directory used to be named `reverse-skill`. The canonical skill name is
**`omk-reverse-skill`**.

Live hub + packs:

`~/.omk/agent/skills/omk-reverse-skill/SKILL.md`

Packs: `~/.omk/agent/skills/omk-reverse-skill/packs/`
(`api-spec-recover`, `api-client-gen`, `protocol-re`, `ghidra-ida-re`, `android-re`)

Router: `packages/agent/src/harness/reverse-skill.ts`

Do not create a second skill named `reverse-skill`, `reverse-engineering-api`,
`protocol-reverse-engineering`, `ghidra-ida-re`, or `android-reverse-engineering`.
