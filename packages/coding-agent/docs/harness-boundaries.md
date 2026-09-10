# 벤치마크 실패에서 다시 나눈 하네스 책임

2026-09-09. 대상은 Terminal-Bench 2.1의 **중단된 Flash 24-task 개발용 비교**다.
새 오케스트레이터를 추가하는 대신, 기존 런타임에서 입력·권한·실행·완료 판정의 책임을
분리한다. 이 문서는 구현한 경계와 후속 설계를 구분하며 성능 우위를 주장하지 않는다.

## 1. 무엇을 고쳐야 하는가

비공개 실행 `tb21-flash24-20260908T151234Z-pYN3`의 결과·요청 원장·세션 메타데이터를
읽기 전용으로 재집계했다. 고정 dataset SHA는 `5c8eadf1f393183288fa08b8f73ca9a469cc5e00`,
실행 소스 HEAD는 `29624c3962d00cc8355191265e7827d9fdf0f3ad`다. 실행에는 미커밋 코드가
포함됐으므로 HEAD만으로 실행물을 재현할 수 없다. 실행 manifest의 파일 해시가 별도로 필요하다.

| 관측 | 확인된 사실 | 설계 결정 |
| --- | --- | --- |
| 완료 범위 | 43/48시행. A 21개, B 22개 | 같은 21쌍만 비교. 미완료 5개를 실패·성공으로 채우지 않음 |
| 같은 21쌍 해결 | OMK 7, Terminus-2 10 | 최종 24개 점수나 공식 순위가 아님 |
| OMK 비정상 종료 4건 | 모두 `read`의 image 결과 다음 공급자 계약 거부 | 도구 관측값이 모델 선택을 변경하지 않게 함 |
| 시간 초과 | OMK 4, Terminus 3 | 원인별 시간 분해 뒤에만 deadline 정책 변경 |
| 같은 21쌍 요청 | OMK 574, Terminus 617 | 이전 Pro 실험의 요청 증폭 결론을 그대로 재사용하지 않음 |
| 같은 21쌍 기록된 입력 토큰 | OMK 9,523,530, Terminus 22,752,932 | 토큰 감소만으로 품질·비용 개선을 판정하지 않음 |
| 동일 tool 인수 반복 | OMK 완료 시행에서 최대 3회 | 반복 차단 임계값을 일괄 낮출 근거 없음 |
| 중단 상태 | 소유 프로세스가 없는데 `state.json`은 running | supervisor 상태와 살아 있는 실행 소유권을 분리 |
| 별도 WSL 측정 | OMK 8세션과 자식 프로세스 PSS 약15.8GiB, SwapPSS 약6.4GiB | MCP 시작 전 자원 입장 제어가 필요. benchmark만의 점유량이 아님 |

이미지 실패 4건은 자동 라우팅→계약 거부까지 확인한 인과 경로다. 아래 수정으로 그
종료 원인을 없애도 네 task가 해결된다는 뜻은 아니다. 시간 초과 중 `tune-mjcf`의
기록된 gateway 시간은 약120초, `db-wal-recovery`는 약712초였다. 나머지 시간을 모두
도구 낭비라고 추정하지 않는다. 대기·tool·검증·호스트 압박 측정이 더 필요하다.

## 2. 선택한 구조

```text
원본 session / tool artifact                         [보관·재생]
              │
사용자가 선택한 모델 + 명시적 사용자 첨부             [모델 선택]
              │
ProviderInputProjection                             [전송 표현]
  ├─ 지원하는 입력: 유지
  └─ text-only + tool image: 명시적 미관측 안내
              │
ModelContract → provider-specific payload check      [허용·거부]
              │
SDK/provider → tool execution → 실행 관측             [실행]
              │
classifyRunTermination → durable run journal          [시도 종료]
              │
prompt_settled (retry·continuation 종료 후)            [프롬프트 종료]
              │
CLI exit status ── text / JSON renderer               [보고]
```

원본 보관은 입력 변환과 별개다. 계약 검사는 입력을 해석하거나 임의 모델을 선택하지 않는다.
`agent_end`는 재시도 전의 시도 종료일 수 있으므로 CLI의 최종 판정으로 바로 쓰지 않는다.
종료 코드 0이나 `prompt_settled=completed`도 외부 verifier의 해결 판정과는 다르다.

