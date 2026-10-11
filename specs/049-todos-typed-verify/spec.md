---
description: "update_todo 항목에 종류·난이도·완료 확인을 붙이고, finish-check가 그 확인으로 todo를 검증한 뒤에만 완료를 받아들인다 (기본 꺼짐)"
---

# Feature Specification: 종류가 붙은 todo와 finish-check 검증

**Specification ID**: `049-todos-typed-verify`
**Feature Branch**: `spec/049-todos-typed` (문서만, origin/main `eda87d0`에서 분기)
**Created**: 2026-10-11
**Status**: Draft (구현 전, 037과 함께 033 A/B 결과 뒤로 순서가 잡혀 있음)
**Constitution**: [specs/constitution.md](../constitution.md)
**Input**: 인호 요청 "reasoning 높낮이를 todos 및 task별로 … 고도화 및 todos 고도화". Tech Lead가 todo별 reasoning effort는 spec 037(Runtime Engineer)로, todo 자체 개선은 이 spec(OMK 담당)으로 나눴다. 이 spec은 037이 읽을 입력(todo 종류)을 만들 뿐 effort를 정하지 않는다.
**Depends on**: spec 035(REQ ledger, extra turn 1회), 036(공유 run clock), 042(`appendRunLog`), 032(fresh-context verifier, 선택). 모두 main에 있다.

## 지금 코드가 하는 일 (main `eda87d0`)

- `update_todo`(`src/core/extensions/builtin/todo-checklist.ts`)는 항목마다 `id`, `label`, `status`(`pending|active|done|blocked`), 선택 `detail`만 받는다. 호출할 때마다 목록 전체를 바꾼다. 상태는 `todo-runtime-state.ts`의 모듈 변수에 있고, compaction(`todoControlState`)이 끝나지 않은 항목을 open task로 보존한다.
- 내장 todo는 `resource-loader.ts`가 기본으로 싣는다. `OMK_TODO_CHECKLIST=0`이거나 사용자 `todo` 확장이 있으면 빠진다.
- finish-check는 todo를 전혀 보지 않는다. `update_todo`는 `READ_ONLY_TOOLS`에 들어 있어 workspace 변경으로도 세지 않는다(`finish-check.ts`). 검증 근거는 프롬프트에서 뽑은 REQ 문장(`extractRequirements`, 최대 8개)과 그 `REQ n: PASS|FAIL` 응답(`parseFinishCheckLedger`)뿐이다.
- 그래서 모델이 todo를 `done`으로 바꿔도 그게 사실인지 아무도 확인하지 않는다.

**사용 빈도 근거 (Bench Analyst, R8 집계, 2026-10-11)**: omk 실행 265회 중 123회(46%)가 `update_todo`를 불렀다. 호출은 모두 310번이고, 89개 과제 중 61개에서 나왔다. 부른 실행의 호출 수는 중앙값 3, 최대 4로, 실행당 tool call 약 44회에 비하면 작다. 실행 89회는 첫 tool call이 todo였다. 통과율은 todo를 쓴 실행이 82.9%, 안 쓴 실행이 69.7%였다. 다만 과제 난이도가 섞여 있어서(어떤 과제에서 todo를 쓰는지가 난이도와 엮임) 이 차이를 todo의 효과로 볼 수 없다. 예전 자체 벤치 수치(`/workspace/omk-bench/RESULTS.md` 69–71행, 2026-10-03, grok-4.7 single 65회 중 4회)는 과제와 설정이 달라 이 spec의 근거로 쓰지 않는다.

**035와 겹치는 부분**: todo 검증의 실패는 035의 extra turn 1회를 같이 쓴다(R2-4). 그래서 todo를 쓴 실행에서 049가 더하는 몫은 "REQ 문장이 못 잡는 todo 확인" 정도일 가능성이 크고, 035 효과와 나누어 보기 어렵다. TB A/B에 들어간다면 판정은 todo를 쓴 실행만 대상으로 한다(A/B 절, 질문 1).

