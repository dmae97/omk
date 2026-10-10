# DAG 실행과 증거를 함께 설명하기

OMK의 검증 가능한 강점은 에이전트 수나 합의 문구가 아니라, 실행 의존성, 실제 종료,
고정 candidate와 승인된 검사 결과를 따로 기록하는 경계다. `omk run explain`은 이 경계를
한 JSON으로 보여주는 읽기 전용 조회다. 일반 chat을 verified run으로 승격하지 않는다.

```bash
omk run explain dag-1 --state-dir /private/operator-state/verified-runs --json
```

SDK에서는 `RunCoordinator.explain(runId)`를 호출한다. 결과의 주요 필드는 다음과 같다.

| 필드 | 의미 |
| --- | --- |
| `runId`, `revision`, `generation` | 설명이 참조한 원장 상태 |
| `executionRequested: false` | writer, verifier, 재시도를 실행하지 않은 조회 |
| `binding.journalDigest` | 모든 run projection에 사용한 한 원장 snapshot의 digest |
| `binding.candidateDigest`, `receiptDigest`, `environmentDigest` | 고정한 candidate와 검사/환경 바인딩 |
| `tasks[].dependsOn` | 계약에서 선언한 직접 artifact 의존성 |
| `tasks[].blockedBy` | 아직 현재 세대에서 성공하지 않은 전이 조상과 관측된 실패/미종료 이유 |
| `tasks[].ready` | 현재 projection의 의존성 readiness, 실행 권한이나 성공 예측 아님 |
| `proof.claimEvaluations` | 승인된 검사에 대한 satisfied, violated, missing, incomplete_scope 판정 |
| `proof.blockingCut` | 막힌 claim의 bounded 설명, 새 수리/승인 권한 아님 |
| `status.cleanSuccess` | 기존 검증/소유권 상태에서 도출한 완료 상태 |

조회는 원장, issuer key, candidate blob이나 receipt를 바꾸지 않는다. Native receipt가
손상되거나 HMAC/실행 바인딩이 맞지 않으면 기존 증거 읽기가 실패하고 완료를 표시하지 않는다.
CLI는 기존 status와 동일하게 clean success와 verified closure를 모두 만족해야 exit 0이다.
미완료/실패는 1, 잘못된 인수는 2다. `--execute`나 모델/승인 필드는 이 조회가 받지 않는다.

## 무엇을 구분하는가

`A → C`와 독립적인 B에서는 기존 eager frontier가 A 종료 후 C를 시작할 수 있다. B를 기다리는
wave barrier가 아니다. 하지만 C의 task checkpoint도 최종 candidate 검증 receipt는 아니다.
A 또는 전이 조상이 실패/미종료/다른 세대이면 이를 설명에 남긴다. 성공 checkpoint를 모았다는
이유만으로 final stdout 검증이 violated인 결과를 verified로 바꾸지 않는다.

승인된 각 check에는 하나의 고유 execution ID와 claim ID가 필요하다. Parser는 비어 있거나
중복된 identity를 거부한다. 완료 판정은 계약의 전체 check 집합을 요구한다. 추가/외래/누락
check나 동일 실행의 복제는 독립 검증으로 세지 않는다. Execution ID의 구분은 통계적인 모델
오류 독립성 보장이 아니다. 같은 모델/같은 오라클을 쓴 두 검사에는 여전히 상관된 오류가 있다.

완료용 boolean과 설명용 reducer는 같은 identity 검사를 사용한다. Reducer에 중복 실행/claim,
비어 있는 실행 ID나 계약 밖 check가 전달되면 `integrity` 오류로 거부하고, boolean은 false다.
아직 관측하지 않은 check는 missing/inconclusive로 설명하므로 조회가 없는 증거를 만들지 않는다.
기존 parser, native receipt와 HMAC 검사는 이 공통 reducer에 앞서 그대로 적용된다.

## 최신 연구와 적용 범위

다음은 2026-10-09에 읽은 원문에 대한 대조이며, 논문의 결과를 OMK의 성능으로 옮기지 않는다.

| 원문 | 확인한 메커니즘 | 이 구현에서 쓰는 점과 쓰지 않는 점 |
| --- | --- | --- |
| [MAScope, arXiv:2610.10126v1](https://arxiv.org/html/2610.10126v1), 2026-10-07 | message evidence로 topology를 복원하고 topology-conditioned failure 진단 | OMK는 이미 선언한 정적 DAG와 원장의 관측 사실을 쓴다. LLM topology 추론/학습 failure prior와 비용 실험을 재현하지 않았다. |
| [DyTopo, arXiv:2602.06039v1](https://arxiv.org/html/2602.06039v1), §3.2–3.3 | 매 round의 query/key embedding과 sparse private-message routing | 통신 그래프를 execution/artifact/authority DAG와 구분한다. semantic similarity로 승인된 의존성이나 쓰기 범위를 바꾸지 않는다. |
| [EDGE, arXiv:2609.01360v1](https://arxiv.org/html/2609.01360v1), 방법/Limitations | 관측 error dependency와 counterfactual rollout으로 검증한 subset을 구분 | `blockedBy`는 선언된 의존성과 상태 설명이다. causal effect나 원인 증명이 아니다. 논문도 corpus-level graph와 LLM judgment noise 한계를 명시한다. |
| [Kostka와 Chudziak, UAI 2026](https://proceedings.mlr.press/v337/kostka26a.html) | correlated consensus, deviation penalty와 Learn-Then-Test calibration | 복제 실행 증거를 거부한다. Calibration 데이터/통계적 risk bound/라이브 ensemble은 구현하지 않았다. |

동적 topology 최적화나 앙상블을 채택하려면 같은 입력/예산에서 독립 holdout과 verifier 품질,
전체 실패/과금/지연을 측정해야 한다. 논문을 인용한 것, routing 권고, hash와 local test만으로
SOTA, 모델 품질 개선, 비용 절감이나 출시 승인을 주장하지 않는다.

## 범퍼카 검증 경계

반례 스트레스 검사는 명시한 불변식을 대상으로 한다. Evidence identity 충돌, 외래/누락 check,
contradictory exit/failure, stale generation과 DAG 조상 실패를 주입한다. 고정 seed의 생성 검사는
순서 변경 불변성과 독립적인 ancestor 탐색 oracle을 대조한다. 실제 공개 SDK/CLI 경로에서는
실패한 branch의 join 차단, task success와 proof 분리, 원장 바이트 무변경, 손상 receipt 거부를
검사한다. 기존 eager/cancellation/retry tests는 별도로 회귀 검사한다.

이 검사는 해당 계약의 탐지력이며 일반적인 의미적 correctness proof가 아니다. Linux sandbox,
작업/검사 budget과 승인 경계는 [Verified Run](verified-run.md)과 같다. 지원되지 않는 sandbox를
검증 성공으로 바꾸거나 테스트를 위해 격리를 끄지 않는다. 설치된 엔진과 TUI/RPC는 소스 수정으로
자동 갱신되지 않는다. Live provider ensemble, learned topology, Windows와 비용/정확도 실측은
이 구현의 미검증 범위다.
