# 하네스 연구 적용 검토 — 2026-11-12

기준 소스: `3045c4ca2f`, K0 G0는 spec 120의 승인된 I1 기준을 사용한다.
이 문서는 주요 연구의 설계 원리를 OMK에 적용하기 위한 검토다. 모든 논문을
망라한 체계적 문헌고찰, 외부 시스템 재현, OMK 성능 우위의 증거가 아니다.
검색 범위는 에이전트 조정, 장기 작업, 컨텍스트, 평가, 권한 경계다.

## 결론: 검증 가능한 단순 실행부터

기존 Goal/Run/receipt/compaction/lane을 재사용한다. 먼저 낡은 증거 표시와
반복 평가의 빈틈을 닫고, 이후 컨텍스트와 위임의 추가 비용이 실제로 이득인지
한 요소씩 비교한다. Rust 이식의 동등성 게이트와 새로운 성능 개선 실험은
분리한다. 기능을 한꺼번에 켜면 어느 변경이 원인인지 알 수 없다.

공개 논문의 아이디어를 독자 구현한다. 논문 공개나 기업의 명성은 코드, 프롬프트,
테스트를 복사할 라이선스가 아니다. 이번 변경은 외부 코드를 복사하거나 새
의존성을 추가하지 않는다. 이후 복사하려면 파일별 MIT/Apache-2.0와 NOTICE를
검토한다. 비공개 Claude Code 구현이나 프롬프트는 사용하지 않는다.

## 확인한 원문과 적용 판단

### G1. Google Research/DeepMind 등의 agent scaling 연구