선행연구는 [SWE-agent의 ACI 연구](https://arxiv.org/abs/2405.15793v3)의 초록을 확인했다.
모델과 도구 사이의 인터페이스를 먼저 고친다는 방향의 참고 자료이며, 이 변경의 구현
세부사항이나 TB 성능 이득을 증명하는 자료가 아니다. 새 학습형 라우터·judge·앙상블은
이번 실패 원인을 해결하지 않으므로 추가하지 않는다.

## 3. 이번에 구현한 경계

### 입력 표현: provider-input.ts

`packages/agent/src/provider-input.ts`는 `projectToolImagesForModel()`을 제공한다.
계약이 있는 core/SDK 경로에서만 사용한다.

- text-only 모델의 `toolResult` 이미지 블록만 텍스트 안내로 바꾼다. 시각 내용을
  추측하거나 OCR 결과를 만들어 내지 않는다.
- 기존 text, tool-call ID, 오류 여부와 순서를 유지한다. 원본 세션의 image는 수정하지 않는다.
- 현재 모델이 이미지 입력을 지원하면 그대로 전송한다. 사용자 첨부는 자동 제거하지 않는다.
- 계약 모드에서는 **tool 이미지로 자동 vision 모델을 선택하지 않는다**. 사용자 이미지가
  있는 경우는 기존 vision 라우트를 검사하고, 허용된 vision 모델이면 모든 첨부를 유지한다.
- 계약 없는 일반 제품 경로는 기존 자동 vision 라우팅을 유지한다.
- core의 `provider_request.omittedToolImages`는 해당 요청에서 생략한 이미지 수다.
  누적 제거량이나 이미지 해석 성공률이 아니다. SDK 요약은 동일 변환을 쓰지만 아직 이
  core 사건 원장의 소비자가 아니므로 별도의 완전한 요청 원장으로 주장하지 않는다.

이는 원본 이미지 메모리를 줄이는 변경이 아니다. read producer의 decode/resize나
세션 내 base64 저장을 없애지 않았다. 그 부분은 아래 artifact-reference 후속 단위다.

### 원인 분류: session-run-termination.ts

기존 `AgentSession`의 종료 원인 분류를 별도 순수 함수로 옮겼다. 세션 수명주기와
원장 append 책임은 그대로 두고, 시계·모델·관측된 거부/timeout을 분류기에 전달한다.

`provider_denied(contract-violation)`가 관측된 core run은 문자열 추측보다 먼저
`configuration.invalid`, `retryable=false`로 분류한다. 계약을 완화하거나 다른 모델로
전환하는 재시도는 추가하지 않는다. 다음 run에서 원인을 초기화한다.
이전 로그의 `retryable=true`는 잘못된 안내였으며, 그것만으로 실제 재시도 지출이
발생했다고 주장하지 않는다. SDK/사용자 정의 stream의 모든 오류까지 이 사건으로
변환한 것은 아니다.

### CLI 결과: print-mode.ts

최종 실패 판단은 renderer 바깥에 둔다. 각 `session.prompt()`가 끝난 뒤
`prompt_settled` 결과를 확인한다. 이 사건이 없는 호환 경로에서는 해당 프롬프트의
assistant error/abort와 typed termination을 확인한다.

text와 JSON 모두 실패 시 종료 코드 1을 반환하고 후속 CLI 프롬프트를 실행하지 않는다.
내부 재시도에서 한 번 실패했어도 최종 settlement가 성공이면 실패로 고정하지 않는다.
실행 전부터 존재하던 이전 termination을 새 프롬프트의 실패로 재사용하지 않는다.

## 4. 다음 고도화: 작은 독립 단위로 구현

아래는 **설계이며 아직 구현하지 않았다**. 이번 실행이나 기본 설정에 몰래 적용하지 않는다.

| 단위 | 기존 책임과 연결 지점 | 수용 기준·중단 기준 |
| --- | --- | --- |
| H1: 실행 소유권·재개 | benchmark supervisor, `run-journal-store.ts` | PID뿐 아니라 boot ID+process start+heartbeat로 소유권 식별. 중단 시 미확정 요청·원본 결과 보존. 재시도는 새 attempt이며 사용자 승인 필요 |
| H2: 공유 시간 예산 | prompt 수명주기, provider signal, `tool-timeout.ts` | 단조 시계 deadline 하나를 모든 대기에 전달. 남은 예산에서 검증·정리 시간을 예약. queue/model/tool/cleanup 구간 측정; fake-clock·child 종료·부분 결과 보존 검사 통과 전 활성화 금지 |
| H3: artifact-reference 입력 | read producer, 세션 저장, provider-input | 큰 이미지/출력을 파일·digest·MIME·크기 참조로 보관. text-only 요청은 decoding 이전에 metadata만 사용. 원본 회수·권한·수명·재생 동일성을 검사하며 조용한 정보 손실 금지 |
| H4: MCP 입장 제어 | MCP manager의 spawn, 기존 resource admission | 사용자 선택 loadout에서 필요할 때 시작. 실제 소유 child에만 종료·유휴회수 적용. 다른 세션·인증·프로젝트 경계를 공유하지 않음. host memory pressure와 startup 비용을 전후 측정 |
| H5: 단일 요청 원장 | core 사건+SDK 요약+provider HTTP 경계 | run/trial/attempt/request ID로 시작·완료·거부·미확정을 연결. 시간창 귀속 금지. 사용량 결측을0으로 대체하지 않음. redaction·append 실패는 평가 completeness에 반영 |

H1→H2→H3/H4→H5 순으로 무조건 전부 재작성하지 않는다. 먼저 각각의 현재 호출 경로와
검사로 최소 diff를 정한다. H2는 “더 빨리 포기하기”가 목표가 아니며, H4는 머신 전체의
프로세스나 Docker를 일괄 종료하는 기능이 아니다. global MCP pool은 인증 격리 비용이
크므로 첫 구현에서 제외한다.

## 5. 검증과 주장 범위

이번 회귀는 공개 합성 입력만 사용했다. benchmark task 이름에 따라 동작을 바꾸거나
원본 정답·verifier를 모델에 노출하지 않았다. 원본 실행물·결과·STOP 상태는 그대로다.

| 검증 | 증명하는 범위 |
| --- | --- |
| core 이미지 회귀 | text-only 모델 유지, 원본 불변, idempotent 입력, 사용자 이미지 거부/허용, legacy 라우팅 유지 |
| SDK 요약 회귀 | 요약에도 동일한 이미지 projection, 계약 거부 후 다음 허용 run 복구 |
| 실제 소스 CLI + loopback HTTP | 실제 read image→두 번째 모델 요청 성공, raw 이벤트의 원본 image 보존, 최종 요청에 image payload 없음 |
| CLI text/JSON 회귀 | 금지 모델의 네트워크0·exit1, settlement 실패 전파, 실패 후 후속 프롬프트 중단, 내부 복구 성공 보존 |
| 기존 런타임 회귀 | auth/network/quota/abort/tool/persistence/compaction 분류와 기존 계약 유지 |

구현 전에는 core 이미지 2개, SDK 요약/분류 2개, CLI 결과 5개 요구 검사가 실제 실패했다.
직접 검토 중 사용자 이미지로 허용된 vision 모델을 선택했을 때 tool image까지 제거되는
문제를 별도 RED로 발견하고 수정했다. 테스트 타입/fixture 오류는 제품 RED에 합산하지 않는다.

실행 명령은 해당 package 디렉터리 기준이다. 메모리 부담을 줄이기 위해 worker 1로 실행한다.

```bash
# packages/agent
node ../../node_modules/vitest/dist/cli.js --run test/provider-input.test.ts test/provider-request-boundary.test.ts --maxWorkers=1 --no-file-parallelism
# packages/coding-agent
node ../../node_modules/vitest/dist/cli.js --run test/sdk-model-contract.test.ts test/print-mode.test.ts test/model-contract-wire-cli.test.ts test/agent-session-termination-runtime.test.ts --maxWorkers=1 --no-file-parallelism
# repository root
node_modules/.bin/tsgo --noEmit --pretty false
npm run check
```

실제 모델 재호출·벤치마크 재개·WSL 재시작·빌드/설치·커밋은 이번 작업에서 하지 않는다.
본 변경은 중단된 24-task 결과를 보정하지 않는다. 재측정 전에 실행 snapshot과 양 arm의
동일 조건을 다시 고정해야 한다. 현재 본 적 있는 24개는 개발 집합으로 유지하고,
일반화 주장은 별도의 사전 고정 확인 평가로 검증한다.
