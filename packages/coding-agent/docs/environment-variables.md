# Environment Variables

OMK uses environment variables in three ways:

- Variables such as `OMK_OFFLINE` configure the OMK process.
- OMK sets `OMK_CODING_AGENT` so child processes can detect that they run inside OMK.
- Commands run by the LLM-callable bash tool receive `PI_*` variables describing the current session.

Provider API-key variables are documented separately in [Providers](providers.md). `XAI_API_KEY` is an xAI Platform API-billing credential; it is not the OAuth credential created by `/login` and cannot populate weekly SuperGrok usage/reset.

## Process Marker

The CLI and RPC entry points set `OMK_CODING_AGENT=true`. Child processes inherit it and can use it to detect that they run inside OMK. It is not session-specific and is not set automatically when OMK is embedded through the SDK.

## Bash Tool Session Environment

Commands run by the bash tool receive the current session state (the `PI_*` names are kept for upstream Pi compatibility):

| Variable | Description |
| --- | --- |
| `PI_SESSION_ID` | Current session ID |
| `PI_SESSION_FILE` | Absolute path to the current session JSONL file; unset for ephemeral sessions |
| `PI_PROVIDER` | Currently selected model provider |
| `PI_MODEL` | Currently selected model ID |
| `PI_REASONING_LEVEL` | Current effective reasoning level: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`, or `ultra` |

The values are resolved when each command starts. Switching models or changing the reasoning level therefore affects the next bash command without restarting OMK. `PI_PROVIDER` and `PI_MODEL` identify the selected OMK model, not a different upstream model that a router may choose internally.

Inherited parent-process values for these variables are always stripped first, so a nested OMK session never exposes stale parent-session metadata.

When asked which model or provider is running, inspect these variables instead of inferring the answer from the system prompt:

```bash
printf '%s/%s\n' "$PI_PROVIDER" "$PI_MODEL"
printf 'reasoning=%s session=%s\n' "$PI_REASONING_LEVEL" "$PI_SESSION_ID"
```

The session file can be inspected directly when the session is persistent:

```bash
if [ -n "$PI_SESSION_FILE" ]; then
  tail -n 1 "$PI_SESSION_FILE"
