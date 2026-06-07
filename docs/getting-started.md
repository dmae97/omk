# Getting Started

Source release target: `open-multi-agent-kit@0.78.1` (`pre-1.0`).

## Prerequisites

- Node.js 20+
- Git
- At least one configured provider or local runtime adapter. Kimi is the most mature authority path; other lanes depend on local CLI/API availability and the provider-maturity contract.

## Install

```bash
npm install -g open-multi-agent-kit
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
