# Verified Run: 단계별 TDD 증거

검증일: 2026-09-11. 1차 명령형 실행, 2차 오프라인 AgentSession·native v3 receipt에 이어
3차에서 고정 candidate 이후의 복구를 연결했습니다. [지원 profile](verified-run.md)의
검증이며 S90 전체 gate, 실서비스 모델, writer 재개, DAG, TUI/RPC, 적용 승인 검증은 아닙니다.

## 1차 RED → GREEN

| 단위 | RED 관측 | GREEN 근거 |
| --- | --- | --- |
| 계약 parser | 기존 protocol export에 parser가 없어 두 정상 사례 실패 | `run-contract.test.ts`: 29개 통과 |
| Coordinator 경로 | 기존 SDK export에 Coordinator/plan 경로가 없어 14개 실패 | `verified-run.test.ts`: 정상 실행·거부 경로 통과 |
| 실제 CLI | `run`이 일반 인수 처리로 넘어가고 `--contract` 등을 거부 | `verified-run-cli.test.ts`: 실제 별도 CLI process로 4개 통과 |
| 파일명 identity | UTF-8 BOM 이름이 일반 이름과 합쳐짐 | `ignoreBOM: true`로 원래 이름 보존, 회귀 통과 |
| directory mode | 지원하지 않는 `0700`을 묵시적으로 정규화 | `0755` 외 mode 거부, 회귀 통과 |
| dispatch 기한 | 원장 append 사이 기한이 지났는데 writer가 파일 생성 | append 뒤 남은 기한 재확인, 미실행 회귀 통과 |

검증 후 blob 길이가 달라진 경우 처음에는 `storage_limit`으로 거부했습니다.
저장된 blob의 손상은 `integrity`로 분류하도록 고쳤습니다.

## 1차 실행한 검사

저장소 root에서 아래처럼 package 작업 디렉터리를 명시합니다.

```bash
(cd packages/protocol && node ../../node_modules/vitest/dist/cli.js --run test/run-contract.test.ts)
(cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run \
  test/verified-run.test.ts test/verified-run-cli.test.ts \
  test/verified-run-candidate.test.ts test/verified-run-journal.test.ts \
  test/verified-run-broker.test.ts test/run-journal-store.test.ts test/run-journal.test.ts)
npm run check
```

| 검사 | 실제 결과 |
| --- | --- |
| protocol 계약 | 29개 통과, exit 0 |
| coding-agent 집중 검사 + 기존 v1 원장 회귀 | 7개 파일, 123개 통과, exit 0 |
| 변경한 TypeScript 17개 파일의 primary LSP | diagnostics 0 |
| `npm run check` | exit 1: 새 문서가 Git index에 없어 tracked 문서의 링크 검사에서 중단 |
| 후속 gate + workspace `tsgo --noEmit` + browser smoke | 별도 실행, exit 0 |
| `git diff --check` | exit 0 |
| `lens_diagnostics(mode=all, severity=error)` | 오류 0 |

전체 검사의 Biome·의존성·순환·module-size·constitution·release consistency 검사는
문서 링크 검사 전까지 통과했습니다. 새 문서 참조를 숨기거나 승인 없이 stage해서
검사를 우회하지 않았습니다. index에 변경을 반영할 권한을 받은 뒤 전체 검사를 다시
실행해야 합니다. 기존 compaction 모듈의 Biome info 11개는 이번 변경과 무관합니다.

중단 지점 뒤의 검사는 다음 명령으로 별도 확인했습니다.

```bash
npm run check:openwiki && npm run check:feature-claims && npm run check:private-home && \
  npm run check:release-surface && npm run check:shrinkwrap && \
  node node_modules/@typescript/native-preview/bin/tsgo.js --noEmit && npm run check:browser-smoke
```

root에서 package config만 지정했던 첫 Vitest 호출은 `test/setup-env.ts`를 root에서
찾아 실행 전에 실패했습니다. 소스를 우회하지 않고 프로젝트 지침대로 package
디렉터리에서 같은 파일들을 실행했습니다. 이 실패를 테스트 통과로 세지 않았습니다.