## 제약 (Tech Lead, 2026-10-11)

- **세션 중에 system prompt와 도구 목록을 바꾸지 않는다** (prompt cache). 플래그는 세션 시작 때 한 번 읽고, 그 세션 동안 `update_todo` 스키마와 설명은 고정이다.
- **task·todo별 내용은 대화 끝에 붙는 메시지로만 넣는다.** todo의 종류, 난이도, 확인 방법, 검증 결과는 system prompt나 `promptGuidelines`에 절대 넣지 않는다. finish-check의 follow-up 메시지(`deliverAs: "followUp"`)와 도구 결과 텍스트로만 전달한다.
- 이 spec은 새 `promptGuidelines` 줄을 추가하지 않는다. 새 필드 설명은 `update_todo` 파라미터 description 안에만 있고, 플래그가 켜진 세션에서만 있다(세션 안에서는 안 바뀜).

## Requirements

### R1 - todo 항목에 세 필드 추가 (P0, 플래그 켜짐에서만)

`OMK_TODO_VERIFY=on`일 때 `update_todo` 항목 스키마에 선택 필드 세 개가 붙는다. 모두 optional이라 기존 호출은 그대로 통과한다.

| 필드 | 값 | 뜻 |
| --- | --- | --- |
| `kind` | `plan` \| `explore` \| `edit` \| `debug` \| `verify` | 이 항목이 하는 일. 037 규칙표의 입력 |
| `difficulty` | `low` \| `medium` \| `high` | 모델의 자기 추정. 037 입력일 뿐, 이 spec은 이 값으로 아무것도 정하지 않는다 |
| `check` | `{ type: "file", path, minBytes?, contains? }` 또는 `{ type: "command", command, expect? }` | 이 항목이 끝났음을 보이는 방법. `expect`는 `exit0`(기본) 또는 출력에 들어 있어야 할 짧은 문자열 |

- `kind`가 없으면 `unknown`으로 기록한다. 잘못된 enum은 도구 오류가 아니라 `unknown`으로 내린다(모델이 목록 전체를 다시 보내게 만들지 않으려고). `unknown`은 `TodoKind`의 값이 아니라 기록용 표시다(R3).
- `check`는 항목당 하나. `command`는 500자, `contains`는 200자, `path`는 4096자에서 자른다. 확인이 붙은 항목은 목록당 최대 8개(`FINISH_CHECK_MAX_REQUIREMENTS`와 같은 값)만 검증 대상이고, 나머지는 기록만 한다.
- 도구 결과 텍스트에 한 줄을 더한다: `checks: <n> attached · <k> without check` (숫자만). 플래그가 꺼지면 결과 텍스트도 main과 같다.

### R2 - finish-check가 todo를 검증 (P0)

finish-check의 check turn은 지금처럼 settle 때 한 번 열린다(조건·건너뜀 이유 동일). 플래그가 켜져 있고 검증 대상 todo가 하나 이상이면:

