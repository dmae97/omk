# OMK Verified Run: 미구현 항목 상세 구현 설계

- 작성 기준일: 2026-09-13, Asia/Seoul
- 기준 소스: HEAD `5b767f25c7`. U1(bounded eager frontier)은 `decee7f157`로 커밋됐고, 이후 커밋은 verified-run 모듈을 바꾸지 않았다.
- 문서 성격: **구현 설계서**. 아래의 새 타입·필드·이벤트·명령·모듈은 별도 표시가 없어도 제안이며, 현재 OMK에 존재하는 API로 해석하지 않는다.
- 선행 자료: 추적하지 않는 내부 작업 문서의 검증 실행 설계와 하네스 비교 결과. 이 문서는 그중 아직 닫히지 않은 항목만 다루며, 그 문서들에 링크하지 않는다.
- 검증 범위: 이 문서는 코드를 바꾸지 않았다. 각 절의 "현재 소스 근거"는 이번에 직접 읽은 파일·기호이며, "제안"은 그 근거에 결합하는 변경이다. 수식은 §14의 방법으로 컴파일 검사했다.

## 0. 범위와 순서

이전 대조에서 미구현 또는 미해결로 남은 항목은 다음 아홉 개다. 각 항목은 독립적으로 검토·되돌리기 가능한 단위로 나눈다.

| 번호 | 항목 | 현재 상태 | 이 문서의 절 | 선행 조건 |
| --- | --- | --- | --- | --- |
| U1 | 병렬 frontier의 커밋 | 완료 (`decee7f157`) | §2 | 없음 |
| U2 | 검증 조건부 DAG 의존성(`after_verification` edge) | 미구현 | §3 | U1 |
| U3 | 계획 수정(amendment)과 변경 계약의 결과 adoption | 미구현 | §4 | U2 |
| U4 | 실제 모델 adapter를 사용하는 verified-run | 미구현 | §5 | 없음(U1과 독립) |
| U5 | 적용 승인·CAS(`run apply`) | 미구현 | §6 | 없음(U1과 독립) |
| U6 | 원격 취소(`run cancel`) | 미구현 | §7 | 없음 |
| U7 | artifact GC | 미구현 | §8 | U5 |
| U8 | 필요한 MCP 서버만 연결(loadout) | 미해결 | §9 | 없음 |
| U9 | 도구 호출 frontier(레벨 장벽 대체) | 미해결 | §10 | 없음 |
| U10 | TUI/RPC 제어 표면 | 미구현 | §11 | U5, U6 |
| U11 | 전체 crash window 복구 | 부분 구현 | §12 | 없음 |

권장 구현 순서는 `U1 → U5 → U6 → U4 → U2 → U8 → U11 → U3 → U7 → U10 → U9`다. 이유는 §13에 있다. 동일 조건 경쟁 비교(설계서 §18)는 이 문서의 구현 범위가 아니라 측정 범위이며, 여기서는 다루지 않는다.

## 1. 공통 불변식

모든 항목은 아래 불변식을 유지해야 한다. 각 항목의 수용 시험에는 이 불변식의 회귀 검사를 포함한다.

### 1.1 상태 전이의 결정론

현재 `readRunJournal()`(`packages/coding-agent/src/core/verified-run/journal.ts`)은 v2 레코드를 hash chain으로 검증하고 `projectRun(events)`로 상태를 재생한다. 새 이벤트를 추가해도 다음이 유지되어야 한다.

$$
s_{k+1} = \delta(s_k, e_{k+1}), \qquad
\forall k:\ \operatorname{hash}(r_{k+1}) = H(\text{version}, k+1, g_{k+1}, \operatorname{hash}(r_k), e_{k+1})
$$

여기서 $g_{k+1}$은 세대이며, 현재 구현은 `resumed`, `writer_restarted`, `tasks_retried` 이벤트에서만 $g$를 1 증가시킨다. 이 문서가 추가하는 세대 증가 이벤트는 §4의 `plan_amended` 하나뿐이며, 그 밖의 새 이벤트는 세대를 바꾸지 않는다.

### 1.2 승인은 JSON 필드가 아니다

`RunCoordinator.start/resume/restartWriter/retryTasks`는 모두 `VerifiedRunApproval.approvedContractDigest`를 신뢰하는 host 호출로 받는다. 새 명령(`apply`, `cancel`, `amend`)도 같은 형태를 따른다. 계약이나 명령 JSON 안의 `approved`, `trusted`, `verified` 필드는 `runObject()`의 허용 키 목록에 없으므로 parser가 거부한다. 이 규칙을 완화하는 변경은 없다.

### 1.3 세대 fencing

$$
\operatorname{Accept}(e) \Rightarrow
e.\text{generation} = \operatorname{CurrentGeneration}(\text{run})
\ \land\
e.\text{revision} = \operatorname{CurrentRevision}(\text{run})
$$

`recovery-command.ts`의 `commandDisposition()`은 `expectedRevision`/`expectedGeneration`을 현재 상태와 정확히 비교하고, 같은 `commandId`의 재요청은 `duplicate`로 분류해 재실행하지 않는다. 새 명령은 모두 `withRecoveryLease()`를 통과한다.

### 1.4 예산은 재부여되지 않는다

`RecoveryBudget`(`recovery-clock.ts`)은 boot ID와 boot-relative `startedMs`, `workDeadlineMs`, `verifyCapMs`, `cleanupDeadlineMs`를 고정한다. 어떤 새 명령도 이 값을 갱신하지 않는다. 남은 시간은 다음으로만 계산한다.

$$
T_{\text{remaining}}(t) = \max\{0,\ D_{\text{phase}} - t\},
\qquad t = \text{boot-relative now},\ \text{same boot ID}
$$

boot ID가 다르거나 단조 시계가 줄어들면 `remainingRunTime()`이 거부한다. 이 거부를 우회하는 경로를 만들지 않는다.

### 1.5 자식 실행의 회수

`dag-phase.ts`의 `executeDag()`는 `finally`에서 `stop.abort()` 후 `Promise.all(inFlight.values())`로 시작된 모든 작업을 기다린다. 새로 추가하는 모든 병렬 경로는 같은 계약을 따른다: **시작한 promise를 모두 기다리기 전에는 반환하거나 throw하지 않는다.**

## 2. U1: 병렬 frontier 커밋 단위 (완료)

이 단위는 `decee7f157`로 `origin/main`에 커밋·푸시됐다. 아래는 그 커밋의 근거·범위·검사 기록이다.

### 2.1 현재 소스 근거

- `packages/protocol/src/run-dag.ts`: `RunDagWriter.maxConcurrentTasks?: 1 | 2`, `parseRunDagWriter()`가 `hasConcurrency`일 때만 필드를 허용하고 `1`/`2` 외 값을 거부한다. 생략 시 필드를 덧붙이지 않아 예전 계약 digest를 보존한다.
- `packages/coding-agent/src/core/verified-run/dag-phase.ts`: `executeDag()`가 `limit = contract.writer.maxConcurrentTasks ?? 1`로 `inFlight` map을 관리하고 `Promise.race`로 완료를 회수한다.
- `dag-projection.ts`: `reduceDagEvent()`가 `task_started`에서 `running` 작업 수가 `maxConcurrentTasks ?? 1` 이상이면 `task_not_ready`로 거부한다.
- `dag-types.ts`: `RunTaskExecution = ready | running(executionId) | exited(executionId, failure)`.
- `run-types.ts`: `dispatch` 이벤트에 `taskId?: string`.
- 신규 모듈: `process-projection.ts`, `task-execution.ts`.
- 테스트: `verified-run-dag-frontier.test.ts`(2), `verified-run-dag-parallel-safety.test.ts`(5), `verified-run-dag-parallel-cli.test.ts`(1). 이번 세션에서 8개 모두 통과했다.

### 2.2 커밋 범위

다음 경로만 stage한다. 같은 작업 트리에 있는 Devin provider, 시작 리소스 표시 수정, ROADMAP 등 다른 작업의 변경은 포함하지 않는다.

```text
packages/protocol/src/run-dag.ts
packages/protocol/test/run-dag-contract.test.ts
packages/coding-agent/src/core/verified-run/dag-phase.ts
packages/coding-agent/src/core/verified-run/dag-projection.ts
packages/coding-agent/src/core/verified-run/dag-types.ts
packages/coding-agent/src/core/verified-run/event-parser.ts
packages/coding-agent/src/core/verified-run/owned-execution.ts
packages/coding-agent/src/core/verified-run/projection.ts
packages/coding-agent/src/core/verified-run/run-types.ts
packages/coding-agent/src/core/verified-run/writer-projection.ts
packages/coding-agent/src/core/verified-run/process-projection.ts
packages/coding-agent/src/core/verified-run/task-execution.ts
packages/coding-agent/test/verified-run-dag-frontier.test.ts
packages/coding-agent/test/verified-run-dag-parallel-safety.test.ts
packages/coding-agent/test/verified-run-dag-parallel-cli.test.ts
packages/coding-agent/docs/verified-run.md
packages/coding-agent/docs/verified-run-testing.md
packages/coding-agent/docs/run-protocol.md
packages/protocol/README.md
```