[논문 2512.08296v1](https://arxiv.org/html/2512.08296v1),
[Google Research 해설](https://research.google/blog/towards-a-science-of-scaling-agent-systems-when-and-why-agent-systems-work/).
본문의 실험 설계, 결과, 한계 절을 확인했다. 180개 설정과 네 벤치마크에서
작업의 순차 의존성과 도구 부하에 따라 다중 에이전트의 이득이 달랐다.

- 채택: 단일 실행을 기준군으로 두고 조정 비용, 중복 작업, 실패 전파를 함께
  측정한다. 독립적인 작업만 병렬화하고 결과는 중앙 검증을 통과시킨다.
- 피할 것: 논문의 45%나 도구 수를 범용 자동 분기 임계값으로 하드코딩하지
  않는다. 특정 실험에서 추정한 관계이지 OMK용 검증된 라우터가 아니다.
- 한계: 네 도메인과 당시 모델에 대한 관측이며 OMK 코딩 작업에서의 개선은
  미측정이다. 전역 token 비용과 추론 budget의 정의도 구분해야 한다.
- 배치: H5. 기존 `subagent-lane-ready-frontier.ts`와 권한 계약을 재사용한다.

### G2. Google DeepMind, Intelligent AI Delegation

[논문 2602.11865v1](https://arxiv.org/html/2602.11865v1).
정의와 위임 축, 권한/책임 논의를 확인했다. 전체 프로토콜 구현이나 실험 결과를
재현한 것은 아니다. 역할 분배뿐 아니라 검증 가능성, 가역성, 책임을 다룬다.

- 채택: 위임 계약에 기존 write scope, capability, budget, cancellation,
  result provenance와 acceptance를 결합한다. 거절과 미확인을 정상 결과로 둔다.
- 피할 것: 에이전트의 자기 신뢰도나 평판을 권한 승인으로 쓰지 않는다.
- 한계: 개념적 프레임워크이며 특정 라우팅 알고리즘의 성능 증거가 아니다.
- 배치: H5, K4. 새 위임 스케줄러 대신 기존 lane/Run 계약의 누락을 검증한다.

### A1. Anthropic, Effective harnesses for long-running agents

[원문](https://www.anthropic.com/research/effective-harnesses-for-long-running-agents).
작업 목록, 초기화, 증분 구현, 실제 사용자 경로 검사와 인계 구조를 확인했다.

- 채택: 완료 기준을 먼저 고정하고, 한 번에 검증 가능한 단위를 끝낸다.
  인계에는 완료 주장보다 실제 증거, 미해결 항목, 다음 검사를 남긴다.
- 피할 것: 매 턴 자동 커밋이나 대형 feature 목록 생성을 기본값으로 강제하지
  않는다. 모델이 자기 테스트를 지워 완료 처리하게 두지 않는다.
- 한계: 주로 웹 앱 개발 사례이며 Rust 전환이나 모든 업무의 일반적 우위는 아니다.
- 배치: H1 구현, H3 후속. 기존 durable goal checkpoint를 확장 없이 우선 수정.

### A2. Anthropic, Effective context engineering for AI agents

[원문](https://www.anthropic.com/research/effective-context-engineering-for-ai-agents).
JIT retrieval, compaction, 구조적 메모, 도구 최소화를 확인했다.

- 채택: 전문 대신 짧은 참조와 최신성 정보를 먼저 제공하고 필요할 때 읽는다.
  압축은 결정, 미해결 문제, 권한과 원본 참조를 보존한다.
- 피할 것: 모든 도구 출력 삭제, 무조건 reset, 단순히 토큰 수만 최소화하는 정책.
- 한계: 중요한 정보의 누락 비용과 검색 latency를 함께 재야 한다.
- 배치: H4. `context-budget-*`, `compaction/control-state.ts`, overflow guards,
  기존 output recall과 source-quote memory를 재사용한다.

### A3. Anthropic, Demystifying evals for AI agents

[원문](https://www.anthropic.com/research/demystifying-evals-for-ai-agents).
과제/시행/채점기/환경 결과의 구분, capability와 regression suite 분리,
반복 시행과 격리, pass@k와 pass^k를 확인했다.

- 채택: 기록된 성공 문장이 아니라 환경 결과를 검사한다. 실패/timeout을
  분모에 유지하고 반복 성공의 일관성을 별도로 보고한다.
- 피할 것: 최고 시행만 선택, 평가 환경 공유, 좋은 출력 경로 하나만 정답으로
  고정, 평가기 수정 뒤 과거 점수와 무표시 혼합.
- 한계: 모델 채점은 인간 보정과 unknown 경로가 필요하다. 작은 합성 검사로
  실제 모델의 해결률이 입증되지는 않는다.
- 배치: H2 구현. 기존 TB 감사기 위에 별도 반복 집계 CLI를 추가한다.

### A4. Anthropic, Harness design for long-running application development

[원문](https://www.anthropic.com/research/harness-design-long-running-apps).
계획/생성/평가 분리, 실제 앱 평가, 모델 변화에 따른 구성요소 제거를 확인했다.

- 채택: 객관적 검사와 주관적 품질 기준을 분리하고, 구성요소를 하나씩 제거하는
  ablation을 수행한다. 품질 이득과 비용을 같은 보고서에 남긴다.
- 피할 것: 모든 작업에 3-agent 구성을 강제하거나 기획자가 사용자 범위를
  임의로 크게 넓히는 것. 인상적인 데모를 비용 통제된 비교로 해석하지 않는다.
- 한계: 사례 기반이며 모델과 예산이 변한다. 원문도 평가기의 관대함과
  최신 모델에서 일부 구조가 불필요해지는 현상을 설명한다.
- 배치: H6. 기존 advisory judge가 결정적 pass/권한을 대체하지 못하게 유지.

### M1. Microsoft Research, Magentic-One

[기술보고서 2411.04468](https://arxiv.org/abs/2411.04468),
[설계와 위험 설명](https://www.microsoft.com/en-us/research/articles/magentic-one-a-generalist-multi-agent-system-for-solving-complex-tasks/).
보고서 초록과 공식 설계 설명을 확인했으며 전체 벤치마크를 재현하지 않았다.

- 채택: 사실과 가설, 계획을 구분하고 정체 시 재계획한다. 반복 평가에는 격리.
- 피할 것: 자기평가만으로 완료, 정체할 때 새 권한/예산을 자동 획득,
  기본 다중 에이전트 또는 자동 로그인/메일/외부 도움 요청.
- 한계: 모델 판단 기반 progress ledger도 오판할 수 있다. 기존 goal cap,
  identical-loop, scope-changed와 observed receipt가 우선한다.
- 배치: H3/H5. 새로운 장부를 늘리기 전에 기존 goal state에 대응시킨다.

### S1. Google/Microsoft/IBM 및 학계, prompt-injection 설계 패턴

[논문 2506.08837v1](https://arxiv.org/html/2506.08837v1).
서론과 여섯 설계 패턴 중 action selector, plan-then-execute, map-reduce,
quarantined LLM의 경계와 조건을 확인했다.

- 채택: 비신뢰 입력을 승인과 분리하고 실행은 호스트가 검증한다. 읽기 전용
  분석과 권한 있는 부작용은 별도 경로로 분리한다.
- 피할 것: 프롬프트 경고나 모델 감시자를 보안 경계로 취급, 요약문이면
  자동으로 신뢰, 일반 코딩 에이전트에 제한된 패턴의 보장을 그대로 주장.
- 한계: 보장은 해당 격리 가정과 기능 제한에 의존한다. 임의 shell/확장 도구의
  안전성을 이 논문 하나로 보장할 수 없다.
- 배치: H7, K3/K4. existing sandbox/authority/receipt 경계를 공격 사례로 검증.

### S2. Anthropic 등, SHADE-Arena

[논문 2506.15740v2 초록](https://arxiv.org/abs/2506.15740v2),
[공식 실험 설명](https://www.anthropic.com/research/shade-arena-sabotage-monitoring).
정상 작업과 숨은 부작용을 함께 평가하는 구조와 감시의 한계를 확인했다.

- 채택: 정상 목적 달성과 무단 부작용 부재를 별개의 필수 검사로 둔다.
  악성 사례뿐 아니라 정당한 작업을 막지 않는 음성 대조군도 포함한다.
- 피할 것: 감시 모델을 승인자로 사용, 비공개 사고 자료/내부 reasoning 수집,
  실제 메일/결제/계정에서 공격 실험, 공개 과제를 학습 후 독립 평가라 주장.
- 한계: 공격 능력 평가이지 자연 발생 동기의 측정이 아니다. 공개되지 않은
  전체 데이터셋을 사용했다고 주장하지 않는다.
- 배치: H7의 자체 합성 trace와 격리된 파일/가짜 서비스에서만 시작.

### O1. OpenAI, Harness engineering

[공식 URL](https://openai.com/index/harness-engineering/).
검색 색인에서 문서 지도와 기계적 제약에 관한 설명은 확인했으나 원문 fetch는
HTTP 403, Firecrawl은 인증 오류였다. **원문 확인 미완료**로 분류한다.

이 자료만 근거로 구현/효과를 주장하지 않는다. 문서 링크/드리프트 검사라는
기존 OMK 장치를 활용하되 상세 연구 편입은 원문을 읽은 뒤에 한다. 설정 변경,
인증 우회, 외부 서비스 가입은 하지 않았다.

## 기존 기능과 실제 적용의 구분

| 영역 | 이번에 확인한 기존 구현 | 이번 적용 / 남은 일 |
| --- | --- | --- |
| 장기 작업 | `durable-goal-checkpoint.ts`, `goal-controller-text.ts`, `goal-verification.ts` | H1: 이전 generation의 evidence를 Historical로 표시. 자동 재개 smoke 계약은 H3 |
| 검증 | `omk-protocol`의 Task/Observation/Evaluation, receipt-bound goal verification | 유지. self-report를 완료 근거로 대체하지 않음 |
| 평가 | `scripts/lib/tb21-audit.mjs`, `turn-metrics.ts`, ATIF exporter | H2: 동일 조건 반복 manifest 감사와 pass@k/pass^k 추정. 모델 실험은 아직 없음 |
| 컨텍스트 | Context Budget V2, compaction control state, overflow progress/guard | 이미 존재. H4는 대체 구현이 아니라 held-out 평가와 최소 차이 실험 |
| 병렬 실행 | lane-ready frontier, dependency/failure scope와 grants | 이미 존재. H5의 자동 추천 정책과 비용 이득은 미검증 |
| 보안 | bash 기본 network none, enforce/fail-closed, verified-run authority | 이미 존재. 이 정책은 모든 확장 도구를 격리하지 않음. H7에서 경로별 검사 |
| 계약 드리프트 | Rust-generated contracts와 fixture recorder | T012: fresh G0/RPC check를 `npm run check:contracts`에 편입 |

## 채택하지 않은 대안

- 새 다중 에이전트 프레임워크 도입: 기존 scheduler와 승인 체계가 이중화된다.
- 모든 모델에 고정 sprint/reset: 모델별 필요성이 다르며 latency와 정보 손실이 생긴다.
- 모델 기반 판정만으로 완료: 환경 결과/부작용 검증을 대신하지 못한다.
- 연구의 회귀계수 그대로 실행 정책에 사용: 실험 도메인 밖 보정이 없다.
- 강화학습/자동 프롬프트 진화 즉시 배포: 별도 데이터 권한, 비용, held-out 평가가 없다.

열린 핵심 질문은 **동일 예산의 OMK 실제 과제에서 어떤 추가 구조가 단순 실행보다
유의하게 낫느냐**다. 답은 로드맵의 사전 고정된 비교로 얻으며 외부 연구의
숫자를 OMK 성과로 가져오지 않는다. 세부 실행 순서는
[harness-roadmap-2026-11.md](harness-roadmap-2026-11.md)에 있다.
