# OMK 하네스 고도화 로드맵

## 0. 현재 작업 범위 — 2026-09-13

검토 기준은 `ca75f4e5cc`와 남아 있던 TB 선택기·감사기 변경이다. 공개 패키지의 로컬
버전은 모두 **0.98.5**이며, 버전 변경·실제 배포는 이번 준비 작업과 구분한다.

| 항목 | 현재 상태와 근거 |
| --- | --- |
| TB mini-suite | `selectionVersion: 2`. 결측·비유한·음수 예상 시간은 null, 알려진 예상 시간 뒤에 정렬한다. 1~2개 선택은 난이도 가중치 순으로 배정한다. [선정 계약](packages/coding-agent/docs/metrics.md#capability-baseline) |
| TB 결과 감사 | `omk-tb21-audit-report-2`. 시작·종료 시각과 나노초 순서를 확인하며 미완료 자료를 집계하지 않는다. 실제 프로세스 종료나 과금 정합성의 증명은 아니다. [감사 계약](packages/coding-agent/docs/tb21-audit.md) |
| 모델 계약 | 과거 §12의 모듈 부재 기록은 현행 상태가 아니다. 논리적 요청 계약과 Chat Completions 전송 경계가 존재한다. 전체 provider의 출력·청구 상한 보장은 여전히 별도다. [현재 경계](packages/coding-agent/docs/model-contract.md) |
| Verified Run | `decee7f157`에서 최대 2개 작업의 eager frontier를 커밋했다. 계획 변경·실모델 writer·적용 승인 등을 완료한 것으로 보지 않는다. [구현 상태](packages/coding-agent/docs/verified-run.md) |
| 배포 준비 | 로컬 검사의 명령·결과, 패키징 범위와 남은 승인 사항은 이 문서 §16에서 관리한다. |

하네스 영향 분류는 **preserve**다. 유지할 지표는 정확한 선택 개수와 중복 없음,
고정 입력에서의 결정성, 결측 비용·미완료 trial의 무음 수락 0건, 원본 증거 쓰기 0건이다.
모델 호출·Harbor 실행·데이터셋 다운로드 없이 합성 fixture로 검증한다. 테스트 수는
해결률·속도·경쟁 우위의 근거가 아니다.

**아래 §1~§15와 기존 서두는 2026-09-07~10의 관측·설계 이력이다.** 당시의 `현재`,
`미커밋`, `BLOCKED`, 버전·검사 수치는 그 시점에만 해당한다. 지금의 배포 여부나
전체 구현 상태로 읽지 않는다. 과거 실험 수치와 원본 기록은 재측정하거나 덮어쓰지 않았다.

### 이전 서두 — 2026-09-07~10 기록

기존 Pro 관측 기준일: **2026-09-07**. Flash 중단 실행 분석·구현 갱신: **2026-09-09**.
대상: **Terminal-Bench 2.1의 OMK 대 Terminus-2 비교**와 이를 재현하는 실행 경로.

현재 상태: Flash 43/48시행을 분석해 모델 선택·입력 표현·종료 판정의 책임을 다시 나누고
이미지 계약 충돌, 잘못된 종료 분류, JSON 실패 종료 상태를 수정했다. 전체 원장·공유 deadline·
MCP 자원 입장 제어는 후속 설계다. **벤치마크 경계 재설계와 검사는 §15**에 기록한다.
후속 [재현 번들 대응](packages/coding-agent/docs/review-bundle-followup.md)에서 metrics 개인정보,
빈 gate·sandbox 정책, 공유 DAG 수리 설명과 선택형 증인 독립성 검사를 개선했다.
§1~§15의 과거 계획·수치는 해당 모델·실행 조건에서의 기록으로 구분한다.

**권고: 모델 계약과 측정 신뢰성을 먼저 고정하고, 요청 왕복·마감시간·검증 비용을 줄여. 다중 에이전트와 학습형 라우터 확대는 그다음이야.**

이 문서는 현재 관측, 기존 작업 트리 구현, 이번 변경, 앞으로의 설계를 구분해. 제안된 단계 전체를 구현 완료하거나 성능 향상을 검증했다는 뜻이 아니야. 2026-09-09 분석에서는 유료 모델 호출, 벤치마크 재실행, 전체 빌드, Git 커밋·푸시·공개 제출을 하지 않았어.

**2026-09-10 후속:** 요청 범위를 재검증하고 9개 구현 커밋을 만들었으며 `npm run build`와
`npm run check`가 통과했어. DeepSeek V4.1 Flash의 기존 공급자 4곳도 확인·반영했어.
현재 배포 최신은 0.98.3이지만 로컬 이력이 분기돼 있어, 이력 통합·push 범위를 확인한 뒤
0.98.4로 올려야 해. 버전 변경·배포·벤치마크는 아직 하지 않았고,
[최신 재검증 기록](packages/coding-agent/docs/review-bundle-followup.md)을 기준으로 봐줘.

## 1. 범위와 증거 기준

`Terminal-Bench 2.1`은 평가 데이터셋이고, `Terminus-2`는 Harbor의 기준 agent(에이전트)야. 둘을 합쳐 별도 벤치마크 이름처럼 쓰지 않아.[^S1][^S2]

공식 목록상 TB 2.1 공개일은 2026-05-06, TB 4.0 공개일은 2026-08-28이야. 따라서 이 문서는 TB 2.1을 **고정 회귀 평가 집합**으로 다뤄. 현재 버전 공개 평가와 과거 버전 내부 비교를 섞지 않아.[^S3]

| 증거 | 이번 확인 범위 | 한계 |
| --- | --- | --- |
| E01: 로컬 `benchmark-paired-summary.json` | 24개 task(작업)의 성공률·요청·토큰·통계 요약을 읽음 | 요약 자체로 실행 무결성을 증명하지 못함 |
| E02: 두 arm(비교군)의 개별 `result.json`과 기존 집계 함수 | task 집합 일치, 쌍대 성공표, 비용·요청·예외를 재집계 | 기존 집계 함수의 결측 처리와 시간창 귀속 한계를 유지함 |
| E03: 로컬 `omk_gateway_agent.py` | OMK 실행 인수, 계측 비활성화, 격리 구조 확인 | 설치 바이너리와 현재 소스의 동일성을 검증하지 않음 |
| E04: 로컬 `policy.uncapped.json` | 토큰 상한·안전 한도·단가·캐시 계수 확인 | 현재 요금표나 실제 청구서가 아님 |
| E05: 현재 소스와 `specs/022-tb21-harness-hardening/spec.md` | 계약·deadline(마감시간)·정체 감지·DAG 계측의 구현 경계 확인 | 다른 작업의 커밋·미커밋 변경이며 이번 성능 측정의 실행 버전과 구분 |
| E06: `scripts/test/tb-mini-suite.test.mjs` | 실제 CLI를 실행하는 회귀 검사 | task 선택 검증이지 모델 해결 능력 검증이 아님 |

로컬 증거의 기준 디렉터리는 `.omk/runs/tb21-deepseek-modelstudio/`야. A 실행은 `jobs-armA-uncapped/2026-09-07__10-40-05`, B 실행은 `jobs-armB-terminus/2026-09-07__10-54-26`에서 확인했어. 원시 자료는 비공개 작업 산출물이며 새 clone(복제본)에 포함되지 않아. 이 문서는 집계와 공개 코드 경로만 설명하고, 원문 프롬프트·세션·키·사용자 환경을 복제하지 않아.

소스 확인 시작점은 `60f520f0c103888ef27438ac5058bdfc78b3e409`, 직렬 검증을 재개한 시점의 HEAD는 `e526b690067287ea79c6acf1c86d07a89c4c3f24`였어. 그 사이 다른 작업의 일부 구현이 커밋됐고 미커밋 변경도 남아 있어서, 어느 SHA도 이번에 읽은 작업 트리 전체를 단독으로 재현하지 못해. 실험 보고서의 OMK 버전 문자열 `0.98.1`도 실행 바이너리의 암호학적 식별자를 대신하지 못해.

## 2. 현재 성적: 우열 확정이 아니라 효율 개선의 단서

### 2.1 관측 결과

아래 성공·요청·비용은 E01과 E02를 대조했어. 토큰·캐시 비율과 bootstrap(부트스트랩) 구간은 E01의 값이야. 비용은 **캐시 할인을 적용하지 않은 gateway ledger(게이트웨이 요청 원장) 추정액**이며 실제 청구액이 아니야.

| 지표 | A: OMK | B: Terminus-2 | 해석 |
| --- | ---: | ---: | --- |
| 해결 task | 13 / 24 | 14 / 24 | 한 task 차이 |
| 해결률 | 54.17% | 58.33% | A − B = −4.17pp |
| 요청 수 | 855 | 526 | A가 62.55% 많음 |
| 입력 토큰 | 17,992,185 | 13,207,562 | A가 36.23% 많음 |
| 출력 토큰 | 345,652 | 404,130 | 총량만으로 추론 품질을 판단하지 않음 |
| 입력 캐시 비율 | 93.49% | 92.32% | 실제 청구 할인과 구분 |
| 원장 추정 비용 | $25.118466 | $19.034337 | A가 31.96% 높음 |
| 전체 비용 / 해결 수 | $1.932190 | $1.359596 | A가 42.12% 높음 |
| 기록된 예외 | 3 | 3 | 종류·근본 원인은 별도 분류 |

`pp`는 percentage points(퍼센트포인트)야. −4.17pp를 상대 변화율 −4.17%로 쓰지 않아.

실험 보고서에는 `deepseek-v4-pro-0813`, thinking(추론 모드) 비활성, task당 900초, 동시성 1, task당 각 arm 1회, 데이터셋 revision(개정 식별자) `5c8eadf1f`, seed(난수 초기값) `20260906`이 기록돼 있어. 이 조건 전체를 새로 wire audit(실제 전송 감사)한 것은 아니야. 다음 기준선에서는 전체 SHA, 실제 provider(공급자)·모델 식별자, 직렬화된 옵션, 실행 순서까지 고정해야 해.

### 2.2 쌍대 통계와 주장 범위

| | B 해결 | B 미해결 |
| --- | ---: | ---: |
| A 해결 | 11 | 2 |
| A 미해결 | 3 | 8 |

작업별 결과를 $Y_{i,A},Y_{i,B}\in\{0,1\}$, 차이를 $D_i=Y_{i,A}-Y_{i,B}$로 두면:

$$
\widehat\Delta=\frac{1}{N}\sum_{i=1}^{N}D_i
=\frac{n_{10}-n_{01}}{N}
=\frac{2-3}{24}=-0.041667.
$$

불일치 쌍이 $m=n_{10}+n_{01}=5$개인 양측 exact McNemar test(정확 맥니마 검정)는 다음과 같아.[^S4]

$$
X\mid m,H_0\sim\operatorname{Binomial}(m,1/2),\qquad
p=\min\left(1,2\sum_{k=0}^{\min(n_{10},n_{01})}\binom{m}{k}2^{-m}\right)=1.
$$

유의수준 $\alpha=0.05$에서 차이를 검출하지 못했어. **동등성·비열등성·OMK의 경쟁 우위를 입증한 결과가 아니야.** E01의 쌍대 백분위 bootstrap 95% 구간은 $[-20.83,+12.50]$pp로 넓어. 이번 문서 작업에서는 bootstrap 코드를 새 구현해 독립 검증하지 않았어.

현재 불일치 수 5에 조건화하면 가장 극단적인 5:0에서도 $p_{\min}=2/2^5=0.0625$야. 이는 현재 불일치 수로 검출이 어렵다는 뜻이지 모든 24-task 설계가 반드시 검출 불가능하다는 뜻은 아니야.

전체 89개를 한 번씩 실행해도 실행의 확률적 변동은 남아. 필요 표본 수를 단정하지 말고, 목표 효과·불일치율·task 간 이질성·반복 내 상관을 반영한 사전 검정력 분석을 해. 현재 표본으로 좁은 동등성 구간이나 공식 순위를 주장하지 않아.

### 2.3 기존 서술에서 바로잡은 부분

E02를 재집계하면 기존 로컬 보고서의 실패 비용 A $12.31, B $12.68과 일치하지 않아.

| 비용 분해 | A | B | A − B |
| --- | ---: | ---: | ---: |
| 각 arm의 미해결 task 비용 | $11.678094 | $11.544687 | +$0.133407 |
| 각 arm의 해결 task 비용 | $13.440372 | $7.489650 | +$5.950722 |
| 전체 | $25.118466 | $19.034337 | +$6.084129 |
| 둘 다 해결한 동일한 11개 task | $9.990120 | $6.349178 | +$3.640942 |

$$
\Delta C_{\mathrm{total}}=\Delta C_{\mathrm{unsolved}}+\Delta C_{\mathrm{solved}}
=0.133407+5.950722=6.084129.
$$

따라서 추가 비용 대부분을 실패 task의 오래된 탐색 탓으로 설명할 수 없어. 같은 11개 성공 task에서도 A의 합산 비용이 약 57.35% 높다는 관측이 있어. 다만 성공 task만 조건화한 비교는 전체 실행 효율의 무편향 추정이 아니야. 전체 쌍을 주 분석으로 유지하고 이 부분집합은 원인 탐색에만 사용해.

예외는 A에서 `AgentTimeoutError` 2건과 `NonZeroAgentExitCodeError` 1건, B에서 `AgentTimeoutError` 2건과 `RateLimitError` 1건으로 집계됐어. B의 마지막 예외를 문맥 초과로 바로 확정하지 않아. 상위 예외 분류와 실제 upstream(상위 공급자) 원인은 다를 수 있으므로 연결된 원인과 응답 코드를 별도 확인해야 해.

### 2.4 데이터 감사의 남은 위험

기존 `paired_analysis.py`는 최신 job(실행 묶음)을 자동 선택하고 task 이름을 사전 키로 써. 반복 실행을 넣으면 중복 task가 덮어써질 수 있어. `None` 비용을 0으로 합산하는 경로도 있어. 원장의 총액과 요약이 맞는다는 사실만으로 결측이 없다고 증명할 수 없어.

B의 요청은 공유 원장을 trial(개별 시행) 실행 시간창의 앞뒤 5초까지 넓혀 첫 일치 task에 귀속해. 실제 겹침·미귀속·중복 귀속 수는 이번에 독립 감사하지 않았어. 따라서 task별 B 비용은 이 귀속 방법에 조건부인 값이야. 합계를 재현한 검사와 정확한 task 귀속 검사를 분리해야 해.

## 3. 요청 왕복과 비용의 원인 가설

요청당 평균 입력은 A 약 21,043토큰, B 약 25,109토큰이야. A의 요청당 문맥은 오히려 약 16.19% 작아.

$$
\frac{T_{\mathrm{in},A}}{T_{\mathrm{in},B}}
=\frac{R_A}{R_B}\frac{\overline T_{\mathrm{in},A}}{\overline T_{\mathrm{in},B}}
\approx1.6255\times0.8381=1.3623.
$$

우선 조사 대상은 **과도한 왕복의 구성**이야. 짧은 명령을 매번 별도 요청으로 보냈는지, 같은 실패를 반복했는지, 출력 관측에 추가 요청이 들었는지, 요약·재시도·모델 전환이 섞였는지를 구분해. 요청 수만 최소화하면 검증을 생략하는 나쁜 최적화가 될 수 있어.

비용은 입력·캐시·출력을 분리해 계산해. $I_r$는 캐시를 포함한 입력, $H_r$는 그중 캐시 적중, $O_r$는 출력, $p_u,p_h,p_o$는 백만 토큰당 단가야.

$$
C=\frac{1}{10^6}\sum_r\left[p_u(I_r-H_r)+p_hH_r+p_oO_r\right].
$$

E04의 캐시 계수는 1이므로 현재 비용은 $p_h=p_u$인 추정이야. 이 숫자를 실제 결제 비용이나 현재 공급자 가격으로 표현하지 않아. 가격표 버전과 청구 대조가 없는 값에는 `estimated`(추정) 표시를 유지해.

시간도 총합만 보지 않아. 순차 실행에서는 다음 분해가 출발점이고, 병렬 실행에서는 겹치는 구간을 중복 가산하지 않고 critical path(전체 완료를 결정하는 의존 경로)를 계산해야 해.

$$
T_{\mathrm{wall}}\approx T_{\mathrm{queue}}+T_{\mathrm{model}}
+T_{\mathrm{tool}}+T_{\mathrm{verify}}+T_{\mathrm{recovery}}+T_{\mathrm{idle}}.
$$

## 4. 지금 존재하는 것과 아직 연결되지 않은 것

| 영역 | 확인된 현재 상태 | 다음 단계 |
| --- | --- | --- |
| 평가 task 선택 | `scripts/tb-mini-suite.mjs`의 개수 누락과 입력 경계를 이번에 수정 | 데이터셋·선정 결과 해시, 대표성 한계 명시 |
| 모델 계약 | `packages/agent/src/run-model-contract.ts`와 agent loop의 선택적 검사 경로가 기존 작업 트리에 있음 | 실제 CLI·SDK·benchmark adapter 주입과 모든 전송 경계 검증 |
| legacy vision route(기존 이미지 모델 전환) | 계약 미설정 경로는 기존 동작을 유지함 | 단일 모델 평가에서 계약 누락을 시작 전 차단 |
| 이미지 text projection(텍스트 메타데이터 투영) | `packages/coding-agent/src/core/tools/read.ts`의 관련 변경과 테스트가 기존 작업 트리에 있음 | 이미지 미지원 입력을 안전하게 처리하는 실제 adapter 실행 확인 |
| 요청 사건 | `provider_request` 및 관련 거부 사건의 코드 경로가 존재함 | 영속 원장·요청 상관 ID·실제 청구 사건과의 대조 |
| 마감시간 | `packages/agent/src/deadline-policy.ts`에 순수 정책 함수가 있음 | loop·도구 timeout(시간 초과)·검증·정리까지 연결 |
| 정체 감지 | `packages/agent/src/stagnation-tracker.ts`에 순수 추적 모듈이 있음 | 실행 상태·신규 증거·허용된 복구 경로와 연결 |
| DAG 대기 측정 | `packages/agent/src/dag-barrier-waste.ts`에 계측 함수가 있음 | 실제 trace(실행 추적)부터 수집; executor(실행기) 교체는 보류 |
| 이번 실험 계측 | adapter가 `OMK_TURN_METRICS=0`으로 실행함 | benchmark 전용 허용 목록 기반 계측 켜기 |
| 스킬·확장 | adapter가 `--no-skills --no-extensions --no-prompt-templates`를 사용함 | 스킬 수 확대를 이번 성적의 원인·개선 근거로 삼지 않기 |

위 런타임 모듈은 이번 변경 파일이 아니야. 소스가 존재하는 것, 호출 경로에 연결된 것, 실험에서 활성화된 것, 실제로 이득이 측정된 것을 각각 별도 상태로 관리해.

## 5. 이번에 적용한 개선: 평가 집합의 개수 계약

기존 선택기는 89개 전체를 요청해도 80개만 반환했어. easy(쉬움) 할당량이 실제 보유 개수보다 클 때 다른 task로 보충하지 않았기 때문이야. 작은 단일 난이도 집합에서도 같은 문제가 재현됐어.

변경 파일은 `scripts/tb-mini-suite.mjs`와 `scripts/test/tb-mini-suite.test.mjs`야. 기존 난이도별 우선 선택을 유지하고, 부족분만 미선정 후보에서 같은 정렬 규칙으로 보충해. 새 의존성이나 별도 실행 프레임워크는 추가하지 않았어.

$$
1\le k\le |\mathcal T|\Longrightarrow
|S(\mathcal T,k,s)|=k,\qquad
|\operatorname{unique}(S)|=k.
$$

추가 계약은 다음과 같아.

| 조건 | 결과 |
| --- | --- |
| seed가 0부터 $2^{32}-1$까지의 정수 | 정상 처리 |
| 소수·NaN·무한대·음수·범위 밖 seed | 종료 코드 2 |
| 양의 safe integer(정확히 표현 가능한 안전한 정수)가 아닌 size | 종료 코드 2 |
| 필수 인수 누락 또는 다음 옵션을 값으로 오인 | 종료 코드 2, 진단 출력 |
| 전체 보유량보다 큰 요청 | 조용한 부분 선정 대신 종료 코드 2 |
| 빈 task 디렉터리·존재하지 않는 디렉터리·파일 경로 | 종료 코드 1 |
| 기본 15개 선정 | 기존 구성·JSON 결과 유지 |

TDD(테스트 우선 개발) 검사는 기존 코드에서 **24개 중 16개 실패**, 수정 뒤 **24개 전부 통과**했어. 실제 CLI를 임시 task 디렉터리에 실행하므로 내부 구현을 모방한 mock(가짜 응답) 검사는 아니야.

기본 JSON의 수정 전후 SHA-256은 모두 `5750f8cd8039611c3c41b4ce72646723d79eaf560c2fde39eede2abd0b9b6c99`였어. 이는 같은 로컬 경로에서의 호환성 검사야. JSON에 로컬 디렉터리가 포함되므로 이 해시를 이식 가능한 데이터셋 식별자로 재사용하지 않아.

선정 정책은 여전히 쉬운 task를 과대표집하고 expert time estimate(전문가 예상 소요시간)가 짧은 후보를 우선해. 따라서 mini-suite(소규모 평가 집합)는 빠른 회귀 신호이지 전체 89개 모집단의 대표 점수가 아니야. metadata(메타데이터) 파서는 제한된 기존 필드 추출 방식이며, 완전한 TOML 검증이나 언어권 간 정렬 동일성은 이번 수정 범위가 아니야.

## 6. 단계별 실행 계획

다음 수용 기준의 숫자는 **설계 목표**야. 이미 측정된 개선율이나 제품 보장은 아니야. 일정 날짜보다 선행 검증 통과를 기준으로 진행해.

| 단계 | 우선순위 | 선행 조건 | 독립 검토 단위 | 완료 기준 |
| --- | --- | --- | --- | --- |
| R0 | P0 | 현재 자료 읽기 | 선택기와 직접 테스트·문서 | 개수 계약·입력 경계·기본 선정 보존 |
| R1 | P0 | R0 | 평가 adapter와 실행 manifest(불변 실행 명세) | 임의 모델 전환·중복 trial·누락 결과를 시작 또는 집계 시 차단 |
| R2 | P0 | R1 계약 정의 | 최종 전송 경계와 CLI·SDK 주입 | 모든 실제 provider 요청이 계약에 귀속 |
| R3 | P1 | R1·R2 | 요청 원장과 집계기 | 비용·토큰·지연·거부·재시도를 요청별로 정합성 검사 |
| R4 | P1 | R3 시간 분해 | 마감시간·정체·검증 제어 | 제한시간 안의 검증된 결과 보존, 무의미한 반복 감소 |
| R5 | P1 | R3 병목 관측 | terminal(터미널) 묶음 실행·관측 경로 | 권한·취소·명령별 상태를 유지하면서 필요한 왕복 감소 |
| R6 | P1/P2 | R3 문맥 계측 | 전송 문맥 예산·캐시 정책 | 증거 손실 없이 최종 요청 상한과 비용 개선 확인 |
| R7 | P2 | 실제 DAG 대기 측정 | 의존성 단위 실행 변경 | 충돌 안전성과 유효한 critical path 개선 입증 |
| R8 | P0 검증 gate(진입 조건) | 선택한 후보의 좁은 검사 통과 | 사전 고정 paired 평가와 보고 | 재현 가능하고 주장 범위가 맞는 비교 결과 |

의존 관계는 $R0\to R1\to R2\to R3\to\{R4,R5,R6\}\to R8$이야. R7은 병목 증거가 생겼을 때만 추가해. 이것은 문서의 읽기 전용 계획이며 AdaptOrch CLI·MCP 실행 결과가 아니야.

### R1. 재현 가능한 adapter와 기준선

현재 비공개 adapter를 그대로 공개 패키지에 복제하지 말고, 재사용에 필요한 최소 계약을 별도 정리해. 공개 task만 사용하는 synthetic fixture(합성 테스트 입력)로 먼저 검증해.

실행 명세에는 `run_id`, `trial_id`, `attempt_id`, 전체 dataset SHA, task·verifier(채점기) 해시, OMK·Harbor·adapter 버전과 산출물 해시, 컨테이너 image digest(이미지 내용 해시), 모델·provider·전송 옵션, 예산·시간 기준·동시성·실행 순서, 도구 권한·활성 기능을 기록해. 비밀 값 대신 승인된 비민감 식별자와 해시만 남겨.

집계기는 자동 최신 job 선택 대신 명시된 실행 명세를 입력받아. 다음 불변식을 위반하면 성능 표를 출력하지 말고 불완전 실행으로 종료해.

$$
\operatorname{keys}(A)=\operatorname{keys}(B)=\mathcal M,\qquad
\operatorname{count}(\mathrm{trial\_id},\mathrm{attempt\_id})=1.
$$

누락 결과를 성공으로 바꾸거나, 결측 비용을 0으로 대체하거나, 실패 trial을 제외한 분모를 쓰지 않아. 재시도는 새 `attempt_id`로 보존해. 미실행·실행 실패·채점 실패·미해결을 구분하되 최종 해결률의 사전 고정 분모를 유지해.

adapter의 출력 pipeline(파이프 연결)이 마지막 `tee` 성공으로 agent 실패를 가리는지 synthetic `exit 7` 검사로 확인해. 현재 읽은 실행 문자열만으로 전체 상위 shell(셸)의 실패 전파를 확정할 수 없으므로 이것은 확인할 위험이야. 취소 때 자식 프로세스·gateway가 종료되는지, 로그 수집 실패가 숨겨지지 않는지도 검사해.

**수용 기준:** manifest와 실제 trial 100% 대조, 중복·미귀속·결측을 명시적으로 처리, 원시 자료를 덮어쓰지 않는 읽기 전용 재집계, 재현 명령의 네트워크·비용 경계 문서화.

**중단 기준:** 비밀 노출, 채점 데이터 접근, 결과의 무음 누락, 실행 버전 불명. 이 상태에서 유료 전체 평가를 시작하지 않아.

### R2. 최종 전송 경계의 단일 모델 계약

기존 `run-model-contract.ts`를 재사용하고 `packages/agent/src/agent-loop.ts`, `packages/agent/src/harness/agent-harness.ts`, `packages/coding-agent/src/core/sdk.ts`와 실제 CLI 구성을 연결해. 계약 모듈을 하나 더 만드는 것보다 최종 wire request(실제 전송 요청)에 기존 계약을 적용하는 게 중요해.

요청 $r$에 대해 모델 $m_r$, provider $p_r$, 자격증명 출처 $a_r$, thinking 값 $h_r$, 출력 상한 $o_r$를 둬.

$$
\operatorname{Allowed}(r)=
[(p_r,m_r)\in\mathcal M_{\mathrm{allow}}]
\land[p_r\in\mathcal P_{\mathrm{allow}}]
\land[a_r\in\mathcal A_{\mathrm{allow}}]
\land[h_r=h_{\mathrm{run}}]
\land[0<o_r\le O_{\max}].
$$

여기서 일반 제품 모드의 허용 정책과 benchmark의 정확히 고정된 정책을 구분해. 기존 `thinking: boolean`은 허용 의미일 수 있어. 비교 실험은 실제 직렬화된 옵션까지 같아야 하므로 허용 여부 검사만으로 충분하지 않아.

주 대화, compaction(문맥 요약), vision fallback(이미지 처리용 대체 모델), 오류 복구, judge(모델 평가자), 위임 호출을 각각 조사해. 검사 후 옵션을 바꾸는 hook(실행 개입점), 모델별 기본 출력 상한, `undefined`·NaN·무한대·0의 정책도 고정해. 실제 자격증명 출처와 논리 provider 이름이 같다고 추정하지 않아.

이미지를 지원하지 않는 단일 모델에는 검증 가능한 파일 메타데이터나 허용된 로컬 추출 결과를 줘. 이미지 내용을 보지 않고 설명을 생성하지 않아. 임의의 다른 모델을 호출해 점수를 올리는 것은 단일 모델 하네스 개선이 아니야.

**수용 기준:** 금지 요청이 네트워크에 전송된 건수 0, 계약 누락 평가 시작 0, 자격증명 교차 전달 0. 공급자 없이 실행하는 전송 경계 테스트와 실제 adapter 합성 실행을 모두 통과해야 해.

**회귀 기준:** 일반 제품의 기존 기능을 무단 제거하지 않아. 실험용 명시적 설정에서 먼저 활성화해. 이미 다른 작업에서 추가된 계약·거부 사건을 중복 구현하지 않아.

### R3. 요청 원장과 실패 분류

기존 `provider_request` 사건을 출발점으로 사용하되, 사건이 발생했다는 사실과 실제 전송·응답·청구를 구분해. 기존 `core/turn-metrics.ts`와 [`metrics.md`](packages/coding-agent/docs/metrics.md)의 비밀 보호 원칙을 유지해.

| 필드 집합 | 최소 의미 |
| --- | --- |
| `run_id`, `trial_id`, `attempt_id`, `request_id`, `parent_request_id` | 원인과 귀속을 시간창 추정 없이 연결 |
| `request_kind` | 주 대화·요약·재시도·이미지·평가·위임·기타 구분 |
| `requested_model`, `effective_model`, `contract_digest` | 요청 의도와 실제 모델을 비교 |
| `state` | 거부·전송 시작·첫 토큰·완료·취소·상태 미확정 구분 |
| `queue_ms`, `model_ms`, `tool_ms`, `verify_ms` | 구간 정의와 단위 고정 |
| 입력·출력·캐시 토큰, `cost_status`, `price_version` | 관측 비용·추정 비용·미확인 비용 구분 |
| `exception_class`, `root_cause_class`, `retryable` | 포장 예외와 실제 원인, 재시도 가능성 구분 |

상태 미확정 요청을 실패한 미전송 요청으로 간주해 바로 재전송하면 중복 효과나 중복 과금이 생길 수 있어. 공급자 요청 ID 또는 안전한 멱등성 계약이 없으면 불확실성을 유지해.

원장 불변식은 `$\mathrm{requests}=\mathrm{denied}+\mathrm{sent}$`처럼 서로 다른 모집단을 섞지 말고 같은 시도 집합에 정의해. 예를 들어:

$$
N_{\mathrm{attempted}}=N_{\mathrm{denied\ before\ send}}+N_{\mathrm{send\ started}},
\qquad
N_{\mathrm{send\ started}}=N_{\mathrm{settled}}+N_{\mathrm{unsettled}}.
$$

**수용 기준:** 비용 귀속 누락·중복 0 또는 보고서를 명시적으로 불완전 상태로 표시. 메트릭 기록 실패는 주 작업을 무조건 실패시키지 않되 평가 신뢰성 gate는 통과시키지 않아. 프롬프트·tool argument(도구 인수)·응답 본문·환경 값은 기본 원장에 넣지 않아.

**중단 기준:** 모델 원장과 gateway 합계가 설명 불가능하게 불일치하거나 계측만으로 task timeout이 늘어남. 기능 추가보다 계측 오버헤드를 먼저 줄여.

### R4. 마감시간, 정체, 검증 완료 조건

기존 순수 정책을 실제 실행에 연결해. 작업 시작과 현재 시각은 monotonic clock(단조 시계)을 사용하고, 외부 wall clock(달력 시계) 변경으로 예산이 늘어나지 않게 해.

$$
B(t)=\max(0,T_{\max}-(t-t_0)),\qquad
B_{\mathrm{solve}}(t)=\max(0,B(t)-B_v-B_f-B_c).
$$

$B_v,B_f,B_c$는 각각 검증·최종 정리·프로세스 종료용 예산이야. 900초 실험에서 90·15·15초를 예약하는 것은 **검증할 시작 후보**이지 현재 기본값이나 최적값이 아니야. task 유형별 검증 시간 관측 후 조정해.

$$
\tau_{\mathrm{tool}}=\min(\tau_{\mathrm{requested}},B_{\mathrm{solve}}(t)).
$$

탐색 예산이 0이면 새 구현 작업을 시작하지 않고 검증·부분 결과 정리로 전환해. tool timeout을 줄이는 것만으로 전체 마감시간이 보장되지는 않아. queue·모델 streaming(점진 응답)·자식 프로세스·정리 작업까지 같은 취소 경계를 적용해야 해.

정체는 단순 같은 문자열 반복과 달라. `상태 fingerprint(상태 식별 해시), 실패 원인, 새 증거, 작업 결과`를 함께 봐. 같은 결정론적 실패에 입력·환경·가설 변화 없이 재시도하는 것은 금지해. 정상적인 긴 프로세스의 진행 관측을 실패 반복으로 오인하지 않도록 진행 신호를 분리해.

검증 증거는 명령·대상·종료 상태·코드 revision과 연결해. 검사 후 관련 파일이 바뀌면 이전 통과를 최종 성공으로 재사용하지 않아. timeout·취소·검증 불가를 해결로 변환하지 않아.

**수용 기준:** 가짜 시계로 0·경계·예산 초과·시계 이상을 검사하고, 실제 합성 프로세스로 취소 전파와 종료를 검사해. 새 증거 없이 반복된 같은 실패 수를 줄이면서 해결률·안전성 회귀 기준을 유지해.

**중단 기준:** 빠른 포기로 실패를 늘리거나 cleanup(정리)이 남은 검증 증거를 삭제함. 정책은 독립 설정으로 되돌릴 수 있어야 하고 되돌릴 때 모델 계약은 유지해.

### R5. 필요한 경우에만 터미널 실행 계층 개선

Terminus-2 문서는 interactive tmux session(대화형 tmux 세션)을 제어하는 도구 경로를 설명해.[^S2] 이를 그대로 복제해야 한다는 뜻은 아니야. OMK의 실제 사용 경로부터 추적해서 이미 가능한 기능과 불필요한 모델 왕복을 구분해.

대상은 `packages/coding-agent/src/core/session-bash-runtime.ts`와 실제 도구 등록·실행 경계야. 기존 검증 영수증·권한·sandbox(격리 실행)·출력 상한을 우회하는 별도 shell을 추가하지 않아.

독립적인 읽기 명령은 필요하면 한 번에 묶되 각각의 종료 상태와 출력 경계를 남겨. 선행 성공이 필요한 명령은 명시적 의존성을 둬. 계속 실행 중인 명령의 관측은 프로세스 ID와 cursor(읽기 위치)로 이어가고, 동일한 부작용 명령을 새로 실행하지 않아.

**수용 기준:** 명령별 실패 전파, interactive 입력, 취소, 자식 종료, 출력 절단 후 원본 위치, 오래된 관측 거부를 실제 CLI 수준에서 확인해. 같은 task의 왕복 수 감소가 검증 생략 때문이 아닌지도 확인해.

**중단 기준:** 권한 범위 확대, 결과 혼합, orphan process(관리되지 않는 잔존 프로세스), 조용한 실패, terminal 유지 비용 증가. 이 문제가 있으면 도구 묶음 수를 늘리지 않아.

### R6. 실제 전송 문맥과 캐시를 함께 최적화

문맥 계획기의 추정 토큰만 보고 성공을 선언하지 않아. system·developer 지침, 사용자 메시지, tool schema(도구 명세), 이미지 표현, 요약, provider별 framing(전송 포맷)을 합친 최종 요청이 대상이야.

$$
T_{\mathrm{instructions}}+T_{\mathrm{messages}}+T_{\mathrm{tools}}+
T_{\mathrm{multimodal}}+T_{\mathrm{framing}}+T_{\mathrm{output\ reserve}}
\le W_{\mathrm{effective}}.
$$

한도 추정 불확실성에 대한 여유를 두되 하위 권한 자료를 줄이려고 상위 지침·권한 경계·현재 목표를 제거하지 않아. 도구 호출·응답의 짝, 최신 실패, 수정한 파일, 미해결 가설과 검증 증거의 원본 위치를 보존해.

캐시 적중률 자체를 목적함수로 쓰지 않아. 문맥을 압축하며 안정적인 prefix(앞부분 문맥)를 매번 바꾸면 토큰은 줄어도 비용·지연이 늘 수 있어. 같은 가격·동일 task 조건에서 cache read(캐시 읽기)와 write(쓰기), 추가 요약 요청 비용까지 합산해.

**수용 기준:** 실제 전송 상한 검사, 다중 모달·긴 tool schema·취소·요약 실패·반복 overflow(문맥 초과) 회귀 검사. 원본 증거 보존과 복원 여부도 확인해. 비용 감소와 task 해결을 동시에 보고해.

**중단 기준:** 요약 때문에 실패 재현 조건이나 권한 지침이 사라짐, 문맥 회수에 더 많은 모델 왕복이 필요함, 성능 개선이 추가 모델 호출에 의존함.

### R7. DAG 실행 변경은 실제 대기 낭비가 있을 때만

현재 barrier(단계 전체 완료 대기) 측정 모듈을 먼저 사용해. task 집합에서 실행 가능한 도구가 실제로 대기했는지, 해당 대기가 전체 완료시간을 늘렸는지 확인하기 전에는 실행기를 교체하지 않아.

도구 $i$의 모든 선행 작업 종료시각 최대를 $r_i$, 실제 시작을 $s_i$로 두면:

$$
W_{\mathrm{ready}}=\sum_i\max(0,s_i-r_i).
$$

이 값에는 자원 한도·충돌 잠금·권한 대기 같은 필요한 시간이 섞일 수 있어. 여러 도구의 대기가 겹치기도 하므로 $W_{\mathrm{ready}}$를 그대로 절감 가능한 wall time으로 해석하지 않아.

**진입 기준 후보:** 측정 가능한 critical path 중 제거 가능한 barrier 대기가 10% 이상인 task 집합이 반복 관측될 때 설계를 시작해. 10%는 사전 합의할 우선순위 기준이지 현재 측정값이 아니야.

**수용 기준:** 읽기·쓰기 충돌, 외부 부작용, 실패 전파, 취소, 동시성 한도, 동일 자원 직렬화가 유지돼야 해. 안전성과 결과를 보존하면서 실제 완료시간 이득을 보여야 해.

**중단 기준:** 추정만 빠르고 실제 critical path는 같음, 도구 중복 실행, 순서 의존 오류 증가. 기존 barrier 실행 경로로 복귀하고 계측은 남겨.

## 7. 다음 실험의 통계·운영 계약

### 7.1 개발 집합과 확인 집합 분리

현재 24개 결과를 본 뒤 설계를 바꿨으므로 이 집합은 개발용이야. 같은 task에서 개선된 점수를 최종 일반화 근거로 사용하면 selection bias(선택 편향)가 생겨. 외부 채점 정답을 프롬프트·소스·스킬에 주입하거나 task 이름별 분기를 추가하지 않아.

순서는 공급자 없는 회귀 검사, 합성 adapter 검사, 승인된 작은 pilot(예비 실행), 사전 고정 확인 평가야. R4·R5·R6를 동시에 켜기보다 하나씩 ablation(개별 요소 제거·추가 비교)해 비용과 성공에 대한 기여를 분리해.

A0는 계약을 고정한 OMK 기준선, A1은 동일 조건의 후보 변경, B는 동일 모델·provider의 Terminus-2로 둬. 다른 모델이나 추가 vision/judge를 쓰는 구성은 별도 계층으로 보고하고 순수 하네스 효과에 합치지 않아.

### 7.2 고정해야 할 조건

모델 snapshot(고정 버전), endpoint(전송 주소), 실제 옵션, task·채점기·컨테이너 revision, 시간·비용 상한, 도구 권한, 네트워크, 동시성, hardware(하드웨어), 지역과 캐시 조건을 기록해. A의 task별 안전 한도와 B의 job별 한도처럼 다른 구조는 동일 조건이라고 축약하지 않아. 미발동 여부도 원장으로 확인해.

쌍의 실행 순서는 무작위화하거나 교차 배치해 공급자 부하·호스트 시간 변화가 한쪽에만 몰리지 않게 해. 최초 실행과 warmed cache(사전 적재 캐시)를 분리해. 조건을 동등하게 만들 수 없는 축은 보고서에 제한으로 표시해.

### 7.3 평가 지표와 반복 분석

주 지표는 사전 고정된 task 집합의 해결률 차이야. 비용·지연·요청·개입·안전 위반은 별도 축으로 보고해. 가중 종합점수를 사후에 골라 승자를 만들지 않아.

반복 $j=1,\ldots,K_i$가 있는 task $i$에서는 먼저 task별 평균을 계산해.

$$
\overline D_i=\frac{1}{K_i}\sum_j(Y_{i,A,j}-Y_{i,B,j}),\qquad
\widehat\Delta=\frac{1}{N}\sum_i\overline D_i.
$$

$N\times K$개 결과를 독립 task로 취급하지 않아. 확인 평가에서는 task를 cluster(상관된 묶음)로 유지하는 재표집 또는 적절한 계층 모형을 사전 지정해. 1회 쌍대 이진 비교에는 exact McNemar를 쓸 수 있지만 반복 결과를 단순히 이어붙이지 않아.

개선 채택 조건은 해결률의 사전 지정 비열등성 허용폭, 비용·지연 개선 목표, 안전성 회귀 바닥을 함께 정해. 예를 들어 비용 15% 감소와 해결률 허용 손실 5pp는 **제품 결정용 후보**이지 현재 데이터에서 검증된 최적 기준이 아니야. 작은 pilot에서 유의성 실패를 동등성 성공으로 바꾸지 않아.

여러 후보 중 가장 좋은 것을 고르는 단계와 최종 확인 검정을 분리해. 중간 결과를 볼 때마다 유리한 시점에서 종료하지 않아. 순차 분석이 필요하면 검정 방법과 중단 규칙을 실행 전에 고정해.

### 7.4 비용 계획과 승인 경계

현재 관측 평균을 단순 비례시키면:

$$
\widehat C_{89,2}=\frac{89}{24}(25.11846612+19.034337)\approx163.73\ \mathrm{USD},
\qquad
\widehat C_{89,2,5}\approx818.67\ \mathrm{USD}.
$$

이는 2개 arm 기준이고 A0·A1·B의 3개 arm 비용이 아니야. 캐시 할인 없는 관측 단가의 산술 외삽이며 task 난이도·실행 분산·재시도·요금 변경을 반영한 견적이나 상한이 아니야. 반복 횟수 5도 이 문서의 비교 예시일 뿐 현재 공식 제출 요건을 대신하지 않아.

실제 실행 전 task 범위, 반복 수, 최대 지출, 모델, 공급자, timeout, 중단 규칙을 따로 승인받아. 이 로드맵을 쓰거나 스킬을 호출한 것 자체는 결제·평가 시작·공개 제출 허가가 아니야.

### 7.5 공개 주장과 버전 이전

공식 TB 버전의 데이터셋·자원 제한·등록 정책을 제출 시점에 다시 확인해. 공개 무결성 정책은 trajectory(행동 이력)와 실제 평가의 연결, 채점기 악용과 데이터 유출 방지를 강조해.[^S5] 내부 통과를 공식 등재나 순위로 표현하지 않아.

TB 2.1 회귀 결과와 TB 4.0 등 다른 버전 결과는 별도 표로 유지해. 모델이 다른 공개 행 사이에 54.17%를 끼워 넣어 OMK 순위를 만들지 않아.

## 8. 우선 보류할 확장

| 제안 | 지금 보류하는 이유 | 다시 검토할 조건 |
| --- | --- | --- |
| 다중 에이전트 기본 활성화 | 현재 주요 신호는 요청 증폭과 비용 증가 | 단일 agent로 해결 불가한 독립 하위 작업과 총비용 이득 확인 |
| learned router(학습형 라우터) | 현재 24쌍은 학습·검증·일반화 분리에 부족 | 충분한 비누출 trace, 단순 규칙 대비 holdout(미사용 검증 집합) 이득 |
| 추가 LLM judge | 호출비·편향·자기검증 위험이 늘어남 | 실행 검증기로 평가 불가한 기준과 독립 평가 정확도 검증 |
| 전체 문맥 시스템 재작성 | 기존 예산·요약 경로가 있으며 실제 병목 미확정 | 최종 전송 측정에서 기존 구조로 해결 불가한 제한 확인 |
| 스킬 대량 기본 로딩 | 이번 실험에서는 스킬이 비활성화됨 | 구체적 task의 인과 비교에서 호출·문맥 비용을 상쇄 |
| task별 정답 규칙 | 평가 오염이며 일반 하네스 능력을 측정하지 못함 | 재검토 대상이 아님 |

## 9. 초기 체크포인트: 검증 명령, 변경 단위, 복구

저장소 루트에서 이번 변경을 검사하는 명령은 다음과 같아. 모두 모델 실행을 요구하지 않아.

```bash
node --test scripts/test/tb-mini-suite.test.mjs
node scripts/tb-mini-suite.mjs --size 89 --json
node scripts/tb-mini-suite.mjs --json | sha256sum
node --check scripts/tb-mini-suite.mjs
node --check scripts/test/tb-mini-suite.test.mjs
npm run check:doc-links
npm run check
git diff --check -- ROADMAP.md scripts/tb-mini-suite.mjs scripts/test/tb-mini-suite.test.mjs packages/coding-agent/docs/metrics.md
```

실제 dataset 디렉터리가 없는 새 clone에서는 선정 명령이 종료 코드 1로 실패하는 것이 정상이고, 합성 입력을 만드는 테스트는 독립적으로 실행 가능해. dataset 다운로드나 Harbor 실행을 검사 실패의 자동 복구로 실행하지 않아.

현재 `biome.json`은 TypeScript 경로만 포함해 위 두 `.mjs` 파일을 직접 지정해도 검사하지 않아. 설치된 Biome 2.3.5의 동일 경로 표준입력 검사도 문법이 틀린 대조 입력을 종료 0으로 통과시켰으므로 검증 근거에서 제외했어. 아래 명령은 기존 규칙을 복사하되 임시 설정에서 파일 포함 범위를 넓혀, 명시한 두 파일만 실제 검사해. 저장소 설정이나 Git index(스테이징 영역)는 수정하지 않아.

```bash
python3 - <<'PY'
import json
import subprocess
import tempfile
from pathlib import Path

root = Path.cwd()
config = json.loads((root / 'biome.json').read_text())
config['files']['includes'] = ['**']
config['vcs']['enabled'] = False
with tempfile.TemporaryDirectory(prefix='omk-tb21-biome-') as directory:
    (Path(directory) / 'biome.json').write_text(json.dumps(config))
    command = [
        'node', str(root / 'node_modules/@biomejs/biome/bin/biome'),
        'check', '--error-on-warnings', '--config-path', directory,
    ]
    control = subprocess.run(
        command + ['--stdin-file-path=control.mjs'],
        input='const broken = ;\n', text=True, capture_output=True, timeout=20,
    )
    assert control.returncode != 0 and 'parsing errors' in control.stderr.lower()
    result = subprocess.run(command + [
        str(root / 'scripts/tb-mini-suite.mjs'),
        str(root / 'scripts/test/tb-mini-suite.test.mjs'),
    ], timeout=20)
    raise SystemExit(result.returncode)
PY
```

| 검사 | 이번 확인 상태 |
| --- | --- |
| 선택기 수정 전 회귀 검사 | 종료 1, 24개 중 16개 실패 |
| 선택기 수정 후 회귀 검사 | 종료 0, 24개 모두 통과 |
| 기존 기본 15개 JSON 호환성 | 수정 전후 SHA-256 일치 |
| 실제 데이터셋 전수 선택 | 종료 0, 89개 선택·89개 고유 task 확인 |
| 두 `.mjs`의 Node 문법 검사 | 각각 종료 0 |
| 임시 설정으로 수행한 Biome 검사 | 종료 0, 실제 2개 파일 검사; 잘못된 문법 대조 입력은 종료 1 |
| 상대 링크 대상·Markdown 구조 | 대상 8개 존재, 두 문서 파싱 통과 |
| LaTeX 구조·출처 각주 | 표시 수식 16개 구분자·괄호 검사와 각주 5개 대응 확인; 화면 렌더링 미검증 |
| 산술 직렬 재계산 | 요청·토큰·비용 비율, 해결당 비용, exact McNemar, 89개 비용 외삽 일치 |
| `npm run check` | 종료 1, 범위 밖 파일의 Biome 오류 3건으로 첫 단계에서 중단; 이후 통합 검사들은 미실행 |
| `npm run check:doc-links` | 종료 1, 새 `ROADMAP.md` 링크 1건과 기존 미추적 문서 링크 4건 |
| 실제 provider 요청 재생·벤치마크 재실행·전체 빌드 | 미실행 |
| 새 해결률·비용 개선의 실증 | 없음 |

### 직렬 검토의 판정과 제한

요청에 따라 서브에이전트 없이 목표 충족, 실제 CLI 동작, 코드 품질, 보안 경계, 통계·문서 정합성을 직렬 검토했어. 앞선 5개 병렬 검토는 시간 제한으로 결과가 없었으므로 통과 근거로 사용하지 않아. 독립적인 다중 검토 통과라고도 주장하지 않아.

전체 저장소의 오류는 `packages/ai/src/utils/oauth/meta.ts`의 import(가져오기) 순서, `packages/coding-agent/test/mcp/tools.test.ts`와 `packages/coding-agent/test/session-termination.test.ts`의 서식이야. 이 파일들은 이번 단위 소유가 아니므로 수정하지 않았어. `npm run check`가 첫 단계에서 멈췄기 때문에 타입 검사 등 뒤쪽 gate의 통과 여부는 알 수 없어.

문서 링크 검사는 링크 대상의 로컬 존재뿐 아니라 Git 추적 여부도 검사해. `metrics.md`에서 새 `ROADMAP.md`로 연결하는 1건은 이번 단위의 미추적 파일 때문이고, 나머지 4건은 `quickstart.md`의 `context-files.md` 링크와 `run-protocol.md`·`runtime-algorithms.md`·`sdk.md`의 `advisory-selection.md` 링크야. 승인 없이 파일을 stage하거나 검사를 약화해 통과시키지 않았어. 이번 문서·테스트·구현은 동일한 승인된 커밋 단위에 포함하고 그 시점에 링크 검사를 다시 실행해야 해.

**판정: 이번 선택기 변경과 문서의 범위 내 검증은 통과했지만, 저장소 통합 gate는 BLOCKED(미통과)야.** 전체 하네스 고도화 완료, 배포 가능, benchmark 성능 향상은 주장하지 않아.

### 커밋 체크포인트

이번 단위의 소유 파일은 `ROADMAP.md`, `scripts/tb-mini-suite.mjs`, `scripts/test/tb-mini-suite.test.mjs`, `packages/coding-agent/docs/metrics.md`야. 기존 미커밋 런타임 변경은 포함하지 않아. 제안 커밋 메시지는 `fix: TB 평가 집합 선택을 보정하고 하네스 고도화 로드맵 추가`야. 실제 stage·commit은 별도 승인 없이 하지 않아.

복구는 이번 단위의 diff(변경분)에 대한 역방향 패치로 제한해. 공유 작업 트리에서 `git reset --hard`, 전체 checkout, 전체 stash로 다른 세션의 변경을 지우지 않아. 새 문서나 테스트 삭제도 해당 파일에 후속 변경이 없는지 확인한 뒤 이 단위만 되돌려야 해.

## 10. 근거와 연결 문서

공개 코드·사용 문서는 [`metrics.md`](packages/coding-agent/docs/metrics.md), [`compaction.md`](packages/coding-agent/docs/compaction.md), [`run-protocol.md`](packages/coding-agent/docs/run-protocol.md), [`agent-loop.ts`](packages/agent/src/agent-loop.ts), [`tb-mini-suite.mjs`](scripts/tb-mini-suite.mjs), [`tb-mini-suite.test.mjs`](scripts/test/tb-mini-suite.test.mjs)를 기준으로 읽어. 작업 트리 전용 파일의 상태는 §4와 구분해야 해.

## 11. 이전 구현 체크포인트 — 2026-09-08

이번 구현은 서브에이전트 없이 직렬로 진행했다. 시작 HEAD는
`0466d05d41045cea53d482408e4dd7ca96d4b30a`이며 공유 작업 트리의 기존 변경은 보존했다.
AdaptOrch route 스킬의 폭 1인 종속 체인 규칙을 계획 권고로만 적용했으며,
AdaptOrch CLI·MCP·공급자 실행 결과를 만들어 내지 않았다.

### 11.1 단계별 상태

| 단계 | 실제 완료한 부분 | 아직 미완료인 부분 |
| --- | --- | --- |
| R0 | 기존 24개 선택기 회귀 검사 재통과 | 전체 평가의 대표성·성능 입증은 별도 |
| R1 | 고정 manifest의 SHA-256, 명시한 두 job, task 체크섬·모델 설정 대조, 중복·결측·모순 검사 | 설치 adapter의 종료 코드·정리 검증, 실제 바이너리/조건 해시 대조, 실행 전 모델 전환 차단, 다회 시행 명세 |
| R2 | 계약·명시적 요청 상한의 양의 safe integer 검증, 잘못된 수치가 누락값으로 바뀌는 경로 제거 | CLI/SDK 기본 경로 주입, 생략된 한도의 실제 상한 설정, compaction 등 모든 전송의 최종 옵션 대조 |
| R3 | 요청 원장을 시간창으로 추정해 합치지 않는 감사 경계 확보 | request ID 원장, 비용·지연 귀속, 실제 청구 대조 |
| R4~R7 | 기존 정책/측정 모듈을 대체하지 않음 | R3의 실행 증거를 전제로 한 loop·terminal·문맥·DAG 고도화 |
| R8 | 공급자 없는 합성 CLI/루프 회귀 검사 | 예산·대상 승인 후의 paired pilot 및 확인 평가 |

R1 또는 R2 전체가 끝난 것은 아니다. 특히 **기록된 model label의 일치는 실제 모든
모델 전송의 계약 준수를 증명하지 않는다.** 이번 변경의 성능 이득은 미측정이다.

### 11.2 R1: 기록된 결과를 읽기 전용으로 감사

새 명령은 `scripts/tb21-audit.mjs`다. 입력·스키마 경계는
`scripts/lib/tb21-input.mjs`, 결과 대조와 집계는 `scripts/lib/tb21-audit.mjs`가 소유한다.
[사용법과 manifest 스키마](packages/coding-agent/docs/tb21-audit.md)에 옵션·종료 코드·제한을 정리했다.

이 명령은 다음을 수행한다.

1. 호출자가 고정한 manifest 해시를 대조한다. 최신 job 자동 선택은 없다.
2. manifest 디렉터리 아래 명시한 두 job만 읽는다. 경로 이탈·심볼릭 링크를 거부하고
   manifest 256 KiB, 결과 파일 8 MiB의 읽기 한도를 적용한다.
3. 두 arm 각각에 모든 task가 정확히 한 번 있는지 검사한다. 재시도 결과가 늘어나면
   마지막 결과를 고르지 않고 불완전 실행으로 거부한다.
4. task 체크섬, Harbor 설정의 model label, trial 디렉터리 이름과 ID 유일성을 대조한다.
5. 누락/null 비용은 0으로 바꾸지 않는다. 성공과 예외가 함께 기록된 경우도 거부한다.
6. 전부 통과한 경우에만 쌍대 성공표·비용·증거 해시를 stdout에 출력한다.
   결과·원장·기존 요약에 쓰기는 하지 않는다.

$$
|A|=|B|=|\mathcal M|,\qquad
\forall t\in\mathcal M:\ \operatorname{count}_A(t)=\operatorname{count}_B(t)=1.
$$

실패 시 stdout은 비고 stderr의 오류 코드와 비영(非零) 종료 상태를 남긴다.
원본 trial ID·절대 경로·kwargs·예외 메시지는 보고서에 복사하지 않는다.
출력의 run/task ID는 manifest에서 승인한 식별자다. 공개 전 검토는 여전히 필요하다.

`status: complete`는 입력 결과가 이 감사 계약을 충족했다는 뜻이다.
항상 `modelVerification: configuration-only`, `costSource: harbor-agent-result`를 표시한다.
조건·바이너리·adapter 해시와 데이터셋 revision은 이 단계에서는 선언값이다.
과거 B arm처럼 Harbor 결과 자체에 비용이 없으면 `missing_cost`로 거부한다.
Gateway 원장 결합을 구현한 것처럼 보이게 만들거나 임의 비용을 채우지 않는다.

**검사 이력:** 새 명령이 없을 때 41개 요구 검사 실패를 확인했다. 이후 별도 경계
검사에서 중복 CLI 옵션이 무음으로 선택되는 문제와 원본 trial ID 노출을 각각
실패로 재현하고 수정했다. 최종 44개 검사가 통과한다. 결과 집계와 입력/경로 검사를
두 파일로 나눠 모든 테스트를 유지했다.

### 11.3 R2: 잘못된 출력 상한의 무음 통과 제거

기존 `resolveMaxOutputTokens`는 NaN·무한대·0·소수 등 잘못된 명시적 값을
`undefined`로 바꿨다. 그 결과 `assertModelContract`가 상한 검사를 건너뛰고
provider stream 함수가 호출됐다. 실제 루프 테스트에서 이 호출을 확인했다.

기존 `assertModelContract`의 단순 비교도 NaN이나 잘못된 계약 상한을 충분히 거부하지
못했다. 새 검증은 계약의 상한과 명시적 요청 상한 모두에 다음 조건을 적용한다.

$$
K\in\mathbb Z,\qquad 1\le K\le 2^{53}-1,
\qquad K_{\mathrm{request}}\le K_{\mathrm{contract}}.
$$

`packages/agent/src/agent-loop.ts`에서 값을 무음 정규화하던 단일 호출 helper를 제거해
`config.maxTokens`를 그대로 계약 검증에 전달한다. 잘못된 값이면 `provider_denied`가
발생하며 `provider_request`와 provider stream 호출은 발생하지 않는다.
`packages/agent/src/run-model-contract.ts`는 이를 typed violation으로 거부한다.

요청 상한이 실제로 생략된 경우는 기존 정책을 유지한다. **이 술어가 provider의 기본
출력 한도를 설정하거나 검증하지는 않는다.** 따라서 run 전체의 실제 전송 상한 보장은
여전히 R2의 후속 작업이다. 이 제한도 타입 주석과 사용 문서에 명시했다.

**검사 이력:** 새 `model-contract-output-limit.test.ts`의 26개 중 21개가 수정 전에
실패했고, 수정 후 전부 통과했다. 기존 계약·agent loop·harness 검사까지 포함하면
144개가 통과한다. 테스트에서는 provider 대신 좁은 stream 경계만 대체했다.

### 11.4 해당 체크포인트의 검사 결과

| 검사 | 실제 결과 | 범위·제한 |
| --- | --- | --- |
| R0+R1 Node 검사 | 종료 0, 68/68 | 기존 선택기 24 + 감사기 44; 파일 실행을 직렬 지정 |
| R2 Vitest 검사 | 종료 0, 144/144 | 새 26 + 계약 13 + loop 88 + harness 17 |
| JS strict typecheck | 종료 0 | 새 CLI와 입력·집계 모듈, `--checkJs --strict` |
| 워크스페이스 `tsgo --noEmit --pretty false` | 종료 0 | 통합 명령이 멈춘 뒤 별도로 실제 실행 |
| Biome 명시적 파일 검사 | 종료 0, 실제 9개 파일 | 임시 포함 설정 사용; 저장소 설정·baseline 변경 없음 |
| 새 manifest 문서 예시 | 실제 `parseManifest`로 통과 | 예시는 합성 해시이며 실행 실적이 아님 |
| 주 언어 서버 오류 검사 | 9개 파일, 오류 0 | 보조 문서 경고·통합 gate와 구분 |
| 문서 구조·로컬 링크 | 문서 3개 파싱, 상대 링크 11개 존재, 표시 수식 18개 구조 통과 | LaTeX 화면 렌더링은 미검증 |
| `npm run check` | 종료 1 | 기존 범위 밖 서식/import 오류 3건으로 중단 |
| `npm run check:constitution` | 종료 1, 330개 중 328 통과 | 미추적 스킬 카탈로그와 모듈 크기 검사 2건 실패; 위 68개와 중복이므로 별도 합산하지 않음 |
| `npm run check:module-size` | 종료 1, 10건 | 기존 크기 부채. `agent-loop.ts`도 포함되지만 이번 diff는 순감 12줄 |
| `npm run check:doc-links` | 종료 1, 6건 | 이번 두 미추적 문서 링크 + 기존 미추적 문서 링크 4건 |
| 실제 provider·Harbor·벤치마크 실행·전체 빌드 | 미실행 | 성능·실제 비용·배포 가능성을 주장하지 않음 |

통합 서식 오류는 기존과 같은 `packages/ai/src/utils/oauth/meta.ts`,
`packages/coding-agent/test/mcp/tools.test.ts`, `packages/coding-agent/test/session-termination.test.ts`다.
카탈로그 실패는 기존 미추적 `.omk/skills/context7-mcp/SKILL.md` 때문이다.
문서 링크에서 이번 대상은 `ROADMAP.md`와 `packages/coding-agent/docs/tb21-audit.md`다.
로컬 상대 링크 대상은 확인했지만 승인 없이 Git에 stage하지 않았다.

진단 캐시의 새 문서→`metrics.md` 링크 경고 1건은 남아 있다. 실제 상대 경로 대상은
존재하며 직접 확인했다. 이 경고를 없애려고 ignore 규칙을 추가하지 않았다.
LSP·타입 검사 결과와 문서 추적 여부 검사를 같은 것으로 취급하지 않는다.

재현 명령은 저장소 루트 기준이다.

```bash
node --test --test-concurrency=1 scripts/test/tb-mini-suite.test.mjs scripts/test/tb21-audit.test.mjs scripts/test/tb21-audit-inputs.test.mjs
(cd packages/agent && node ../../node_modules/vitest/dist/cli.js --run test/model-contract-output-limit.test.ts test/run-model-contract.test.ts test/agent-loop.test.ts test/harness/agent-harness.test.ts)
node node_modules/typescript/bin/tsc --noEmit --allowJs --checkJs --strict --target ES2022 --module NodeNext --skipLibCheck --types node scripts/tb21-audit.mjs scripts/lib/tb21-input.mjs scripts/lib/tb21-audit.mjs
node_modules/.bin/tsgo --noEmit --pretty false
npm run check:constitution
npm run check:module-size
npm run check:doc-links
npm run check
```

### 11.5 커밋 체크포인트와 다음 순서

| 원자적 단위 | 변경 범위 | 제안 메시지 |
| --- | --- | --- |
| R1 결과 무결성 | `scripts/tb21-audit.mjs`, `scripts/lib/tb21-{input,audit}.mjs`, `scripts/test/tb21-audit*.test.mjs`, `scripts/test/fixtures/tb21-evidence.mjs`, `tb21-audit.md`, metrics/ROADMAP의 R1 문서 hunk | `feat: TB21 결과를 고정 명세로 오프라인 감사` |
| R2 명시적 상한 | `packages/agent/src/{agent-loop,run-model-contract}.ts`, `packages/agent/test/model-contract-output-limit.test.ts`, metrics/ROADMAP의 R2 문서 hunk | `fix: 모델 계약의 잘못된 출력 상한을 전송 전에 거부` |

이번 구현에서 branch 생성·stage·commit·push·PR은 수행하지 않았다. 기존 R0 변경과
다른 세션의 미커밋 파일을 한꺼번에 묶지 않는다. 커밋 승인 시 경로뿐 아니라 공통
문서의 해당 hunk를 분리해 검토해야 한다.

다음 구현은 **R1의 adapter 종료/정리·실행 provenance 연결 → R2의 실제 최종 상한과
모든 전송 경계 연결 → R3의 request ID 원장** 순서다. R4~R7의 최적화는 그 계측과
회귀 조건 뒤에 진행한다. 유료 R8 실행은 task·모델·반복·예산 승인 전에는 시작하지 않는다.

**현재 판정: 두 구현 단위의 좁은 검증은 통과, 저장소 통합 gate는 BLOCKED.**

## 12. 알고리즘 재검증과 수정 — 2026-09-08 후속 검사

### 12.1 당시 소스와 검증 범위

검증 도중 HEAD가 `0466d05…`에서 `60f520f…` 등으로 변경됐다. 아래 통합 검사는
`29624c3962d00cc8355191265e7827d9fdf0f3ad`에서 시작하고 같은 HEAD에서 종료했다.
공유 작업 트리 전체가 이 SHA와 동일하다는 뜻은 아니다. 이 작업에서는 Git 쓰기를 하지 않았다.

현재 디스크에 `packages/agent/src/run-model-contract.ts`, `deadline-policy.ts`,
`stagnation-tracker.ts`, `dag-barrier-waste.ts`가 없음을 확인했다. 이전에 읽은 본문이나
§11의 통과 결과를 현재 구현 증거로 재사용하지 않았다. 누락된 모듈을 임의 복원하거나
남아 있는 회귀 테스트를 삭제하지 않고, 실제로 남아 있는 R0/R1 도구를 수정했다.

따라서 현재 R2/R4/R7의 모듈 존재·동작은 **미확인 또는 부재** 상태이며, 해당 후속
작업은 의도한 소스 기준과 복원/이식 범위를 먼저 확정해야 한다. 기존 24-task 성적을
재채점하거나 새 벤치마크를 실행한 작업은 아니다.

적용한 절차는 `adaptorch-route`의 순차 의존 권고, `omk-engineering`·`programming`의
소스/타입 검사, `debugging`·`tdd-workflow`의 실패 재현, `property-based-testing`의
불변식·변환 검사, `ponytail`의 최소 변경, `lsp`와 직접 사후 검토다. 외부 공급자·에이전트
실행은 없었다. 연구·GUI·배포 등 이 변경과 무관한 스킬을 무작정 활성화하지 않았다.

### 12.2 발견한 오류와 수정

| 문제 | 실패 근거 | 적용한 수정 |
| --- | --- | --- |
| 결측 예상 시간의 선정 우선순위 왜곡 | 누락·빈 문자열·비유한 값이 0분, 음수가 더 짧은 작업으로 취급됨 | 유효한 0/소수는 보존하고 나머지는 null; 같은 난이도 후보군과 부족분 보충에서 알려진 시간 뒤로 정렬 |
| 1~2개 선정의 이름순 편향 | 난이도별 최소 1개씩 뽑은 후 이름순 `slice`로 초과분을 버림 | 부족한 슬롯을 난이도 가중치 순(medium, hard)에 배정한 뒤 기존 부족분 보충 적용 |
| 난이도 빈도 표의 prototype 충돌 | `__proto__`, `constructor`, `toString` 라벨의 빈도가 잘못 출력됨 | 일반 객체 누적 대신 `Map`으로 집계 |
| 미완료 결과의 완료 판정 | 시작/종료시각이 누락·null·잘못된 값이어도 성공 요약 가능 | 시각 존재·명시적 타임존·달력 유효성·종료≥시작 검증 후에만 집계 |

예상 시간 정렬 키는 유효한 수치에 한해서 다음과 같다. 이 우선순위보다 난이도 쿼터가
먼저 적용되므로, 알려진 시간이 없는 task도 난이도 구성을 위해 선정될 수 있다.

$$
K(t)=\begin{cases}
E_t,& E_t\text{ is finite and }E_t\ge0,\\
+\infty,& \text{otherwise}.
\end{cases}
$$

선정된 task 중 unknown이 있으면 `totalExpertMinutes`는 null이다.
`knownExpertMinutes`와 `unknownExpertEstimates`를 별도로 제공하며, 알려진 값의 합이
비유한 값으로 넘치면 종료 1로 거부한다. unknown을 0으로 치환한 완전한 총량은 만들지 않는다.
기존 제한적 TOML 필드 추출 방식은 유지했으며 일반 TOML 파서로 확장한 것은 아니다.

시각 검증은 `Date.parse`로 정수 초·타임존을 처리하고 소수초는 BigInt 나노초로 별도
보존한다. 밀리초 절삭 때문에 `…123457` 이후에 끝난 `…123456`을 같은 시각으로 보는
문제를 예방한다. 유효하지 않은 달력 날짜의 자동 정규화도 허용하지 않는다.

$$
t_{\mathrm{ns}}=10^6t_{\mathrm{whole\ seconds,ms}}+
\operatorname{integer}(\operatorname{rightPad}_9(f)),\qquad
 t_{\mathrm{finish,ns}}\ge t_{\mathrm{start,ns}}.
$$

미종료는 `unfinished_trial`, 잘못되거나 역전된 시각은 `invalid_trial_time`으로 거부한다.
이는 기록의 완결성 검사이지 실제 프로세스 종료·자식 정리·시계 신뢰성의 증명은 아니다.

### 12.3 호환성 및 측정 경계

- 선택기는 `selectionVersion: 2`를 출력한다. `expertMinutes`와 `totalExpertMinutes`가
  null일 수 있다. 불완전 메타데이터 또는 1~2개 선정에서는 기존 task 구성이 달라질 수 있다.
  §5의 기본 JSON 해시는 v1의 과거 검사 결과이며 새 출력에 적용되지 않는다.
- 감사 출력은 `omk-tb21-audit-report-2`, 입력 manifest는 계속 `omk-tb21-manifest-1`이다.
  `completionVerification: recorded-timestamps`를 표시한다. v1에서 통과한 시각 누락
  자료는 v2에서 거부될 수 있으며, 현재 시각으로 값을 지어내 보정하지 않는다.
- 정상 크기 선정의 난이도 쿼터, seed 검증, 고정 manifest 해시, 비용 결측 거부,
  원본 자료 미수정, 실제 모델 전송 검증과의 구분은 보존했다.
- 비교 실행 전에 새 선정 결과·버전·데이터셋을 다시 고정해야 한다. 버전 변경 전후 결과를
  동일한 조건의 비교로 합치지 않는다.

로컬 데이터셋의 **선정만** 실행한 결과는 다음과 같다. 전문가 예상 시간은 모델 실행
시간·과금액이 아니며 해결률 또는 비용 개선을 입증하지 않는다.

| 선택 크기 | 선택 개수 | 알려진 예상 시간(분) | unknown 개수 | 전체 예상 시간 |
| --- | ---: | ---: | ---: | --- |
| 15 | 15 | 275 | 0 | 275 |
| 89 | 89 | 18190 | 1 | null |

### 12.4 검증 결과와 남은 차단

새 선정/시각 검사 31개 중 수정 전 29개가 실패했다(새 출력 계약 검사 포함).
prototype 라벨 검사 3개도 별도로 실패를 확인했다. 수정 후 새 34개와 기존 68개,
총 **102개 CLI 검사**가 통과했다. 입력값·작은 크기·seed 조합·반복 결정성, 타임존
등가성, 소수초 순서, Unix epoch 이전 시각을 검증했고 스냅샷 문자열만 고정하지 않았다.

| 검사 | 결과 | 범위 |
| --- | --- | --- |
| R0/R1 직렬 Node 검사 | 종료 0, 102/102 | 실제 CLI + 합성 임시 task/trial; 모델 호출 없음 |
| JS strict typecheck | 종료 0 | 선택기·감사 CLI·입력/집계 모듈 4개, JSDoc 타입 포함 |
| Biome 명시 검사 | 종료 0, 실제 5개 파일 | 임시 포함 설정 사용, 저장소 규칙 변경 없음 |
| 주 언어 서버 오류 검사 | 5개 파일, 오류 0 | 변경 소스·테스트 범위 |
| `npm run check:doc-links` | 종료 0 | 현재 체크아웃의 검사 결과이며 Git 게시 승인은 아님 |
| 문서 구조 검사 | 3개 문서 파싱, 로컬 링크 11개·각주 5개 대응·표시 수식 20개 구조 확인 | LaTeX 화면 렌더링 미검증 |
| 진단 캐시 `lens_diagnostics(mode=all)` | 문서 경고 7건 | 해당 로컬 대상과 각주 정의는 직접 확인; 경고 억제 설정은 추가하지 않음 |
| R2 재검사 | 종료 1, 수집 실패·실행 테스트 0 | `../src/run-model-contract.ts` 부재 |
| 전체 `tsgo --noEmit --pretty false` | 종료 2, 오류 4건 | R2 모듈·`modelContract`·`provider_request` 표면 부재 |
| `npm run check` | 종료 1 | 기존 범위 밖 Biome 오류 3건에서 중단 |

§11의 전체 타입 통과와 144개 런타임 검사 통과를 현재 결과로 해석하면 안 된다.
현재 실패를 숨기려고 R2 테스트를 지우거나 무시하지 않았다. 전체 검사에서 멈춘 뒤의
gate를 통과했다고 추정하지도 않았다.

```bash
node --test --test-concurrency=1 scripts/test/tb-mini-suite.test.mjs scripts/test/tb-mini-suite-ranking.test.mjs scripts/test/tb21-audit.test.mjs scripts/test/tb21-audit-inputs.test.mjs scripts/test/tb21-audit-completion.test.mjs
node node_modules/typescript/bin/tsc --noEmit --allowJs --checkJs --strict --target ES2022 --module NodeNext --skipLibCheck --types node scripts/tb-mini-suite.mjs scripts/tb21-audit.mjs scripts/lib/tb21-input.mjs scripts/lib/tb21-audit.mjs
(cd packages/agent && node ../../node_modules/vitest/dist/cli.js --run test/model-contract-output-limit.test.ts)
node_modules/.bin/tsgo --noEmit --pretty false
npm run check
```

### 12.5 커밋 체크포인트

| 단위 | 변경 파일·문서 hunk | 제안 메시지 |
| --- | --- | --- |
| R0 선정 알고리즘 교정 | `scripts/tb-mini-suite.mjs`, `scripts/test/tb-mini-suite-ranking.test.mjs`, metrics/ROADMAP의 선정 v2 설명 | `fix: TB 선정의 결측 시간·소규모 쿼터·라벨 집계 오류 수정` |
| R1 완료 판정 강화 | `scripts/lib/tb21-audit.mjs`, `scripts/test/tb21-audit-completion.test.mjs`, `scripts/test/fixtures/tb21-evidence.mjs`, tb21-audit/metrics/ROADMAP의 시각 검증 설명 | `fix: 미완료 TB trial 집계 거부와 소수초 순서 검증` |

두 단위의 분리 검토를 제안하며 커밋·브랜치·푸시·PR은 각각 승인 전까지 수행하지 않는다.
유료 벤치마크·AdaptOrch 실행·전체 빌드는 하지 않았다. 누락된 런타임 모듈의 복원/이식
여부와 기준 브랜치가 확정되면 R2 검사를 다시 진행해야 한다.

**판정: R0/R1 교정의 범위 내 검증은 통과. R2 및 저장소 통합 검증은 BLOCKED.**

## 13. 실행 계약의 첫 적용 — 2026-09-08

기준 HEAD는 `29624c3962d00cc8355191265e7827d9fdf0f3ad`다. 기존 미커밋 파일은
보존했고, 이전에 남아 있던 `model-contract-output-limit.test.ts`의 검사를 삭제하거나
완화하지 않았다. 현재 변경은 **A00/R2의 논리적 요청 계약과 A01/R3의 사건 연결 일부**다.
로드맵 전체, 최종 wire 계약, 새로운 성능 개선이 완료됐다는 뜻은 아니다.

### 13.1 구현한 동작

- `run-model-contract.ts`: 공급자/모델 쌍, 논리적 인증 출처, 추론 허용·수준,
  양의 safe integer 출력 상한을 검증하고 정책을 복사·동결한다.
- core loop: 생략된 출력 한도는 계약·모델 한도의 작은 값으로 채운다. 금지된 요청은
  인증 조회보다 먼저 거부하며, 생명주기·문맥·인증·다음 턴 콜백에서 계약이 바뀌지 않는다.
- `provider-request.ts`: `requestId`로 요청·거부·종결 사건을 연결한다. 기록 경계는
  `stream-dispatch`이며 응답 원문·키·헤더·원시 오류를 사건에 넣지 않는다.
- 자동 이미지 라우팅: 공급자가 바뀌면 이전 공급자의 고정 API 키와 요청/모델 헤더를
  재사용하지 않는다. 목적 공급자의 resolver가 반환한 키는 사용할 수 있다.
- CLI `--model-contract <file>`: 최대 64 KiB의 UTF-8 JSON을 한 번 읽고 세션 교체에도
  같은 정책을 사용한다. 누락·중복 인수, 잘못된 파일·JSON은 거부한다.
- SDK: 일반 세션과 CLI 서비스 factory에 옵션을 전달한다. 같은 SDK stream을 사용하는
  문맥·분기 요약도 검사한다. 계약 모드의 payload 훅은 불변 복사본을 관측할 수 있지만
  내용을 바꾸는 경로는 차단한다. 일반 payload의 `undefined` 선택 필드는 허용한다.

[계약 사용법과 정확한 적용 경계](packages/coding-agent/docs/model-contract.md)에 JSON·SDK
예제와 호환성을 기록했다. 새 요청·계약·라우팅·큐·SDK 전송·CLI 파일 경계 모듈은
각각 250줄 미만이다. 기존 Agent 큐와 SDK 전송 책임을 분리했으며 크기 baseline은 올리지 않았다.
순환 의존 검사에서 새 타입/전송 모듈의 순환도 발견했다. 요청 타입을 독립 모듈로 옮기고
SDK의 수동 사용량 관측 콜백을 주입해 제거했으며, import-cycle baseline을 넓히지 않았다.

### 13.2 실제 검증

| 검사 | 결과 | 범위 |
| --- | --- | --- |
| 기존 출력 상한 검사 최초 실행 | 종료 1, 모듈 부재로 수집 실패 | 이전 관측의 부재 확인 |
| 새 요청 경계 검사 RED | 15개 중 14개 실패 | 금지 요청 전송, 한도 누락, 가변 정책, 키/헤더 문제 재현 |
| SDK RED | 5개 실패 중 4개가 실제 전달·상한·요약 위반 | 훅 검사는 초기 동기/비동기 assertion 모양 문제와 구분 |
| lifecycle·payload 추가 RED | 각각 2개 실패 | 시작 콜백 정책 변경/사건 누락, 선택 필드·모델 훅 문제 |
| core·Agent·기존 harness 회귀 | 종료 0, 317/317 | 9개 파일, 공급자 없는 fixture |
| SDK·CLI·요약 회귀 | 종료 0, 116/116 | 8개 파일, 실제 CLI subprocess 오류 경로 2개 포함 |
| 새 계약/요청/라우팅 3모듈 V8 coverage | 문장·줄 96.42%, 분기 94.59%, 함수 92.85% | 전체 저장소 coverage가 아님 |
| 전체 `tsgo --noEmit --pretty false` | 종료 0 | 현행 작업 트리의 타입 검사 |
| `npm run check:import-cycles` | 종료 0 | 새 순환을 제거한 뒤 baseline 내 56개 모듈 확인 |
| 주 LSP 검사 | 8개 대상 모두 clean | 초기 1개 시간 초과는 재검사로 확인 |
| `lens_diagnostics(mode=all)` | 진단된 11개 파일의 오류 0 | 미진단 파일까지 전수 검사한 결과가 아님 |
| `npm run check` | 종료 1 | 기존 범위 밖 Biome 오류 3건에서 중단 |
| `npm run check:module-size` | 종료 1 | 기존 범위 밖 6개 모듈의 baseline 초과; 이번 Agent/main 증가분은 해소 |
| `npm run check:doc-links` | 종료 1 | 새 계약 문서는 로컬에 있으나 아직 Git에 포함되지 않음 |
| 독립 5방향 리뷰 | 미완료 | 초기·축소 재시도가 시간 초과; 부분 의견을 전체 PASS로 계산하지 않음 |

검사 중 CLI 인수 테스트의 `it.each` 배열 전달 오류를 수정했다. 잘못된 입력으로 발생한
초기 CLI 실패를 기능의 유효한 RED 증거로 합산하지 않았다. core와 SDK의 최종 합계는
**433개**이며 같은 검사의 반복 실행을 추가로 세지 않는다.

```bash
cd packages/agent
node ../../node_modules/vitest/dist/cli.js --run test/model-contract-output-limit.test.ts test/run-model-contract.test.ts test/provider-request-boundary.test.ts test/provider-request-lifecycle.test.ts test/provider-payload-policy.test.ts test/agent-model-contract.test.ts test/agent-loop.test.ts test/agent.test.ts test/harness/agent-harness.test.ts
cd ../coding-agent
node ../../node_modules/vitest/dist/cli.js --run test/sdk-model-contract.test.ts test/sdk-stream-options.test.ts test/model-contract-args.test.ts test/model-contract-file.test.ts test/model-contract-cli.test.ts test/args.test.ts test/compaction-summary-reasoning.test.ts test/agent-session-vision-compaction.test.ts
cd ../..
node_modules/.bin/tsgo --noEmit --pretty false
npm run check
npm run check:module-size
npm run check:doc-links
```

Biome의 3개 차단 파일은 `packages/ai/src/utils/oauth/meta.ts`,
`packages/coding-agent/test/mcp/tools.test.ts`, `packages/coding-agent/test/session-termination.test.ts`다.
크기 차단은 기존 `harness/reverse-skill.ts`, AI `types.ts`, coding-agent의
`compaction.ts`, `model-registry.ts`, `provider-usage.ts`, `interactive-mode.ts`다.
이번 요청 경계의 검증을 통과시키려고 해당 파일이나 기준값을 바꾸지 않았다.

### 13.3 미완료 계약과 다음 단위

공급자별 직렬화는 별도다. 조사한 `adjustMaxTokensForThinking()`은 thinking 예산을
추가할 수 있고 Codex request builder는 `maxTokens`를 전송하지 않는다. 따라서 이번
상한은 **실제 전송·출력·청구의 보장값이 아니다**. 이 차이를 막는 최종 payload 검사와
실제 요청 provenance를 다음 R2 단위에서 연결해야 한다.

요약은 정책 검사에 연결됐지만 새 core 사건의 소비자는 아니다. 사건 영속화,
run/attempt 상관 ID, HTTP 재시도·사용량·청구 대조는 R3에 남아 있다.
별도 `AgentHarness` 계열, 직접 `omk-ai` 호출, 자문 judge, child process와 임의의
extension 코드는 자동으로 같은 정책에 포함되지 않는다. 이 프로세스 내 코드의
접근 권한을 계약 객체가 sandbox하는 것도 아니다.

단계별 합성·회귀 검사는 끝냈지만 **통합 gate와 독립 리뷰는 BLOCKED**다.
현재 실행 중인 CLI를 재빌드·재시작하거나 설치·배포하지 않았고, 새 벤치마크·유료 모델
호출·Git 쓰기도 하지 않았다. 다음 순서는 최종 전송 계약과 R3 원장 완결성 확보이며,
마감시간·학습형 라우팅·DAG 기본값 변경은 그 증거를 전제로 진행한다.

## 14. Model Studio 전송 교정과 Chat Completions 계약 — 2026-09-08

이번 단위는 벤치마크 전송 경계의 결함 두 가지를 수정했다. 기존 작업 트리의 R2 구현을
기반으로 했으며 다른 세션의 변경, 인증, 모델 선택 설정, 과거 평가 자료는 수정하지 않았다.
실행 중인 편집 모델과 다음 평가의 대상 모델을 혼동하지 않았고 외부 추론 요청도 하지 않았다.

### 수정과 근거

1. **공급자별 전송 형식:** Model Studio 공식 HTTPS 호스트를 OpenAI 기본값으로 처리해
   `max_completion_tokens`, `developer`, OpenAI 전용 캐시 필드를 보내고 있었다.
   DeepSeek의 native `thinking` 설정도 Model Studio가 문서화한 `enable_thinking`과 달랐다.
   현재는 `max_tokens`, `system`, 명시적 thinking boolean을 기본으로 사용한다.
   DeepSeek V4의 추론 수준도 호환 설정이 허용하면 전송하며 명시적인 effort opt-out은 보존한다.
   URL 문자열 일부가 아닌 파싱된 HTTPS hostname으로 판별하고 주소나 키를 변경하지 않는다.
2. **최종 payload 계약:** 논리적 검사 이후 다른 모델 ID 또는 잘못된 출력 상한이 만들어져도
   관측 훅이 없으면 검사가 없었다. 현재 Chat Completions는 정확한 ID와 하나의 유효한 출력
   상한을 HTTP 호출 전에 검사한다. 비허용 ID, 누락·모호·비정수·초과 한도는 거부한다.
   사용자 훅은 기존처럼 불변 복사본만 관측하며, 훅이 없을 때에는 대화 전체를 복제하지 않는다.
   core와 SDK가 중첩 적용돼도 관측용 복사를 반복하지 않는다.

호환성 책임은 `packages/ai/src/providers/openai-completions-compat.ts`, payload 경계는
`packages/agent/src/provider-payload-contract.ts`로 분리했다. 기존 대형 provider 파일은
줄였으며 의존성·크기 baseline·검사 제외 규칙은 추가하지 않았다.

### 검증 결과

| 검사 | 실제 결과 |
| --- | --- |
| 수정 전 재현 | Model Studio 13개, payload 계약 17개 실패. 직접 검토 중 `minimal` 전송 오류 1개도 RED→GREEN으로 교정. assertion 모양 오류는 교정 후 별도 재실행 |
| API 직렬화·기존 회귀 | 종료 0, 86/86 |
| core 계약·루프·Agent·harness | 종료 0, 340/340 |
| CLI·SDK·요약 | 종료 0, 118/118 |
| 기존 R0/R1 합성 CLI 검사 | 종료 0, 102/102 |
| 새 표적 검사 | 위 합계에 포함된 47개. 반복 실행을 중복 합산하지 않음 |
| 변경 TypeScript 7파일 Biome, 전체 `tsgo --noEmit --pretty false` | 종료 0 |
| `check:import-cycles`, `check:private-home`, `git diff --check` | 종료 0 |
| 주 LSP | 검사한 소스·테스트 7파일 오류 0 |
| `lens_diagnostics(mode=all)` | 최종 진단 대상 10파일 오류·경고 0. 앞선 링크 경고의 로컬 대상도 확인 |
| `npm run check` | 종료 1, 기존 서식/import 오류 3건에서 중단 |
| `check:module-size` | 종료 1, 기존 범위 밖 baseline 초과 6개 |
| `check:doc-links` | 종료 1, 기존 미추적 `model-contract.md`를 참조하는 링크 3개 |

API 검사는 실제 OpenAI SDK의 직렬화 이후 fetch를 대체한다. CLI 검사는 격리된 임시
agent home과 loopback HTTP 서버로 소스 CLI→SDK→전송 경로를 실행해 모델 ID,
`max_tokens: 512`, `enable_thinking: false`와 금지 모델의 전송 0건·종료 1을 확인했다.
초기 CLI 검사의 timeout은 테스트 자식 stdin을 닫지 않은 문제였고 EOF 전달로 해결했다.
이 timeout을 제품 결함이나 유효한 RED 검사로 계산하지 않았다.
기존 API 캐시 검사도 외부 `OMK_CACHE_RETENTION`에 영향을 받아, 해당 변수만 제거한
검사 명령으로 기준선과 수정 후 결과를 비교했다.

통합 검사 차단 파일은 §13.2의 목록과 같다. 문서 링크 3개는 metrics/providers/sdk의
`model-contract.md` 참조다. 승인 없이 기존 미추적 파일을 stage하거나 검사 기준을
완화하지 않았다. 이 상태를 전체 저장소 PASS나 재측정 준비 완료라고 부르지 않는다.

### 재측정 전에 남은 조건

[공급자 안내](packages/coding-agent/docs/providers.md#model-studio-deepseek-v4)에 따라
**Token Plan·Coding Plan·종량제의 키와 주소를 구분**해야 한다. 같은 모델 표시명만으로
같은 과금 경로나 snapshot이라고 가정하지 않는다. 다음 비교의 provider, 정확한 Flash ID,
추론 모드, 출력 인수, task 집합, 반복 수와 예산을 고정한 뒤 양쪽 adapter를 확인한다.

이번 검사는 직렬화된 출력 인수에 대한 것이며 원격 추론 토큰·청구 상한·숨은 모델 라우팅을
보장하지 않는다. 다른 API, 실제 설치 바이너리, Harbor adapter 주입, 요청 원장과
성능 이득은 여전히 별도 검증 대상이다. 새 모델 호출·벤치마크·빌드·설치·Git 쓰기는 없었다.

### 커밋 체크포인트

- API 단위: `openai-completions.ts`, 새 compat 모듈, `modelstudio-completions.test.ts`,
  providers/models 문서와 이 절의 해당 hunk.
  제안: `fix: Model Studio DeepSeek 추론 모드와 출력 인수 교정`.
- 계약 단위: `provider-request.ts`의 이번 hunk, 새 payload 모듈·직접 테스트,
  `model-contract-wire-cli.test.ts`, 계약 문서와 이 절의 해당 hunk.
  제안: `fix: Chat Completions 최종 모델과 출력 상한 검증`.
  이 단위는 기존 미커밋 R2 구현에 의존하므로 그 변경의 승인·검토와 분리해 다뤄야 한다.

두 단위 모두 직접 검토했다. 실패 시 전송 중단, 기존 공급자 회귀, 불변 관측,
불필요한 복제·의존성 추가 여부를 확인했다. 독립 다중 에이전트 리뷰로 표현하지 않는다.

## 15. Flash 실패 기반 경계 재설계 — 2026-09-09

[새 아키텍처와 수용 기준](packages/coding-agent/docs/harness-boundaries.md)에 증거,
책임별 구조, 구현 범위와 후속 단계 H1~H5를 정리했다. 현재 실행물·원본 결과는 변경하지
않았고 사용자가 중단한 벤치마크도 재개하지 않았다. WSL 재시작·설정 변경도 이번 작업에서는 없다.

### 이번에 구현한 세 경계

1. 계약 모드에서 tool 이미지가 모델 선택을 바꾸지 않게 했다. text-only 요청에만 명시적
   미관측 안내를 투영하고 원본 session/image, tool-call ID, text, 오류 상태는 보존한다.
   사용자 첨부의 허용된 vision 경로와 비계약 모드의 기존 동작은 유지한다.
2. run 종료 분류를 `session-run-termination.ts`로 분리했다. 관측된 core 계약 거부는
   문자열 기반 provider-protocol 추측보다 먼저 non-retryable configuration으로 분류한다.
3. text/JSON renderer와 최종 prompt 성공 여부를 분리했다. 실패 settlement는 exit1이며
   후속 CLI 프롬프트를 중단한다. 내부 retry 후 성공은 그대로 성공이다.

### 검사

| 검사 | 실제 결과 |
| --- | --- |
| core 입력·계약·루프 | 종료 0, 134개 |
| SDK·CLI·요약·실패 분류 | 종료 0, 60개 |
| 기존 session termination runtime | 종료 0, 17개 |
| 합계 | 211개, 14개 test 파일. 반복 실행은 합산하지 않음 |
| 전체 `tsgo --noEmit --pretty false` | 종료 0 |
| 주 LSP | 변경 소스·테스트 13개 오류0 |
| 표적 Biome | 변경 범위 검사·서식 교정 통과 |
| `check:import-cycles`, `git diff --check` | 종료 0 |
| `npm run check` | 종료 1, 기존 범위 밖 서식/import 오류3개에서 중단 |
| `check:module-size` | 종료 1, 기존 범위 밖 초과6개. 이번 AgentSession 증가분은 원인분류 분리로 해소 |
| `check:doc-links` | 미추적 계약/설계 문서가 정식 변경에 포함되기 전에는 미통과 |

좁은 검사와 자기 검토는 통과했지만 저장소 전체 통합 gate가 통과한 상태는 아니다.
기존 차단 목록은 §14와 같고, 새 설계 문서의 링크도 커밋 포함 시 다시 검사해야 한다.
새 runtime 모듈은 각각 34·78 pure LOC이며 테스트 fixture도 분리했다.
새 의존성·검사 억제·모듈 크기 baseline 증가는 없다. 독립 다중 에이전트 리뷰를 수행한
것처럼 표현하지 않으며, 이 구조가 새로운 해결률을 보장하지 않는다.

### 커밋 체크포인트 — 아직 stage/commit하지 않음

| 단위 | 이번 파일/hunk | 제안 메시지 |
| --- | --- | --- |
| 입력 표현 | agent `provider-input.ts`, `provider-request.ts`, `provider-request-types.ts`, `index.ts`, `provider-input.test.ts`; coding-agent `sdk-provider-stream.ts`, `sdk-model-contract.test.ts`의 이미지 검사; 계약/설계 문서 | `fix: 단일 모델 계약에서 도구 이미지의 입력 표현 분리` |
| 종료 원인·CLI | coding-agent `session-run-termination.ts`, `agent-session.ts`의 해당 hunk, `print-mode.ts`, `print-mode.test.ts`, `print-mode-fixtures.ts`, `model-contract-wire-cli.test.ts`, SDK 분류 검사와 JSON 문서 | `fix: 계약 거부 원인과 CLI 최종 실패 상태 보존` |

두 단위는 이전 미커밋 R2 구현 위에 놓인다. 승인 시 이번 hunk와 의존 변경을 구분해
검토해야 하며, 전체 작업 트리를 한꺼번에 stage하지 않는다. 후속 H1~H5는 문서에 명시한
증거·검사·비용 경계를 만족하는 작은 단위로 진행한다.

## 16. 배포 준비 — 2026-09-13

### 범위와 현재 판정

`ca75f4e5cc` 이후 남은 TB 변경을 검토했다. 선택기·감사기의 구현과 직접 테스트는
각각 독립 단위이며, 공유 문서의 해당 설명만 함께 묶는다. 이번에 추가한 런타임
기능은 없다. 시각 문자열 뒤 개행을 거부하는 실제 CLI 경계 검사 4개를 추가했으며,
기존 구현에서도 통과함을 확인했다. 이를 새로 수정한 결함의 RED로 세지 않는다.

`.playwright-mcp/`의 로컬 캡처·로그는 삭제하지 않고 루트의 정확한 디렉터리만
Git ignore에 추가했다. 인증·모델·MCP·스킬 활성 설정은 변경하지 않았다. 제공받은
Mac 스킬 목록으로 Linux의 설치 상태를 단정하거나 누락 스킬을 설치하지 않았다.

**판정: 아래 로컬 검사와 패키징 준비는 통과. 릴리스 실행은 승인 전 보류다.**
관측 환경은 Linux, Node.js `v24.19.0`, npm `11.14.1`이다. Mac/Windows 실행 결과,
실계정 Devin 호출, 전체 비-LLM 제품 테스트, 다중 플랫폼 바이너리 검증은 이번에
수행하지 않았다. 기존 벤치마크를 재실행하지 않았고 새로운 성능 수치는 없다.

### 재검증 근거

| 검사 | 관측 결과 | 해석 범위 |
| --- | --- | --- |
| 새 TB 회귀 검사의 기준선 대조 | HEAD 소스를 임시 디렉터리에 복사해 실행: 종료 1, 38개 중 36개 실패 | 공유 소스·index는 되돌리지 않음. 구 구현의 잘못된 결과와 v2 계약 차이를 실제 CLI로 탐지 |
| 현행 TB 검사 5파일 | 종료 0, 106/106 | 합성 task/trial만 사용. 원본 평가 자료·provider 호출 없음 |
| JS strict typecheck | 종료 0 | 선택기·감사 CLI·입력·집계 모듈, `--allowJs --checkJs --strict` |
| `.mjs` 명시적 Biome | 종료 0, 실제 4파일 | 임시 설정에서 포함 범위 지정. 잘못된 문법 대조 입력은 종료 1. 저장소 검사 설정은 유지 |
| primary LSP | 4개 파일 clean, 미확인 0 | TB 구현 2개·회귀 테스트 2개 |
| `npm run build` | 종료 0 | 7개 workspace 패키지를 저장소 순서대로 빌드. 모델 카탈로그 재생성 없음 |
| `npm run check` | 종료 0, Node 검사 378/378 포함 | Biome·크기·순환·문서·릴리스 정합성·private-home·shrinkwrap·tsgo·browser-smoke 전체 체인. TB 검사와 중복되므로 합산하지 않음 |
| 빌드된 CLI | `--version`, `--help`, `run --help` 각각 종료 0 | 자격증명 없는 임시 HOME에서 프롬프트 없이 실행. version은 0.98.5 |
| 빌드된 공개 package import | 7개 모두 성공 | 공개 최상위 entrypoint의 로드만 검증. provider 추론 실행 아님 |
| Gitleaks | 종료 0, 탐지 0건 | `v0.98.5` 이후 현재 diff와 새 TB 테스트에 기존 규칙·완전 redaction 적용. 전체 비공개 이력에 대한 보증 아님 |

검사의 명령과 상세 로그는 로컬 증거 디렉터리에서 보관한다. 요약 수치는 이 작업의
관측이며, 과거 §9~§15의 실패·통과 수치와 혼합하지 않는다. 소스 변경 뒤에는 해당
검사를 다시 실행해야 한다. 현재 TUI 세션을 재시작하거나 새 설치본으로 검증했다고
주장하지 않는다.

### 패키지 내용 검사

각 패키지 디렉터리에서 `npm pack --dry-run --ignore-scripts --json`을 실행했다.
모두 종료 0이며 version은 0.98.5다. **이 명령은 tarball 배포나 설치 테스트가 아니다.**
`main`·`types`·명시적인 `exports`·`bin` 대상이 파일 목록에 존재하고, `.omk`,
`.git`, `.playwright-mcp`, 중첩 `node_modules`, 인증·키 파일이 들어가지 않는지 확인했다.

| 패키지 | 포함 파일 수 |
| --- | ---: |
| `omk-ai` | 376 |
| `omk-tui` | 123 |
| `omk-protocol` | 63 |
| `omk-agent-core` | 287 |
| `omk-adaptorch-wpl` | 111 |
| `open-multi-agent-kit` | 2231 |
| `omk-book-to-skill` | 65 |

Devin의 `DEVIN-NOTICE`와 분리된 `dist/providers/devin-connect-stream.js`,
CLI의 `npm-shrinkwrap.json`과 `docs/verified-run-remaining-design.md`도 포함된다.
이 목록 검사는 다음 릴리스의 설치·실행 보증을 대신하지 않는다.

### 변경 로그와 버전 경계

`.omk/prompts/cl.md`의 감사 절차로 `v0.98.5..HEAD`를 대조했다. CI 복구·문서 전용
커밋은 제품 기능 공지에서 제외했고, 다음 누락을 `[Unreleased]`에만 보완했다.

- coding-agent와 protocol: 최대 2개 작업의 opt-in eager frontier와 생략 시 digest 보존.
- coding-agent: AI 패키지의 Codex SSE timeout 수정과 리소스 설명의 외부 하네스 태그 처리.
- coding-agent: checkout-only TB 출력의 v2 전환·null 총량·필수 완료시각을 Breaking Changes로 명시.

기존 배포 changelog 본문, 버전·lockfile·shrinkwrap·README 버전 링크는 수정하지 않았다.
새 `### New Features` 홍보 요약은 별도 확인 전 작성하지 않았다.

2026-09-13 읽기 전용 확인에서 [GitHub v0.98.5 Release](https://github.com/dmae97/omk/releases/tag/v0.98.5)는
공개 상태였고 6개 플랫폼 자산을 갖고 있었다. 로컬 v0.98.5 태그는 main의 조상이다.
각 공개 registry의 `https://registry.npmjs.org/<package>/latest`도 위 7개 전부 0.98.5를
반환했다. 이는 이전 배포 상태 확인이지 이번 변경을 배포한 결과가 아니다.

TB 출력 소비자에게는 호환성 변경이 있으므로, 헌법의 minor 규칙에 따라 **다음 버전
후보는 0.99.0**으로 제안한다. checkout-only 인터페이스의 릴리스 범위를 확정하기 전
자동으로 버전을 바꾸거나 0.98.5에 재게시하지 않는다.

### 재현 명령과 승인 체크포인트

```bash
# 합성 입력만 사용하는 회귀 검사
node --test --test-concurrency=1 scripts/test/tb-mini-suite.test.mjs scripts/test/tb-mini-suite-ranking.test.mjs scripts/test/tb21-audit.test.mjs scripts/test/tb21-audit-inputs.test.mjs scripts/test/tb21-audit-completion.test.mjs
node node_modules/typescript/bin/tsc --noEmit --allowJs --checkJs --strict --target ES2022 --module NodeNext --skipLibCheck --types node scripts/tb-mini-suite.mjs scripts/tb21-audit.mjs scripts/lib/tb21-input.mjs scripts/lib/tb21-audit.mjs
npm run build
npm run check
# 각 공개 workspace에서 별도로 실행 (게시·lifecycle 실행 없음)
(cd packages/ai && npm pack --dry-run --ignore-scripts --json)
```

| 제안 커밋 단위 | 범위 | 제안 메시지 |
| --- | --- | --- |
| 선택 v2 | `scripts/tb-mini-suite.mjs`, `scripts/test/tb-mini-suite-ranking.test.mjs`, metrics의 선정 설명 | `fix(scripts): TB 선택의 결측 예상 시간과 소규모 할당 보정` |
| 감사 v2 | `scripts/lib/tb21-audit.mjs`, `scripts/test/tb21-audit-completion.test.mjs`, 감사 문서와 metrics의 해당 hunk | `fix(scripts): TB 미완료 결과와 소수초 순서 검증` |
| 배포 준비 문서 | ROADMAP 이력·현재 상태, metrics의 과거 상태 구분, changelog 2개, `.gitignore`의 캡처 경로 | `docs(release): 잔여 TB 변경과 로컬 배포 준비 기록` |

이번 후속 요청에서는 stage·commit·push·branch·PR·tag·npm 게시·workflow dispatch를
수행하지 않았다. 위 분할 및 커밋·푸시 범위를 승인받은 뒤 index 전체를 검사한다.
배포 승인은 별도다. 버전을 바꾸면 7개 package와 lock/shrinkwrap·릴리스 노트·README를
동기화하고 새 버전으로 빌드·검사·pack을 다시 실행해야 한다.

실제 게시 경로는 기존 CI다. `release:*` 스크립트는 버전 변경뿐 아니라 commit·tag·push까지
수행하므로 준비 단계에서 실행하지 않았다. 게시 실패는 원인을 고친 뒤 같은 태그의
공식 workflow를 재실행하며, 동일 버전용 release 스크립트를 다시 실행하지 않는다.
태그·GitHub Release·7개 npm latest가 일치하기 전에는 새 배포 완료라고 보고하지 않는다.

[^S1]: Harbor, [Terminal-Bench 2.1 dataset](https://hub.harborframework.com/datasets/terminal-bench/terminal-bench-2-1/6). 데이터셋 식별과 89-task 구성. 확인일 2026-09-07.
[^S2]: Harbor, [Terminus-2](https://www.harborframework.com/docs/agents/terminus-2). 기준 agent와 terminal 실행 구조. 현재 문서의 세부 동작을 설치된 Harbor 0.20.0의 구현과 동일하다고 가정하지 않음. 확인일 2026-09-07.
[^S3]: Terminal-Bench, [Benchmarks](https://www.tbench.ai/benchmarks). TB 2.1 2026-05-06, TB 4.0 2026-08-28 공개일. 확인일 2026-09-07.
[^S4]: statsmodels, [mcnemar](https://www.statsmodels.org/stable/generated/statsmodels.stats.contingency_tables.mcnemar.html). 쌍대 분할표와 정확 이항 검정의 방법 근거. 위 수치는 현재 2:3 불일치 표에서 계산함. 확인일 2026-09-07.
[^S5]: Terminal-Bench, [Leaderboard Integrity Update](https://www.tbench.ai/news/leaderboard-integrity-update). 2026-04-19 공지의 평가 무결성 원칙. 해당 공지를 모든 후속 버전의 현재 제출 절차와 동일시하지 않음. 확인일 2026-09-07.
