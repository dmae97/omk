# Getting Started

Source release target: `@omk/cli@0.78.0-alpha.1`.

## Prerequisites

- Node.js 20+
- Git
- At least one supported provider or local runtime adapter (Codex CLI, Gemini CLI, Claude Code, OpenRouter, DeepSeek, Kimi, etc.)

## Install

```bash
npm install -g @omk/cli
```

## Initialize a project

```bash
omk init
```

This creates:
- `AGENTS.md`, `GEMINI.md`, `CLAUDE.md`, `DESIGN.md`
- `.kimi/skills/` (runtime adapter skills used by the OMK control loop)
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