`run-dag-contract.test.ts`와 세 문서는 현재 작업 트리에서 이미 수정되어 있으므로 diff를 확인한 뒤 frontier 관련 hunk만 stage한다. 커밋 직전 staged diff 전체를 검토하고 위 목록 밖의 hunk가 있으면 중단한다.

### 2.3 수용 조건

커밋 전 다음을 실행했다. protocol 4개 파일 70개 통과, coding-agent 12개 파일 49개 중 48개 통과였고 남은 1개(`verified-run-cli.test.ts`의 `linux-command-v1` CLI 시나리오)는 부하 30/16 CPU에서 30초 timeout이었으며 단독 재실행에서 통과했다. `npm run check`는 pre-commit hook에서 전부 통과했다.

```bash
(cd packages/protocol && node ../../node_modules/vitest/dist/cli.js --run \
  test/run-contract.test.ts test/run-dag-contract.test.ts test/run-dag-properties.test.ts test/run-task-retry.test.ts)
(cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run --maxWorkers=2 \
  test/verified-run-dag*.test.ts test/verified-run-crash.test.ts test/verified-run-cli.test.ts)
npm run check
```

커밋 메시지: `feat(runtime): 최대 2개 작업의 eager frontier 연결` (`decee7f157`).

## 3. U2: 검증 조건부 DAG 의존성

### 3.1 문제

현재 `RunDagTask.dependsOn: readonly string[]`은 단일 의미다: 선행 작업의 **출력 checkpoint가 수락됨**(`status === "succeeded"`, 같은 세대). 설계서 §11.2의 세 가지 edge 조건 중 `after_artifact`만 구현되어 있고, `after_execution`(실패해도 진행)과 `after_verification`(선행 산출물이 특정 검사를 통과해야 진행)은 없다.

현재 검사는 최종 통합 candidate에서만 실행된다(`verification-phase.ts`의 `verifyCandidate()`). 작업 단위 검사가 없으므로 "C는 A의 출력이 검사 `lint-a`를 통과했을 때만 시작한다"를 표현할 수 없다.

### 3.2 계약 확장 (`packages/protocol/src/run-dag.ts`)

`dependsOn`의 원소를 문자열 또는 객체로 허용한다. 문자열은 기존 의미(`after_artifact`)를 그대로 유지해 예전 계약 digest를 바꾸지 않는다.

```typescript
export type RunDagEdge =
	| string
	| { readonly kind: "after_artifact"; readonly taskId: string }
	| {
			readonly kind: "after_execution";
			readonly taskId: string;
			readonly allowedOutcomes: readonly ("succeeded" | "failed")[];
	  }
	| { readonly kind: "after_verification"; readonly taskId: string; readonly claimIds: readonly string[] };

export interface RunDagTaskCheck {
	readonly claimId: string;
	readonly argv: readonly string[];
	readonly stdout: string;
}
export interface RunDagTask {
	readonly id: string;
	readonly dependsOn: readonly RunDagEdge[];
	readonly writablePaths: readonly string[];
	readonly attempts: readonly (readonly string[])[];
	/** 작업 출력 checkpoint에 대해 실행하는 작업 단위 검사. 최종 검사를 대체하지 않는다. */
	readonly checks?: readonly RunDagTaskCheck[];
}
```

parser 규칙(`parseRunDagWriter()` 확장):

1. 문자열 edge는 `{kind: "after_artifact", taskId}`로 **정규화하지 않는다**. 정규화하면 digest가 바뀌므로, 정규화된 형태는 메모리 상의 파생 뷰(`normalizeEdge()`)로만 사용한다.
2. `after_verification.claimIds`는 1–8개, 각 ID는 선행 작업의 `checks[].claimId`에 존재해야 한다. 없으면 `RunContractError("edge claim")`.
3. `after_execution.allowedOutcomes`는 1–2개 중복 없는 값이다. `["failed"]`만 허용하는 edge는 "실패 후 정리"용이며 허용된다.
4. `checks`가 있는 작업은 `checks`가 1–8개, `claimId`는 작업 내에서 유일하고 contract 최상위 `checks[].claimId`와도 겹치지 않는다(최종 attestation의 claim 공간과 분리). 겹치면 `RunContractError("duplicate claim")`.
5. `checks` 필드가 없는 작업 객체는 `runObject(value, ["id","dependsOn","writablePaths","attempts"])`로 파싱하고, 있는 작업만 5-key 목록으로 파싱한다(`maxConcurrentTasks`와 같은 `hasConcurrency` 패턴). 생략 시 digest 보존.
6. `orderRunDag()`와 `runDagAncestors()`는 `normalizeEdge(edge).taskId`로 그래프를 만든다. 순환 검사는 edge 종류와 무관하게 적용한다.
7. `after_verification` edge의 선행 작업에 `checks`가 없으면 `RunContractError("edge claim")`.

### 3.3 Ready 판정

작업 $v$의 정규화된 edge 집합을 $E(v)$, 선행 작업 $u$의 현재 projection을 $\pi(u)$, 현재 세대를 $g$라 하자.

$$
\operatorname{Ready}(v) \iff
\pi(v).\text{status} = \text{pending}
\ \land\
\bigwedge_{\varepsilon \in E(v)} \operatorname{EdgeOk}(\varepsilon)
\ \land\
|\{u : \pi(u).\text{status} = \text{running}\}| < \text{maxConcurrentTasks}
$$

$$
\operatorname{EdgeOk}(\varepsilon) =
\begin{cases}
\pi(u).\text{status} = \text{succeeded} \land \pi(u).\text{generation} = g
& \varepsilon = \text{after\_artifact}(u) \\[4pt]
\pi(u).\text{status} \in \varepsilon.\text{allowedOutcomes} \land \pi(u).\text{generation} = g
& \varepsilon = \text{after\_execution}(u, \cdot) \\[4pt]
\pi(u).\text{status} = \text{succeeded} \land \pi(u).\text{generation} = g
\land \forall c \in \varepsilon.\text{claimIds}:\ \operatorname{TaskCheck}(u, c) = \text{passed}
& \varepsilon = \text{after\_verification}(u, \cdot)
\end{cases}
$$

`after_execution`으로 `failed`를 허용한 선행 작업이 있어도, **최종 candidate 합성은 `succeeded` 작업의 출력만 사용한다**. 실패 출력을 입력으로 쓰는 edge는 지원하지 않는다. `composeDagCandidate()`는 `runDagAncestors()` 결과 중 `status === "succeeded"`인 작업만 병합하며, `after_execution([failed])` edge의 선행 작업은 입력에서 제외된다. 이 제외는 `dag-candidates.ts`에 명시적 필터로 구현하고, 필터 결과가 비어 있어도 초기 `input_checkpoint`는 항상 포함된다.

### 3.4 작업 단위 검사와 새 이벤트

`task_finished`가 `outputDigest !== null`로 수락된 직후, 해당 작업에 `checks`가 있으면 다음을 수행한다.

1. 출력 checkpoint를 읽기 전용 디렉터리 `tasks/<id>-<attempt>-g<g>-check`로 `materializeCandidate()`한다.
2. 각 check를 `executeRunCommand(journal, {role: "verifier", argv, workspace, deadline, claimId, taskId}, ...)`로 실행한다. `role: "verifier"`, `taskId` 지정은 기존 dispatch 이벤트의 필드로 표현 가능하며 새 role 값을 추가하지 않는다.
3. 결과를 새 이벤트로 append한다.

```typescript
| {
		readonly kind: "task_checked";
		readonly taskId: string;
		readonly attempt: number;
		readonly outputDigest: string;
		readonly checks: readonly CheckObservation[]; // evidence-binding.ts의 기존 타입
		readonly observedMs: number;
  }
```

reducer 규칙(`reduceDagEvent()` 확장):

- `task_checked`는 해당 작업이 `succeeded`이고 `outputDigest`가 일치하며 같은 세대일 때만 수락한다. 아니면 `integrity`.
- 각 `CheckObservation`의 `claimId`는 작업의 `checks[].claimId` 집합과 정확히 일치해야 한다(누락·중복·초과 거부).
- 통과 판정은 `closesRunClaims()`와 같은 규칙을 작업 검사에 적용하되, 별도 순수 함수 `closesTaskClaims(task, {output, environment, checks})`로 구현한다. 관측의 `sourceRoot`는 `outputDigest`, `environmentDigest`는 run의 `environmentDigest`다.
- projection에 작업별 `checkResults: ReadonlyMap<claimId, "passed" | "failed">`를 추가한다. `RunTaskProjection`의 `succeeded` 분기에 선택 필드 `checks?: readonly {claimId, passed}[]`로 둔다. `RunTaskCheckpoint`의 기존 형태를 바꾸지 않기 위해 `checks`가 없는 예전 checkpoint는 "검사 없음"으로 읽는다.

$$
\operatorname{TaskCheck}(u, c) = \text{passed} \iff
\exists\, o \in \operatorname{checks}(u):\
o.\text{claimId} = c \land o.\text{exitCode} = 0 \land o.\text{failure} = \varnothing
\land o.\text{stdoutDigest} = H(\text{expected}_c)
$$

### 3.5 검사 실패의 의미