## 통과한 동작과 한계

| 동작 | 테스트 |
| --- | --- |
| 계약 snapshot 불변성·unknown authority·잘못된 ID/경로/budget 거부 | `packages/protocol/test/run-contract.test.ts` |
| 실제 bwrap writer→고정 candidate→읽기 전용 verifier→수락 | `test/verified-run.test.ts` |
| 원본 보존, 범위 밖 변경·가짜 verified 텍스트·키/receipt/blob 손상 거부 | `test/verified-run.test.ts` |
| 시간·output 초과, dispatch 의도 기록 후 기한 재검사 | `test/verified-run.test.ts` |
| 실제 자식의 시작 출력 확인 후 timeout/close, foreign process 보존, background 자손 종료 | `test/verified-run-broker.test.ts` |
| append 실패 시 상태 미승격·store 폐쇄, live/released owner, stale head | `test/verified-run-journal.test.ts` |
| 중복·foreign completion 거부, unsettled 예약 보존, torn/legacy 손상 거부 | `test/verified-run-journal.test.ts` |
| mode·삭제·binary·empty·BOM 이름 binding, 링크/부분 scope 거부 | `test/verified-run-candidate.test.ts` |
| 실제 CLI/SDK 상태 일치, 별도 process inspect, 원본 artifact base64 회수 | `test/verified-run-cli.test.ts` |
| 기존 v1 RunJournal/RunJournalStore 의미 유지 | `test/run-journal.test.ts`, `test/run-journal-store.test.ts` |

추가로 필요한 검증: supervisor 강제 종료의 모든 crash window, PID 재사용,
cgroup hard limit, reboot/boot-relative 예산 복원, 실서비스 provider 연결,
동시 DAG, 적용 nonce/base CAS, 모든 UI의 공통 제어입니다.

전체 coverage 비율은 측정하지 않았습니다. 실제 코딩 성능·경쟁 엔진 비교·유료 모델
호출·배포 검사는 실행하지 않았습니다. 새 파일은 250 pure-LOC 한도 안에 두었고,
기존 사용자 변경은 검증 대상 변경에 섞어 고치지 않았습니다. 커밋·push·PR은 수행하지
않았습니다.

## 2차: AgentSession·native v3 연결

- native v3 필드가 없어 5개 테스트가 실패한 상태에서 시작했습니다. 실제 검사 결과를
  `createEvidenceReceipt()`로 보존하고 supervisor attestation v2에 core digest를 연결했습니다.
- 유효한 core에 mutable `ledgerBinding`을 주입해도 통과하던 사례를 재현했습니다.
  이 경로에서는 발급하지 않은 envelope authority metadata를 거부하도록 고쳤습니다.
- 처음 redaction fixture는 기존 redactor의 계약 밖인 bare `Bearer` 문자열이었습니다.
  지원하는 `Authorization: Bearer` fixture로 바로잡았고, 기존 redactor를 약화하지 않았습니다.
- scripted profile이 거부되던 상태에서 실제 `AgentSession`과 기존 Faux adapter를 연결했습니다.
  producer가 열린 동안 candidate 고정·정산을 거부하고, 요청 cap·실패 latch를 공유합니다.
- 직접 `AgentSession` import로 새 모듈 5개가 순환에 들어갔습니다. session port와 기존
  `agent-session-services.ts` 조립 경계로 의존성을 역전하여 baseline 변경 없이 해소했습니다.
- `main.ts`가 기존 크기 baseline을 한 줄 넘었습니다. 인접 provider-sync 분기를 같은
  순서로 command router에 옮겼습니다. 빠진 router 분기 테스트의 RED→GREEN을 확인했고,
  baseline을 올리거나 줄을 합쳐 검사를 속이지 않았습니다.
- 배열형 `it.each` fixture의 원소가 callback 인수로 펼쳐지는 타입 오류도 발견했습니다.
  `{steps}` 객체 행으로 바꾸어 실제 17-step 상한과 상대 executable을 검사합니다.

최종 재실행 명령:

