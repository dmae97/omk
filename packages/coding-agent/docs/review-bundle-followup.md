# 재현 번들 검토 후 적용한 경계 개선

대상 자료: `OMK_Review_Reproduction_Bundle_2026-09-09.zip`.
ZIP SHA-256: `aa90e09d04b5802ca2e8343f2666887822eca7e3ab474309835117e85bcd63d8`.
14개 member의 경로·크기·링크 여부와 제공된 checksum 13개를 확인했다.
이 해시는 자료 식별자이며 제삼자 서명이나 안전성 인증은 아니다.

번들 기준은 `dc413cd9bc59be0fcb0267a2442b2d5461b14031`(0.98.3), 현재 작업 시작
HEAD는 `29624c3962d00cc8355191265e7827d9fdf0f3ad`다. 현재 미커밋 변경도 있으므로
리뷰 문구를 현재 구현의 사실로 그대로 승격하지 않았다. 확인된 결함부터 별도 회귀로
고정했고, 번들의 계획을 실행 권한으로 취급하지 않았다.

## 2026-09-10 재검증·커밋 상태

이 절이 아래 9월9일 검사 기록보다 최신이다. 설정·선택 모델·벤치마크는 그대로 두고
구현을 재검증했다. 공식 문서로 DeepSeek V4.1 Flash의 native DeepSeek,
OpenCode Go, OpenRouter, Vercel 경로를 확인해 생성기에 반영했다.
자세한 ID와 가격·wire 한계는 [카탈로그 기록](model-catalog-refresh.md)에 있다.

| 단위 | 재검증 | 구현 커밋 |
| --- | --- | --- |
| 기존 모듈 크기6건 해소 | 선언·함수 AST 이동 전후 일치, 직접 회귀195개, LSP16파일 clean | `0ae2b3b29c` |
| 브라우저 Node 의존성 제거 | 새 bundle 회귀 RED→GREEN, 기존 metadata14개, browser smoke 종료0 | `15059ff28a` |
| 모델 계약·이미지 투영·종료 | core227개, CLI/SDK43개, Agent/Harness41개 통과 | `e8f27e3d9f` |
| 모델 목록·thinking | 164개 통과/라이브 등5개 제외, 전체1333모델 중복·상한·가격 불변식 통과 | `267c1f909a` |
| metrics v2 | 42개 통과 | `bc3b43b5a4` |
| gate·sandbox 정책 | 56개 통과 | `63fb682fc0` |
| 공유 DAG·증인 정책 | 24개 통과, 내부 oracle60그래프 | `6e1ccb2e64` |
| 최신성 상수 명칭 | 정렬 회귀4개 통과, 계산식 불변 | `b9109a91ae` |
| 기존 서식3건 | 직접 회귀40개 통과 | `bccf660ab0` |

위 표는 겹치는 검사들이 있으므로 합산 테스트 수가 아니다. 각 커밋은 명시한 경로/hunk만
stage했고, pre-commit 검사를 우회하지 않았다. 훅이 파일 전체를 다시 stage하는 경우
이번 단위 밖 hunk를 일시 격리한 뒤 복원했으며, 커밋 tree가 검토한 index와 같은지 확인했다.
이전 retry·Codex SSE timeout·TB 선택기/감사 변경은 미커밋 상태로 보존했다.

최종 `npm run build`, `npm run check`, `git diff --check`는 종료0이다.
빌드한 카탈로그에서도 네 Flash 경로와 off/low/high/max를 확인했다.
`lens_diagnostics(mode=all)`의 error 결과는 0이다. 수동 TUI 재시작·실제 추론·과금과
전체 라이브 suite는 실행하지 않았다. 검증용 CLI의 버전은 아직 **0.98.1**이다.

### 배포 보류: 이력 통합과 범위 확인 필요

GitHub 최신 release와 npm 일곱 package의 latest는 모두 **0.98.3**이다.
하지만 해당 tag는 이 로컬 HEAD의 조상이 아니며, 작업 시작 시 로컬/원격 main이
26/11커밋으로 갈라져 있었다. 읽기 전용 merge 미리보기에서 문서·changelog·spec
7개 경로의 충돌도 확인했다. 기존 release를 덮어쓰거나 force-push하지 않는다.