작업 검사가 하나라도 실패하면 작업 상태는 `succeeded`로 유지되지만(출력은 유효한 checkpoint다), `after_verification` edge를 가진 후속 작업은 시작하지 않는다. 다른 edge 종류로 연결된 후속 작업은 시작할 수 있다. 실행 가능한 작업이 없고 미완료 작업이 남으면 기존 `tasks_paused`로 정지한다. `inspectTaskRecovery()`의 `retryableTaskIds`에는 **검사가 실패한 succeeded 작업도 포함**한다(attempt 여유가 있을 때). 재시도하면 새 attempt가 출력을 다시 만들고 검사를 다시 실행한다.

작업 검사 통과는 **checkpoint 수락 조건이지 최종 verified가 아니다**. 최종 `verifyCandidate()`는 그대로 모든 작업이 고정된 뒤 통합 candidate에 대해 contract 최상위 `checks`를 실행한다. 작업 검사 receipt는 최종 attestation에 포함하지 않으며, `evidence()` 출력에 `taskChecks` 배열로 별도 노출한다.

### 3.6 수용 시험

| ID | 시나리오 | 요구 결과 |
| --- | --- | --- |
| V01 | 문자열 edge만 있는 기존 계약 | digest 불변, 기존 테스트 전부 통과 |
| V02 | `after_verification` edge, 선행 검사 통과 | 후속 작업 시작, 최종 verified |
| V03 | `after_verification` edge, 선행 검사 실패 | 후속 작업 미시작, `tasks_paused`, `retryableTaskIds`에 선행 작업 포함 |
| V04 | `after_execution([failed])` 정리 작업 | 선행 실패 후 정리 작업 시작, 최종 candidate에 선행 실패 출력 미포함 |
| V05 | `task_checked`의 claimId 집합 불일치 | `integrity` 거부 |
| V06 | edge가 존재하지 않는 claimId 참조 | parser `RunContractError("edge claim")` |
| V07 | 작업 검사 통과 후 출력 blob 손상 | 재개·재시도 시 `task_checkpoint_mismatch` |
| V08 | 작업 검사 중 SIGKILL | 재시작 후 `task_checked` 없음 → 검사 재실행, 출력 재생성 없음 |
| V09 | 작업 검사가 출력을 수정 | 읽기 전용 mount로 실패, 검사 실패로 기록 |
| V10 | 병렬 frontier + 검증 edge 조합 | 검사 통과 즉시 후속 시작, 무관한 형제 대기 없음 |

property test: 5개 노드에서 가능한 순방향 DAG 1,024개 각각에 대해 edge 종류를 무작위 배정하고, Ready 집합이 §3.3의 수식을 독립 구현(집합 연산만 사용)과 일치함을 확인한다. 기존 `run-dag-properties.test.ts` 패턴을 확장한다.

## 4. U3: 계획 수정(amendment)과 결과 adoption

### 4.1 문제

현재 그래프는 승인 후 불변이다(`verified-run.md` "그래프는 승인 후 불변입니다"). 계약 digest가 바뀌면 새 run이 필요하고, 이전 run의 성공 checkpoint는 재사용할 수 없다. 설계서 §12.3은 "재계획은 task 정의나 의존성 또는 수락 조건의 변경"이며 "재사용 자체가 새 계획에 결합된 명시적 adoption 사건이어야 한다"고 규정한다.

### 4.2 명령 계약 (`packages/protocol/src/run-amend.ts`, 신규)

```typescript
export interface RunAmendCommand {
	readonly schemaVersion: typeof VERIFIED_COMMAND_VERSION;
	readonly kind: "amend";
	readonly runId: string;
	readonly commandId: string;
	readonly expectedRevision: number;
	readonly expectedGeneration: number;
	/** 현재 승인된 계약의 digest. 이 값이 현재 원장의 계약과 다르면 거부. */
	readonly contractDigest: string;
	/** 새 계약 전체. parser는 profile이 linux-command-dag-v1인지 확인. */
	readonly amendedContract: RunContract;
	/** 이전 세대에서 그대로 채택할 작업 ID. 빈 배열 허용. */
	readonly adoptTaskIds: readonly string[];
}
```

승인은 `VerifiedRunApproval.approvedContractDigest`에 **새 계약의 digest**를 넣는 별도 host 호출이다. 이전 계약 digest로는 amend할 수 없다.

### 4.3 안정 노드 계약(stable node contract)

작업 $u$의 안정 계약 digest를 다음으로 정의한다.

$$
\sigma(u) = H\big(
u.\text{id},\ u.\text{writablePaths},\ u.\text{attempts},\ u.\text{checks},\
[\sigma(w) : w \in \operatorname{Anc}(u)]_{\text{sorted by id}},\
\text{budget},\ \text{environmentDigest}
\big)
$$

$\operatorname{Anc}(u)$는 `runDagAncestors()`의 결과다. 재귀 정의이므로 위상 순서로 계산하며, 순환은 parser가 이미 배제한다. `dependsOn`의 edge 종류는 $\sigma$에 **포함하지 않는다**: 같은 입력·명령·검사·조상이면 edge 의미가 바뀌어도 이미 만든 출력은 동일하기 때문이다. 대신 edge 변경은 Ready 재계산으로 반영된다.

adoption 조건:

$$
\operatorname{Adoptable}(u) \iff
u \in \text{adoptTaskIds}
\ \land\
\pi_{\text{old}}(u).\text{status} = \text{succeeded}
\ \land\
\sigma_{\text{old}}(u) = \sigma_{\text{new}}(u)
\ \land\
\operatorname{BlobIntact}\big(\pi_{\text{old}}(u).\text{inputDigest}\big)
\ \land\
\operatorname{BlobIntact}\big(\pi_{\text{old}}(u).\text{outputDigest}\big)
$$

$\operatorname{BlobIntact}(d)$는 manifest $d$와 그가 참조하는 모든 blob 파일이 존재하고 각 파일의 SHA-256이 manifest의 digest와 일치한다는 뜻이다. 현재 `loadCandidate()`가 수행하는 검사와 같다.

하나라도 실패하면 명령 전체를 `adoption_mismatch`로 거부한다. 부분 adoption으로 조용히 진행하지 않는다.

### 4.4 이벤트와 세대

```typescript
| {
		readonly kind: "plan_amended";
		readonly command: RunAmendCommand;
		readonly observedMs: number;
		readonly reconciledExecutionIds: readonly string[];
		readonly adopted: readonly RunTaskCheckpoint[];
		readonly previousContractDigest: string;
  }
```

- `plan_amended`는 세대를 1 증가시킨다(`readRunJournal()`의 세대 증가 목록에 추가). `MAX_VERIFIED_RUN_GENERATIONS = 3`은 그대로 공유한다. 즉 resume/restart/retry/amend를 합쳐 최대 두 번이다.
- `revision`도 1 증가한다. 이후 모든 명령의 `expectedRevision`은 새 값이어야 한다.
- 이후 `projectRun()`은 `plan_amended` 이후의 이벤트를 **새 계약**으로 해석한다. 이를 위해 `WriterReduction.contract`를 가변 필드로 두고 `plan_amended` 처리 시 교체한다. `created` 이벤트의 계약은 원본으로 보존된다.
- `adopted` checkpoint는 새 세대에 `status: "succeeded"`, `generation: 새 세대`로 복사된다. 기존 `tasks_retried.adopted`와 같은 처리다.
- 활성 실행이 있으면(`activeExecutionIds.length > 0` 또는 `running` 작업) amend를 `writer_open`으로 거부한다. 설계서 §12.3 "active writer가 없는 안전한 경계에서만".
- candidate가 이미 고정된 run(`candidateDigest !== null`)은 amend할 수 없다(`candidate_frozen`). 검증 후 계획 변경은 새 run이다.

### 4.5 evidence와 CLI

- `readRunEvidence()`는 `first.contract`(원본)가 아니라 **현재 유효 계약**으로 attestation을 검증해야 한다. `plan_amended` 레코드가 있으면 마지막 것의 `amendedContract`를 사용한다. attestation의 `contractDigest`는 현재 계약 digest이며, 원본 계약 digest는 `originalContractDigest` 필드로 별도 기록한다(attestation version 4로 올린다; v3 읽기는 유지).
- CLI: `omk run amend ID --execute --contract NEW.json --approve NEW_DIGEST --adopt ID[,ID...]|- --revision N --generation N --command-id ID`. `--adopt -`는 빈 adoption이다. `inspect ID --amend-preview --contract NEW.json`은 읽기 전용으로 `adoptable`, `stale`, `new` 작업 목록과 $\sigma$ 비교 결과를 반환한다.

### 4.6 수용 시험

| ID | 시나리오 | 요구 결과 |
| --- | --- | --- |
| A01 | 작업 하나 명령 변경, 나머지 adoption | 변경 작업만 재실행, adoption 작업 출력 재사용, 최종 검사 새로 실행 |
| A02 | adoption 요청한 작업의 조상이 변경됨 | $\sigma$ 불일치 → `adoption_mismatch`, 원장 무변경 |
| A03 | 활성 실행 중 amend | `writer_open` 거부 |
| A04 | candidate 고정 후 amend | `candidate_frozen` 거부 |
| A05 | 세대 3에서 amend | `generation_limit` 거부 |
| A06 | 이전 계약 digest로 승인 | `approval` 거부 |
| A07 | adoption blob 손상 | `adoption_mismatch` |
| A08 | 같은 commandId 재요청 | 조회만, 재실행 없음 |
| A09 | edge 종류만 변경(명령·입력 동일) | adoption 허용, Ready 재계산 |
| A10 | amend 후 resume/retry | 새 revision·세대 기준으로만 수락 |