```bash
(cd packages/protocol && node ../../node_modules/vitest/dist/cli.js --run \
  test/run-contract.test.ts test/run-scripted-contract.test.ts)
(cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run --maxWorkers=2 \
  test/verified-run.test.ts test/verified-run-cli.test.ts \
  test/verified-run-candidate.test.ts test/verified-run-journal.test.ts \
  test/verified-run-broker.test.ts test/verified-run-v3.test.ts \
  test/verified-run-agent.test.ts test/verified-run-agent-events.test.ts \
  test/run-journal-store.test.ts test/run-journal.test.ts \
  test/verified-executor.test.ts test/evidence-receipt.test.ts)
```

| 검사 | 2차 최종 결과 |
| --- | --- |
| protocol | 2개 파일, 40개 통과, exit 0 |
| coding-agent + 기존 원장/receipt 회귀 | 12개 파일, 188개 통과, exit 0 |
| primary LSP | 21개 파일, diagnostics 0 |
| workspace `tsgo --noEmit` | exit 0 |
| import-cycle / module-size | exit 0, baseline 변경 없음 |
| `npm run check` | exit 1, 동일한 미추적 문서 링크 차단 |
| 차단 지점 이후 나머지 gate·browser smoke·diff whitespace | 별도 실행, exit 0 |

위 228개는 앞의 1차 테스트와 회귀를 포함한 최종 집합이며 두 표의 수를 더하지 않습니다.
실제 CLI process에서 두 profile의 start→inspect→artifact를 실행했습니다. 성공 출력만
남긴 모델 문구는 실패한 명령을 승격하지 못합니다. 서로 다른 run의 Faux adapter도
섞이지 않습니다. 기존 v1 attestation은 `legacy`로 읽고 다시 쓰거나 v3로 승격하지 않습니다.

추가/확장 테스트: `run-scripted-contract.test.ts`, `verified-run-v3.test.ts`,
`verified-run-agent.test.ts`, `verified-run-agent-events.test.ts`, `verified-run-cli.test.ts`.
자체 검토에서는 credential/리소스 discovery, 원장 실패 후 dispatch, 열린 producer의
조기 정산, mutable native envelope, 종료 메시지로 실패를 숨기는 경계를 확인했습니다.
신규 모듈 최대 크기는 244 pure LOC입니다. Coordinator와 event reducer는 다음 확장 전
책임별 분리가 필요한 200–250 LOC 구간입니다.

## 3차: 고정 candidate 이후 복구

범위는 **writer·모델을 재실행하지 않는 검증 재개**입니다. budget/namespace 정보를
이미 기록한 새 run만 재개할 수 있습니다. 원장과 key·기존 산출물은 유지하고 새로운
generation에서 같은 candidate를 다시 검사합니다.

| 단위 | 실패 관측과 수정 |
| --- | --- |
| resume parser/SDK | parser와 `resume()`이 없어 RED. exact ref·candidate binding으로 구현 |
| CLI 재개 | 실제 SIGKILL 이후 `run resume`이 usage error로 RED. `--execute` 요구 경로 연결 |
| reboot 진단 | boot가 다른데 uptime도 작으면 `clock_rollback`으로 오분류. boot 비교를 먼저 적용 |
| 원장 실패 | append 전 실패·bytes가 남은 indeterminate 실패를 주입. 둘 다 새 검사 dispatch 없음 |
| 시계 혼용 | wall reference와 서로 다른 종료 wall clock을 읽어 종료가 시작보다 앞서는 사례 재현 |
| 구형 호환 fixture | 새 budget/gate metadata와 구형 환경 hash를 섞은 fixture가 실패. 실제 구형 원장 모양으로 재구성 |

시계 문제는 host clock 변화, test clock 누출, 두 clock의 혼용을 구분해 조사했습니다.
실제 host의 NTP/VM 변화가 원인이었다고 단정하지 않습니다. Date만 뒤로 이동시키는
fault injection에서 안정 대조군은 통과했고, 역행 사례는
`1577836800000 < 1767225600000`으로 실패했습니다. 종료 표시를 시작 wall reference +
단조 경과시간으로 투영한 뒤 두 경우가 모두 통과했습니다. 실제 재개 예산은 별도의
boot-relative 기한으로 판정합니다. fake clock은 테스트 종료 때 복구합니다.

