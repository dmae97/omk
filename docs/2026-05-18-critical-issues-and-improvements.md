# 2026-05-18 Critical Issues

## Scope

분석 범위는 현재 `open-multi-agent-kit` working tree 전체다. 병렬 subagent fan-out으로 architecture, source archaeology, security, infra/release, QA/test, docs 방향성을 분리 검토했고, 로컬에서 핵심 파일을 추가 확인했다.

주의:

- 이 문서는 최초 발견 사항과 이후 안정화 결과를 함께 기록한다.
- secret 값은 출력하지 않았다.
- “Critical/P0”는 public release 또는 기본 런타임 안전성 전에 반드시 해결해야 하는 항목이다.

## Stabilization status after 2026-05-18 fixes

Resolved/mitigated in source and covered by regression tests:

- MCP raw permission await bypass: fixed for tool/resource/prompt paths.
- Standard `tools/call`: now routes through governance redaction/audit before returning MCP-compatible content.
- MCP lifecycle: request timeout, notification shape, pending close rejection, stdio close handling, streamable HTTP session/header behavior.
- Fresh init: project-local scopes and `omk-core-verified` baseline; `--local-user` remains explicit high-trust mode.
- Kimi CLI / `.kimi`: DAG runner honors `KIMI_BIN`; `kimi-wire` is opt-in until isolated HOME/MCP/hook parity exists; project hook commands are absolute inside isolated HOME.
- Runtime MCP merge: project `.kimi/.omk` relative direct args and simple inline shell paths are normalized against project root.
- Secret handling: shell/evidence/quality/state/attempt/event/checkpoint persistence paths redact secret-looking strings; runtime secret scan covers selected `.omk/.kimi` trust-boundary files.
- Checkpoint restore: dirty worktree requires explicit force and protected patch paths are rejected.

Still operationally relevant:

- Existing ignored/generated `.omk/*` and `.kimi/*` artifacts can be stale relative to fixed source templates and should be checked against current scoped runtime policy before demos/releases.
- `mcp_scope = all`, `skills_scope = all`, and `hooks_scope = all` are trusted local-user modes, not fresh-project defaults.
- Current generated root roles include `security`; docs/prompts should list it consistently while still treating role availability as harness-scoped.
- `team`/worktree mode remains experimental until merge handoff and verification reconstruction are consistently evidenced.

## Executive summary

This section is historical as of the 2026-05-18 stabilization pass. The original review found three release-blocking risk classes; current source/runtime docs now mark the first two as resolved or scoped, and the remaining items are tracked as follow-up hardening rather than active default-runtime blockers.

1. **Historical: MCP trust boundary bypass.** `McpHost` raw tool/resource/prompt paths previously missed `await` on async permission checks; current source marks this fixed with regression coverage.
2. **Historical: default runtime surface drift.** Earlier generated files described or enabled broad/full MCP behavior. Current `.omk/runtime-preset.json` is `omk-core-verified`, `.omk/config.toml` uses project scope for MCP/skills/hooks, and current project `.omk/mcp.json` / `.kimi/mcp.json` do not list secret-backed project MCP servers.
3. **Partially mitigated: side-effect, evidence, and restore hardening.** Current source records AbortSignal propagation, redaction, runtime secret scan, and checkpoint dirty-worktree/protected-path guards; related P1/P2 follow-ups remain historical backlog items unless revalidated against current files.

## P0 / Critical

### P0-1. MCP host raw operations bypass permission policy

**Status:** Resolved in source; regression coverage: `test/mcp-host-permissions.test.mjs`.

**Severity:** Critical  
**Area:** MCP authorization / tool trust boundary

**Evidence**

- `src/mcp/host.ts:370-400` — `McpHost.callTool`
- `src/mcp/host.ts:509-536` — `McpHost.readResource`
- `src/mcp/host.ts:559-586` — `McpHost.getPrompt`
- `src/mcp/host.ts:591-602` — `checkPermission` is async

**Problem**

`checkPermission` returns `Promise<boolean>`, but raw callers use it as `if (!this.checkPermission(...))`. A Promise is truthy, so denial is never triggered on those raw paths. `governedCallTool` correctly uses `await`, but `callTool`, `readResource`, and `getPrompt` do not.

