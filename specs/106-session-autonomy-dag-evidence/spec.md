# Spec 106 — session skill admission, goal autonomy, lane failure isolation, evidence lifecycle

Status: draft (spec; C1 implemented on `feat/lane-failure-isolation`)
Base: `origin/main` @ `f1920f4dad` (after #205/#206, merged in). Verified: `git diff 741ac1c473 f1920f4dad` touches none of the files cited below (only `.omk/extensions/atelier/test/cost-history.test.ts` (#206) and LICENSE/README/TRADEMARKS/`readmeasset/adaptorch/*` (#205)), so every `file:line` ref is re-anchored to `f1920f4dad` unchanged. Launcher refs are main, not the C1 branch. Refs under `packages/coding-agent/src/core/` unless noted.
Source: 인호's v1.5.5 improvement doc (A–D). Freeze 10/23 12:00 KST ⇒ every behavior change default-off.

## 0. Doc claims re-checked against current main

All six SHA-256 values in doc §A.4 match main (files unchanged since 741ac1c4).

| Claim | Verdict | Evidence |
|---|---|---|
| active-name union has no cap (9+1+1 ⇒ 11) | correct | `active-skill-state.ts:25-27` (`new Set` union) |
| `defaultActiveSkills` ≤ 64 names | correct | `settings-manager.ts:13` |
| selector limit 3 | correct | `skill-selector.ts:14` `MAX_SELECTED_SKILLS = 3` |
| per-prompt candidates 3 | correct (comment says "at most 5") | `skill-search.ts:43-44` |
| `skill_search` default 5 / max 8 | correct | `skill-search-mode.ts:17-18` |
| explicit skills enter via bang/`/skill:` in `_prompt` | correct | `agent-session.ts:2476-2491`, `_expandSkillCommand` `:2693`, steer/followUp `:2737`, `:2760` |
| goal default 8 rounds | correct | `extensions/builtin/goal-controller.ts:138` |
| launcher blocks the whole next batch on any non-completed outcome | correct | `subagent-lane-launcher.ts:113` |
| per-batch `Promise.all` barrier | correct | `subagent-lane-launcher.ts:160` |
| recall 4 MiB, 1 MiB head, 3/goal, 20/dir, mtime pruning, `nextAttempt` from surviving names | correct | `goal-output-recall.ts:30-34,88,106,118` |
| `closeTempFile()` flushes, does not delete | correct | `tools/output-accumulator.ts:123` |
| spill removes dir only on write failure | correct | `tools/artifact-spill.ts:29` |
| **New finding (doc silent):** every builtin loadout is `write-scoped` with `edit/write/bash` | — | `loadouts.ts:218-300`; so C1 isolation does not fire for builtin loadouts (decision D-Q1, §6) |
| "lane A must not block D" is a bug | **framing**: it is a deliberate conservative policy with tests; treat as policy change | `test/subagent-lane-launcher.test.ts` |

**The cap of 10 is a product contract chosen by 인호, not an evidence-backed optimum.** No external study supports 10; we do not claim quality gains from it.

## 1. Order (Tech Lead, 2026-10-22 KST)

| # | Item | Flag (default off; off ⇒ byte-identical behavior) | Owner boundary | Required IDs |
|---|---|---|---|---|
| C1 | DAG settled-failure scope, batches kept | `OMK_LANE_FAILURE_SCOPE` | `subagent-lane-launcher.ts` + `subagent-lane-failure-scope.ts` | DG1 (doc counterexample pinned), DG3, DG4; 0 writer-conflict and 0 unsettled-permit regressions |
| A1 | session skill admission, cap 10 | `OMK_SKILL_ADMISSION` | `AgentSession` single admission fn; paths: defaults, explicit, read, steer/followUp | SK1, SK2, SK5 required |
| D1 | evidence lifecycle observe-only | `OMK_EVIDENCE_LIFECYCLE=observe` | recall / spill / bash producers | 0 deletes; EV11 recall path-reuse fix before any delete |
| B | goal autonomy | `OMK_GOAL_AUTONOMY` | `goal-controller*.ts` | **post-freeze**, no YOLO default; AU1–AU4 |
| later | ready frontier (DG2), auto-load + worker (SK3/4/6/7), consumer-ACK deletion | `OMK_LANE_READY_QUEUE` etc. | — | separate specs/PRs |

## 2. C1 — lane failure scope (implemented)

- Rule (flag on; Tech Lead 2026-10-22): a settled `failed` lane is *non-writing* only if its declared `scheduler.writeSet` is empty AND its grant has no write-capable tool (`edit`, `write`, `bash`) AND it is `parallelizable`; a missing/unknown `writeSet` ⇒ writer. A non-writing failure blocks only its transitive dependents via `laneGrants[].dependsOn` (already includes receipt-consumer edges). Any other non-completed status (unsettled, cancelled, permit-rejected, admission-deferred, skipped-abort) or a failed writer ⇒ legacy global block. **Note:** every builtin loadout grants `edit/write/bash` (`loadouts.ts:218-300`), so real behavior barely changes today; the rule is the contract future read-only loadouts will use.
- `LaunchSubagentLanesResult.allLanesCompleted: boolean` — true only if every lane completed; **DG1 asserts it is false** (no false completion). Additive field; flag-off outcomes unchanged.
- **C1 cannot be measured on real runs until a read-only loadout/grant exists**: every builtin loadout grants `edit/write/bash`, so with the flag on, builtin-loadout failures still take the legacy global block. This is the deliberate safe trade-off (a failed writer may leave partial workspace changes; no edge ≠ independent).
- Batches and `Promise.all` barrier unchanged when `OMK_LANE_READY_QUEUE` is off (DG2, below).
- Tests `test/subagent-lane-failure-scope.test.ts`: flag-off legacy, DG1 (doc counterexample: A→B, C→D, only A fails ⇒ B blocked, C and D complete, overall NOT complete), DG1 transitive, DG3 join, DG4 writer, empty writeSet + `bash` lane fails ⇒ next batch blocked, unsettled keeps global block + permit, all-complete. Failing-first verified (DG1×2 fail without launcher change).
- Bars: 8/8 new (adds: empty writeSet + `bash` lane fails ⇒ next batch blocked) + 48/48 existing lane tests (0 writer-conflict / unsettled-permit regressions); flag-off outcomes identical on the legacy fixture.

## 2a. DG2 — ready frontier (implemented, default off)

- Flag `OMK_LANE_READY_QUEUE=1` (name from §1); off ⇒ the batch loop runs unchanged (flag-off start order + result pinned by inline snapshot).
- On: `subagent-lane-ready-frontier.ts` starts a lane, in plan source order, as soon as every effective dependency (`laneGrants[].dependsOn`) settled `completed`, at most `effectiveLaneWidth` in flight. Preserved: (a) a lane waits while any earlier-ordered lane it conflicts with is unsettled — conflict = read/write path intersection (`laneGrantsConflict`, the planner's own rule) or either lane not `parallelizable`, so writer serialization and conflict order equal the batches; (b) any retained `unsettled` lane blocks new starts and keeps its permit; (c) heavy permits unchanged (`runLane`); (d) C1 failure scope decides blocks from the outcomes of lanes that ran (frontier-made `blocked-dependency` outcomes do not escalate a C1-isolated block). Failure scope off ⇒ any non-completed outcome stops all new starts (slightly stricter than the batch loop, which let same-batch siblings start).
- Tests `test/subagent-lane-ready-frontier.test.ts` (manual deferreds, no wall clock): DG2 counterexample flag off (B waits for C) and on (B starts while C runs), width cap, DG4 write-conflict serialization in plan order, DG1 with both flags, frontier-on/scope-off global block, DG3 join, unsettled reservation, flag-off snapshot.
- DG5/DG6 with frontier on: timed-out child kept `unsettled` keeps its permit and child accounting and stops new starts; a rejected settlement never releases the permit; results arriving after abort are `cancelled` (dependents `skipped-abort`); an unsettled lane's late settlement rewrites no outcome and starts no lane.
- Frontier-only on (C1 off) stops ALL new starts after any failure — stricter than the old batch loop, which still started same-batch siblings.
- A/B: fix C1 (`OMK_LANE_FAILURE_SCOPE=1`) on in both arms and compare frontier on vs off, so scheduling is not confounded with the stop policy.
- Covariate: `<OMK_RUN_LOG_DIR>/subagent-lane-frontier.jsonl` records per launch `notStartedDueToFailure` (count), `lanes`, `failureScope`, `frontier` — counts only, no lane ids or text; unsettled-reservation blocks are not counted. Written whenever the frontier or C1 is on, so both A/B arms (C1 on, frontier on/off) log it; batch arm counts lanes C1 kept from starting; both flags off ⇒ no file.
- `notStartedDueToFailure` = in both arms, the number of lanes not started because of a failure; lanes held only by unsettled or abort are not counted.
- Flag-off snapshot test verified against main `1c9dce39cb`'s launcher (temp worktree, test file only).
- Not yet: real-run measurement.

## 3. A1 — skill admission

- `SkillAdmissionLedger` (pure, owned by `AgentSession`) persisted as a **new versioned session entry type** `skill_admission` (Tech Lead 2026-10-22), each record `{ schemaVersion: 1, policyRevision, skillId, digest (sha256 of body), source, status: "reserved"|"admitted"|"released" }` plus `origin` and `requestId`; session-level `cap: 10`, optional `legacyOverCap: true`:
- `reserve(skillId, digest)` is synchronous (single JS turn ⇒ atomic): counts `reserved + admitted`; same `(skillId, source, digest)` ⇒ no new slot; new digest ⇒ new slot. Returns `{ok:false, reason:"cap"}` at 10.
- `commit(requestId)` when the provider request is built; `release(requestId)` only when failure before send is certain.
- Restored from session entries after resume and compaction (and model switch); **never reset to 0 by any path** — pinned by SK1/SK2/SK5 tests. Missing ledger + history of >10 bodies ⇒ `legacyOverCap`, new admissions refused.
- Cap-refused skill: body not injected, a counts-only trace line; required skill refused ⇒ explicit notice (never silent drop).
- Settings: `defaultActiveSkills` stays ≤64 as *preferences*; admission picks ≤10.
- Flag off ⇒ byte-identical provider requests to main.

Tests (`test/suite/` because it is session code): SK1 6+3+5 ⇒ 10 admitted + reasons; **SK2** 9 admitted, two concurrent new reads ⇒ exactly 1 ok; SK3 cross-path; SK4 dedupe/alias/new digest; **SK5** resume + compaction + model switch keep count; SK7 legacy; flag-off byte equality.
PREREG bars: SK1–SK7 deterministic pass 100%; flag-off request bytes identical. **Invariant check** (not a reliability claim): 200 seeded randomized reserve/commit/release interleavings must show 0 cap violations; 0/200 only bounds the per-interleaving violation rate at ≈1.5% (95% upper, rule of three), so it is a regression guard, not evidence of correctness.

**A1 status: partially satisfied: <=10 on explicit/steer/followUp/read/worker hand-off paths; bash bypass not gated. Open gaps: bash bypass (e.g. `cat SKILL.md`) not gated; worker-local SKILL.md reads not in parent ledger; SK6 covers only the slot count, the request-budget check stays a default-on condition. No default-on until gaps closed.** Gating details: every path goes through `admitSkillBody`; a refused SKILL.md `read` is replaced by `[skill admission] "<id>" was not loaded: session skill cap 10 reached.`; flag-on workers get `--no-skills` plus only admitted `--skill` paths; slot identity is the SKILL.md body without frontmatter on every path (records carry `digestMode: "body"`; a record without it is a #209 wrapped-block record and still restores). policyRevision is not bumped: #209 digest records may be counted once more (over-count, safe).

A1 notes: reserve+commit are synchronous at expansion, so a failed request still counts (over-count, safe direction); two-step commit is a follow-up. SK3/SK6 gating landed in the follow-up PR; no default-on until the open gaps above are closed.

## 4. D1 — evidence lifecycle, observe-only

- `OMK_EVIDENCE_LIFECYCLE=observe`: register managed artifacts (recall, read spill, tool-bash log, executor `fullOutputPath`) with `{artifactId, producer, bytes, holds[]}`; emit counts/bytes/hold reasons only (0 raw bytes in trace). **No deletes**, existing pruners untouched.
- Prerequisite fix recorded for PR 6: `nextAttempt()` reuses paths after deletion (`goal-output-recall.ts:118`) ⇒ needs monotonic id before any deletion ships.
- **EV11 (flag `observe` only):** recall files are `acceptance-<id>-<round>-<rev>-<attempt>-<8 hex nonce>.log`, so a path whose files were all removed (today possible via the per-dir cap or clear/replace) is never reused; cap/clear patterns accept both forms. Flag off keeps the attempt-only names byte-identical. A durable monotonic counter is still owed before D2 deletion ships (the nonce is collision-avoidance, not ordering).
- Observed metrics (counts only): artifacts registered, bytes, hold reasons, and **share of artifacts whose hold reason is `unknown`** (no producer/consumer mapping) — the gap D2 deletion must close first.
- Bar: 0 deletes; trace has 0 raw bytes; EV10 (verified-run GC/evidence/publish) unchanged.

**D1 implemented (observe-only) on `feat/evidence-lifecycle-observe`.** `core/evidence-lifecycle.ts` keeps an in-memory registry per session (bounded at 4096 per session; overflow counted) with `{artifactId (monotonic ev-<n>), producer, pathSha256, ownerSha256?, bytes, contentSha256?, requiredConsumers?, consumed[], verified?, retryHold, recoveryHold, holds[], status}`. Producers wired: goal recall (`goal-output-recall.ts` → `goal-output-recall-evidence.ts`), read/bash spill (`artifact-spill.ts`), tool-bash log (`OutputAccumulator.closeTempFile`), executor `fullOutputPath` (`bash-executor.ts`). Only recall has a consumer mapping (`repair-turn`, `acceptance-recheck`; hold `goal-active` until a passing re-run); every other producer is `holds:["unknown"]`, so `unknownHoldShare` is exactly the D2 mapping gap. `wouldDelete` = present artifacts with no hold; `deletes` is the constant 0. Existing pruners (recall `keepNewest`/`enforceCaps`, `deleteGoalRecallFiles`, executor discard) run unchanged; a removal they make is recorded as `removed-by-existing-policy`. Report sink: `goal_verification.evidenceLifecycle` (flag on only). No path text, no output text in any record (test-pinned). Not observed: verified-run evidence/receipts (EV10 untouched), interactive/RPC consumers of spill/bash logs (all `unknown`), EV4–EV9/EV12–EV13 (deletion-time, D2).
- D1 report also carries `unknownHoldShareByProducer` (`recall`, `spill` = read+bash spill, `bash` = tool-bash log, `executor` = executor `fullOutputPath`; each `{present, unknown, share}`) and `blockedExhausted`: recall files of a goal blocked with rounds exhausted are classified and counted separately; their holds are **not** released (no state change).
- Session sink (flag `observe` only): one `type:"custom"`, `customType:"evidence_lifecycle"` entry `{schemaVersion: 1, report}` per settled prompt (written at `agent_settled`, never at dispose), so goal-less sessions are sampled; a custom entry is never in model context; digests/counts only. The `goal_verification.evidenceLifecycle` sink stays. Flag off ⇒ no entry. Entries are cumulative snapshots (`aggregation:"cumulative"`, 0-based monotonic `settleIndex` per session); analyse the last entry per session.
- Registry is scoped by session: `Map<sessionId, registry>` (cap 4096 per session). Every `AgentSession` entry that can start work runs inside `withEvidenceSession(sessionId)`: `prompt()`, `executeBash()`, and the two agent-loop starts outside `prompt()` (`sendCustomMessage({triggerTurn})` and the deferred-turn drain), all via one `_evRun` = `_shutdown.run` in scope. The AsyncLocalStorage is constructed lazily, only when the flag is `observe` (flag off: never constructed or entered, test-pinned), so the read/bash tools, the executor and goal recall attribute artifacts to the owning session. A producer with no session context records under the explicit `unattributed` bucket, which is never merged into a session's counts; each report carries `unattributed` (that bucket's registered count). The `evidence_lifecycle` entry and `goal_verification.evidenceLifecycle` contain only their session's artifacts. Session dispose drops that session's key (records only; files untouched). Pruner removals are noted on whichever session owns the file.
- `unattributed` is a **data-quality metric**: each report carries `unattributed` and `processRegistered` (all buckets in the process), so `unattributed / processRegistered` is computable per entry. Before D2 criteria are set, Bench Analyst checks that ratio and analyses processes with `unattributed > 0` separately (their per-session counts may be missing artifacts).
- Observe changes recall file names (EV11 nonce); a durable monotonic counter is a D2 precondition.

## 5. B — goal autonomy (post-freeze)

- Flag `OMK_GOAL_AUTONOMY=1`, default off. Reuses `/goal` continuation + acceptance; no YOLO, `command-safety-gate` unchanged.
- Intent wiring: goal created only for explicit execution requests (existing `/goal` path, plus an opt-in intent classifier behind the same flag); scope = approved acceptance contract revision + command set.
- Hard stops: round cap (existing `maxRounds`, default 8, not raisable by the model), budget, user steer/cancel, **outcome-unknown side effect ⇒ stop, never blind retry (AU4)**, contract/target change ⇒ re-approval (AU3).
- **Primary metric: false-completion rate** (reported complete, fails independent grading; both denominators). Secondary only: duplicate-confirmation count. A drop in confirmations with any rise in false completion = fail.
- PREREG bar — **non-inferiority**, fixed before measuring:
  - H0: FC(autonomy) − FC(baseline) ≥ δ. Margin **δ = +5pp false-completion (placeholder — pending 인호 decision)**.
  - Unit: task, paired (same task, model, provider, effort, tools, budget in both arms); repeats are not independent tasks.
  - CI: paired proportion difference, Tango score interval (Newcombe paired hybrid score as cross-check), one-sided 95%. Pass iff upper bound < δ.
  - Task count rationale: n ≈ (z₀.₉₅ + z₀.₈)² · p_disc / δ² with assumed discordance p_disc ≈ 0.10 ⇒ (1.645+0.842)²·0.10/0.05² ≈ 250 paired tasks; a pilot re-estimates p_disc, then n is frozen before the main run.
  - Paid-run **$ cap: pending 인호 decision**; no paid run before it is posted.
  - AU1–AU4 deterministic 100%.

## 6. Default-on promotion (each needs its own separate PREREG; nothing here promotes)

| Item | §12.1 metrics required | Notes |
|---|---|---|
| C1 | DAG: unrelated-branch blocks, resource conflicts, stale-result rejections, unsettled reservations remaining; 검증 완료율; 거짓 완료 | needs a read-only loadout/grant first (else unmeasurable, §2) |
| A1 | 스킬: unique admissions, real body tokens, cap/budget refusals, resume match rate; 검증 완료당 비용; 거짓 완료 | cap 10 is a contract, so promotion judges no-regression, not gains |
| D1 | EVIDENCE: created/retained bytes, hold reasons, unknown-hold share, unexpected absence; 전체 자원 (disk) | observe-only; deletion (D2) is a separate spec |

Promotion requires 0 cap violations, 0 permission widening and 0 required-evidence loss, plus the separate PREREG's bar.

## 7. Decisions (recorded; were open questions Q1–Q3)
- **D-Q1** (Tech Lead, 2026-10-22 KST): a lane is non-writing only if declared `scheduler.writeSet` is empty AND its grant has no `edit`/`write`/`bash`; unknown/missing `writeSet` ⇒ writer. Builtin loadouts all have these tools ⇒ C1 does not fire for them until a read-only grant exists. Pinned by the empty-writeSet + `bash` test.
- **D-Q2**: A1 ledger = versioned `type:"custom"`, `customType:"skill_admission"` session entries (not a new `SessionEntry` union member); restored on resume; never reset by compaction or model switch. Unknown `schemaVersion`/`policyRevision` => fail closed (refuse all new admissions, never restart from 0).
- **D-Q3**: `allLanesCompleted` is a field on `LaunchSubagentLanesResult`; DG1 asserts overall incomplete.
- #205/#206 merged; both branches merged `origin/main` @ `f1920f4dad` (merge commits, no rebase).

## Appendix — source doc §10 and §11.1, verbatim (fixed before measuring)

### 10. 작은 변경 단위와 완료 기준

| 변경 단위 | 범위 | 완료 기준 |
| --- | --- | --- |
| PR 1 | 스킬 manifest·10개 cap·공식 로딩 경로 통합 | 실제 session request에서 cap이 유지되고 resume·병렬 read·명시 호출을 통과 |
| PR 2 | 자동 선택·자동 본문 로드·worker 전달 | 별도 스킬 지시 없이 관련 본문을 제공, 무관한 질의 0개 허용, 전체 요청 예산 충족 |
| PR 3 | 기존 goal의 승인 범위 내 자동 진행 | 여러 repair round를 중간 확인 없이 진행, 사용자 steer·cancel·budget 경계 유지 |
| PR 4 | lane effective dependency와 실패 격리·frontier | A→B/C→D 반례 해결, writer 충돌·unsettled permit 회귀 없음 |
| PR 5 | 임시 artifact 등록과 terminal 작업 정리 | 완료/보존 상태가 정확하고 기존 receipt·publish·resume 회귀 없음 |
| PR 6 | DAG consumer ACK 기반 진행 중 정리 | fan-out·retry·재계획·crash·삭제 실패에서도 조기 삭제 없음 |

PR 1–2와 PR 4의 소스 조사·세부 설계는 독립적으로 진행할 수 있다. PR 6은 artifact 수명주기와 effective dependency가 확정된 뒤 연결한다. 기능별 한도·owner·projection을 먼저 정하고 테스트를 약화하여 맞추지 않는다.

PR 4는 위험을 더 줄이려면 먼저 배치를 유지한 채 실패 범위를 분리하고, 다음 변경에서 자원 제약이 보존된 ready frontier를 적용할 수 있다. 임시로 실패 차단을 없애는 한 줄 수정으로 병렬화를 열지 않는다.

### 11. 인수 테스트

아래는 **앞으로 구현해야 할 회귀·통합 검증**이다. 현재 probe 통과와 혼동하지 않는다.

#### 11.1 필수 시나리오

| ID | 시나리오 | 기대 결과 |
| --- | --- | --- |
| SK1 | defaults 6 + explicit 3 + auto 5 | 본문 admission은 최대 10, 제외 사유 기록 |
| SK2 | 9개 상태에서 서로 다른 신규 스킬 2개 동시 요청 | 신규 1개만 성공, 예약 포함 cap 유지 |
| SK3 | `/skill:`·read·SDK·steer·followUp 경로 교차 | 공통 cap과 provenance 적용 |
| SK4 | alias·동일 본문 재조회·같은 이름 다른 출처·버전 변경 | 올바른 중복 제거, 출처·버전 혼동 없음 |
| SK5 | resume·compaction·provider 전환 | 누적 admission 유지, 슬롯 초기화 없음 |
| SK6 | 큰 스킬 2개 또는 worker 다수 | 최종 요청 예산과 전체 작업 예산 유지 |
| SK7 | manifest 없는 과거 세션 또는 기존 본문 사용량 10개 초과 | 확인 가능한 이력만 재구성, 0으로 초기화 금지, 초과 세션 신규 admission 차단 |
| AU1 | 승인된 수정→검사 실패→수정→pass | 단계마다 재확인 없이 실제 완료까지 진행 |
| AU2 | 중간 사용자 steer·cancel·권한 철회 | 이후 dispatch·late result 수용 차단 |
| AU3 | 명령·검사 계약·대상 범위 변경 | 이전 승인 부당 재사용 금지 |
| AU4 | round·deadline·비용 한도, outcome unknown | 정확한 중단 사유, blind side-effect retry 없음 |
| DG1 | A→B, C→D에서 A만 정착 실패 | B 차단, C와 D 진행, 전체 목표는 미완료 |
| DG2 | A 완료·C 대기, B와 C의 자원 범위 분리 | 빈 슬롯이 있으면 B 시작 |
| DG3 | 두 부모를 가진 join | 모든 필수 선행 조건 충족 전에는 미시작 |
| DG4 | writer 충돌·read/write 충돌·receipt 의존성 | eager 전환 후에도 기존 직렬화 제약 유지 |
| DG5 | timeout 후 child가 살아 있음 또는 settlement reject | permit·child accounting 유지, 신규 효과 보수적 중단 |
| DG6 | 이전 attempt/generation 결과 도착 | 현재 출력·검증·consumer ACK에 반영하지 않음 |
| EV1 | EVIDENCE를 B·C가 소비하며 B만 완료 | 원문 보존 |
| EV2 | read·부분 읽기·검색·실패 진단 열람만 수행 | 읽기 횟수만으로 삭제하지 않음 |
| EV3 | producer 완료 후 verification/retry/recovery hold 존재 | 원문 보존 |
| EV4 | 삭제 후보 결정과 신규 소비자 등록 경합 | revision/CAS로 하나의 일관된 결과 |
| EV5 | 삭제 의도 기록 후 crash, unlink 후 결과 기록 전 crash | idempotent 재개, 파일 존재와 상태 일치 |
| EV6 | OS 잠금·권한 오류·I/O 오류·metadata 기록 실패 | `deleted` 오표시 없음, bounded retry와 보류 이유 |
| EV7 | symlink·경로 교체·다른 세션 파일·최종 산출물 | 등록·권한·보존 경계 밖 삭제 없음 |
| EV8 | 모든 자료가 필수 hold인데 저장 한도 초과 | 필수 evidence 삭제 대신 capture/작업 admission 제한 |
| EV9 | 삭제된 원문을 재조회·resume에서 요구 | 명시적인 부재 사유 또는 새 attempt, 가짜 복구 없음 |
| EV10 | 기존 verified-run GC·evidence·publish·recovery | 기존 계약이 요구하는 자료 유지 |
| EV11 | 같은 goal·round·revision의 recall 전부 정리 후 재실행 | 새 원문은 새 경로, 과거 출력 링크가 새 결과를 가리키지 않음 |
| EV12 | native read·tool bash·interactive/RPC 출력 생성 후 소비 완료 | 각 producer의 실제 반환 경로를 등록·정리하며, 노출하지 않는 출력의 기존 cleanup 유지 |
| EV13 | count cap·goal clear/replace·세션 삭제가 활성 reader와 경합 | 공통 owner의 lease·명시적 삭제 정책을 우회하지 않음 |