최종 검사 명령:

```bash
(cd packages/protocol && node ../../node_modules/vitest/dist/cli.js --run \
  test/run-contract.test.ts test/run-scripted-contract.test.ts test/run-resume.test.ts)
(cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run --maxWorkers=2 \
  test/verified-run.test.ts test/verified-run-cli.test.ts \
  test/verified-run-candidate.test.ts test/verified-run-journal.test.ts \
  test/verified-run-broker.test.ts test/verified-run-v3.test.ts \
  test/verified-run-agent.test.ts test/verified-run-agent-events.test.ts \
  test/verified-run-resume.test.ts test/verified-run-gate.test.ts \
  test/verified-run-clock.test.ts test/verified-run-crash.test.ts \
  test/run-journal-store.test.ts test/run-journal.test.ts \
  test/verified-executor.test.ts test/evidence-receipt.test.ts)
npm run check
```

| 검사 | 3차 최종 결과 |
| --- | --- |
| protocol | 3개 파일, 52개 통과, exit 0 |
| coding-agent·기존 회귀 | 16개 파일, 216개 통과, exit 0 |
| primary LSP | 최초 1개 timeout, 재확인 후 24개 파일 clean |
| workspace `tsgo --noEmit`·import-cycle·module-size | exit 0, baseline 변경 없음 |
| `npm run check` | exit 1: 동일한 미추적 문서 링크 차단 |
| 이후 gate·browser smoke·`git diff --check` | 별도 실행, exit 0 |

최종 268개는 이전 단계 테스트를 포함합니다. 새 검증은 다음을 확인합니다.

- bwrap private info FD에서 namespace init을 확인한 뒤에만 gate 해제. ready 기록 실패·늦은 callback·취소 시 명령 미실행.
- 실제 CLI supervisor를 SIGKILL하고 CLI/SDK에서 같은 candidate 재개. modelRequests·원래 budget·검증 기한 보존.
- `inspect --recovery`는 원장을 변경하지 않으며 `--execute` 없는 재개는 거부.
- 만료·reboot·clock 역행·stale ref·다른 candidate·live owner·명령 ID 충돌 차단.
- 동일 resume 명령의 재실행 방지. generation 3 이후 추가 획득 차단.
- namespace identity 없는 dispatch와 중단된 writer는 미정산 상태를 유지. key를 잃으면 재생성하지 않음.

강제 종료는 test가 만든 CLI에만 보냈습니다. 생성한 fixture와 자식 process는 테스트에서
정리했습니다. 실제 reboot, 모든 crash window, writer 재실행, cgroup 제한, 실서비스 모델,
DAG·RPC/TUI·적용 승인/CAS는 여전히 미검증 또는 미구현입니다. 새 event/parser/phase 모듈로
분리해 250 pure-LOC 한도를 유지했고, 기존 사용자 변경은 건드리지 않았습니다.

## 커밋 체크포인트

이번 단위의 변경 범위:

- `packages/protocol/src/run-contract.ts`, `src/index.ts`, `test/run-contract.test.ts`, `README.md`
- `packages/coding-agent/src/core/verified-run/{storage,candidate,events,journal,broker,evidence,coordinator}.ts`
- `packages/coding-agent/src/core/run-execution-api.ts`
- `packages/coding-agent/src/commands/{run-command,verified-run-cli}.ts`
- `packages/coding-agent/test/verified-run{,-broker,-candidate,-cli,-journal}.test.ts`
- `packages/coding-agent/vitest.config.ts`
- `packages/coding-agent/docs/{run-protocol,sdk,verified-run,verified-run-testing}.md`

제안 메시지: `feat(runtime): 격리 명령형 Run Coordinator 연결`.
1차 시점에는 stage·commit 허가가 없었습니다. 기존 다른 작업의 변경은 이 단위에 포함하지 않습니다.

2차 추가 변경 범위:

- `packages/protocol/src/run-parsing.ts`, `src/run-contract.ts`, `src/index.ts`, `test/run-scripted-contract.test.ts`
- `packages/coding-agent/src/core/verified-run/{check-receipt,evidence-binding,owned-execution,scripted-writer,session-port}.ts`
- 같은 디렉터리의 `coordinator.ts`, `events.ts`, `evidence.ts`, `broker.ts`
- `packages/coding-agent/src/core/agent-session-services.ts`, `src/index.ts`, `src/main.ts`
- `packages/coding-agent/src/commands/{run-command,verified-run-cli}.ts`
- 위 2차 추가/확장 테스트와 기존 SDK·protocol·verified-run 문서

2차 제안 메시지: `feat(runtime): AgentSession 기준 경로와 v3 증거 연계`.
2차 시점의 M2–M4는 미구현이었습니다. 3차에도 M2 전체·M3–M4 완료로 판정하지 않습니다.

3차 추가 변경 범위:

- `packages/protocol/src/run-resume.ts`, `src/index.ts`, `test/run-resume.test.ts`
- `packages/coding-agent/src/core/verified-run/{recovery,recovery-clock,namespace-identity,process-gate}.ts`
- 같은 디렉터리의 `run-types.ts`, `event-parser.ts`, `projection.ts`, `writer-projection.ts`, `events.ts`
- 같은 디렉터리의 `phase-context.ts`, `writer-phase.ts`, `verification-phase.ts`, `coordinator.ts`, `broker.ts`, `owned-execution.ts`, `journal.ts`, `evidence.ts`
- `packages/coding-agent/src/core/run-execution-api.ts`, `src/commands/verified-run-cli.ts`
- `packages/coding-agent/test/verified-run-{resume,gate,clock,crash,v3}.test.ts`
- 기존 SDK·protocol·verified-run 문서

제안 메시지: `feat(runtime): 고정 candidate의 세대별 복구와 예산 보존`.
3차까지 stage·commit·push·PR은 수행하지 않았습니다.

## 커밋 승인 후 사전 검사

사용자의 원자적 커밋 승인 후 이 기능의 54개 경로만 stage했습니다. 기존 provider,
retry, benchmark, ROADMAP 변경은 제외했습니다. 전체 staged diff를 검사하고 각 staged
파일이 이미 검토·검증한 working-tree 파일과 byte 단위로 같은지 확인했습니다.

- `npm run check`: exit 0. 미추적 문서 링크 차단이 해소됐으며 guard 기준은 바꾸지 않았습니다.
- protocol 집중 재검사: 52개 통과, exit 0.
- resume/gate/crash/v3 집중 재검사: 25개 통과, exit 0.
- staged scope·whitespace 검사: 일치·오류 없음.

이 첫 커밋은 계약부터 CLI/SDK·검증·고정 candidate 복구까지의 연결된 opt-in 기능입니다.
이 단위는 `3a1a110ecb` (`feat(runtime): 검증 실행과 고정 candidate 복구 연결`)로 커밋했습니다.
writer 복구 고도화는 아래 별도 구현·직접 테스트·문서 단위로 이어집니다. push·PR·배포는
별도 승인 범위가 아니므로 수행하지 않습니다.

## 4차: 불변 입력 기반 writer 재시작

고도화 대상은 M2의 남은 writer 경계입니다. 부분 작업 디렉터리를 이어 쓰거나 변경된
원본을 다시 읽는 대신, 최초 writer 전에 저장한 CAS 입력 checkpoint에서 새 시도를 만듭니다.
이는 단계별 부분 retry나 Task DAG가 아니라 **승인된 로컬 writer 전체의 명시적 재시작**입니다.

- SDK 메서드가 없어 6개가 실패한 RED에서 시작했습니다. 이후 `restartWriter`와
  `inspectWriterRecovery`를 연결했습니다.
- 실제 writer SIGKILL 후 CLI의 새 flag가 usage error로 실패하는 RED를 확인한 뒤
  `restart-writer --execute`와 `inspect --writer-recovery`를 연결했습니다.