1. **host 파일 확인 먼저.** `type: "file"` 확인은 host가 직접 한다: `stat`, 일반 파일인지, `minBytes` 이상인지, `contains`가 있으면 앞 1 MiB 안에 그 문자열이 있는지. 파일 내용은 기록하지 않는다. 확인은 하나씩 순서대로, 전체 200 ms 상한(넘으면 나머지는 `unknown`).
2. **명령 확인은 모델이 돌린다.** host는 모델이 쓴 명령을 직접 실행하지 않는다(도구 승인·샌드박스 경로를 우회하지 않기 위해). check 메시지 끝에 `TODO n: <label> — check: <command>` 줄을 붙이고, 응답 끝에 `TODO <n>: PASS|FAIL - <측정값>` 한 줄씩을 요구한다. 파싱은 REQ ledger와 같은 정규식 모양을 쓴다.
3. **판정.** 항목 결과는 `pass | fail | unreported | unknown`. 모델이 `done`이라 했는데 host 파일 확인이 실패하면 응답과 상관없이 `fail`(`source: "host"`), 모델이 PASS라 해도 바뀌지 않는다.
4. **완료를 받아들이는 조건.** `done` 항목 중 `fail`이 하나라도 있으면 그 항목들을 spec 035의 실패 항목에 합쳐 **같은 extra turn 1회**(`FINISH_CHECK_MAX_EXTRA_TURNS = 1`)를 쓴다. 새 turn 예산을 만들지 않는다. `OMK_FINISH_CHECK_EXTRA_TURN`이 꺼져 있으면 기록만 하고 끝난다(035와 같은 규칙). 0.85 이후에는 extra turn이 없다.
5. **도구 상한.** check turn 상한은 `finishCheckToolCap(REQ 수 + 명령 확인 todo 수)`로 계산하고 최대 12 그대로다.
6. `pending`/`blocked` 항목의 확인은 돌리지 않는다. 끝나지 않은 항목 수만 기록한다.
7. todo가 없거나 확인이 붙은 항목이 없으면 finish-check는 main과 똑같이 동작한다(메시지 바이트까지 동일).

### R3 - 037과의 계약 (P1, 037 구현은 하지 않음)

방 결정(2026-10-11, Tech Lead·Runtime Engineer)이다. 049는 계약만 정하고 037을 구현하지 않는다.

- **공유 타입 하나.** 049가 `packages/coding-agent/src/core/todo-state.ts`(지금 `TodoItem`, `TodoStatus`가 있고 `update_todo` 확장이 import하는 순수 모듈)에서 `export type TodoKind = "plan" | "explore" | "edit" | "debug" | "verify"`를 내보낸다. 값 목록 상수(`TODO_KINDS`)도 같은 파일에 둔다. 이 파일은 I/O가 없고 이미 기본 경로에서 로드되므로, 037이 import해도 꺼짐 비용(R4)이 늘지 않는다.
- **037의 확장.** 037은 이 타입을 import해서 `Phase = TodoKind | "build" | "run"`으로 넓힌다. `build`와 `run`은 037 안에서만 쓰는 하위 단계라 049의 todo 스키마에는 없다.
- **`unknown`과 todo 없음은 같다.** 잘못된 종류는 `unknown`이 되고, 037은 `unknown`과 todo가 없는 경우를 똑같이 다루어 자기 tool call 기반 단계 신호로 돌아간다.
- **우선순위.** `plan`은 todo 종류에서만 나온다(tool call로는 plan을 알 수 없다). 그 밖에는 037이 tool 신호를 우선하고, 어느 쪽에서 왔는지 `llm-call.jsonl`에 `phaseSource: "todo" | "tool"`로 남긴다. 이 로그는 037의 것이다.
- **읽기 함수.** `todo-runtime-state.ts`에 순수 읽기 함수 `activeTodoKind(): TodoKind | undefined`를 추가한다(`nextActiveTodo` 기준, `unknown`이면 `undefined`). 037은 이것만 읽는다.
- **사라진 것.** 초안의 `TaskClassV4` 변환표는 뺀다. 037이 `TodoKind`를 직접 쓰기 때문이다.
- effort를 바꾸는 것은 037의 몫이고, 요청 파라미터라 위 prompt cache 제약과 부딪히지 않는다. Adaptorch로 넘어가는 경로는 없다. 038과 같은 조건(로컬, HTTP MCP, 근빈 라이선스 서면 OK)이 갖춰지고 037 규칙표가 A/B에서 이긴 뒤의 일이다.

### R4 - 꺼짐 비용 0 (P0, Perf Engineer 기준)