따라서 `node scripts/check-release-consistency.mjs --release`는 종료1이다.
일반 check 통과를 release 승인으로 해석하지 않는다. 기존0.98.3 이력을 통합하고
배포에 포함할 로컬 커밋 범위를 확인한 뒤 **0.98.4**로 patch bump해야 한다.
병합·origin/main 및 v0.98.4 push·태그 게시 범위 확인을 요청했으며, 현재는 버전 변경,
태그 생성, push, GitHub Release, npm publish를 실행하지 않았다.

## 1. 적용한 변경

| 지적 | 현재 코드에서 확인한 결과 | 적용 |
| --- | --- | --- |
| F01/F02/F03 | 공유 DAG에서 지역 최소 cut을 합치면 전역 최소도 포함 최소도 아님 | bounded antichain 설명, 명시적 optimality, 복잡도 설명 교정 |
| 4.7의 추가 위험 | 부모 자체 반례가 있어도 child만 수리 대상으로 반환 | local/children 원인을 구분하고 부모 의무도 설명에 보존 |
| F07 | `exp(-age/h)`의 h를 half-life라고 명명 | e-folding time constant로만 개명. 수치·점수·선택 정책은 그대로 |
| F09 | 다른 observation ID만으로 독립 증인 수 증가 | 선택형 `explicit-groups` 정책과 결과의 정책 표시 |
| F10/F11 | 오류를 200자로 자르고 입력을 spread해 원문·추가 필드·toJSON이 저장될 수 있음 | metrics v2 허용 목록, 오류 분류만 저장, 전체 중첩 값·파생 counter 검증 |
| F12 | 빈·희소 gate 배열 또는 호출자 배열 변경 뒤 `open` | 생성자 거부·배열 snapshot. 빈 결과 결합도 거부 |
| F20 | 명시적 허용 없이 enforce→audit/off 또는 filesystem root 확대 | 더 약한 mode·더 넓은 root를 채택하지 않음. 명시적 allowBroaden 경로 유지 |

추가로 `TaskContractBuilder.fromJSON()`의 문법 오류가 입력 일부를 메시지에 넣는
동작을 재현했다. 잘못된 JSON은 계속 `SyntaxError`로 거부하되 원문을 포함하지 않는다.
오류를 삼키거나 잘못된 계약을 허용하는 수정은 아니다.

## 2. Claim Graph: 설명과 진실 판정을 분리

현재 `claim-blocking-cut.ts`의 수정 전 Git blob은 번들의 추출본과 같은
`1d5d1a1f229b7439ff940fc3d1abbe0c988e3fa4`였다. 검토한 Node 재현 스크립트로
다음을 실제 확인했다.

```text
all(any(a,z), any(b,z)): 기존 [a,b], 최소 [z]
all(any(a,z), z):        기존 [a,z], 최소 [z]
```

새 `explainBlockingCut()`은 비지배 수리 집합을 유지해 공유 노드를 고려한다.
완주하면 `optimality: minimum`, 후보 family 128개 또는 탐색 operation 65,536개
상한에 걸리면 deterministic greedy와 `optimality: not-proven`, `truncated: true`를
반환한다. 상한은 탐색 규모 제한이지 절대 wall-clock 제한이 아니다. fallback은
cardinality minimum이나 inclusion minimum을 보장하지 않는다.

이 결과는 현재 평가 snapshot의 **수리 의무 모델**에서의 설명이다. 실제 수정 후의
정확성, 비용 최적성, 승인·merge 권한이 아니다. `minimalBlockingCut` 배열은 호환용으로
유지하고, 최소성이 필요한 소비자는 `blockingCut` metadata를 사용한다.
부모 자체 위반·scope 의무는 `localClaimIds`에 나타난다. unresolved effect와 전체
workspace completeness는 기존 verdict 경계에 남는다.

새 strict witness 정책은 `witnessIndependence: "explicit-groups"`로 선택한다.
`requiredWitnesses > 1`에서는 nonempty `independenceGroup`만 집계한다. 독립성이
불명인 관측이 하나의 named group을 보충하거나, ID만 바꿔 quorum을 채우지 못한다.
기본값은 기존 `legacy-observation-id`이며 결과에 사용한 정책이 기록된다.
그룹이 정말 독립인지는 실행·영수증 경계에서 인증해야 한다. 이 함수가 임의 문자열을
실제 독립 실행의 증명으로 만들어 주는 것은 아니다.

