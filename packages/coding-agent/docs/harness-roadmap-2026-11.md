# 하네스 강화와 Rust 전환 실행 로드맵

2026-11-12. 기준: `3045c4ca2f`와 spec 120 결정 I1. 구현 계약은
[spec 121](../../../specs/121-evidence-driven-harness/spec.md), 근거와 한계는
[연구 검토](harness-research-2026-11.md)에 있다. 이 문서의 목표 수치는 제안된
수용 기준이며 측정 결과가 아니다. 더 강한 하네스를 목표로 하지만 현재 버전이나
경쟁 제품 대비 우위는 아직 측정하지 않았다.

## 실행 원칙과 상태

기존 spec-kit 거버넌스, `omk-protocol`, durable goal, verified-run, Context
Budget V2와 lane runtime을 재사용한다. 새 오케스트레이터/메모리 장부/권한
어휘를 만들지 않는다. 기능의 구현, 활성화, 실제 효과를 별도로 기록한다.

| 단위 | 결과물 | 상태와 증거 |
| --- | --- | --- |
| K0/T012 | 승인된 G0/I1 corpus, legacy marker 호환, fresh contract gate | 로컬 완료. `verify-k0.sh` 통과. 신규 fixture의 macOS/Windows 실행은 미수행 |
| H1 | generation이 지난 checkpoint evidence의 명시적 재검증 표시 | 소스 구현, 12개 SDK/컨트롤러 회귀 테스트 통과. 설치된 TUI에는 미적용 |
| H2 | 기존 TB 감사 위의 반복 시행 CLI | 소스 구현, 합성 CLI/기존 감사 테스트로 검증. 모델 해결률 실험은 없음 |
| H3a/H7a | 고정 복구 20개, 공격/정상 7쌍과 누락/skip 거절 게이트 | [회귀 corpus](harness-corpus.md) 구현. Linux 34개 사례, 검증기 23개 테스트와 저장소 검사 통과. preflight와 플랫폼 확장은 미구현 |
| H3/H7 후속, H4–H6/H8 | resume preflight, 플랫폼 확장, 컨텍스트/위임/평가 실험 | 계획. corpus 통과를 런타임 기능/모델 성능 향상으로 표시하지 않음 |
| K1–K8 | 기존 Rust 단계 | 기존 승인/의존성/플랫폼 게이트 유지 |

## A. 현재 Node 하네스 강화

### H1 — 연속성에 증거의 나이를 표시

- 근거: A1/A2, M1. 기존 checkpoint formatter의 단일 경로를 수정한다.
- 현행 generation은 `Verified`, 이전 것은 `Historical evidence (reverify)`.
- 저장 스키마, checksum, 권한, 완료 reducer는 변경하지 않는다.
- 검증: `test/durable-goal-checkpoint.test.ts`,
  `test/goal-controller-checkpoint.test.ts`, G0/I1, `npm run check`.
- 완료 조건: 오래된 증거가 현재 증거로 표시되는 회귀 0, 현재/없음/재시작/
  비신뢰 workspace checkpoint 대조군 유지. 동일 스키마로 롤백 가능.

### H2 — 반복 실행을 정직하게 측정

- 근거: A3, G1, M1. 기존 `tb21-audit`의 입력/검증/출력을 재사용한다.
- 별도 repeat-set에서 n회 manifest와 digest를 사전 고정한다. task, 조건,
  모델 설정, harness/adapter가 다르면 집계를 거절한다. 누락과 중복도 거절.
- 지표: task별 pass@1, pass@k와 all-k-success 추정, 실패/timeout 수, 전체 비용,
  성공 시행당 비용. 최고 한 번을 일관된 성공으로 보고하지 않는다.
- 검증: `node --test scripts/test/tb21-repeat-audit.test.mjs` 및 기존 TB 감사 3개
  테스트. 미완료/비용 누락/중복 ID/조건 변경/경로 탈출/overflow 음성 대조군.
- 한계: 기록 감사이지 실제 모델 동일성, 시행 독립성, 청구서나 유의성의 증명은
  아니다. 상세 입력은 `tb21-repeat-audit.md`를 참고한다.

### H3 — 재개 전에 실행 환경과 승인 상태를 확인

- 의존: H1, existing goal/Run contracts. 근거: A1, M1.
- 재사용: `goal-verification.ts`, `durable-goal-store.ts`,
  `compaction/control-state.ts`, 기존 subagent checkpoint brief.
