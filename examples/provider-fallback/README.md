# Example: Provider fallback

Use this example when you want to show OMK routing multiple coding-agent runtimes through one evidence-gated control loop.

## What it demonstrates

- `--provider auto` routing across configured provider adapters.
- Agent-mode CLI execution from the terminal.
- Parallel worker planning before edits.
- Dry-run safety for exploratory or failing-test tasks.

## Run it

```bash
npm i -g open-multi-agent-kit
omk init
omk doctor
omk orchestrate "fix failing tests" --workers 4 --dry-run
```

For an interactive provider-routing session, run this separately:

```bash
omk chat --provider auto --mode agent
```

## Expected output

OMK should choose an available runtime, show the selected route, prepare a bounded worker plan, and keep the run replayable through OMK artifacts. A dry run should describe the plan without applying code changes.

## Why this belongs in AI-agent SDK/tooling lists

OMK is useful for agent builders who need routing, fallback, scoped tool access, evidence gates, telemetry, and replay around coding-agent workflows.