## 5. U4: 실제 모델 adapter를 사용하는 verified-run

### 5.1 문제

`linux-scripted-agent-v1`은 Faux provider로 승인된 step index만 선택하는 합성 응답이다(`scripted-writer.ts`). 실제 provider(OpenAI Codex, Anthropic 등)가 자연어 목표에서 도구 호출을 생성하는 경로는 없다. 설계서 §4는 이를 계약 스냅샷·권한 축소·지원 행렬로 다룬다.

### 5.2 새 profile 계약

```typescript
export interface RunLiveAgentWriter {
	readonly kind: "live-agent";
	readonly provider: string;        // 기존 ModelContract.allowedProviders 원소와 동일 형식
	readonly modelId: string;         // 정확한 사용자 모델 ID
	readonly thinkingLevel: "off" | "low" | "medium" | "high" | "max";
	readonly maxRequests: number;     // 1–64
	readonly maxOutputTokens: number; // 1–200000
	/** 승인된 도구 이름. 현재는 "verified_shell" 하나만 허용. */
	readonly tools: readonly ["verified_shell"];
	/** 도구가 실행할 수 있는 argv[0]의 절대 경로 allowlist. */
	readonly allowedExecutables: readonly string[]; // 1–32, 각각 runAbsolutePath
}
// RunContract에 { profile: "linux-live-agent-v1"; writer: RunLiveAgentWriter } 분기 추가
```

`tools`를 튜플 리터럴로 고정하는 이유: 이 단계에서는 도구 하나만 지원하며, parser가 다른 이름을 거부하도록 타입과 검사를 일치시킨다.

### 5.3 실행 경계

기존 `scripted-writer.ts`와 `session-port.ts`를 재사용한다. 차이는 다음 세 가지뿐이다.

1. **모델**: Faux 대신 host가 `VerifiedRunRuntime.createSession()`에 주입한 실제 provider 세션을 사용한다. runtime port에 `resolveModel(provider, modelId)` 함수를 추가하고, 계약의 provider/modelId를 `ModelContract`(`packages/agent/src/run-model-contract.ts`)로 변환해 `createAgentSession({ modelContract })`에 전달한다. 즉 §4.2의 스냅샷은 **기존 `--model-contract` 경로를 그대로 사용**한다.
2. **도구**: `verified_shell` 도구는 `{argv: string[]}`만 받고, `argv[0]`이 `allowedExecutables`에 없으면 거부한다. 실행은 `executeRunCommand(journal, {role: "writer", argv, workspace, deadline, claimId: null}, ...)`로 bwrap 안에서 이루어진다. 도구 결과는 stdout/stderr digest와 앞 32 KiB(기존 receipt redaction 규칙)만 모델에 돌려준다.
3. **요청 예산**: `session.prompt(goal, { runBudget: { timeoutMs, maxRequests, maxConcurrentRequests: 1 } })`로 기존 공유 예산을 사용한다. `maxOutputTokens`는 `ModelContract.maxOutputTokens`로 전달한다.

원장 이벤트는 기존 `writer_opened → model_request → dispatch/exited → writer_closed`를 그대로 사용한다. `model_request.requestId`는 core의 `provider_request.requestId`와 같은 값을 쓴다.

### 5.4 지원 행렬과 거부 조건

설계서 §4.4의 행렬을 계약 검사로 구현한다. `packages/agent/src/run-model-contract.ts`의 기존 검사에 더해, live profile은 다음을 **시작 전에** 확인하고 하나라도 `unknown`이면 `adapter_unsupported`로 거부한다.

| capability | 확인 방법 | 현재 근거 |
| --- | --- | --- |
| 전송 모델 ID 확인 | `openai-completions` payload hook의 model ID 검사 | `model-contract.md` "Covered paths" |
| 출력 상한 필드 확인 | 같은 hook의 `max_tokens`/`max_completion_tokens` 검사 | 동일 |
| 취소 전달 | `provider-request.ts`의 signal 전달 | `provider-request-boundary.test.ts` |
| 사용량 보고 | 최종 metadata의 usage 존재 | `session-run-budget.ts` |

Codex responses adapter는 `model-contract.md`에 "does not serialize maxTokens"로 명시되어 있으므로 출력 상한 확인이 `unknown`이다. 따라서 첫 지원 provider는 `openai-completions` 계열로 한정하고, 다른 adapter는 각각 payload hook 검증을 추가한 뒤 행렬에 등록한다. 행렬은 코드 상수(`LIVE_AGENT_CAPABILITIES`)로 두고 문서는 그것을 인용한다.

### 5.5 비용·과금 경계

이 profile은 **실제 과금을 발생시킨다**. 다음을 명시한다.

- `plan`은 여전히 네트워크를 쓰지 않는다. `start`만 provider를 호출한다.
- `maxRequests`는 논리 요청 수이며 HTTP 재시도 수가 아니다. adapter의 내부 재시도는 `maxRetries: 0`으로 요청하되, 이것이 provider의 내부 시도를 증명하지는 않는다(`model-contract.md` 한계 유지).
- 재개(`resume`)는 writer를 재실행하지 않으므로 추가 과금이 없다. `restart-writer`는 새 writer 실행이므로 **남은 `maxRequests` 안에서만** 다시 과금된다. 이전 요청 수는 환급하지 않는다.
- 테스트는 loopback HTTP 서버로 `openai-completions` wire를 흉내 낸다. 실제 provider 호출 테스트는 `LIVE_E2E=1`과 해당 provider 환경 변수가 있을 때만 `describe.skipIf`로 실행한다.

### 5.6 수용 시험

| ID | 시나리오 | 요구 결과 |
| --- | --- | --- |
| L01 | loopback 모델이 허용 executable 호출 | bwrap 실행, 출력 digest 회신, candidate 고정, verified |
| L02 | 모델이 allowlist 밖 executable 요청 | 도구 거부, 모델에 오류 회신, 원장에 dispatch 없음 |
| L03 | 모델이 `maxRequests` 초과 | `model_request_limit`, writer 미완료, candidate 없음 |
| L04 | payload hook에서 model ID 불일치 | `provider_denied`, 네트워크 전송 0 |
| L05 | 출력 상한 확인 불가 adapter | `adapter_unsupported`로 start 거부 |
| L06 | writer 중 SIGKILL 후 restart-writer | 남은 요청 수로 재실행, 이전 요청 수 유지 |
| L07 | 모델 응답에 `verified: true` 텍스트 | 검사 결과에 영향 없음 |
| L08 | 도구 결과에 credential 문자열 | 모델 입력 전 redaction, receipt에도 미포함 |
| L09 | 취소 신호 | provider 요청 취소 전달, 활성 bwrap 회수, `cancelled` |
| L10 | 사용량 metadata 결측 | 예산 snapshot에 `usage_unknown`, 0으로 정산하지 않음 |

## 6. U5: 적용 승인과 CAS (`run apply`)

### 6.1 문제

현재 `apply: "artifact-only"`만 허용된다. 검증된 candidate를 원본 workspace에 반영하는 명령이 없다. 설계서 §10.3: 적용은 기대 base를 명시하는 compare-and-swap이어야 하며, 검증한 바로 그 snapshot만 적용한다.

### 6.2 명령 계약 (`packages/protocol/src/run-apply.ts`, 신규)

```typescript
export interface RunApplyCommand {
	readonly schemaVersion: typeof VERIFIED_COMMAND_VERSION;
	readonly kind: "apply";
	readonly runId: string;
	readonly commandId: string;
	readonly expectedRevision: number;
	readonly expectedGeneration: number;
	readonly contractDigest: string;
	/** 검증된 candidate. 원장의 candidateDigest와 정확히 일치. */
	readonly candidateDigest: string;
	/** 적용 직전 원본 workspace가 가져야 하는 digest. 계약의 baseDigest와 같아야 한다. */
	readonly expectedBaseDigest: string;
	/** 적용 대상 절대 경로. 계약의 workspace.root와 같아야 한다. */
	readonly targetRoot: string;
}
```

`apply`는 `RunContract.apply`의 값을 `"artifact-only" | "managed-apply"`로 확장할 때만 허용한다. `"artifact-only"` 계약에는 `apply` 명령이 `apply_not_requested`로 거부된다. 계약 값 변경은 digest를 바꾸므로 새 승인이 필요하다.

### 6.3 CAS 조건

$$
\operatorname{Apply}(h_c) \Rightarrow
\underbrace{\operatorname{capture}(\text{targetRoot}) = h_b}_{\text{base unchanged}}
\ \land\
\underbrace{h_c = \text{state.candidateDigest}}_{\text{same snapshot}}
\ \land\
\underbrace{\text{state.verification} = \text{verified}}_{\text{receipt valid}}
\ \land\
\underbrace{\operatorname{readRunEvidence}() \text{ succeeds}}_{\text{attestation intact}}
$$