**Impact**

- denyServers / allowServers policy can be bypassed.
- A connected MCP server can expose tools/resources/prompts even when host policy should block them.
- Any higher-level code path using raw `callTool` instead of governed call inherits the bypass.

**Exploit scenario**

A project or user config denies a remote MCP server, but a code path calls `host.callTool(name, args, serverHint)` directly. The Promise-based permission check passes by truthiness, and the remote MCP executes.

**Fix**

- Add `await` in `callTool`, `readResource`, `getPrompt`.
- Prefer routing all operations through governed variants or split raw APIs as internal-only.
- Add tests for denied server/tool/resource/prompt access.

**Acceptance tests**

- Denied server cannot execute `callTool`.
- Denied server cannot `readResource`.
- Denied server cannot `getPrompt`.
- Tests must fail on the current implementation and pass after adding `await`.

---

### P0-2. Secret-backed/full MCP runtime is active in project config and conflicts with safe baseline

**Status:** Resolved for current source and current checked generated/runtime docs; still audit local ignored runtime artifacts before release/demo.

**Severity:** Critical  
**Area:** MCP startup / secret boundary / runtime default

**Evidence**

Historical evidence from the original review:

- `.omk/config.toml` previously used `mcp_scope = "all"`, `skills_scope = "all"`, and `hooks_scope = "all"`.
- `.omk/runtime-preset.json` / `.omk/runtime-presets.json` previously pointed at `omk-parallel-orchestrator`.
- Project MCP files previously included or exposed broader/secret-backed surfaces.

Current 2026-05-19 check:

- `.omk/config.toml` uses `mcp_scope = "project"`, `skills_scope = "project"`, and `hooks_scope = "project"`.
- `.omk/runtime-preset.json` uses `id = "omk-core-verified"`.
- Current project `.omk/mcp.json` and `.kimi/mcp.json` list no project secret-backed MCP server entries; `omk-core-verified` keeps `omk-project` as the baseline project-local MCP hint.

**Problem**

The original repository state did not match the conservative `omk-core-verified` baseline described by AGENTS/docs. Current checked files now align on project-scoped MCP/skills/hooks and avoid claiming that broad MCP is fully enabled by default.

**Impact**

- Local, CI, Kimi, Codex, and OMK runtime surfaces can diverge.
- Unpinned or compromised MCP packages can receive loaded credentials at startup.
- Debugging and release evidence becomes non-reproducible because the active MCP set depends on user-local files and network-installed packages.

**Exploit scenario**

A malicious or compromised `npx` MCP package starts through a project-level MCP wrapper that sources user secret env files, then exfiltrates the environment during MCP startup.

**Fix**

- Make `omk-core-verified` the default public preset, or explicitly document `omk-parallel-orchestrator` as high-trust opt-in.
- Keep fresh project MCP minimal: `omk-project` and possibly readonly filesystem only.
- Move secret-backed MCP to user scope or explicit `--local-user` / `--with-mcp` setup.
- Pin MCP package versions and prefer lockfile-backed installation.

**Acceptance tests**

- Fresh init does not create secret-backed remote MCP entries in project config.
- Runtime preset default matches docs/templates.
- `omk doctor` reports config drift between `.omk/mcp.json` and `.kimi/mcp.json` without leaking env values.

---

### P0-3. MCP client and stdio transport can hang indefinitely

**Status:** Resolved/mitigated in source; regression coverage: `test/mcp-client-lifecycle.test.mjs`, `test/mcp-streamable-http.test.mjs`, `test/mcp-host-permissions.test.mjs`.

**Severity:** Critical  
**Area:** MCP lifecycle / reliability

**Evidence**

- `src/mcp/client.ts:176-188` — `sendRequest` has no timeout
- `src/mcp/transports/stdio.ts:64-100` — `connect` resolves after spawn/stdin/stdout setup, not after protocol readiness
- `src/mcp/transports/stdio.ts:111-130` — malformed stdout is ignored
- `startupTimeoutMs` exists on `McpServerConfig` but is not enforced by `McpClientSession.sendRequest`.

**Problem**

If an MCP server starts but never responds, prints malformed stdout, or dies after a pending request is created, the request can hang. Startup timeout is represented in config but not consistently wired into request lifecycle.

