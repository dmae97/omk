# Spec 110: Export omk runs as ATIF trajectories (Terminal-Bench 4.0 / Harbor)

Status: draft (spec only, no code). Follow-up: spec 111 = finish-confirm gate.

## Goal

The TB leaderboard rejects a submission unless "every rewarded trial has a Hub
`trajectory_path` (ATIF) ... agents that only upload custom logs fail here"
([SUBMIT.md](https://github.com/harbor-framework/terminal-bench/blob/main/leaderboard/SUBMIT.md)).
omk writes its own logs only. This spec adds an offline exporter that turns one omk
trial into one ATIF `Trajectory` JSON file, with no field loss.

Schema source (Apache-2.0), read at harbor commit `209a48a`:
[`src/harbor/models/trajectories/`](https://github.com/harbor-framework/harbor/tree/main/src/harbor/models/trajectories)
(`trajectory.py`, `step.py`, `tool_call.py`, `observation.py`, `observation_result.py`,
`metrics.py`, `final_metrics.py`, `agent.py`, `content.py`) and the validator
[`src/harbor/utils/trajectory_validator.py`](https://github.com/harbor-framework/harbor/blob/main/src/harbor/utils/trajectory_validator.py).
Target `schema_version: "ATIF-v1.8"` (the model default; accepted values `ATIF-v1.0`..`ATIF-v1.8`).

## Inputs (omk side)

1. **Event stream**: `omk --mode json` stdout, the `AgentEvent` union in
   `packages/agent/src/types.ts` (`message_end`, `turn_end`, `tool_execution_start`
   {toolCallId, toolName, args}, `tool_execution_end` {toolCallId, toolName, result, isError},
   `agent_end`). This is the only source of message text and tool arguments.
2. **Run log dir** (`OMK_RUN_LOG_DIR`, `packages/coding-agent/src/core/run-log.ts`,
   `appendRunLog`): `<name>.jsonl` lines, each with `t`, `elapsedFraction`, `pid`, `role`
   (`lead`|`worker`). Per the run-log PRIVACY RULE these carry hashes/numbers only.
   Main one: `llm-call` (`llm-call-run-log.ts`): `provider`, `model`, `systemHash`,
   `toolsHash`, `phase`, `phaseSource`, `requestedAtMs`, `responseId`, `input`, `output`,
   `cacheRead`, `cacheWrite`, `costTotal`, `costInUsdTicks`, `usageMissing`, `stopReason`,
   `durationMs`, `gapMs`. Others: `finish-check`, `deliverable-guard`, `skill-select`,
   `quota-no-retry`, edit-diagnostics (spec 107), etc.

## Field mapping

| omk source | ATIF field | Notes |
|---|---|---|
| fixed `"omk"`, package version | `Trajectory.agent.name`, `agent.version` | required |
| `llm-call.model` (lead) | `agent.model_name`, `Step.model_name` | |
| tool schemas (if in stream) | `agent.tool_definitions` | else omit (open Q3) |
| session id from stream / trial id | `Trajectory.session_id`, `trajectory_id` | |
| user prompt (`message_end`, role user) | `Step{source:"user", message}` | |
| system prompt | `Step{source:"system", message}` | omk logs only `systemHash`; see Q1 |
| assistant `message_end` | `Step{source:"agent", message, reasoning_content}` | thinking -> `reasoning_content` |
| reasoning level | `Step.reasoning_effort` | |
| toolCall block / `tool_execution_start` | `Step.tool_calls[] = ToolCall{tool_call_id, function_name, arguments}` | `arguments` must be an object |
| `tool_execution_end.result` | `Step.observation.results[] = ObservationResult{source_call_id, content}` | `source_call_id` must equal a `tool_call_id` in the same step (validator `validate_tool_call_references`) |
| `tool_execution_end.isError` | `ObservationResult.extra.omk.isError` | no ATIF slot |
| `llm-call.input/output/cacheRead/costTotal` | `Step.metrics{prompt_tokens, completion_tokens, cached_tokens, cost_usd}` | prompt_tokens semantics: Q4 |
| `llm-call.cacheWrite, responseId, stopReason, durationMs, gapMs, phase, phaseSource, systemHash, toolsHash, usageMissing, costInUsdTicks, provider, requestedAtMs, elapsedFraction, pid, role` | `Step.metrics.extra.omk.*` / `Step.extra.omk.*` | no ATIF slot |
| `llm-call.t` / message timestamp | `Step.timestamp` (ISO 8601) | |
| LLM calls per assistant step | `Step.llm_call_count` | never 0 on a step with `metrics` (v1.7 rule) |
| sum over steps | `Trajectory.final_metrics{total_prompt_tokens, total_completion_tokens, total_cached_tokens, total_cost_usd, total_steps}` | |
| other run-log files (`finish-check`, `deliverable-guard`, `skill-select`, `quota-no-retry`, spec 107 diagnostics, unknown names) | `Trajectory.extra.omk.runLog["<name>"]` = raw lines, verbatim | lossless catch-all |
| worker (`role: worker`) `llm-call` lines | `Trajectory.extra.omk.workerLlmCalls` (verbatim) | v1: no `subagent_trajectories`; see Q2 |
| exporter version, input file hashes | `Trajectory.extra.omk.export` | |

Rules: `Step.step_id` sequential from 1 (`validate_step_ids`). `model_name`,
`reasoning_effort`, `reasoning_content`, `tool_calls`, `metrics` only on `source:"agent"`
steps (`validate_agent_only_fields`). All omk-only data goes under an `omk` key inside the
nearest `extra` so nothing is dropped and nothing collides.

## Where it lives

`scripts/bench/atif-export.mjs` (next to `scripts/tb-mini-suite.mjs`), run as
`node scripts/bench/atif-export.mjs --events <events.jsonl> --run-log <dir> [--mask-env-names A,B] --out <trajectory.json>`.
Not imported by any package, not in any `dependencies`, not shipped in the npm tarball.
No new npm deps (Node built-ins only).

**Validator boundary (Tech Lead condition):** Harbor's validator is Python and runs only in
the bench environment, never in omk CI and never as an omk dependency. omk unit tests use
one fixed sample ATIF file, `scripts/bench/fixtures/atif/sample.trajectory.json`, that has
already passed the validator; it is checked in together with
`sample.validator.json` recording the harbor commit/version, `schema_version` and the
validation date.

## Redaction

- The exporter runs on the host (Q6 decision), so the host env alone does not know every
  agent-side secret. Before writing, scan every string value (object keys included, and the
  whole `extra.omk` tree, `extra.omk.eventLog` included) for: values of `TYPESAFE_API_KEY` and
  every other env var whose name matches `/KEY|TOKEN|SECRET|PASSWORD|AUTH|COOKIE/i`, plus every
  name listed in `--mask-env-names A,B` or `OMK_ATIF_MASK_ENV_NAMES="A,B"` (secret names from
  the agent environment; values are read from the exporter's environment); replace with
  `[REDACTED:<NAME>]`. Env values shorter than 8 characters are skipped (flags like `1`
  would shred unrelated text). Other env values are not masked.
- Secrets that exist only inside the container are out of scope for v1: bench runs pass keys
  from the host, so the host has the values. An env-file handoff is a follow-up only if a real
  case turns up.
- Pattern pass for common key shapes -> `[REDACTED:PATTERN]`: `sk-`, `xai-`,
  `ghp_`/`gho_`/`ghu_`/`ghs_`/`ghr_` and `github_pat_`, each followed by at least 16
  characters from `[A-Za-z0-9_-]` (so `sk-learn` is not masked); `Bearer <token>` at any
  length. The post-write rescan uses the same patterns. The 8-character minimum applies to
  env values only.
- Never copy `process.env` into output; never log redacted values.
- Masking is the only allowed lossy step in the export.
- The exporter fails (exit 2) and removes the output file, rather than leaving it, if a
  post-write rescan (same env values, names and patterns) still finds a hit.

## Success criteria

1. **Primary (Tech Lead done-criterion): lossless round-trip.** A test exports one committed
   secret-free sample omk trial (fixture events + run-log dir) to ATIF, validates it against the
   schema, then reverses it (`extra.omk` + ATIF fields -> omk records) and asserts deep
   equality with the input: every run-log line and every event field is recovered,
   0 fields lost. The no-slot fields listed above are checked by name.
2. In the bench environment only, Harbor's own validator (`trajectory_validator.py` /
   `Trajectory.model_validate`) accepts 100% of trajectories exported from the fixture set
   (>= 3 fixtures: plain, tool error, worker lines). In omk CI, the exporter's output for
   the sample input must structurally match the checked-in validated sample ATIF file.
3. Counts match the run log: matched + unmatched (`extra.omk.unmatchedLlmCalls`) ==
   total lead `llm-call` lines; total
   `tool_calls` == `tool_execution_start` events; observation results == `tool_execution_end`.
4. Zero secret leakage (separate masking test, not the round-trip fixture): with fake `TYPESAFE_API_KEY` and other fake env values injected
   into prompts, args and tool results, none appear in output bytes.

## Test plan

- `scripts/bench/atif-export.test.mjs` (node:test): mapping, step_id order,
  agent-only-field rule, round-trip deep-equality on the secret-free fixture, counts; a separate masking test with fake keys.
- Unit test compares export output against the checked-in validated sample (same keys,
  step order, counts; volatile fields like timestamps normalized). No Python in omk CI.
- Bench-env step (manual / bench scripts): run harbor validator on every export; refresh the
  sample + `sample.validator.json` when the pinned harbor version changes.
- No live model calls; fixtures only.

## Out of scope

No uploads to Harbor Hub, no leaderboard PR, no paid runs, no runtime change to omk
logging (if Q1 needs a new log field, that's a separate spec).

## Decisions (Tech Lead review, PR #231)

- **Q1 system prompt:** use the full system prompt text from the event stream as the first
  step (`source:"system"`); the masking pass applies. If absent, emit a hash placeholder step
  with the reason in `extra.omk`. The run log is unchanged.
- **Q2 workers:** out of scope for v1: no `subagent_trajectories`. Worker `llm-call` lines
  are kept verbatim in `extra.omk.workerLlmCalls`. A follow-up after spec 112 adds worker
  event lines and maps them to `subagent_trajectories` (unique `trajectory_id` +
  `ObservationResult.subagent_trajectory_ref`).
- **Q6 host:** the exporter runs on the host; agent-side secret names reach it through
  `--mask-env-names` / `OMK_ATIF_MASK_ENV_NAMES` (see Redaction).
- **Q4 tokens:** `prompt_tokens = input + cacheRead + cacheWrite`; `cached_tokens = cacheRead`.
- **Q5 join:** by `responseId` first, else by order. Unmatched `llm-call` lines go to
  `Trajectory.extra.omk.unmatchedLlmCalls`, never dropped.
- **Q3:** `--mode json` carries no tool schemas or system prompt, so `agent.tool_definitions`
  (optional in ATIF) is omitted and the Q1 hash placeholder is used unless an
  `omk_session_info` line (spec 112) is present.
  The first (seq 1) line maps to the system step and `agent.tool_definitions`.
  Follow-up (done): seq 2 and later lines are kept verbatim (masked) in
  `Trajectory.extra.omk.sessionInfoChanges[]` (eventLog `ref:"sessionInfoChange"`), and when a run
  has at least one such line every agent step gets `extra.omk.sessionInfo = {seq, systemHash,
  toolsHash}` of the line active when it ran. No extra `source:"system"` steps are inserted.
- **Q7:** non-blocking.

## Open questions

1. System prompt text: run log has only `systemHash` (by privacy rule) and json mode may not
   emit it. Emit a `source:"system"` step with a hash placeholder, or omit? Does judge need it?
2. Workers: are worker event streams captured per process? Embed as
   `subagent_trajectories` or separate files with `trajectory_path`?
3. Is the tool list available in the event stream for `agent.tool_definitions`?
4. ATIF `prompt_tokens` description vs omk `input` (excludes cache?) - confirm whether
   `prompt_tokens = input + cacheRead` is required.
5. Joining `llm-call` lines to assistant messages: by `responseId` when present, else order;
   what if counts differ (retries, aborted calls)?
6. How Harbor's installed-agent flow collects the trajectory file (path/naming convention)
   for a custom agent — not confirmed from source yet.
7. Image content parts (`ContentPart` with `ImageSource.path`) - does omk ever emit images in TB runs?
