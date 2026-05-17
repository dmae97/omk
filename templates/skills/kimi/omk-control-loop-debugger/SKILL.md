---
name: omk-control-loop-debugger
description: Diagnose agent, runtime, tool, hook, context, provider-routing, DAG, retry, fallback, and evidence-gate failures using an industrial automation feedback-control loop. Use when workflows oscillate, stall, lose context, misroute tools, or need setpoint/sensor/controller/actuator/disturbance/correction analysis.
---

## Control-loop Debugger

Use this to turn agent failures into a feedback-loop diagnosis instead of a vague postmortem.

## Model

- Setpoint: the user's requested target result and acceptance criteria.
- Sensor: observed evidence from tests, logs, traces, diffs, screenshots, or user feedback.
- Controller: router, scheduler, skill selection, policy, prompt, or state machine deciding the next action.
- Actuator: edit, tool call, Kimi run, worker lane, hook, MCP server, or external command.
- Disturbance: tool failure, context loss, stale state, version drift, quota, permissions, flaky tests, or hidden dependency.
- Correction: retry, fallback, narrowed scope, state cleanup, manual review, test addition, or hard block.

## Debug Process

1. Restate the setpoint in measurable terms.
2. List sensors and mark which are fresh, stale, missing, or contradictory.
3. Compare sensor evidence to the setpoint and name the control error.
4. Identify which controller decision created or failed to correct the error.
5. Check actuator authority, side effects, timeout, and rollback path.
6. Name disturbances separately from root cause.
7. Pick one correction and define evidence that proves the loop is stable.

## Failure Patterns

- Oscillation: repeated retries without new evidence.
- Saturation: context, token, time, quota, or worker capacity exhausted.
- Sensor drift: stale tests, old logs, cached docs, or wrong working directory.
- Bad actuator: command edits the wrong path, writes too broadly, or cannot affect the failure.
- Controller mismatch: wrong skill, worker, provider, workflow, or fallback route.

## Output

```txt
Setpoint:
Sensor evidence:
Control error:
Controller decision:
Actuator path:
Disturbance:
Correction:
Verification:
Residual risk:
```
