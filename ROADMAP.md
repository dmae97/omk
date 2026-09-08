# OMK 하네스 고도화 로드맵

벤치마크 관측 기준일: **2026-09-07**. 구현 기록 갱신: **2026-09-08**.
대상: **Terminal-Bench 2.1의 OMK 대 Terminus-2 비교**와 이를 재현하는 실행 경로.

현재 상태: R0 선택기 완료, R1 결과 감사·R2 상한 수치 검증 부분 구현.
§9는 초기 체크포인트이며 **최신 구현·검사·남은 조건은 §11**에 기록한다.

**권고: 모델 계약과 측정 신뢰성을 먼저 고정하고, 요청 왕복·마감시간·검증 비용을 줄여. 다중 에이전트와 학습형 라우터 확대는 그다음이야.**

이 문서는 현재 관측, 기존 작업 트리 구현, 이번 변경, 앞으로의 설계를 구분해. 제안된 단계 전체를 구현 완료하거나 성능 향상을 검증했다는 뜻이 아니야. 이번 작업에서 유료 모델 호출, benchmark(벤치마크) 재실행, 전체 빌드, Git 커밋·푸시·공개 제출은 하지 않았어.

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

## 11. 구현 진행 기록 — 2026-09-08

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

### 11.4 현재 검사 결과

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

[^S1]: Harbor, [Terminal-Bench 2.1 dataset](https://hub.harborframework.com/datasets/terminal-bench/terminal-bench-2-1/6). 데이터셋 식별과 89-task 구성. 확인일 2026-09-07.
[^S2]: Harbor, [Terminus-2](https://www.harborframework.com/docs/agents/terminus-2). 기준 agent와 terminal 실행 구조. 현재 문서의 세부 동작을 설치된 Harbor 0.20.0의 구현과 동일하다고 가정하지 않음. 확인일 2026-09-07.
[^S3]: Terminal-Bench, [Benchmarks](https://www.tbench.ai/benchmarks). TB 2.1 2026-05-06, TB 4.0 2026-08-28 공개일. 확인일 2026-09-07.
[^S4]: statsmodels, [mcnemar](https://www.statsmodels.org/stable/generated/statsmodels.stats.contingency_tables.mcnemar.html). 쌍대 분할표와 정확 이항 검정의 방법 근거. 위 수치는 현재 2:3 불일치 표에서 계산함. 확인일 2026-09-07.
[^S5]: Terminal-Bench, [Leaderboard Integrity Update](https://www.tbench.ai/news/leaderboard-integrity-update). 2026-04-19 공지의 평가 무결성 원칙. 해당 공지를 모든 후속 버전의 현재 제출 절차와 동일시하지 않음. 확인일 2026-09-07.
