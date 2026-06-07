# Adjustable Timeouts and Cron Jobs

**Date**: 2026-05-05
**Issue**: [#6](https://github.com/dmae97/open-multi-agent-kit/issues/6) — Adjustable timeouts and execution limits
**Status**: Implemented in v1.1.1
**Spec**: `specs/001-adjustable-timeouts-cron/`

## Summary

This feature addresses the gap where OMK excelled at active multi-agent coding sessions but lacked support for passive long-running tasks (large file downloads, compilation, AI training) and scheduled automation. It introduces:

1. **Timeout Presets** — configurable, named timeout profiles for DAG nodes
2. **Cron Jobs** — scheduled recurring DAG execution via `.omk/cron.yml`
3. **Long-Running Task Monitor** — heartbeat-based health tracking and stall detection

---

## 1. Timeout Presets

### Built-in Presets

| Preset | Timeout | Description |
|--------|---------|-------------|
| `default` | 2 minutes | Backward-compatible default |
| `quick` | 30 seconds | Fast tasks |
| `standard` | 2 minutes | Same as default |
| `long-running` | 30 minutes | Compilation, downloads, training |
| `unlimited` | 0 (no timeout) | Use with caution |

### Configuration

Add custom presets to `.omk/config.toml`:

```toml
[timeouts.training]
timeout_minutes = 120
description = "AI model training session"

[timeouts.compile]
timeout_minutes = 45
description = "Large project compilation"
```

Or use `timeout_ms` for millisecond precision:

```toml
[timeouts.precise]
timeout_ms = 900000
description = "Exactly 15 minutes"
```

### Usage

#### Per-node (DAG JSON)
```json
{
  "id": "train-model",
  "role": "coder",
  "timeoutPreset": "training"
}
```

#### Per-node override (highest priority)
```json
{
  "id": "train-model",
  "role": "coder",
  "timeoutPreset": "training",
  "timeoutMs": 7200000
}
```
The explicit `timeoutMs` always wins over the preset.

#### CLI flag
```bash
omk run feature-dev "Implement auth" --timeout-preset long-running
omk parallel "Refactor legacy code" --timeout-preset compile
```

#### Environment variable
```bash
export OMK_NODE_TIMEOUT_MS=600000  # 10 minutes for all nodes
omk run feature-dev "Implement auth"
```

### Resolution Priority

1. Per-node `timeoutMs`
2. Per-node `timeoutPreset`
3. CLI `--timeout-preset`
4. Environment `OMK_NODE_TIMEOUT_MS`
5. Built-in `default` preset (120s); `omk parallel` keeps its historical 10-minute default when no preset is requested

---

## 2. Cron Jobs

### Configuration

Create `.omk/cron.yml`:

```yaml
jobs:
  - name: nightly-build
    schedule: "@daily"
    dagFile: "dags/nightly.json"
    concurrencyPolicy: forbid
    enabled: true
    catchup: false

  - name: health-check
    schedule: "@every 30m"
    dagFile: "dags/health.json"
    concurrencyPolicy: allow
    enabled: true

  - name: weekly-report
    schedule: "@weekly"
    dagFile: "dags/report.json"
    concurrencyPolicy: replace
    enabled: true
```

### Schedule Syntax

| Expression | Meaning |
|------------|---------|
| `@yearly` / `@annually` | Once per year |
| `@monthly` | Once per month |
| `@weekly` | Once per week |
| `@daily` / `@midnight` | Once per day |
| `@hourly` | Once per hour |
| `@every 5m` | Every 5 minutes |
| `@every 1h` | Every hour |
| `@every 30s` | Every 30 seconds |

### Concurrency Policy

| Policy | Behavior when previous run is active |
|--------|--------------------------------------|
| `allow` | Start new run in parallel |
| `forbid` | Skip the new run |
| `replace` | Detach old tracking and start new |

### CLI Commands

```bash
# List all jobs
omk cron list

# Run a job immediately (independent of schedule)
omk cron run nightly-build

# Run an ad-hoc job
omk cron run ad-hoc-job --dag-file dags/one-off.json

# View recent runs
omk cron logs nightly-build

# Enable/disable (non-persistent; edit YAML to persist)
omk cron enable nightly-build
omk cron disable health-check
```

### Run Persistence

Each cron run is persisted to:
```
.omk/cron-runs/<job-name>/<timestamp>.json
```

Example:
```json
{
  "jobName": "nightly-build",
  "startedAt": "2026-05-05T00:00:00.000Z",
  "completedAt": "2026-05-05T00:15:30.000Z",
  "success": true,
  "runId": "nightly-build-1714857600000",
  "logPath": ".omk/cron-runs/nightly-build/2026-05-05T00-00-00-000Z.json"
}
```

---

## 3. Long-Running Task Monitor

### Heartbeat Mechanism

While a DAG node is running, the executor emits a heartbeat every 30 seconds:
- Updates `state.lastHeartbeatAt`
- Registers with the node monitor engine

### Stall Detection

If no heartbeat is received for 3 × 30s = 90s, the node is marked as **stalled**:
```
[omk] node train-model stalled (no heartbeat for 90000ms)
```

Stalled nodes respect the node's `failurePolicy`:
- If `retryable: true`, the executor will retry up to `maxRetries`
- Otherwise, the node is marked `failed` and dependents may be blocked

### Watching Live Runs

```bash
omk runs --watch
omk cockpit --watch
```

The live display now includes heartbeat status for active long-running nodes.

---

## Architecture

### New Modules

```
src/util/timeout-config.ts       # Preset resolution from config + env
src/util/cron-engine.ts          # In-process cron scheduler
src/orchestration/node-monitor.ts # Heartbeat tracking & stall detection
src/commands/cron.ts             # omk cron CLI
```

### Modified Modules

```
src/contracts/orchestration.ts   # TimeoutPreset, CronJob, CronRun, NodeMonitor types
src/kimi/runner.ts               # Dynamic timeout resolution
src/orchestration/executor.ts    # Preset integration + heartbeat + monitor
src/orchestration/dag.ts         # timeoutPreset field on DagNode
src/commands/run.ts              # --timeout-preset CLI flag
src/commands/parallel.ts         # timeoutPreset threading
src/orchestration/orchestrate-prompt.ts  # timeoutPreset propagation
src/cli.ts                       # cron command registration
```

---

## Migration Notes

- **Backward compatible**: Existing DAGs without `timeoutPreset` continue to use the 120s default.
- **No breaking changes** to CLI or config formats.
- **Opt-in**: Cron and monitoring are only active when configured.

---

## Inspiration

This feature was inspired by [Hermes agent](https://github.com/Babelcloud/genshin) and [openclaw](https://github.com/openclaw/openclaw), which handle long-running task orchestration gracefully. OMK now bridges the gap between active coding sessions and passive background automation.