여기서 $h_b$ = `expectedBaseDigest` = `contract.workspace.baseDigest`. `captureCandidate(targetRoot, contract.budget)`는 `.git`/`.omk`를 제외한 전체 트리를 다시 읽으므로 사용자가 검증 중 파일을 바꿨으면 base가 달라져 `base_moved`로 거부한다.

### 6.4 적용 알고리즘

원자적 디렉터리 교체는 사용자가 편집 중인 임의 트리에서 보장할 수 없다(설계서 §10.3). 따라서 다음 순서로 **부분 적용을 감지 가능하게** 만든다.

1. `withRecoveryLease()`로 단일 owner를 획득한다(다른 apply/resume과 직렬화).
2. `apply_intent` 이벤트를 append/fsync한다: `{kind: "apply_intent", command, candidateDigest, baseDigest, plannedWrites: [{path, digest, mode} ...], plannedDeletes: [path ...]}`. `plannedWrites`는 candidate manifest와 base manifest의 차집합이다.
3. base와 candidate 모두에 있고 digest가 같은 파일은 건드리지 않는다.
4. 각 쓰기는 같은 디렉터리의 임시 파일(`.omk-apply-<runId>-<random>`)에 쓰고 fsync한 뒤 `rename`한다. 각 삭제는 `unlink`한다. 디렉터리 생성은 부모부터 순서대로 한다.
5. 모든 쓰기·삭제 후 부모 디렉터리들을 fsync한다.
6. `captureCandidate(targetRoot)`를 다시 실행해 `h_c`와 비교한다. 같으면 `applied` 이벤트, 다르면 `apply_diverged` 이벤트를 append한다. **어느 쪽이든 되돌리기(rollback)를 자동으로 수행하지 않는다.** 원본은 이미 `input_checkpoint` blob으로 보존되어 있으므로, 사용자는 `omk run artifact`로 base 파일을 회수할 수 있다.
7. 4–6 사이에서 프로세스가 죽으면 재시작 시 `apply_intent`만 있고 `applied`/`apply_diverged`가 없는 상태다. `inspect --apply-recovery`는 현재 트리를 다시 capture해 (a) base와 같음 → "미적용", (b) candidate와 같음 → "적용 완료(미기록)", (c) 둘 다 아님 → "부분 적용"으로 분류만 하고, 후속 행동은 사용자 명령(`apply` 재요청 또는 수동)이다. 같은 `commandId`의 `apply` 재요청은 (a)에서만 실행을 계속하고, (b)에서는 `applied`를 기록하며, (c)에서는 `apply_partial`로 거부한다.

$$
\operatorname{Classify}(\text{tree}) =
\begin{cases}
\text{unapplied} & \operatorname{capture}(\text{tree}) = h_b \\
\text{applied\_unrecorded} & \operatorname{capture}(\text{tree}) = h_c \\
\text{partial} & \text{otherwise}
\end{cases}
$$

### 6.5 지원 범위와 거부

- `targetRoot`는 계약의 `workspace.root`와 정확히 같아야 한다. 다른 경로로의 적용은 지원하지 않는다.
- symlink, hardlink, 특수 파일, 잘못된 UTF-8 이름은 candidate 단계에서 이미 거부되므로 적용 대상에도 없다.
- base 트리에 candidate manifest에 없는 새 파일이 생겼으면 base digest가 달라져 거부된다. 즉 "검증 후 사용자가 파일을 추가한" 상태에서는 적용할 수 없고, 사용자가 그 파일을 치우거나 새 run을 만들어야 한다. 이는 의도된 보수적 정책이다.
- Git ref 갱신, commit, index 변경은 하지 않는다. 적용 후 `git status`는 사용자 책임이다.

### 6.6 수용 시험

| ID | 시나리오 | 요구 결과 |
| --- | --- | --- |
| P01 | verified candidate를 미변경 base에 적용 | 파일 반영, `applied`, 재capture = $h_c$ |
| P02 | 검증 후 base 파일 변경 | `base_moved`, 트리 무변경 |
| P03 | `artifact-only` 계약에 apply | `apply_not_requested` |
| P04 | 다른 candidate digest | `candidate_mismatch` |
| P05 | attestation 손상 | `integrity`, 트리 무변경 |
| P06 | 쓰기 도중 SIGKILL | `apply_intent`만 존재; `--apply-recovery`가 partial 분류; 같은 commandId 재요청은 `apply_partial` |
| P07 | 적용 완료 후 `applied` 기록 전 SIGKILL | recovery가 `applied_unrecorded`; 재요청이 `applied` 기록 |
| P08 | 삭제가 포함된 candidate | 파일 삭제 반영, 빈 디렉터리 처리 일치 |
| P09 | 같은 commandId 두 번 | 두 번째는 조회 |
| P10 | 다른 owner가 lease 보유 | `lease_held` 거부 |

## 7. U6: 원격 취소 (`run cancel`)

### 7.1 문제

현재 취소는 실행 중인 supervisor 프로세스의 `AbortSignal`(CLI SIGINT/SIGTERM 또는 SDK signal)로만 전달된다. 다른 프로세스에서 실행 중인 run을 취소하는 명령이 없다.

### 7.2 설계

원장은 단일 writer(owner lease)이므로, 취소 요청자는 원장에 쓸 수 없다. 대신 **run 디렉터리 안의 별도 요청 파일**을 사용한다.

- 요청자: `omk run cancel ID --command-id ID [--state-dir DIR]`는 `runPath/cancel-requests/<commandId>.json`을 `publishObject()`로 원자적으로 생성한다. 내용은 `{schemaVersion, kind: "cancel", runId, commandId, requestedAtBootId, requestedAtMs}`. 이미 있으면 조회다. 원장은 건드리지 않는다.
- 소유자: `executeRunCommand()`가 dispatch 전에, 그리고 `executeSandbox()`의 stdin gate를 열기 직전에 `cancel-requests/` 디렉터리를 확인한다. 파일이 있으면 `cancel_observed` 이벤트를 append하고 `AbortController.abort()`로 기존 취소 경로에 합류한다. 확인 비용은 `readdirSync` 한 번이며 dispatch당 한 번이다.
- 실행 중인 bwrap 자식은 기존 취소 경로(SIGTERM → cleanup 기한 → SIGKILL, `quarantined` 판정)를 그대로 따른다. 취소 요청 파일이 있다고 소유자가 즉시 죽지는 않는다.
- 소유자가 없는 run(살아 있는 lease 없음)에 대한 cancel은 파일만 남기고 `no_owner`를 반환한다. 다음 `resume`/`retry-tasks`/`restart-writer`는 시작 전에 cancel 파일을 확인하고 `cancelled`로 거부하며, 사용자가 `--clear-cancel`로 파일을 제거해야 재개할 수 있다.

취소 관측과 실제 종료는 다르다(설계서 §5.3). `cancel` 명령의 반환값은 `{requested: true, ownerAlive: boolean}`이며 종료를 보장하지 않는다. 종료 확인은 `inspect`의 `activeExecutionIds`와 `settlement`로 한다.

### 7.3 수용 시험

| ID | 시나리오 | 요구 결과 |
| --- | --- | --- |
| C01 | 실행 중 다른 프로세스에서 cancel | 다음 dispatch 경계에서 `cancel_observed`, 활성 실행 회수, `cancelled` |
| C02 | 소유자 없는 run에 cancel | `no_owner`, 파일 생성, 이후 resume 거부 |
| C03 | `--clear-cancel` 후 resume | 정상 재개 |
| C04 | 같은 commandId 재요청 | 조회 |
| C05 | 취소 무시하는 자식 | cleanup 기한 후 `quarantined`, settled 아님 |

## 8. U7: artifact GC

### 8.1 문제