**Impact**

- `omk mcp doctor/test`, host startup, and runtime MCP calls can stall.
- A single bad MCP server can block orchestration.
- CI and local test flakiness increase, especially around slow `npx` startup.

**Fix**

- Enforce startup timeout around `connect + initialize`.
- Add per-request timeout in `sendRequest`.
- Reject all pending requests on child close, not only on transport error.
- Before initialization, treat non-JSON stdout as a startup failure with a sanitized diagnostic.

**Acceptance tests**

- Server that never responds fails within configured timeout.
- Server that prints invalid stdout before initialize fails with clear diagnostic.
- Server close rejects pending requests.

---

### P0-4. Executor timeout/abort does not cancel underlying runner side effects

**Status:** Resolved for current TaskRunner/Kimi/provider/shell paths via `AbortSignal` propagation; keep extending this contract for new runners.

**Severity:** Critical  
**Area:** DAG executor / side-effect containment

**Evidence**

- `src/orchestration/executor.ts:359-385` — `nodeRunner.run(node, env)` is raced against timeout/abort promises.
- `src/contracts/orchestration.ts` `TaskRunner` does not accept `AbortSignal`.

**Problem**

The executor marks a node failed when timeout/abort wins the race, but the underlying runner keeps running because it receives no cancellation signal. That runner can still mutate files, write logs, update worktrees, or produce output after the scheduler has already moved on.

**Impact**

- Timed-out/aborted nodes can cause late writes after failure.
- Evidence and state can lie about what actually changed.
- Parallel runs may merge or verify while a “failed” task is still mutating state.

**Fix**

- Extend `TaskRunner.run(node, env, signal)` or add cancellation hooks.
- Wire signal to Kimi child process, provider runner, shell runner, and worktree cleanup.
- Kill or quarantine timed-out worktrees before dependents proceed.

**Acceptance tests**

- A timed-out runner attempting a delayed file write cannot mutate the main workspace after timeout.
- Abort cancels child process and no late state updates occur.
- State records timeout reason and cleanup result.

---

### P0-5. Evidence and quality logs can persist secret text

**Status:** Mitigated across shell/evidence/quality/state/attempt/event/checkpoint paths; runtime scan added for selected `.omk/.kimi` trust-boundary files.

**Severity:** Critical  
**Area:** secret redaction / evidence storage

**Evidence**

- `src/orchestration/evidence-gate.ts:504-515` stores `stdoutTail`, `stderrTail`, `evidenceText`, `message`.
- `src/orchestration/state-persister.ts:8-27` redacts by secret-like object keys, not arbitrary secret-looking substrings.
- `src/util/shell.ts:75-79`, `src/util/shell.ts:141-149` can write raw output to log files.
- `src/mcp/quality-gate.ts:281-293` stores quality gate logs.

**Problem**

Secret redaction is key-based in state persister and not applied uniformly to command output. If a malicious or accidental command prints environment values, evidence and log artifacts can persist them.

**Impact**

- `.omk/runs/**/state.json`, decision traces, quality logs, and shell logs may retain sensitive output.
- Secret-scan may pass because `.omk/` is ignored or outside the tracked scan target.

**Fix**

- Use the centralized `src/mcp/secret-scanner.ts` redactor for all diagnostic text before persistence.
- Redact stdout/stderr tails before storing evidence.
- Add runtime scan mode covering selected `.omk`/`.kimi` trust-boundary files and logs.

**Acceptance tests**

- A command-pass gate that prints a fake token stores only redacted text.
- Quality gate logs redact known token patterns.
- Runtime secret scan reports file path and finding type without printing the secret.

## P1 / High

### P1-1. Dynamic fallback nodes are not resume-stable

**Evidence:** `src/orchestration/executor.ts:487-503`, `src/orchestration/executor.ts:523-582`

Fallback nodes are pushed into `dag.nodes` at runtime. On resume, the original DAG may not contain those dynamically-added nodes or rewritten dependencies, so fallback progress can be lost or replayed incorrectly.

**Fix:** persist dynamic DAG mutations or reconstruct them from saved state during resume. Add a resume regression for `fallbackRole`.

---