자세한 공개 계약은 [protocol README](../../protocol/README.md)에 있다.

## 3. Metrics v2와 호환성

`turn-metrics-record.ts`가 입력/파일 검증과 명시적 projection을 소유한다.
`turn-metrics.ts`는 sink와 집계만 담당한다. 새 기록은 root/usage/tool/cache의 알려진
필드만 구성하고 raw error 대신 `timeout/aborted/permission/not_found/invalid_input/unknown`
분류를 저장한다. 오류 분류는 진단 metadata이지 재시도나 권한 결정 신호가 아니다.

기존 v1 기록은 검증해서 집계하며, 원래 파일은 수정하거나 삭제하지 않는다.
기존 파일에 이미 들어간 민감값은 별도 검토 대상이다. 식별자 자체도 익명화하지 않는다.
잘못된 수치·중첩 값·파생 counter는 malformed로 집계한다. 새 입력이 잘못됐거나
한 record가 파일 상한보다 크면 sink는 dropped counter를 올리고 false를 반환한다.
agent 실행은 metrics 실패 때문에 중단하지 않는다.

전체 파일 읽기·동시 writer·rotation 경쟁까지 해결한 것은 아니다. 원장의 세그먼트화나
비동기 writer는 실제 병목과 crash matrix를 확보한 다음 단위다.
[metrics 계약](metrics.md)을 함께 참조한다.

## 4. 나머지 지적의 현재 처리

| 지적 | 상태와 다음 수용 기준 |
| --- | --- |
| F04/F05, level/chunk barrier | 보류. 최종 인수 재계획·충돌 잠금·취소·결과 순서를 보존하는 replay와 실제 critical-path 측정이 선행 |
| F06, 표현 비용과 효용 | 보류. F07 이름만 수정했으며 선택 점수는 바꾸지 않음. 표현별 작은 exhaustive oracle과 문맥 손실 평가 필요 |
| F08, flat 관측의 존재 의미 | 현재 `evaluateCondition`에서 존재 양화를 확인. v1 의미를 조용히 최종 상태 의미로 바꾸지 않음. snapshot-bound adapter를 별도 설계해야 함 |
| F09의 원천 인증 | 부분 적용. strict grouping은 구현했지만 receipt/run에서 그룹을 인증·파생하는 adapter는 미구현 |
| F13/F14, 원장 전체 재검사·동기 대기 | 이번 미재현·미변경. append/lock 시간·fsync 비용을 측정한 뒤 보장 유지 여부로 판단 |
| F15, lane child cancellation | 이번 미재현·미변경. child 시작/종료·abort·permit 반환 통합 검사를 통과하기 전 기본 활성화하지 않음 |
| F16/F17, WPL timeout·실패 재발 | 이번 미재현·미변경. 상위 deadline과 실제 underlying 취소, 같은 failure signature 이력의 회귀 필요 |
| F18, 중복 settlement | 이번 미재현·미변경. delta counter를 바로 교체하지 않고 ID 기반 등록/종료와 모든 생산자 연결 검사 필요 |
| F19, 제공자 오류 의미 | 이전 작업에서 core model-contract 거부를 configuration으로 분리. 전체 제공자 typed-error 전환이나 정책 변경을 완료한 것은 아님 |
| F20의 전체 권한 집합 | mode/root 반례를 수정. 모든 도메인·프로파일·OS enforcement 조합의 보편적 안전성 증명은 아님 |

검토 문서의 18개 PR 제안을 모두 구현했다는 뜻이 아니다. 새 오케스트레이터·학습형
라우터·기본 다중 agent·새 DB를 추가하지 않았다. 설정·모델·WSL을 바꾸거나 유료 모델,
벤치마크, 배포를 실행하지도 않았다.

## 5. 검증 증거

- 번들 원본 재현 스크립트: Node 24에서 종료0, 원본의 잘못된 두 결과 확인.
  번들 Python 참조 알고리즘은 실행하거나 제품 코드로 복사하지 않았다.
- 기존 범위 baseline 58개 통과 후, gate/sandbox 7개·metrics 17개·claim 4개 요구를
  RED로 재현했다. 독립성 정책 2개, JSON 오류 노출 1개, record 크기 1개도 별도 RED 후 수정했다.