- `input_checkpoint`가 없거나 손상되면 현재 workspace로 대체하지 않습니다.
  원본·이전 부분 출력을 바꿔도 새 `writer-N`에는 저장된 원래 입력만 사용합니다.
- 이전 `modelRequests`는 유지하고 새 시도에 남은 한도만 전달합니다. `requestBaseline`은
  새 시도의 종료 turn 검증에만 사용하며 전체 사용량을 초기화하지 않습니다.
- candidate 검증 재개와 writer 재시작이 같은 lease/CAS/command-id/generation 경계를 씁니다.
  generation 상한, 원래 work deadline, 모르는 namespace와 live owner 거부도 유지합니다.
- 기존 형식 fixture에서 새 `input_checkpoint` 사건을 제거하여 구형 원장 검사를 유지했습니다.
  실제 runtime의 구형 입력 누락을 허용하도록 guard를 낮추지는 않았습니다.

최종 명령은 3차의 테스트 집합에 다음을 추가한 것입니다.

```bash
(cd packages/protocol && node ../../node_modules/vitest/dist/cli.js --run \
  test/run-contract.test.ts test/run-scripted-contract.test.ts \
  test/run-resume.test.ts test/run-writer-restart.test.ts)
# coding-agent의 기존 16개 파일에 아래 3개를 추가하여 --maxWorkers=2로 실행
# test/verified-run-writer-restart.test.ts
# test/verified-run-writer-crash.test.ts
# test/verified-run-writer-progress.test.ts
npm run check
```

| 검사 | 4차 결과 |
| --- | --- |
| protocol | 4개 파일, 62개 통과, exit 0 |
| coding-agent·기존 회귀 | 19개 파일, 229개 통과, exit 0 |
| `npm run check` | exit 0, 문서 링크 포함 전체 통과 |
| 타입·import-cycle·module-size | 통과, baseline 변경 없음 |

최종 291개는 이전 단계를 포함한 집합입니다. 실제 CLI 테스트는 SIGKILL, 읽기 전용 조회,
`--execute` 누락 거부, 원본/부분 출력 변조, 요청 누적, 예산 보존을 확인했습니다. command-only
경로는 모델 요청 없이 재시작합니다. 순수 reducer 테스트는 이전 요청이 새 시도의 종료 응답을
대신할 수 없고 이전 request ID도 재사용할 수 없음을 검사합니다.

이 단위의 변경 경로:

- `packages/protocol/src/run-writer-restart.ts`, `src/index.ts`, `test/run-writer-restart.test.ts`, `README.md`
- `packages/coding-agent/src/core/verified-run/{recovery-command,recovery-projection,writer-completion,writer-recovery}.ts`
- 같은 디렉터리의 `coordinator.ts`, `event-parser.ts`, `journal.ts`, `projection.ts`, `recovery.ts`,
  `recovery-clock.ts`, `run-types.ts`, `scripted-writer.ts`, `writer-phase.ts`, `writer-projection.ts`
- `packages/coding-agent/src/core/run-execution-api.ts`, `src/commands/verified-run-cli.ts`
- 위 writer 테스트 3개, `test/verified-run-v3.test.ts`, SDK·protocol·verified-run 문서

제안 메시지: `feat(runtime): 불변 입력 checkpoint 기반 writer 복구`.
input pin·process identity 기록 이전의 crash window, 원격/opaque 부작용, 실서비스 모델,
M3 DAG와 M4 전체 제어 표면은 완료하지 않았습니다. S90 점수나 경쟁 성능을 측정하지 않았습니다.

## 5차: 정적 명령 DAG와 선택적 작업 재시도

기준은 `e7ab1485ee`입니다. 이번 단위는 M3의 직렬 command DAG·동일 계약 내 출력 재사용입니다.
기존 단일 Coordinator·v2 journal·bwrap broker·candidate CAS·native v3 검증 경로를 재사용했습니다.
별도 실행 엔진이나 live provider 호출은 추가하지 않았습니다.

### 적용한 스킬과 결정

- `adaptorch-route` / `omk-plan`: 읽기 전용 분석의 순차형 권고를 적용했습니다. 작업 DAG는
  5개 노드·4개 edge, width 1(approx), 구조 깊이 5였습니다. 실행 권한으로 해석하지 않았습니다.