- `OMK_TODO_VERIFY`가 없거나 `on/1/true/enable/enabled`가 아니면: `update_todo` 스키마·description·결과 텍스트가 main과 바이트 단위로 같고, finish-check에 새 handler가 없고, 새 모듈(`todo-verify.ts`)을 import하지 않는다.
- 시작 시간 +10 ms, RSS +5 MiB 이내. CI에 `print-mode-worker-cold-path.test.ts` 방식의 lazy-import 테스트(`todo-verify-flag-off-cold-path.test.ts`)를 넣어 꺼짐에서 모듈이 로드되지 않음을 확인한다.
- subagent worker에서는 항상 꺼진다(`worker-env.ts`에 `OMK_TODO_VERIFY=0`, 034와 같은 방식).
- UI 세션에서는 finish-check가 원래 `headless`가 기본이므로 R2는 headless 또는 `OMK_FINISH_CHECK=always`에서만 돈다. R1 필드는 UI에서도 받아서 위젯에 종류만 작게 보여 줄 수 있지만, 위젯 변경은 이 spec 범위 밖이다.

### R5 - run log (P0, spec 042)

`appendRunLog("todo-verify", record)`로 `$OMK_RUN_LOG_DIR/todo-verify.jsonl`에 쓴다. 숫자·enum·해시만 넣는다. label, detail, command, path, contains, 측정값 텍스트는 넣지 않는다.

- `type: "todo-snapshot"` (update_todo 호출마다): `total`, `byKind`(종류별 개수), `byDifficulty`, `withCheck`, `checkTypes`(`file`/`command` 개수), `done`.
- `type: "todo-verify"` (check turn이 끝날 때): `checked`, `pass`, `fail`, `unreported`, `unknown`, `hostFail`, `notDone`, `extraTurn`(bool), `hostCheckMs`, 그리고 항목별 `[{ idHash, kind, checkType, result }]`. `idHash`는 todo `id`의 sha256 앞 12자.
- `t`, `elapsedFraction`, `pid`, `role`은 `appendRunLog`가 붙이므로 record에서 쓰지 않는다.

## Acceptance (구현 PR에서)

1. 플래그 꺼짐: `update_todo` 스키마 JSON, 결과 텍스트, finish-check 메시지가 main과 같다. `todo-verify.ts`가 로드되지 않는다. `todo-verify.jsonl`이 생기지 않는다.
2. 플래그 켜짐 + 확인 없는 todo만: finish-check 메시지가 main과 같다.
3. `done` + file 확인, 파일 없음 → `fail`(`host`), 모델이 PASS라 써도 `fail`. extra turn 켜짐이면 035의 extra turn 하나에 합쳐지고, 두 번째 extra turn은 없다.
4. `done` + command 확인 → 메시지에 `TODO n:` 줄이 있고, `TODO n: FAIL - …` 응답이 `fail`로 파싱된다. 응답이 없으면 `unreported`.
5. `pending` 항목의 확인은 돌지 않고 `notDone`에만 센다.
6. 잘못된 `kind` → `unknown`, 도구 오류 없음.
7. check turn 도구 상한은 12를 넘지 않는다.
8. 세션 도중 플래그나 todo 내용이 바뀌어도 system prompt 문자열과 도구 목록이 바뀌지 않는다(첫 요청과 마지막 요청의 system prompt·tools 해시 비교).
9. run log 줄에 label/command/path 원문이 없다(고유 문자열을 심고 파일 전체에서 검색).
10. 꺼짐 cold-path 테스트와 Perf 측정(+10 ms, +5 MiB) 통과.

## A/B 측정 (자리만, Bench Analyst가 정함)