- claim exhaustive oracle는 독립 Boolean evaluator로 60개 작은 공유 DAG를 비교했다.
  처음 oracle에서 빠졌던 미참조 required root를 바로잡은 뒤 유효한 RED를 다시 확인했다.
- bounded fallback, graph/child permutation, 부모 자체 반례, strict/legacy witness 정책,
  v1/v2 metrics, 실제 파일 sink, 실제 gate receipt와 sandbox spawn 경로를 표적 검사했다.
- 성능·해결률 향상, 전체 저장소 무결성, 운영 사고 부재를 이 검사로 주장하지 않는다.

```bash
# packages/protocol
node ../../node_modules/vitest/dist/cli.js --run test/claim-cut-review.test.ts test/claims.test.ts --maxWorkers=1 --no-file-parallelism
# packages/coding-agent
node ../../node_modules/vitest/dist/cli.js --run test/turn-metrics-boundary.test.ts test/turn-metrics.test.ts test/review-policy-boundaries.test.ts test/evidence-system.test.ts test/evidence-gate-binding.test.ts test/sandbox-default-policy.test.ts test/context-budget-v2-knapsack-order.test.ts --maxWorkers=1 --no-file-parallelism
# root
node_modules/.bin/tsgo --noEmit --pretty false
npm run check
```

### 2026-09-09 검사 상태 (당시 기록)

| 검사 | 결과 |
| --- | --- |
| Protocol 회귀 | 24개 통과 |
| Metrics·gate·sandbox·문맥 정렬 회귀 | 102개 통과 |
| 기존 서식 3건 정리 후 직접 회귀 | 추가 40개 통과. 반복한 11개는 중복 합산하지 않음 |
| 합계 | 166개, 공급자 없는 표적 검사. 내부 생성 graph 수는 별도 테스트 수로 세지 않음 |
| 전체 `tsgo --noEmit --pretty false` | 종료0 |
| 주 LSP | 17파일 요청, 15파일 clean, 2파일 확인 불가, 보고된 오류0. compiler 통과와 구분 |
| import-cycle·private-home·diff 검사 | 종료0 |
| `npm run check` | Biome·pinned deps·vendoring·TS imports·dependency tree·import cycles 단계 통과 후 기존 module-size 초과6건에서 종료1 |
| 문서 링크 검사 | 이전 작업의 미추적 model-contract/model-catalog-refresh 문서 링크5건으로 종료1 |

모듈 크기 차단은 기존 `harness/reverse-skill.ts`, AI `types.ts`, coding-agent의
`compaction.ts`, `model-registry.ts`, `provider-usage.ts`, `interactive-mode.ts`다.
이번 단위가 추가했던 evidence-system 크기 증가와 sandbox 타입 순환은 책임·타입 분리로
해소했으며 baseline을 늘리지 않았다. 전체 저장소 gate 통과나 배포 가능 상태를 주장하지 않는다.

## 6. 커밋 체크포인트

| 단위 | 파일 범위 | 제안 메시지 |
| --- | --- | --- |
| Metrics 개인정보·입력 경계 | `core/turn-metrics*.ts`, 직접 metrics 테스트, metrics 문서 | `fix: metrics 원문 누출 차단과 v2 입력 검증` |
| 검증·sandbox 구성 | `guardrails/evidence-system.ts`, `merge-gate-result.ts`, `core/sandbox/policy*.ts`, 직접 경계 검사 | `fix: 빈 gate와 sandbox 정책 확대를 거부` |
| Claim 설명·strict witness | protocol claims/index와 직접 회귀, protocol README | `fix: 공유 DAG repair 설명과 증인 독립성 계약 보정` |
| 명칭 정정 | `context-budget-v2-scoring.ts`의 상수·지역 변수 이름 | `refactor: 최신성 계수의 time-constant 의미 명시` |
| 기존 서식 정리 | AI `utils/oauth/meta.ts`의 named import 순서, `test/mcp/tools.test.ts`와 `test/session-termination.test.ts`의 줄바꿈 | `style: 통합 검사를 막던 기존 서식 오류 정리` |

9월9일에는 구현과 직접 테스트·문서를 위 단위로 제안하고 stage/commit하지 않았다.
9월10일 승인 후 수행한 실제 커밋·검사와 배포 보류 조건은 이 문서 위쪽 표에 기록한다.