- 결과물: 명시적으로 승인된 smoke command, workspace digest, 마지막 관측
  상태를 기존 계약에 연결하는 opt-in resume preflight. 계획과 사실은 분리.
- 테스트: 강제 중단→재시작, 변경된 파일, 사라진 도구, 해제된 승인, 과거 receipt,
  unknown side effect, 남아 있는 child process, 모델 교체. 같은 효과를 재실행하지 않음.
- 지표/기준: 고정된 20개 합성 recovery 시나리오에서 중복 부작용 0, stale
  승인 재사용 0, 누락된 committed entry 0. 정상 재개 대조군은 모두 통과.
- 순서: 실패 fixture와 기대 상태를 먼저 커밋 대상으로 준비→기존 진입점 연결→
  focused tests→G0→check. smoke command 승인은 재시작만으로 복원하지 않는다.
- 롤백: opt-in 제거, 기존 명시 재개 경로로 복귀. 새 자동 재개 default 금지.

### H4 — 최소 컨텍스트와 회수 가능성을 함께 평가

- 의존: H2. 근거: A2, A4.
- 결과물: 기존 context-budget/compaction 후보의 단일요소 ablation. 먼저
  required context, provenance, pending tool pair, 사용자 제약 보존을 측정한다.
- 회귀 corpus: 도구 출력 넘침, 충돌하는 지침, 오래된 source hash, 필요한 정보가
  마지막에 등장, 다국어/긴 경로, 취소 중 compaction, 재요청 시 원본 회수.
- 수용 기준: hard constraint 보존 100%, 거짓 완료/비인가 효과 0, paired 성공률
  비열등 하한 -2pp보다 높음, solved task당 input tokens 중앙값 10% 이상 감소,
  p95 wall time 10% 초과 악화 없음. 수치는 시행 전 고정하고 결과 보고 바꾸지 않음.
- activation: 새 후보는 default-off. 실패하면 기존 알고리즘/원본 context 유지.
  원본 삭제나 필수 도구 숨김으로 토큰 절약을 만들지 않는다.

### H5 — 작업 구조와 관측 비용으로 위임을 제한

- 의존: H2, H7의 권한 대조군. 근거: G1/G2, M1.
- 단일 에이전트, 현재 lane 계획, 제한 병렬 계획을 동일 총 budget으로 비교한다.
- sequential/병렬 가능/공유 writer/도구 집약/고위험 작업군을 분리한다. 자동 추천은
  먼저 observation-only이며 호출 권한이나 실제 dispatch를 만들지 않는다.
- 기존 dependency, write-scope conflict, cancellation, reservation 소유권을 유지.
  실패한 결과를 합의나 평균 점수로 pass로 승격하지 않는다.
- 수용 기준: 안전 회귀 0, 동일 예산에서 성공률 +5pp 이상 및 paired 95% 하한 >0,
  또는 성공률 비열등(-2pp)과 solved task당 비용 10% 이상 감소. task군별 보고.
- 비용/도구 사용량 미확인은 추천 불가. Google 논문의 45% 임계값은 사용하지 않음.
- 롤백: 추천 미적용, 기존 고정 topology. 호스트가 위임을 금지하면 직접 실행.

### H6 — 생성자와 판정자의 역할을 분리하되 비용을 제한

- 의존: H2. 근거: A3/A4.
- outcome assertions, 정책 검사, 코드 품질 rubric을 별도 필수/참고 항목으로 둔다.
  이미 있는 `chooseWithAdvisoryJudge()`와 Task/Observation reducer를 재사용한다.
- 모델 평가는 deterministic pass 뒤에만 optional. rubric, model, 입력 digest와
  예산을 고정하고 동일 모델 자기평가를 독립 검증으로 부르지 않는다.
- calibration: 고정된 정답/오류/모호 30개 사례와 전문가 판정, unknown 경로.
  false acceptance 0을 요구하는 결정적 안전 사례는 모델 점수로 보완하지 않음.
- 수용 기준: 사전 합의한 품질 rubric에서 paired 개선, 모든 deterministic floor
  유지, 추가 평가 비용/latency 보고. 비용 상한 없으면 호출하지 않는다.
- 롤백: advisory off. 자동 승인, release, merge에는 연결하지 않는다.

### H7 — 실제 권한 경로의 공격과 정상 대조군