### P1-2. Streamable HTTP transport performs duplicate initialize and does not propagate headers to SSE

**Evidence:** `src/mcp/transports/streamable-http.ts:24-55`, `src/mcp/client.ts`

The transport sends `initialize` during `connect`, then `McpClientSession.initialize()` sends another initialize. `EventSource` is also created without custom auth headers.

**Fix:** make transport connect transport-only and let `McpClientSession.initialize()` own the MCP handshake. Use a streaming implementation that supports auth headers or fail actionably.

---

### P1-3. PR review workflow runs PR code with write-token permissions

**Evidence:** `.github/workflows/omk-review.yml:13-15`, `.github/workflows/omk-review.yml:38-61`

The same job checks out PR code, builds/runs it, and has `pull-requests: write` to post comments.

**Fix:** split read-only analysis from minimal-permission comment posting.

---

### P1-4. Secret scan excludes ignored runtime trust-boundary files

**Evidence:** `.gitignore` excludes `.omk/` and `.kimi/`; `scripts/secret-scan.mjs` scans tracked + untracked non-ignored files.

Runtime trust files such as `.omk/mcp.json`, `.omk/kimi.config.toml`, `.omk/hooks/**`, `.kimi/hooks/**`, `.kimi/mcp.json` can contain secret-loading commands or logs while `npm run secret:scan` still passes.

**Fix:** add `secret:scan:runtime` with curated runtime paths and redacted output.

---

### P1-5. `runShell` inherits full environment and global `OMK_SUDO=1` can escalate package-manager commands

**Evidence:** `src/util/shell.ts:45`, `src/util/shell.ts:64-67`

Package scripts and quality gates can inherit cloud/provider tokens. If `OMK_SUDO=1` is set globally, allowlisted package-manager/docker operations can run under sudo unexpectedly.

**Fix:** minimal env by default for untrusted scripts; explicit env passthrough; remove global sudo switch or make it per-call and never default for package managers/docker.

---

### P1-6. Hook drift: `.kimi` guard is weaker than `.omk` guard

Infra review found `.omk/hooks/pre-shell-guard.sh` and `.kimi/hooks/pre-shell-guard.sh` checksums differ. Depending on runtime surface, the same shell command can be blocked in one context and allowed in another.

**Fix:** treat `.omk/hooks` as canonical generated source and add drift tests comparing guard behavior on fixture commands.

---

### P1-7. Checkpoint restore can mutate a dirty worktree without a safety gate

**Evidence:** `src/util/checkpoint.ts:122-178`

Restore applies `git apply` or `patch` without clean worktree check or pre-restore backup.

**Fix:** refuse restore unless worktree is clean or explicit `--force` is provided; create pre-restore checkpoint automatically; print affected files before applying.

---

### P1-8. Release tag is not checked against package version

**Evidence:** `.github/workflows/release.yml:3-6`, publish job

The release workflow triggers on `v*`, but publish does not assert `github.ref_name === v${package.json.version}`.

**Fix:** add a pre-publish exact-match step comparing tag name to `package.json.version`.

---

### P1-9. Tarball audit validates local checkout for some checks instead of extracted tarball

**Evidence:** `scripts/package-audit.mjs:635-669`, `scripts/package-audit.mjs:378`, `scripts/package-audit.mjs:450-471`

`--tarball` mode sets file sizes/unpacked size to `0` and some checks read local files instead of extracted tarball contents.

**Fix:** extract tarball to a temp directory and run all validations against extracted files.

---

### P1-10. CI diagnostics print environment/home metadata

**Evidence:** `.github/workflows/ci.yml:26-33`

CI prints env keys/values matching `omk|kimi|node|home` and lists `$HOME`.

**Fix:** print only allowlisted key names and versions. Avoid env values and home directory listings.

## P2 / Medium

### P2-1. `protect-secrets` hook scans only `tool_input.content`

Replacement-style edit tools can carry new text in fields like `new_string`, `replacement`, `old_str/new_str`, bypassing content-only scanning.

**Fix:** recursively scan every string field in tool input and add post-edit diff scan.

### P2-2. Worker count / “all agents” semantics are inconsistent

**Evidence:** `.omk/agents/root.yaml`, `src/commands/run.ts:187-193`, `src/commands/parallel.ts:366-372`, `.omk/config.toml`