- `ponytail` / `programming`: 기존 parser와 자료구조를 사용했습니다. 새 의존성 없이
  FIFO Kahn 순서·전체 ancestor closure·서로 겹치지 않는 작업 출력 범위로 한정했습니다.
  기존 tool conflict DAG는 의미와 패키지 계층이 달라 재사용하지 않았습니다.
- `tdd-workflow` / `property-based-testing`: 계약→SDK 실행→선택 retry→CLI의 RED/GREEN을
  기록하고, 5개 노드에서 가능한 1,024개 순방향 DAG를 하나의 전수 property test로 검사했습니다.
- `refactor`: 공통 work 복구 검사를 `work-recovery.ts`로 옮겨 writer와 task 복구가 같은
  input·clock·namespace·key·environment 경계를 사용하도록 했습니다. 기존 M2 회귀를 함께 실행했습니다.
- `lsp` / `security-review` / `review-work` / `code-review-and-quality`: 타입·입력·권한·실패 경계를
  루트 에이전트가 직접 검토했습니다. 독립 multi-agent 심사나 보안 인증을 수행한 것은 아닙니다.
- `omk-arxiv`는 pre-flight에서 중단했습니다. 이미 정해진 정적 DAG·세대 fencing을 연결하는
  범위여서 새로운 알고리즘 문헌 조사나 성능 비교로 확장하지 않았습니다.

### RED → GREEN

| 단계 | 실제 RED | GREEN 근거 |
| --- | --- | --- |
| DAG 계약 | 정상 계약 2개가 `version/profile/apply`로 거부됨 | DAG 계약 17개 + 기존 protocol 회귀 통과 |
| SDK DAG | 새 실행 2개가 `unsupported` terminal 상태로 반환됨 | 실제 두 writer·통합 산출물과 failed dependency 차단 통과 |
| 선택 retry | 4개가 `retryTasks is not a function`으로 실패 | 성공 branch 1회 유지, 실패 branch 2차 실행, 새 verifier generation 확인 |
| CLI | SIGKILL 뒤 `--task-recovery`가 usage/exit 2로 실패 | 실제 CLI inspect·승인 누락 거부·retry-tasks·복구 완료 통과 |

### 최종 검증 명령

```bash
(cd packages/protocol && node ../../node_modules/vitest/dist/cli.js --run \
  test/run-contract.test.ts test/run-scripted-contract.test.ts test/run-resume.test.ts \
  test/run-writer-restart.test.ts test/run-dag-contract.test.ts \
  test/run-dag-properties.test.ts test/run-task-retry.test.ts \
  --coverage --coverage.provider=v8 --coverage.include=src/run-dag.ts \
  --coverage.include=src/run-task-retry.ts --coverage.reporter=text --coverage.reporter=json-summary)

(cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run --maxWorkers=2 \
  test/verified-run.test.ts test/verified-run-cli.test.ts test/verified-run-candidate.test.ts \
  test/verified-run-journal.test.ts test/verified-run-broker.test.ts test/verified-run-v3.test.ts \
  test/verified-run-agent.test.ts test/verified-run-agent-events.test.ts test/verified-run-resume.test.ts \
  test/verified-run-gate.test.ts test/verified-run-clock.test.ts test/verified-run-crash.test.ts \
  test/verified-run-writer-restart.test.ts test/verified-run-writer-crash.test.ts \
  test/verified-run-writer-progress.test.ts test/run-journal-store.test.ts test/run-journal.test.ts \
  test/verified-executor.test.ts test/evidence-receipt.test.ts test/verified-run-dag*.test.ts \
  --coverage --coverage.provider=v8 '--coverage.include=src/core/verified-run/dag-*.ts' \
  --coverage.include=src/core/verified-run/work-recovery.ts \
  --coverage.reporter=text --coverage.reporter=json-summary)

node node_modules/@typescript/native-preview/bin/tsgo.js --noEmit
npm run check
```