`verified-run.md`: "orphan artifact가 남을 수 있으며 GC는 없습니다." blobs, tasks/*, writer-N, candidate-N, attestations, check-receipts가 run 디렉터리에 누적된다.

### 8.2 보존 규칙

run $r$의 도달 가능 집합 $R(r)$을 다음으로 정의한다.

$$
R(r) = \{\text{issuer.key}, \text{journal.v2.jsonl}\}
\ \cup\ \operatorname{Blobs}(\text{inputDigest})
\ \cup\ \bigcup_{u \in \text{tasks}} \operatorname{Blobs}(\pi(u).\text{inputDigest}) \cup \operatorname{Blobs}(\pi(u).\text{outputDigest})
\ \cup\ \operatorname{Blobs}(\text{candidateDigest})
\ \cup\ \{\text{attestations/receiptDigest.json}\}
\ \cup\ \operatorname{Receipts}(\text{receiptDigest})
$$

$\operatorname{Blobs}(d)$는 manifest $d$가 참조하는 모든 blob 파일과 manifest 파일 자신이다. `null` digest는 빈 집합이다. 이전 세대의 attestation(`resumed` 전의 것)은 $R$에 **포함**한다: 감사 기록이며 재서명하지 않기 때문이다. 작업 디렉터리(`writer-N`, `tasks/*`, `candidate-N`)는 blob으로 이미 보존되므로 $R$에 포함하지 않는다.

GC 대상은 $\operatorname{Files}(r) \setminus R(r)$이다. 단, 다음 조건에서는 GC를 거부한다.

- 살아 있는 owner lease가 있다(`lease_held`).
- `activeExecutionIds`가 비어 있지 않거나 `settlement !== "settled"`(`unsettled`).
- 원장 읽기가 실패한다(`integrity`). 손상 run은 GC하지 않는다.
- `apply_intent`가 있고 `applied`/`apply_diverged`가 없다(§6.4의 미결 적용).

### 8.3 명령

`omk run gc ID --execute [--state-dir DIR]`. `--execute` 없이는 삭제 예정 목록과 바이트 수만 출력한다. 삭제는 파일 단위 `unlink`이며 디렉터리는 비었을 때만 제거한다. 삭제 전에 `gc_started` 이벤트, 삭제 후 `gc_finished {removedFiles, removedBytes}` 이벤트를 append한다. 두 이벤트 사이에서 죽으면 다음 GC가 같은 계산을 다시 하며, 이미 지워진 파일은 목록에 없으므로 멱등하다. run 전체 삭제(`--purge`)는 별도 명령이며 이 문서 범위 밖이다.

### 8.4 수용 시험

| ID | 시나리오 | 요구 결과 |
| --- | --- | --- |
| G01 | 완료된 run의 writer 디렉터리 | 삭제, blob·attestation·journal 보존, `evidence()` 여전히 성공 |
| G02 | 재시도로 세대 2인 run | 세대 1의 실패 attempt 디렉터리 삭제, adoption blob 보존 |
| G03 | 활성 실행 중 | `unsettled` 거부 |
| G04 | 원장 손상 | `integrity` 거부, 파일 무변경 |
| G05 | 미결 apply_intent | 거부 |
| G06 | GC 중 SIGKILL 후 재실행 | 잔여 파일만 삭제, 오류 없음 |
| G07 | `--execute` 없음 | 삭제 0, 목록만 |

## 9. U8: MCP loadout — 필요한 서버만 연결

### 9.1 현재 소스 근거

`McpManager.listToolDefinitions()`(`packages/coding-agent/src/core/mcp/manager.ts:94`)는 `Promise.all([...this.runtimes.values()].map(ensureConnected))`로 **모든 활성 서버를 함께 연결**한다. `AgentSession.attachMcpServers()`(`agent-session.ts:4333`)는 이 함수를 호출한다. 클래스 주석의 "lazy"는 `attachMcpServers()`가 호출되기 전에는 spawn하지 않는다는 뜻이며, 호출 시점에는 전체 연결이다.

### 9.2 설계

세 계층으로 나눈다.

1. **inventory**: 설정된 서버 이름 목록. spawn 없음. 현재 `serverNames` getter로 이미 가능하다.
2. **manifest**: 서버별 도구 schema의 로컬 캐시 `~/.omk/agent/mcp-manifests/<name>.json`(`{configDigest, tools: [...], capturedAt}`). `configDigest`는 `McpServerConfig`에서 `env` 값을 제외한 `{command, args, cwd}`의 digest다. manifest가 있고 configDigest가 같으면 spawn 없이 도구 정의를 등록할 수 있다.
3. **connect**: 실제 spawn. 도구가 **처음 호출될 때** 또는 manifest가 없을 때만 수행한다.

`attachMcpServers(options)`에 `loadout?: readonly string[]`을 추가한다.

- `loadout`이 주어지면 그 이름의 서버만 대상으로 한다. 목록에 없는 서버는 `status()`에 `idle`로 남고 spawn하지 않는다.
- `loadout`이 없으면 기존 동작(전체 연결)을 유지한다. 기본값 변경은 이 단계에서 하지 않는다.
- 대상 서버 중 manifest가 있는 것은 manifest로 도구를 등록하고 `state: "cached"`(새 상태)로 둔다. 첫 도구 호출 시 `ensureConnected()`가 spawn하고, 연결 후 `listTools()` 결과가 manifest와 다르면 호출을 `mcp_schema_drift`로 거부하고 manifest를 갱신하지 않는다(사용자가 `omk mcp refresh <name>`으로 갱신).
- manifest가 없는 대상 서버는 기존처럼 즉시 연결한다.

동시 첫 호출은 기존 `runtime.connecting` promise 공유로 중복 spawn을 막는다(`ensureConnected()`의 현재 구현). 이 부분은 변경하지 않는다.

### 9.3 계약 결합

verified-run의 live profile(§5)은 MCP 도구를 아직 허용하지 않으므로(`tools: ["verified_shell"]`), 이 절은 일반 세션에만 적용된다. 이후 live profile에 MCP를 허용할 때는 계약에 `mcpLoadout: readonly string[]`과 각 서버의 `manifestDigest`를 고정하고, drift 시 run을 `mcp_schema_drift`로 정지한다.

### 9.4 수용 시험

| ID | 시나리오 | 요구 결과 |
| --- | --- | --- |
| M01 | 서버 3개 설정, loadout 1개 | spawn 1, 나머지 `idle` |
| M02 | loadout 서버에 manifest 존재 | spawn 0, 도구 등록, 첫 호출 시 spawn 1 |
| M03 | 첫 호출 후 schema drift | 호출 거부, manifest 무변경 |
| M04 | loadout 미지정 | 기존 전체 연결 동작 유지 |
| M05 | 동시 첫 호출 2회 | spawn 1 |
| M06 | loadout 서버 실패 | 다른 서버 영향 없음, 상태 `failed` |
| M07 | manifest configDigest 불일치 | manifest 무시, 즉시 연결 |

측정: `packages/coding-agent/test/mcp/fake-server.mjs`를 사용해 spawn 횟수를 세고, `cold start` 시간과 서버 수의 관계를 `omk doctor resources --report`와 별도로 기록한다. PSS 측정은 Linux `/proc/<pid>/smaps_rollup`을 읽는 테스트 헬퍼로 한다.

## 10. U9: 도구 호출 frontier

### 10.1 현재 소스 근거

- `assignDagDependencies()`(`packages/agent/src/tool-dag-scheduler.ts:192`)는 각 호출의 직접 선행 충돌 집합을 계산하지만, live executor는 사용하지 않는다.
- `executeToolCallsDagLevels()`(`agent-loop.ts:958`)는 `schedulePlannedDagLevels()`로 레벨을 만들고 `runDagLevelCalls()`를 레벨마다 `await`한다. `runDagLevelCalls()` 안에서 승인(`authorizePlannedToolCall`) 후 `rescheduleRunnableLevels()`로 최종 인수 기준 재계획을 한 뒤 `Promise.all`로 레벨을 실행한다.
- 결과는 `finalizedByIndex`에 모아 source order로 emit한다.

### 10.2 설계 원칙

설계서 §11.4의 여섯 규칙을 그대로 따른다. 핵심은 **승인·재계획 경계를 레벨 단위에서 호출 단위로 옮기지 않는 것**이다. hook이 인수를 바꿀 수 있으므로, 최종 인수는 승인 직후에만 확정되고 그 시점의 claim으로만 충돌을 판단해야 한다.

### 10.3 알고리즘

1. batch 전체를 `planToolCall()`로 계획한다(현재와 동일).
2. **승인 단계는 source order로 순차 수행**한다(현재는 레벨 단위로 순차). 각 호출은 승인 직후 최종 인수로 claim을 resolve하고, `entries[i]`에 저장한다. 승인 대기 중 사용자 응답이 필요한 hook은 여기서 자연히 직렬화된다.
3. 승인이 끝난 호출 $i$에 대해, 이미 승인된 $j < i$ 중 `resolutionsConflict(entries[j], entries[i])`인 집합을 $\operatorname{pred}(i)$로 계산한다(`assignDagDependencies()`의 per-entry 버전).
4. 실행은 별도 루프에서 frontier 방식으로 한다.

$$
\operatorname{Ready}(i, t) \iff
\operatorname{Approved}(i)
\ \land\
\forall j \in \operatorname{pred}(i):\ \operatorname{Done}(j, t)
\ \land\
|\operatorname{Running}(t)| < \text{maxConcurrency}
$$

`Done(j)`는 `finalizeExecutedToolCall()`까지 끝난 상태다. `hasUnsettledTimeout()`이 참인 호출은 `Done`이 아니라 `Unsettled`이며, 그 호출과 충돌하는 후속 호출은 영원히 Ready가 되지 않고 batch를 `stoppedByUnsettledTimeout`로 종료한다(현재 의미 보존).

5. 결과 emit은 현재와 같이 batch 종료 후 source order로 한다. lifecycle start 이벤트는 실제 실행 시작 시점에 emit한다.

### 10.4 보존해야 하는 의미

| 현재 의미 | frontier에서의 처리 |
| --- | --- |
| 승인 hook이 인수를 바꾸면 최종 인수로 재계획 | 승인 직후 claim resolve이므로 자동 반영 |
| 해석 불가 인수는 exclusive barrier | `resolution.kind === "exclusive"`는 모든 이전 호출과 충돌·모든 이후 호출이 이를 기다림 |
| `toolPolicies`의 `sequential` 도구 | 같은 도구 이름의 모든 호출을 서로 충돌로 취급 |
| unsettled timeout 후 나머지 skip | 위 §10.3 4항 |
| `signal.aborted` 시 나머지 `Operation aborted` | Ready 판정 전 signal 확인, 미시작 호출은 aborted 결과 |
| 결과 source order | 변경 없음 |

### 10.5 승격 조건

이 변경은 `AgentLoopConfig.toolScheduling: "dag-v2" | "dag-frontier-v1"` 옵션으로 추가하고 기본값은 `dag-v2`를 유지한다. 승격은 설계서 §19.2의 `observe → opt-in → bounded default` 순서를 따르며, opt-in 단계에서 다음 회귀가 모두 통과해야 한다.

| ID | 시나리오 | 요구 결과 |
| --- | --- | --- |
| F01 | A(느림)·B(독립)·C(A 의존) | C가 B 완료 전에 시작 |
| F02 | hook이 B의 인수를 A와 충돌하도록 변경 | B가 A 완료를 기다림 |
| F03 | symlink alias 두 경로 | canonical claim으로 충돌 인식 |
| F04 | 실행 중 cap 변경 없음(cap은 batch 시작 시 고정) | cap 초과 시작 0 |
| F05 | A timeout 후 늦은 쓰기 | A와 충돌하는 C 미시작, `stoppedByUnsettledTimeout` |
| F06 | 승인 대기 중 취소 | 미승인 호출 aborted, 실행 중 호출 회수 |
| F07 | 실패 결과 source order | 기존 테스트 통과 |
| F08 | `sequential` 도구 3회 호출 | 직렬 실행 |
| F09 | 기존 `dag-v2` 회귀 전체 | 옵션 미지정 시 통과 |

성능 주장은 F01 같은 합성 시간 예시로만 하며, 실제 이득은 §18 실험 후에만 보고한다.

## 11. U10: TUI/RPC 제어 표면

### 11.1 원칙

CLI(`verified-run-cli.ts`)와 SDK(`RunCoordinator`)가 이미 있으므로, TUI/RPC는 **새 실행 경로를 만들지 않고 같은 Coordinator를 호출**한다. RPC 명령은 JSON이므로 `parseRun*Command()`를 그대로 사용한다.

### 11.2 RPC

기존 RPC 모드(`packages/coding-agent/docs/rpc.md`)에 다음 명령을 추가한다. 응답은 `RunProjection`/`RecoveryInspection`/`VerifiedRunEvidence`를 그대로 직렬화한다.

| RPC 명령 | Coordinator 호출 | 승인 |
| --- | --- | --- |
| `run.plan {contract}` | `planVerifiedRun` | 불필요(읽기) |
| `run.inspect {runId, mode?}` | `inspect`/`inspectRecovery`/… | 불필요 |
| `run.evidence {runId}` | `evidence` | 불필요 |
| `run.artifact {runId, candidateDigest, path}` | `artifact` | 불필요 |
| `run.start {contract, command, approvedContractDigest}` | `start` | RPC 호출자가 host 승인 채널 |
| `run.resume/restartWriter/retryTasks/amend/apply` | 각 메서드 | 동일 |
| `run.cancel {runId, commandId}` | §7 | 불필요(요청 파일만) |

RPC 호출자는 신뢰하는 host다(`verified-run.md` "SDK 호출자는 신뢰하는 host이고 승인 채널 인증을 책임집니다"). `approvedContractDigest`를 RPC payload로 받는 것은 이 신뢰 가정 안에서만 유효하며, 문서에 명시한다. 불신 클라이언트에 RPC를 노출하는 배포는 지원 범위 밖이다.

### 11.3 TUI

`/run` 슬래시 명령 하나로 시작한다: `/run inspect ID`, `/run evidence ID`, `/run cancel ID`. 상태 표시는 `RunProjection`의 `execution/settlement/verification/application` 네 축을 각각 보여주고 하나의 boolean으로 합치지 않는다(설계서 §8.1). `start/apply`는 승인 digest 입력이 필요하므로 TUI에서는 **계약 digest를 화면에 표시하고 사용자가 같은 값을 타이핑**해야 진행한다. 클릭 한 번 승인은 두지 않는다.

### 11.4 수용 시험

| ID | 시나리오 | 요구 결과 |
| --- | --- | --- |
| R01 | RPC `run.start` → `run.inspect` | CLI와 같은 projection |
| R02 | RPC payload에 `approved: true` 필드 | parser 거부 |
| R03 | TUI `/run inspect` | 네 축 표시, JSON과 동일 값 |
| R04 | TUI apply 승인 digest 오타 | 거부, 실행 없음 |
| R05 | RPC 중 연결 끊김 | Coordinator는 계속 실행, 재연결 후 inspect로 상태 확인 |

## 12. U11: 전체 crash window 복구

### 12.1 현재 복구 가능 상태

`verified-run.md` "`resume`으로 복구하지 않는 경우" 목록과 `work-recovery.ts`의 `assertWorkRecoverable()`을 기준으로, 자동 복구가 차단되는 창은 다음이다.

| 창 | 상태 | 현재 처리 |
| --- | --- | --- |
| W1 | `created` 후 `budget_anchored` 전 | `legacy`/`input_checkpoint_missing`으로 차단 |
| W2 | `budget_anchored` 후 `input_checkpoint` 전 | 동일 |
| W3 | `dispatch` 후 `process_ready` 전 | namespace identity 없음 → 차단 |
| W4 | `process_ready` 후 `exited` 전(살아 있음) | live namespace → 차단(정상) |
| W5 | `exited` 후 `task_finished`/`candidate` 전 | 출력 미고정 → 재시도 명령으로 복구 가능 |
| W6 | `candidate` 후 `evaluated` 전 | `resume`으로 복구 가능 |
| W7 | `evaluated` 후 attestation 파일 fsync 전 | `evidence()` 실패 → `integrity` |

### 12.2 설계

W1·W2는 **자동 복구 대상이 아니다**. writer가 시작되기 전이므로 부작용이 없고, 사용자는 같은 계약으로 새 `runId`를 시작하면 된다. 다만 `inspect --recovery`가 이를 `reason: "not_started"`로 명확히 분류하고 "새 run 시작"을 안내하도록 한다.

W3은 §12.3에서 다룬다. W4는 정상 동작이다. W5는 현재 `retry-tasks`/`restart-writer`가 처리한다. W6은 `resume`이 처리한다.

W7은 순서를 바꿔 닫는다: `verifyCandidate()`가 `issueRunEvidence()`로 attestation을 **먼저** fsync하고, 그 다음 `evaluated` 이벤트를 append한다. 현재 코드가 이미 이 순서다(`issueRunEvidence` → `journal.append({kind: "evaluated"})`). 따라서 W7의 실제 창은 "attestation은 있으나 `evaluated`가 없음"이며, 이 경우 `resume`이 새 세대에서 검사를 다시 실행한다(재서명 아님). 이 동작이 현재 구현과 일치하는지 확인하는 회귀 시험 `verified-run-crash.test.ts`에 사례를 추가한다.

### 12.3 W3: dispatch 후 process_ready 전

이 창은 bwrap이 시작됐는지 알 수 없다. 현재는 차단이 맞다. 자동화할 수 있는 부분은 **판정**뿐이다: `process-gate.ts`의 stdin gate는 `process_ready`가 fsync된 뒤에만 `go`를 보내므로, `process_ready` 기록이 없으면 gate가 열리지 않았고 **명령은 실행되지 않았다**. 따라서 W3의 자식은 있어도 유휴 상태이며, 종료해도 부작용이 없다.

이를 근거로 `inspect --recovery`는 W3을 `reason: "dispatch_without_ready"`로 분류하고, `retry-tasks`/`restart-writer`는 W3 상태의 dispatch를 **`exited {failure: "interrupted_before_ready"}`로 정산**한 뒤 진행할 수 있다. 조건은 다음이다.

$$
\operatorname{SafeToReconcile}(x) \iff
\nexists\, \text{process\_ready}(x)
\ \land\
\big(\operatorname{NamespaceAlive}(x) = \text{false} \lor \operatorname{NamespaceUnknown}(x)\big)
$$

namespace가 살아 있으면(gate 대기 중인 유휴 bwrap) 먼저 SIGKILL하고 close를 확인한 뒤 정산한다. identity가 없어 alive 여부를 알 수 없는 경우는 gate가 열리지 않았음이 원장으로 증명되므로 정산할 수 있다. 이 정산은 새 세대 진입 시 `reconciledExecutionIds`에 기록한다(기존 필드 재사용).

### 12.4 수용 시험

| ID | 시나리오 | 요구 결과 |
| --- | --- | --- |
| K01 | `created` 직후 SIGKILL | `not_started`, 새 run 안내 |
| K02 | `dispatch` 직후(ready 전) SIGKILL, 자식 없음 | `dispatch_without_ready`, retry 시 `interrupted_before_ready` 정산 후 진행 |
| K03 | 위와 같되 유휴 bwrap 생존 | SIGKILL → close 확인 → 정산 |
| K04 | `process_ready` 후 SIGKILL, 자식 생존 | 차단 유지(`namespace_alive`) |
| K05 | attestation 후 `evaluated` 전 SIGKILL | resume이 새 세대 재검사, 이전 attestation 보존 |
| K06 | `evaluated` 후 SIGKILL | inspect/evidence 정상 |

## 13. 구현 순서의 근거

| 순서 | 항목 | 이유 |
| --- | --- | --- |
| 1 | U1 | 완료 (`decee7f157`). 다른 항목의 기준선 |
| 2 | U5 apply | 사용자가 결과를 실제로 쓰는 첫 경로. verified-run의 제품 가치가 여기서 생김 |
| 3 | U6 cancel | apply와 같은 명령 인프라(`withRecoveryLease`, 요청 파일) 재사용 |
| 4 | U4 live adapter | 실제 모델 없이는 U2·U3의 효용을 평가할 수 없음. 기존 model-contract 재사용 |
| 5 | U2 verification edge | live adapter 위에서 작업 단위 검사가 의미를 가짐 |
| 6 | U8 MCP loadout | 일반 세션 개선. verified-run과 독립이지만 U4 이후 live profile에 결합 |
| 7 | U11 crash window | apply/cancel/live가 추가된 뒤 창 목록을 재확정 |
| 8 | U3 amendment | U2의 stable node digest가 필요 |
| 9 | U7 GC | apply_intent 등 모든 파일 종류가 정해진 뒤 |
| 10 | U10 TUI/RPC | 명령 집합이 안정된 뒤 |
| 11 | U9 tool frontier | 별도 패키지(`omk-agent-core`), 독립 승격 경로 |

각 단위는 `programming` 스킬의 RED→GREEN 규칙을 따른다: 실패하는 테스트를 먼저 작성하고 실제 실패를 기록한 뒤 구현한다. 모듈은 250 pure-LOC 한도를 유지하며, `coordinator.ts`(219줄)와 `projection.ts`는 U3 이전에 책임별 분할이 필요하다.

## 14. 문서 검증 방법

이 문서의 수식은 다음으로 검사한다.

```bash
python3 - <<'PY'
import re, subprocess, tempfile, pathlib
text = pathlib.Path("packages/coding-agent/docs/verified-run-remaining-design.md").read_text()
blocks = re.findall(r"\$\$(.+?)\$\$", text, re.S)
body = "\n".join(f"\\begin{{equation*}}{b}\\end{{equation*}}" for b in blocks)
src = "\\documentclass{article}\\usepackage{amsmath,amssymb}\\begin{document}" + body + "\\end{document}"
d = tempfile.mkdtemp()
pathlib.Path(d, "f.tex").write_text(src)
r = subprocess.run(["latex", "-interaction=nonstopmode", "-halt-on-error", "-output-directory", d, "f.tex"], capture_output=True, text=True, cwd=d)
print("blocks:", len(blocks), "exit:", r.returncode)
PY
```

종료 코드 0이 수식 문법의 통과 기준이다. 이 검사는 수식이 읽힐 수 있는지만 확인하며, 설계 가정의 정확성을 증명하지 않는다. 문서 내 소스 경로·기호명은 `rg`로 존재를 확인했고, 그 결과는 이 문서 끝의 검증 기록에 있다.

## 15. 비목표와 남는 한계

- 임의 외부 API의 exactly-once, 모든 provider의 실제 과금 상한, 같은 UID 악성 프로세스로부터의 격리, Linux 외 OS는 여전히 범위 밖이다.
- U4의 `verified_shell`은 첫 도구이며 파일 편집 도구·MCP 도구는 후속이다.
- U5는 Git 통합을 하지 않는다. commit/branch는 사용자 책임이다.
- U9의 성능 이득은 §10.5 회귀 통과 후 설계서 §18의 동일 조건 실험으로만 주장한다.
- 이 문서는 구현 시간을 추정하지 않는다.

## 부록 A. 새 오류 코드

기존 `VerifiedRunError` 코드 체계에 추가하는 값이다. 모두 lowercase snake_case이며 기존 코드와 겹치지 않는다.

| 코드 | 절 | 의미 |
| --- | --- | --- |
| `edge claim` (RunContractError) | §3 | edge가 참조한 claimId가 선행 작업 checks에 없음 |
| `adoption_mismatch` | §4 | stable node digest 또는 blob 불일치 |
| `candidate_frozen` | §4 | candidate 고정 후 amend 시도 |
| `generation_limit` | §4 | 세대 상한 초과(기존 코드 재사용 가능 시 재사용) |
| `adapter_unsupported` | §5 | capability 행렬에 `unknown` 존재 |
| `model_request_limit` | §5 | 기존 코드 재사용 |
| `apply_not_requested` | §6 | `artifact-only` 계약에 apply |
| `base_moved` | §6 | 적용 직전 base digest 불일치 |
| `apply_partial` | §6 | 부분 적용 상태에서 재요청 |
| `no_owner` | §7 | 소유자 없는 run에 cancel |
| `lease_held` | §6, §8 | 다른 owner의 lease 보유 |
| `unsettled` | §8 | 활성 실행 중 GC |
| `mcp_schema_drift` | §9 | manifest와 실제 schema 불일치 |
| `not_started` | §12 | writer 시작 전 crash |
| `dispatch_without_ready` | §12 | gate 열리기 전 crash |

## 부록 B. 참조한 소스 (2026-09-13 작업 트리)

| 파일 | 참조한 기호 |
| --- | --- |
| `packages/protocol/src/run-contract.ts` | `RunContract`, `RunCheck`, `RunPhaseBudget`, `parseRunContract`, `parseRunStartCommand` |
| `packages/protocol/src/run-dag.ts` | `RunDagTask`, `RunDagWriter`, `orderRunDag`, `runDagAncestors`, `parseRunDagWriter` |
| `packages/protocol/src/run-parsing.ts` | `runObject`, `runId`, `runDigest`, `runArray`, `runRelativePath`, `runAbsolutePath`, `runArgv` |
| `packages/protocol/src/run-task-retry.ts` | `RunTaskRetryCommand`, `parseRunTaskRetryCommand` |
| `packages/protocol/src/claims/claim-types.ts` | `ObservationSource`, `ClaimNode`, `ObservationNode`, `ProofClosureInput`, `WorkspaceCompleteness` |
| `packages/coding-agent/src/core/verified-run/coordinator.ts` | `RunCoordinator`, `VerifiedRunApproval`, `planVerifiedRun` |
| `.../verified-run/dag-phase.ts` | `executeDag`, `executeTask`, `observeWork` |
| `.../verified-run/dag-projection.ts` | `readyDagTasks`, `reduceDagEvent` |
| `.../verified-run/dag-types.ts` | `RunTaskExecution`, `RunTaskProjection`, `RunTaskCheckpoint`, `DagEvent` |
| `.../verified-run/dag-recovery.ts` | `inspectTaskRecovery`, `retryDagTasks`, `assertDagRecoverable` |
| `.../verified-run/run-types.ts` | `RunEvent`, `RunProjection`, `WriterReduction` |
| `.../verified-run/recovery-command.ts` | `commandDisposition`, `withRecoveryLease`, `requireRunJournal` |
| `.../verified-run/recovery-clock.ts` | `RunClock`, `RecoveryBudget`, `readRunClock`, `anchorRunBudget`, `remainingRunTime` |
| `.../verified-run/verification-phase.ts` | `verifyCandidate` |
| `.../verified-run/evidence.ts` | `issueRunEvidence`, `readRunEvidence`, `createRunIssuer` |
| `.../verified-run/evidence-binding.ts` | `CheckObservation`, `parseCheckObservations`, `closesRunClaims` |
| `.../verified-run/candidate.ts` | `CandidateManifest`, `CandidateSnapshot`, `captureCandidate`, `materializeCandidate`, `assertCandidateScope`, `storeCandidate`, `loadCandidate` |
| `.../verified-run/journal.ts` | `readRunJournal`, `VerifiedRunJournal`, `JournalSnapshot`, `journalPath` |
| `.../verified-run/owned-execution.ts` | `executeRunCommand`, `OwnedRunCommand` |
| `.../verified-run/scripted-writer.ts` | `executeScriptedWriter`, `ScriptedWriterContext` |
| `.../verified-run/session-port.ts` | `VerifiedRunSession`, `VerifiedRunRuntime` |
| `.../verified-run/process-gate.ts` | `PROCESS_GATE_ARGV`, `identityFromSandboxInfo` |
| `.../verified-run/storage.ts` | `VerifiedRunError`, `publishObject`, `publishBytes`, `readRegularFile`, `stateRunPath` |
| `packages/coding-agent/src/commands/verified-run-cli.ts` | `parse`, `runVerifiedRunCli` |
| `packages/coding-agent/src/core/mcp/manager.ts` | `McpManager`, `listToolDefinitions`, `ensureConnected`, `connect`, `checkHealth` |
| `packages/coding-agent/src/core/agent-session.ts` | `attachMcpServers` |
| `packages/agent/src/tool-dag-scheduler.ts` | `assignDagDependencies`, `applyConcurrencyCap`, `scheduleDagLevels` |
| `packages/agent/src/agent-loop.ts` | `executeToolCallsDagLevels`, `runDagLevelCalls` |
| `packages/coding-agent/docs/verified-run.md` | 구현·검증 상태표 |
| `packages/coding-agent/docs/model-contract.md` | Covered paths, Limits |
