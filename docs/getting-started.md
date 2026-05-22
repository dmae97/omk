# Getting Started

Source release target: `@oh-my-kimi/cli@1.1.18`. Latest published npm release remains `1.1.17` until release gates pass.

## Prerequisites

- Node.js 20+
- Git
- At least one supported provider (Kimi, Codex CLI, Gemini CLI, Claude Code, OpenRouter, etc.)

## Install

```bash
npm install -g @oh-my-kimi/cli
```

## Initialize a project

```bash
omk init
```

This creates:
- `AGENTS.md`, `GEMINI.md`, `CLAUDE.md`, `DESIGN.md`
- `.kimi/skills/` (runtime skills, with Kimi as the first and most mature adapter)
- `.agents/skills/` (portable skills)
- packaged workflow skills such as `agentmemory`, `react-doctor`, and `multica`
- `.omk/` (config, hooks, memory, agents)

## Run

```bash
omk doctor
omk chat
omk plan "refactor auth module"
omk run feature-dev "add user dashboard"
```