- 의존: 현재 sandbox/authority/receipt. 근거: S1/S2, G2.
- 합성 파일/가짜 API에서 악성 tool output, 조작된 checkpoint, 오래된 receipt,
  forged success, 출처 바꿔치기, 승인 밖 쓰기/네트워크를 시도하는 corpus.
- 성공 과제만 보지 않고 무단 효과 부재를 독립적으로 검사한다. 정당한 읽기,
  승인된 편집, 정상 재개도 같은 수로 포함해 과도한 차단을 발견한다.
- 수용 기준: scoped deterministic 공격에서 비인가 효과 0, false-pass 0,
  정상 대조군 100% 유지. 전체 prompt-injection 안전성을 주장하지 않는다.
- 모델 monitor는 경고용이다. 기존 OS sandbox/권한 검사/서명 또는 authenticated
  receipt 경계를 대체하지 않는다. 실제 계정/메일/결제 실험 금지.
- K3/K4 전에 플랫폼별로 복제하며 외부 확장 tool은 sandbox 밖이라는 사실을 명시.

### H8 — 모델 교체 때 불필요해진 장치를 제거

- 의존: H2와 각 후보. 근거: A4, G1.
- 새 모델/major harness 변경마다 baseline 대 full 대 one-component-off 비교.
- 모델 이름만이 아니라 실제 요청 provenance를 고정할 수 없으면 비비교 결과.
- 수용 기준: regression/safety floor 유지, 품질 비열등(-2pp), 비용 또는 p95
  latency 10% 이상 감소. 충족한 구성만 더 단순한 후보로 승격한다.
- 필수 보안 검사와 승인 경계는 제거 실험 대상이 아니다. 보호장치를 빼서 비용을
  줄인 결과는 부적격. 자동 self-modification/online policy learning은 별도 spec.

## B. Rust K1–K8의 구현 가능한 작업 단위

Rust는 더 강한 추론의 근거가 아니라 소유권/배포 선택이다. `preserve` 이식과
`advance` 개선을 같은 golden 변경으로 숨기지 않는다. 각 K 단계는 독립적으로
거절 가능하고, 대조 recorder 변경과 replay 구현을 분리한다.

| 단계 / 의존 | 첫 단위와 산출물 | 수용 게이트 | 남는 경계 |
| --- | --- | --- | --- |
| K1 / K0, B1 | 정확한 버전/전이 의존성/라이선스/build-script/macro review bundle. 승인 뒤 Anthropic request/SSE fixture recorder, 이어 Rust replay. OpenAI Responses, Chat Completions 순서 | RC2: header/body/Unicode/chunk split/tool streaming/error/cancel fixture 전부 일치, 네트워크 없는 tests, secret scan | 새 crate는 bundle 승인 전 추가 금지. 실제 OAuth/결제 테스트는 별도 승인 |
| K2 / K1 | 단일-writer session lifecycle, append/fsync recovery, queued input, budget/abort, compaction 순서로 작은 단위 | RC3/G0: node-vs-Rust recorded trace, 각 durable write 지점 kill/restart, 잃은 entry/중복 효과 0 | 목표/verified ledger 소유권 K7 유지. dual side-effect 실행 금지 |
| K3 / K2 | read/write/edit의 경로/인코딩/실패 parity, 다음 Linux supervision 재사용, macOS supervisor, Windows 명시 거절 | RC4/PL2, H7, exit/signal/truncation/timeout, readonly/protected path, symlink race 음성 테스트 | network와 OS backend 없으면 fail-closed, bash audit 선택은 명시적 |
| K4 / K2 | versioned stdio handshake/bounds, event-order read replica, manifest discovery와 generic specifier map, 이후 cancellation/host loss | EH1–5/PA1, 실제 Node child 사용, after-write sync read, backpressure, process-tree cleanup, handler replay 0 | 80 example entries와 owner corpus의 모든 disposition. private corpus는 저장소 밖 |
| K5 / K3,K4, Phase 2 | 모드별 print→JSON→RPC→ACP packaged-artifact gate, binary pin/Node version/path 검사, rollback | CM1/RB1/PZ1/PL1, Linux/macOS/Windows native runs, 설치/중단/재개/Node rollback | 모든 refused feature의 실제 named error. 플랫폼 run 누락은 pass 아님. release 별도 |
| K6 / K5 | renderer/keyboard baseline→extension compositing→IME/image/clipboard→terminal matrix | 실제 terminal/tmux/각 OS, 접근성/취소/resize, 기존 entry parity와 새 디자인 검토 | OpenTUI 느낌과 Rust renderer 선택은 별개. 디자인 변경은 이 단계 소유 |
| K7 / K5, H3/H5/H7 | grant ledger→revocation→recovery→scheduler→MCP/skills/packages/lanes, 각각 단일 owner 인계 | 기존 H2 회귀와 finite R oracle, lost-outcome quarantine, no double dispatch, 권한 만료/취소 | 연구 기반 개선을 포팅 성과로 혼동 금지. stage별 review bundle |
| K8 / K6,K7 | rollback rehearsal, 동일 release candidate의 모든 acceptance, 사용자 opt-in migration, 마지막 default flip | 모든 요구 모드/플랫폼 pass, 미해결 P0/P1 없음, 명시 owner 결정 | Node 제거와 major release를 이 작업에서 실행하지 않음 |