| 검사 | 최종 결과 |
| --- | --- |
| protocol | 7개 파일, 92개 통과, exit 0 |
| coding-agent·기존 회귀 | 26개 파일, 261개 통과, exit 0 |
| 합계 | 353개 통과. 이전 291개를 포함한 집합이며 property 조합 수를 테스트 수에 더하지 않음 |
| 새 protocol 모듈 coverage | lines/statements 100%, branches 94.64%, functions 100% |
| DAG·공통 work 복구 모듈 coverage | lines/statements 99.31%, branches 82.07%, functions 100% |
| primary LSP | 변경 소스 21개 파일 모두 clean, 미확인 0 |
| 타입·전체 `npm run check` | exit 0. import-cycle/module-size baseline을 바꾸지 않음 |

Coverage는 명시한 신규/공통 복구 모듈 집합만의 수치이며 저장소 전체 coverage가 아닙니다.
CLI는 별도 프로세스로 직접 실행했습니다. 이 테스트가 live model 품질이나 모든 OS의 동작을
입증하지는 않습니다. 전체 검사에 남아 있는 기존 compaction info 11개와 OpenWiki corpus 부재
경고는 이번 변경의 오류가 아니며, 이를 숨기거나 기존 다른 변경을 수정하지 않았습니다.

### 보장별 확인과 자가 검토

| 보장 | 근거 |
| --- | --- |
| 순환·미등록 의존성·task scope·시도 목록 제한 | `run-dag-contract.test.ts`, `run-task-retry.test.ts` |
| 순서·노드 보존·정확한 transitive ancestor 집합 | `run-dag-properties.test.ts`의 전수 DAG/Floyd–Warshall 대조 |
| 형제 출력 미노출, 삭제·빈 디렉터리·mode·입력 digest 보존 | `verified-run-dag-candidates.test.ts` |
| 성공 작업 미재실행, 바뀐 원본/부분 출력 미사용 | `verified-run-dag-retry.test.ts` |
| 실제 SIGKILL·읽기 전용 조회·명시적 실행 승인 | `verified-run-dag-cli.test.ts` |
| unknown dispatch 차단, pending-only 재개, frozen candidate 재검증 | `verified-run-dag-recovery.test.ts` |
| task attempt/generation 상한·reboot·fsync 실패 후 무실행 | `verified-run-dag-recovery.test.ts` |
| 변경/누락 adoption·늦은 task/process 사건 거부 | `verified-run-dag-events.test.ts` |
| 실제 writer 취소·후속 작업 무실행·기한/복구 조회 차단 | `verified-run-dag-cancellation.test.ts` |

자가 검토 결과: 실행 checkpoint와 verification receipt를 구분하고, 새 세대의 통합 검사만으로
최종 수락합니다. parser·순수 상태 전이·파일 합성·실행·복구를 분리했고 불신 JSON을 실행 승인으로
승격하지 않았습니다. 새 source/test 모듈은 250 pure LOC 이하입니다. 기존 `projection.ts` 234,
CLI 223 pure LOC는 경고 구간이므로 다음 확장 시 분할을 검토해야 합니다.

### 커밋 체크포인트

변경 범위는 `packages/protocol/src/{run-contract,run-dag,run-task-retry,index}.ts`와 직접 테스트,
`packages/coding-agent/src/core/verified-run/`의 DAG·공통 복구 및 연결 reducer,
`src/core/run-execution-api.ts`, `src/commands/verified-run-cli.ts`, DAG 테스트와 관련 문서입니다.

제안 메시지: `feat(runtime): 정적 DAG와 선택적 작업 재시도 연결`.
이번 단위의 stage·commit·push·PR은 수행하지 않았습니다. 기존 provider/retry/benchmark/ROADMAP
변경은 제외·보존했습니다.

미완료: 병렬 eager frontier, verification-conditioned edge, 겹치는 쓰기 범위, 계획 amendment와
변경된 계약의 결과 adoption, 실서비스 모델, M2의 미기록 input/process crash window, M4 전체
제어·적용 표면입니다. S90 점수·경쟁 우위·성능 개선량은 측정하거나 부여하지 않았습니다.