The root exposes 16 aliases / 14 role files, but run/parallel hard-cap parsed worker count at `6` and project config sets `runtime.max_workers = 4`.

**Fix:** document “all roles available” separately from “all roles concurrently running.” Add an explicit `--all-roles` planning mode if needed, but keep execution concurrency resource-bounded.

### P2-3. CLI command contract still has many direct `process.exit` calls

Search found direct `process.exit` calls in multiple command modules including `run.ts`, `parallel.ts`, `chat.ts`, `doctor.ts`, `spec.ts`, `plan.ts`, `menu.ts`, `project-index.ts`, `research.ts`, `snip.ts`, `google.ts`, `screenshot.ts`.

**Fix:** move automation-critical commands to typed results and let `src/cli/main.ts` handle process exit code.

### P2-4. Dist freshness policy differs between local and CI

`scripts/run-tests.mjs` enforces dist freshness locally unless `OMK_SKIP_DIST_FRESHNESS=1`, while CI/smoke paths often bypass after build steps.

**Fix:** make build freshness an explicit manifest/hash gate in both local and CI.

### P2-5. Test coverage has blind spots

No direct tests for `McpHost` permission bypass were found. Critical files such as `src/mcp/host.ts`, `src/mcp/client.ts`, MCP transports, and checkpoint restore need focused regression tests.

**Priority tests**

1. MCP host permission denial
2. MCP request timeout/child close
3. executor late side-effect cancellation
4. fallback resume stability
5. redacted evidence output
6. checkpoint dirty-worktree refusal
7. `run-tests --summary-json` path containment
8. JSON-RPC notifications omit `id`

## Critical init artifact status

No critical init artifacts were missing when this file was updated.

- ✅ `AGENTS.md`
- ✅ `.kimi/AGENTS.md`
- ✅ `.omk/config.toml`
- ✅ `.omk/agents/root.yaml`
- ✅ `.kimi/mcp.json`
- ✅ `.omk/hooks/pre-shell-guard.sh`
- ✅ `.omk/hooks/protect-secrets.sh`
- ✅ `.omk/memory/graph-state.json`

## Recommended fix order

Historical fix order from the 2026-05-18 review; items 1, 2, 3, 4, 7, 8, and 9 are now marked resolved/mitigated above where current files differ. Revalidate remaining backlog items before treating them as active defects.

1. Fix MCP host permission bypass and add regression tests. — resolved.
2. Enforce MCP startup/request timeout and reject pending requests on close. — resolved/mitigated.
3. Reset/clarify default runtime preset and MCP scope. — resolved in current docs/runtime files.
4. Add evidence/log redaction using the central secret scanner. — mitigated.
5. Split PR review workflow permissions. — historical backlog; revalidate.
6. Add release tag/package version gate. — historical backlog; revalidate.
7. Harden executor cancellation and fallback resume. — cancellation mitigated; fallback resume remains historical backlog unless revalidated.
8. Add runtime secret scan for `.omk`/`.kimi` trust files. — resolved with `secret:scan:runtime`.
9. Harden checkpoint restore. — resolved/mitigated.
10. Convert tarball audit to extracted-tarball validation. — historical backlog; revalidate.

## Verification snapshot for this review

Commands run locally by the lead agent:

- `git status --short`
- `omx doctor --team`
- `omx list --json`
- `omx hud --json`
- targeted `ctx_tree`, `ctx_read`, `ctx_search`
- `.omk` / `.kimi` hook checksum diff
- `npm run -s yaml:check` — passed
- `npm run -s lint` — passed
- `npm run -s secret:scan` — passed
- `npm run -s check` — passed

Additional subagent-reported checks:

- `npm run -s yaml:check` — passed
- `npm run -s lint` — passed
- `npm run -s check` — passed
- `npm run -s secret:scan` — passed
- targeted tests passed for `run-tests-harness`, `mcp-command`, `provider-routing`, `chat-startup`, `rust-safety-harness`, `orchestration` matches, `init-mcp-secrets`, `cli-timeout-preset`, and `goal`

Not complete:

- Full test suite pass was not proven in this lead run.
- Release check/native build/package audit/smoke pack were not run by the lead agent.