fi
```

These variables are injected into the LLM-callable bash tool. They are not injected into user-entered `!` or `!!` commands.

### Custom Bash Tools

Bash tools created with `createBashTool()` expose the session environment by default. Injection happens before `spawnHook`, so a hook receives the variables in `ctx.env`:

```typescript
const bashTool = createBashTool(cwd, {
  spawnHook: (ctx) => ({
    ...ctx,
    env: { ...ctx.env, CI: "1" },
  }),
});
```

Disable session metadata independently of the spawn hook:

```typescript
const bashTool = createBashTool(cwd, {
  exposeSessionEnvironment: false,
  spawnHook: (ctx) => ctx,
});
```

When disabled, OMK removes inherited values for these variables so nested OMK processes do not expose stale parent-session metadata.

## OMK Process Configuration

These variables are read by OMK itself. The default-on built-in harness flags below are enabled when unset. Any of `0`, `false`, `off`, `disable`, or `disabled` disables the corresponding built-in; matching is case-insensitive and ignores surrounding whitespace. `--no-extensions` does not disable these first-party built-ins.

| Variable | Description |
| --- | --- |
| `OMK_CODING_AGENT_DIR` | Override the config directory; default is `~/.omk/agent` |
| `OMK_CODING_AGENT_SESSION_DIR` | Override session storage; overridden by `--session-dir` |
| `OMK_PACKAGE_DIR` | Override the package directory, useful for Nix/Guix store paths |
| `OMK_PROJECT_CONTEXT_BOOTSTRAP` | Default on for a bare `omk` launch in an otherwise empty Git repository root: create the standard project context documents without overwriting files. `0`, `false`, or `off` disables the bootstrap. Commands with arguments and non-empty or non-Git directories never auto-bootstrap; `omk init --project` covers explicit setup |
| `OMK_OFFLINE` | Disable startup network operations, including update checks and install/update telemetry |
| `OMK_SKIP_VERSION_CHECK` | Disable the latest-version request |
| `OMK_TRUST_PROJECT` | Project trust gate for a cloned project's code ([Project trust](packages.md#project-trust)). `1` trusts the project OMK started in, only for non-interactive runs (`-p`, `--mode json`, `--mode rpc`, workers, CI, `omk install`/`update`/`list`/`config`, `omk package doctor`), and prints one stderr line naming it. It is read once at startup and removed from OMK's environment, so the `bash` tool and other child processes do not inherit it. Interactive `omk` ignores `1` and asks. `0` keeps project code off in every mode, over a stored answer, and is inherited. Any other value is ignored |
| `OMK_TRUST_PROJECT_MCP` | `1` trusts a project's `.omk/mcp.json` servers without asking; separate from `OMK_TRUST_PROJECT`. See [MCP](mcp.md) |
| `OMK_TELEMETRY` | Override install/update telemetry and provider attribution headers: `1`/`true`/`yes` or `0`/`false`/`no` |
| `OMK_SHARE_VIEWER_URL` | Override the base URL used by `/share` |
| `OMK_HARDWARE_CURSOR` | Set to `1` to show the hardware cursor; see [Terminal setup](terminal-setup.md) |
| `OMK_SCROLLBACK_SCREENS` | Transcript history screens rendered above the live tail on session load/rebuild. `0` renders only the live tail. Blank or non-finite values use default 50; negatives clamp to zero and fractions are floored. A finite `terminal.scrollbackSeedScreens` setting takes precedence. Skipped prefix children still undergo identity checks; the complete exit log is rendered separately |
| `OMK_CONTEXT_GOVERNOR` | Context Budget V2 process override: `1` forces it on and `0` forces it off; otherwise the global `contextBudget.enabled` setting applies |
| `OMK_CONTEXT_GOVERNOR_CACHE` | Set to `memory` to keep representations, negative results, and plans in session memory instead of persisting representations per workspace |
| `OMK_CONTEXT_GOVERNOR_CACHE_DIR` | Relocate the Context Budget V2 representation snapshot from `.omk/cache/context-budget-v2`; plans remain session-memory-only |
| `OMK_VERIFIED_BASH` | Default-on verified bash adapter for AgentSession/CLI bash. Set to `0` to opt out and use the legacy unverified path (see [SDK — Evidence and Verification](sdk.md#evidence-and-verification)) |
| `OMK_EXEC_TRUNCATE_MIDDLE` | Default on; set `0`/`false`/`off` to opt out and keep only the end (read per bash call). When agent `bash` tool output passes 2000 lines or 50KB, it shows the start and the end with one `[... omitted N lines (...) ...]` marker line in the middle instead of only the end. The start keeps half of the budget (whole lines), and the marker counts inside the 50KB / 2000-line budget. The full-output temp file, `details.truncation.truncated` and the tool description are unchanged; with it on, `details.truncation` also carries `strategy: "head-tail"`, `headLines`, `headBytes`, `omittedLines` and `omittedBytes`. User `!` commands and RPC bash are not affected. Subagent workers inherit it (spec 113) |
| `OMK_EDIT_DIAGNOSTICS` | Default on (read per call). After built-in `edit`/`write` on a file with a checker, new diagnostics are appended to the tool result. `shadow` runs the checker but writes results only to the run log; `0`/`false`/`off` opts out. Skipped when remote `operations` are passed. Per-check timeout via `OMK_EDIT_DIAGNOSTICS_TIMEOUT_MS` |
| `OMK_JSON_SESSION_INFO` | Default on. In `--mode json`, adds `omk_session_info` lines (system prompt + tool definitions). Set `0`/`false`/`off` to opt out and get the old stream |
| `OMK_GOAL_AUTONOMY` | Default on (spec 119). `/goal` autonomy: hard, recorded stops for budget, deadline, unknown side-effect outcome and scope change, capped at 8 rounds; an RPC steer pauses the goal. Set `0`/`false`/`off` to opt out |
| `OMK_SKILL_ADMISSION` | Default on (spec 106 A1). A session admits at most 10 unique skill bodies (explicit, steer/follow-up, `SKILL.md` reads via `read`, worker hand-off); further bodies are refused with a notice. Set `0`/`false`/`off` to opt out |
| `OMK_SKILL_AUTO_LOAD` | Default on (spec 117; needs `OMK_SKILL_ADMISSION`, also default on). Strong-only skill auto-load: matching skill bodies arrive in a `prompt-skills` message (12k-token budget). Subagent workers always get `0`. Set `0`/`false`/`off` to opt out |
| `OMK_EVIDENCE_LIFECYCLE` | Default `delete` (specs 106/118): conditional delete-after-use. Only goal-recall files this session wrote under `<cwd>/.omk/goals/recall` (real directories, not symlinks) are deleted, and only after a verified passing recheck with no hold or reader lease; terminal failure diagnostics are kept. Unset, `1` or `delete` select it; `observe` records counts only and deletes nothing; any other value is `observe`. Set `0`/`false`/`off` to opt out |
| `OMK_LANE_READY_QUEUE` | Default on (spec 106 DG2): subagent lanes start from a ready frontier as soon as their dependencies settle instead of waiting for a batch barrier. `0`/`false`/`off` opts out |
| `OMK_LANE_FAILURE_SCOPE` | Default on (spec 106 C1): a failed non-writing, parallelizable subagent lane blocks only lanes that depend on it; writer failures still block globally. `0`/`false`/`off` opts out |
| `OMK_RTK_OUTPUT` | Default on: successful, bounded `vitest --run` / `tsc --noEmit` bash output (≥1KB) is condensed through a local `rtk pipe` subprocess (`OMK_RTK_PATH` or `rtk` on `PATH`, no credentials, telemetry off); if `rtk` is missing or fails the raw output is kept and `details.outputFilter.status` is `fallback`. `0`/`false`/`off` opts out |
| `OMK_RESPONSE_REASONING_CAP` | Default on (spec 033): caps reasoning per response (`OMK_RESPONSE_REASONING_CAP_TOKENS`, default 20000; wall cap `OMK_RESPONSE_WALL_CAP_SEC`) and retries a cut response once. `0`/`false`/`off` opts out |
| `OMK_BASH_SANDBOX` | AgentSession built-in local bash mode. Unset or unknown values select `enforce`: macOS `sandbox-exec` or Linux `bwrap`, workspace/temp writes only, network disabled, and fail closed without a usable backend. Explicit `audit` selects the unwrapped ledger-only path; `0`/`off` disables the preflight. Use `off` only when a verified outer whole-process sandbox owns isolation; it does not isolate OMK by itself |
| `LIVE_E2E` | Test-only: keep provider credentials so live-API e2e suites run on purpose (default scrubbed for hermetic tests) |
| `OMK_IDENTICAL_LOOP` | Default-on consecutive-loop guard. Warns from the third identical `tool+args` call and blocks the sixth. Set a disabling value to opt out |
| `OMK_TOOL_PAIR_REPAIR` | Default-on outbound-context repair. Removes unmatched tool-use and tool-result blocks before provider requests without rewriting the transcript. Set a disabling value to opt out |
| `OMK_PROMPT_PRESET` | Default-on model-specific guidance for supported Claude/Anthropic, Kimi, GLM/ZAI, and Grok/xAI models. Set a disabling value to opt out |
| `OMK_DEEPSEEK_HARNESS` | Default-on `deepseek_harness` engine for native DeepSeek and recognized DeepSeek model IDs on gateways. Adds scoped execution guidance and pressure-triggered outbound tool-result pruning, without changing history, credentials, or transport. Set a disabling value to opt out; independent from `OMK_PROMPT_PRESET`. See [DeepSeek harness](deepseek-harness.md) |
| `OMK_CLAUDE_CONTEXT_FILES` | Claude models omit all discovered context documents by default to prevent unrelated context from causing provider false positives. Set to `1`, `true`, `on`, or `yes` to restore them |
| `OMK_GOAL_CONTROLLER` | Default-on working-directory `/goal` command and automatic continuation. Goals created by `/goal` use an eight-round cap. Set a disabling value to opt out |
| `OMK_FINISH_CHECK` | Finish discipline. By default, headless runs (`-p`, no UI) get scope, early-save, edge-case and environment rules in the system prompt, plus one automatic verification turn after a run that changed the workspace. `1`/`always` also enables it in interactive sessions; a disabling value turns it off |
| `OMK_TIME_BUDGET_SEC` | Wall-clock seconds the caller allows for the run, for example a benchmark task timeout. When set, the finish discipline tells the run to save outputs at 75% of the budget and skips the verification turn past 90% |
| `OMK_FINISH_CHECK_EXTRA_TURN` | Experimental, default off. With `1`/`on`, a verification turn whose numeric checklist item misses its limit or has no measurement gets one more turn to fix or measure it (before 85% of `OMK_TIME_BUDGET_SEC`, with a stop reminder at 90%). Unset or any other value: the run ends after the verification turn. With `OMK_RUN_LOG_DIR` set, each extra-turn decision (used, why, budget fraction) is appended to `finish-check.jsonl` there |
| `OMK_FINISH_CHECK_REVERIFY` | Experimental, default off. With `1`/`on`, a headless run with a time budget that first finishes before 30% of it gets one more turn after the verification turn: a fresh-context check of the deliverables on new inputs, with `write`/`edit` blocked, at most 10 tool calls and 15% of the budget. Its failures get a fix turn only when `OMK_FINISH_CHECK_EXTRA_TURN` is also on (that turn is the extra turn); otherwise the result is only recorded. Never passed to subagent workers. With `OMK_RUN_LOG_DIR` set, the trigger decision (or why it did not run) and the verdict, changed paths, tool calls, budget fractions and fix turn are appended to `finish-check.jsonl` there |
| `OMK_ADAPTIVE_EFFORT` | Default on; `0`/`false`/`off` opts out. Reasoning effort follows the work phase: plan, debug (the same command failing again within 5 tool calls) and verify calls keep the configured effort; explore, edit, build and run calls send `high`, or the configured effort if it is lower, or the next level the model supports below `high`. Effort is never raised above the configured level. The phase comes from the last tool calls (bash commands are classified by rule); the group changes after 2 calls in a row, at most 4 times per session. Before tracking another ID would exceed 8,192 distinct IDs or 1,048,576 UTF-16 code units of IDs, the wrapper stops adapting and passes its input reasoning effort unchanged to the next wrapper for the rest of its lifetime; other caps and model constraints still apply. It emits one `OMK_ADAPTIVE_EFFORT_HISTORY_LIMIT` warning; restarting OMK creates a new wrapper. This can increase reasoning effort or cost. With run logging on, `adaptive-effort.jsonl` records a `history_limit` event without IDs. Only the effort changes: model, system prompt and tools stay the same. Calls without tools (summaries, compaction) are untouched, and subagent workers always get `0`. With `OMK_RUN_LOG_DIR` set, `llm-call.jsonl` lines carry `phase`, `phaseSource` (`todo`/`tool`), `effortGroup` (`low`/`high`), `effortSwitch` (`{from, to, n}` on the switching call, else `null`) and `lowerClamped` (nothing lower than the configured effort can be sent). |
| `OMK_DELIVERABLE_GUARD` | Experimental, default off. With `1`/`true`/`on`/`enable`/`enabled`, headless runs keep the last valid copy of each output file the task prompt names (outside the workspace, deleted at shutdown), steer once at 40% of `OMK_TIME_BUDGET_SEC` when one does not exist yet, and put the copy back when the file is missing or fails a quick check (size limit from the prompt, `cc`/`python3`/`bash -n`/JSON syntax) at 90%, when the run settles (before the verification turn) and on SIGTERM. A valid file is never replaced. `always` also enables it in interactive sessions. Subagent workers always get it off. With `OMK_RUN_LOG_DIR` set, it appends its steers, restore-point verdicts, restores and settle summaries to `deliverable-guard.jsonl` there |
| `OMK_TODO_VERIFY` | Experimental, default off. With `1`/`true`/`on`/`enable`/`enabled` (read once at startup), `update_todo` items also take optional `kind` (`plan`/`explore`/`edit`/`debug`/`verify`; anything else is recorded as unknown), `difficulty` (`low`/`medium`/`high`) and `check` (`{type: "file", path, minBytes?, contains?}` or `{type: "command", command, expect?}`), and the tool result adds a `checks:` count line. When the finish check runs, done items with a `file` check are checked on the host (exists, size, text in the first 1 MiB, 200 ms in total) and done items with a `command` check get a `TODO n:` line the model runs and reports; the host never runs the command. Failed done items join the `OMK_FINISH_CHECK_EXTRA_TURN` extra turn (still one per task) and are only recorded without it. Up to 8 checked items per list. Off, the tool schema, its result and every finish-check message are unchanged. Subagent workers always get it off. With `OMK_RUN_LOG_DIR` set, appends `todo-snapshot` (per `update_todo`) and `todo-verify` (per check turn) lines with counts, kinds and hashed ids only to `todo-verify.jsonl` there |
| `OMK_FINISH_CHECK_SNAPSHOT_DIR` | For benchmark harnesses. Right before the verification turn, the finish check writes `pre-check-<n>.request` in this directory and waits for the harness to create `pre-check-<n>.done` (for example after snapshotting the container). The outcome is written to `pre-check-<n>.result`. The wait does not count against `OMK_TIME_BUDGET_SEC`. Unset means no handshake |
| `OMK_FINISH_CHECK_SNAPSHOT_TIMEOUT_SEC` | Maximum seconds to wait for `pre-check-<n>.done` before continuing without a snapshot. Default 120 |
| `OMK_FINISH_CHECK_WORKERS` | Finish-check mode for subagent worker processes. Workers run headless, so by default they get `OMK_FINISH_CHECK=0` and only the lead runs the verification turn. Set a value such as `1` to pass it to workers. `OMK_TIME_BUDGET_SEC` and the snapshot settings are never passed to workers |
| `OMK_WORKER_EXTENSIONS` | Which user extensions subagent workers load. Workers start with `--no-extensions` by default; skills, the command-safety gate and the todo checklist are unaffected, and the extension that registered the worker's model provider (including one that only overrides a built-in provider's `baseUrl`/`headers`) is loaded automatically. `all` keeps today's discovery in workers. A comma-separated list (for example `my-mcp-adapter,memory`) loads those extensions, matched against the extensions this session actually loaded: by absolute path, or by name (package name for `npm:`/`git:` packages, otherwise the file name without extension, or the directory name for `index.ts`). A name that matches two extensions loads neither; use the absolute path. Package sources (`npm:…`, `git:…`, `https://…`) are never passed to workers. Problems are printed once to stderr as `omk subagent: OMK_WORKER_EXTENSIONS: …`, and an extension with a `before_provider_request` handler that stays out of workers is named once on the first spawn. Passed through to workers unchanged, so nested workers follow the same rule |
| `OMK_RUN_LOG_DIR` | For benchmark harnesses. When set, runtime features append JSON-lines diagnostics to `<dir>/<feature>.jsonl` (for example `finish-check.jsonl`, `reasoning-cap.jsonl` from `OMK_RESPONSE_REASONING_CAP`, or `llm-call.jsonl` with one line per provider request: `provider`, `model`, `effort` (the reasoning level after the model contract, adaptive effort and the reasoning cap), `effortSent` (its provider wire value, e.g. grok-4.7 `max` → `xhigh`), `messageCount`, `systemHash` and `toolsHash` (sha256 of the system prompt and tool list), `phase` and `phaseSource` (`null` when `OMK_ADAPTIVE_EFFORT` is opted out), `requestedAtMs`, `responseId`, `input`, `output`, `cacheRead`, `cacheWrite`, `costTotal` (OMK's estimate, including xAI reasoning tokens), `costInUsdTicks` (always `null`), `usageMissing`, `stopReason`, `durationMs` and `gapMs` (since the previous call ended); with `OMK_ADAPTIVE_EFFORT` on (default) also `effortGroup`, `effortSwitch` and `lowerClamped`; token and cost fields are `null`, never 0, when no usage arrived). Each line has `t` (epoch ms), `elapsedFraction` of `OMK_TIME_BUDGET_SEC` (or `null`), `pid` and `role` (`lead`, or `worker` in subagent workers). Lines hold hashes, paths and numbers only, never prompt text, file contents or env values. Unset means nothing is written |
| `OMK_COMPLETION_SOUND` | Interactive-TTY terminal notification override: `0` disables it and `1` enables it. Sounds never run in RPC, JSON, print mode, or CI |
| `OMK_YOLO`, `OMK_COMMAND_SAFETY`, `OMK_DISABLE_COMMAND_SAFETY` | Disable the command-safety gate entirely (YOLO mode). `OMK_YOLO` and `OMK_DISABLE_COMMAND_SAFETY` accept `1`, `true`, `yes`, or `on`; `OMK_COMMAND_SAFETY` accepts `0`, `false`, `off`, `disable`, or `disabled`. Every verdict, including block-tier and privilege commands, is skipped in interactive and headless runs. Use only when a verified outer sandbox owns the boundary |
| `OMK_COMMAND_SAFETY_ASSUME_YES` | `1` or `true` auto-accepts non-privilege confirm-tier commands in interactive **and headless** runs. Privilege confirmation and block-tier commands remain denied. Use only under a trusted outer sandbox when headless auto-accept is intended |
| `OMK_SKILL_SEARCH` | Experimental, default off. With `1`/`true`/`on`/`enable`/`enabled` and more than 24 model-invocable skills plus the `read` tool, the system prompt replaces the skill list with one fixed line, adds a fixed `skill_search` tool, and sends skill candidates as hidden messages at task start. The BM25 index is built on first use and cached in `cache/skill-index-v1.json` under the agent directory. With `OMK_RUN_LOG_DIR` set, appends hash-only records to `skill-select.jsonl`. See [skills](skills.md#skill-search-omk_skill_search) |
| `OMK_SKILL_SELECT` | Experimental, default unset (off). `bm25` or `metacon` turns on skill search like `OMK_SKILL_SEARCH` and picks the ranker: BM25, or BM25 top 64 narrowed by local capability-coverage planning with BM25 fill. Wins over `OMK_SKILL_SEARCH`. Any other value, including `wpl`, is off with one warning. Subagent workers inherit it. See [skills](skills.md#ranking-mode-omk_skill_select) |
| `OMK_SKILL_SEARCH_SUGGEST` | `0` turns off the automatic skill candidates of `OMK_SKILL_SEARCH` while keeping the `skill_search` tool. Subagent workers always get `0` |
| `OMK_GROK_HARNESS` | Default-on native `xai` provider dispatch to the `grok-harness` loadout. `0`, `false`, `off`, or `no` disables it |
| `OMK_DEVIN_HARNESS` | Default-on `devin` provider dispatch to the `devin-harness` loadout. `0`, `false`, `off`, or `no` disables it; independent from `OMK_GROK_HARNESS` |
| `OMK_DOMAIN_ROUTING` | Default on: general prompt-based domain routing picks a tool loadout profile from the first prompt; `0`/`false`/`off` opts out. Native xAI and Devin harness dispatch do not require it |
| `VISUAL`, `EDITOR` | External editor fallback when `externalEditor` is unset |
| `HTTP_PROXY`, `HTTPS_PROXY` | Proxy outbound HTTP requests |
| `OMK_RESOURCE_GOVERNOR` | Resource-governor mode: `off`, `observe` (default), `adaptive`, or `strict`. Feeds `/resource [probe\|policy]` and `omk doctor resources [--json]`; see the resource governor section in [Settings](settings.md) |
| `OMK_TOOL_SCHEDULER` | Tool scheduler override: `dag-v2` or the `waves-v1` rollback path; see also the `agent.toolScheduler` setting |
| `OMK_PREFIX_BOUNDARY` | Spec 102, default on: keeps the system-prompt cache boundary when an extension changes only the dynamic tail after it (the prefix must match byte-for-byte). `0`/`false`/`off` opts out to the spec 052 rule. |
| `OMK_GOAL_OUTPUT_RECALL` | Spec 098, default on (`0`/`false`/`off` opts out). Saves the full output of a failing goal acceptance check to `<cwd>/.omk/goals/recall/` (dir 0700, files 0600, a `*` `.gitignore`; first 1 MiB + last 3 MiB past 4 MiB; newest 3 per goal, 20 per dir). The follow-up points the model at it so it reads ranges with `read` instead of re-running the check. **Security:** since 1.5.5 no redaction runs on bash/log output, so these files can contain secrets the check printed, verbatim. Off is the current follow-up, byte-for-byte. |
| `OMK_TURN_METRICS`, `OMK_TURN_METRICS_DIR` | Turn metrics are written under `.omk/metrics/` as sessions run; set `OMK_TURN_METRICS=0` to disable or `OMK_TURN_METRICS_DIR` to relocate. Aggregate with `omk stats`; see [Metrics](metrics.md) |

Provider credentials such as `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, and cloud-provider configuration are listed in [Providers](providers.md).