각 단위의 공통 순서: 기준 recorder/독립 oracle→실패 replay→최소 구현→focused
Rust/TS 검사→`npm run check`→문서/증거→다음 단위. 큰 포팅을 끝낸 뒤 한 번에
회귀 테스트를 붙이지 않는다. K4는 K3와 논리적으로 병렬 가능하지만 공유 파일과
권한이 겹치면 직접 순차 실행한다.

## C. 측정/승격 계약

1. 고정 task ID/checksum, grader digest, public/synthetic input, model/provider
   request identity, harness commit, dependency lock, container/tool versions,
   budget/timeout, stop policy를 시행 전에 저장한다.
2. 30개 task의 3회 paired trial을 pilot로 시작하되 개선 판정용 표본 수는
   pilot variance와 최소 효과에 따라 사전 확정한다. 작은 pilot를 확정 우위로
   발표하지 않는다. 비용 cap이 없어 이번 작업에서는 모델 실행하지 않는다.
3. 각 trial은 새 격리 환경과 과거 정답 없는 state. pair order는 고정 seed로
   교차 배치한다. 실패, timeout, abstention, infra failure를 모두 남긴다.
   infra failure를 제외하려면 두 arm 대칭 재실행 규칙을 사전에 정한다.
4. 분석 단위는 task. 동일 task의 반복을 독립 task로 부풀리지 않는다. task 단위
   paired bootstrap 10,000회, 95% 구간, fixed seed를 analysis manifest에 고정한다.
   H4/H5/H8의 threshold는 결과를 본 뒤 완화하지 않는다.
5. 주요 지표: outcome success, false completion, unauthorized effects,
   pass@1/pass@k/pass^k, abstention, solved당 비용, p50/p95 latency, input/output/
   cache tokens, retries, interventions, duplicated work. 필요한 분모가 없으면 null.
6. 1개 주요 비교를 먼저 지정한다. 탐색적인 여러 arm은 탐색으로 표시하고 독립된
   held-out 확인 전 default로 승격하지 않는다. 모델 judge는 인간 rubric과 보정한다.
7. raw trace는 로컬/접근 제한. 공개는 allowlisted outcome/digest만, 별도 검수와
   승인 뒤. API 키/환경 값/비공개 프롬프트/개인 경로/숨은 reasoning을 수집하지 않는다.

[기존 metrics 계약](metrics.md)이 우선한다. 반복 감사 CLI가 통과했다는 사실은
이 통계 실험 전체가 수행됐다는 뜻이 아니다.

## 다음 실행 순서

1. K0/I1와 H1/H2를 각각 독립 diff로 검토한다. commit/push/PR은 별도 요청 때만.
2. [K1 B1 검토](../../../specs/120-rust-core/k1-dependency-review.md)는 J1 승인 범위에서 임시 해석과 전이 그래프 검토를 완료했다. 최종 B1 승인과 빌드/편입 승인은 남아 있다. H3a/H7a corpus는 작성됐으며 H3 resume preflight와 H7 플랫폼 확장도 남아 있다.
3. bundle 승인 후 K1 provider 한 종류를 recorder와 replay로 분리 구현한다.
4. H2로 baseline 반복 증거를 수집할 모델/과제/달러 cap을 고정한다.
5. H4/H5/H6 중 관측된 최대 실패 원인 하나만 선택해 비교한다. 근거가 없으면
   더 많은 agent나 prompt를 기본값에 추가하지 않는다.
