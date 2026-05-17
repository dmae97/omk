# Getting Started

Current package: `@oh-my-kimi/cli@1.1.16`.

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
- `.kimi/skills/` (Kimi-specific skills)
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