- **새 지출 없음.** 고정점, arm, 대상·대조 과제, win 기준, 비용은 Bench Analyst가 033 A/B 결과 이후에 정하고 이 절에 고정한다. 인호의 OK와 크레딧이 있을 때만 돈다.
- TB A/B에 넣을지는 Tech Lead가 정한다(질문 1). 넣는다면 **판정은 todo를 쓴 실행만** 대상으로 한다. R8에서 todo를 안 쓴 54%의 실행에서는 049가 아무것도 하지 않으므로, 전체 통과율로 보면 효과가 묻힌다. 어느 실행이 todo를 썼는지는 `todo-verify.jsonl`의 `todo-snapshot` 줄로 가린다.
- 미리 정해 둘 것: (a) todo를 쓴 실행의 비율이 arm 사이에 비슷한지(플래그가 todo 사용 자체를 바꾸면 비교가 깨진다), (b) 비교는 `OMK_FINISH_CHECK_EXTRA_TURN=on`을 양쪽에 켠 상태에서 `OMK_TODO_VERIFY`만 다르게 하는 것이 맞는지(질문 3). 035와 같은 extra turn을 쓰므로 A(전부 꺼짐) 대비로 보면 035 효과가 섞인다.
- 근거는 `todo-verify.jsonl`과 `finish-check.jsonl`. 얻은 회차에 `hostFail` 또는 `fail`→extra turn 기록이 있어야 효과로 본다(034와 같은 모양).

## Non-goals

- reasoning effort를 정하거나 바꾸는 것 (037).
- 모델이 todo를 만들도록 매 task 메시지를 덧붙이는 것. R8에서 46%가 이미 todo를 쓰므로 지금은 필요하지 않다.
- host가 모델이 쓴 셸 명령을 직접 실행하는 것.
- `metacognition/obligations.ts`(change-atom → 필수 obligation)와의 통합. 같은 문제를 다른 쪽에서 보는 모듈이라 나중에 합칠 수 있지만, 지금은 관측 전용이라 건드리지 않는다.
- TODO 위젯 UI 변경, compaction `todoControlState`에 종류를 넣는 것.

## 정해 주실 것 (Tech Lead)

1. **TB A/B에 넣을지**: R8에서 46%의 실행이 todo를 썼으니 "거의 없음"은 아니에요. 다만 todo 검증은 035 extra turn과 겹쳐서 따로 보이는 효과가 작을 수 있어요. 넣는다면 todo를 쓴 실행만으로 판정할게요. (제 안: 033·035 결과가 나온 뒤에 넣어요. 035가 효과 없음이면 049의 TB 효과도 기대하기 어려워요.)
2. **command 확인을 host가 직접 돌릴지**: 제 안은 "돌리지 않음, 모델이 check turn에서 돌림"이에요. host 실행이 더 믿을 만하지만 승인·샌드박스 경로를 우회해요.
3. **A/B 기준 arm**: 035 extra turn을 양쪽 다 켠 상태에서 049만 비교할지, 아니면 A(전부 꺼짐) 대비로 볼지요?
4. ~~`kind` 목록~~: 정했어요. `TodoKind` 다섯 개를 049가 내보내고 037이 `build`/`run`을 더해요(R3).

## Expected Files (구현 PR)

- `packages/coding-agent/src/core/todo-state.ts`: `TodoKind`와 `TODO_KINDS`(037과 공유), `TodoDifficulty`, `TodoCheck` 타입(선택 필드)
- `packages/coding-agent/src/core/todo-verify.ts`: 플래그 해석, 스키마 확장, host 파일 확인, `TODO n:` 메시지·파싱, run log record (순수 + 작은 I/O)
- `packages/coding-agent/src/core/extensions/builtin/todo-checklist.ts`: 플래그 켜짐에서만 확장 스키마 사용
- `packages/coding-agent/src/core/extensions/builtin/finish-check.ts`: 플래그 켜짐에서만 todo 검증 연결, 035 실패 항목에 합치기
- `packages/coding-agent/src/core/todo-runtime-state.ts`: `activeTodoKind()` (037이 읽는 유일한 입구)
- `packages/coding-agent/examples/extensions/subagent/worker-env.ts`: `OMK_TODO_VERIFY=0`
- `packages/coding-agent/docs/environment-variables.md`
- Tests: `test/todo-verify.test.ts`(AC 2–7, 9), `test/todo-verify-extension.test.ts`(AC 1, 3, 8), `test/todo-verify-flag-off-cold-path.test.ts`(AC 1, 10)
