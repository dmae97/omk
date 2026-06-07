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

## Updates

On startup OMK checks npm for a newer release and, when one exists, shows an
interactive prompt (Update now / Skip this version / Remind me later). Choosing
"Update now" runs `npm i -g open-multi-agent-kit`.

- **Automatic (non-interactive) updates:** set `OMK_AUTO_UPDATE=1` (also accepts
  `true|yes|on|always`). When OMK is outdated it self-updates on startup without
  prompting. CI is always skipped, and `OMK_UPDATE_PROMPT=off` disables update
  checks entirely.
- Manual check: `omk update check` (add `--refresh` to bypass the cache).

## Support the project (GitHub star)

First-time users get a one-time prompt to star the repository. If the GitHub CLI
(`gh`) is authenticated the star is applied directly; otherwise OMK prints the
repo URL and, on a desktop session, opens it in your browser so you can star in
one click. You can star anytime with `omk star`, check status with
`omk star --status`, and disable the prompt with `OMK_STAR_PROMPT=off`.
