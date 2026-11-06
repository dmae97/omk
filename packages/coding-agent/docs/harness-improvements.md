# OMK 하네스 코드와 품질 점검 — 2026-10-30

대상 독자는 OMK 유지보수 담당자와 릴리스 검토자다. 이 문서는 현재 하네스의 검증 상태와
후속 작업을 구분한다. 전체 제품의 정확성, 보안, 성능 또는 원격 CI 통과를 보증하지 않는다.

## 기준과 범위

- 브랜치: `feat/explore-agent-tool`
- 시작 HEAD: `7c04fba991ebc66e48a7f2ffbc5246c6d1f50e6e`
- 패키지 기준: `open-multi-agent-kit` 1.5.10
- 범위: `packages/coding-agent`의 세션 수명주기, 컨텍스트 예산, compaction, durable goal,
  도구 실행과 session control. 전체 비-e2e 시험에서는 다른 workspace의 실패도 구분해 기록한다.
- 작업 트리에는 다른 세션의 미커밋 변경이 다수 있었다. 결과는 순수한 HEAD가 아니라
  **검사 시점의 작업 트리**에 대한 것이다. 다른 세션의 소스와 생성 카탈로그는 수정하지 않았다.

## 종합 판정

**초기 감사에서 발견한 AI와 TUI 실패는 후속 디버깅으로 해소했고, 최종 전체 비-e2e 시험과 저장소 정적 가드가 모두 통과했다.**

초기 `packages/coding-agent` 검사에서는 901개 시험 파일에서 10,282개 테스트가 통과하고 57개가 걸러졌다.
그러나 초기 전체 `./test.sh`는 AI 모델 카탈로그 실패 6건과 TUI의 기존 너비 속성 실패 2건으로
종료 코드 `1`이었다. 아래 발견 표는 그 초기 상태를 보존한다. 후속 수정과 최종 결과는 다음 절에 기록한다.

## 후속 디버깅 결과

- **AI stale 회귀 정리:** live OpenCode Go와 models.dev 응답이 모두 `200`이고 대상 6개 ID는
  live 목록에 없음을 확인했다. 생성 카탈로그를 되살리는 대신 `packages/ai/test/opencode-go-payload.test.ts`에서
  제거된 모델의 오래된 기대를 정리했다. payload와 catalog 대상 검사 88개가 통과했다.
- **TUI 너비 계산 수정:** `packages/tui/src/visible-width.ts`는 선행 비출력 문자를 제거한 base의
  trailing AM만 추가 계산한다. `packages/tui/src/utils.ts`는 전체 입력이 실제로 맞는지 먼저 확인하고,
  ANSI로 분리된 grapheme의 보존 접두사는 부분 폭 합이 아니라 전체 후보 폭으로 제한한다. W4b와 W5b를
  정식 회귀로 복귀시켜 속성 테스트 10개와 TUI 전체 844개 테스트가 통과했다.
- **pi-lens 후속 정리:** `reasoning-drop.ts`의 이중 assertion을 `Object.entries()`로 제거하고,
  cache invalidation의 bare `object`를 `Record<string, unknown>`로 좁혔다. 관련 회귀 82개와 두 파일의
  error-level 재진단이 통과했다. JSON과 외부 모듈 경계의 의도된 `unknown`은 그대로 유지한다.
- **무제한 스킬 admission:** `skill-admission-ledger.ts`의 10개 제한과 legacy cap 거부를 제거했다.
  명시 호출, resume, `read`, worker hand-off와 자동 로드에서 10개를 초과한 본문을 허용하고,
  dedupe와 unknown-version fail-closed는 유지한다. 대상 회귀 44개와 `npm run check`가 통과했다.
- **SWE-2 stale usage 회귀:** 실제 `estimated=264850`, `limit=219416` 사례를 재구성했다.
  현재 소스와 활성 `dist`는 compaction 경계 뒤 추정값을 이전 usage 없이 다시 계산한다.
  `agent-session-compaction.test.ts`에 정확한 공개 경로 회귀를 추가해 관련 74개 테스트가 통과했다.
- **최종 전체 검증:** `npm run check`와 `./test.sh`가 모두 종료 코드 `0`이다. 최종 coding-agent
  시험은 901개 파일에서 10,276개 통과 및 57개 skip, AI는 140개 파일에서 1,325개 통과 및 818개 skip,
  TUI는 844개 통과 및 실패 0이다.

## 우선순위별 발견

| 우선순위 | 발견 | 근거와 권고 |
| --- | --- | --- |
| P1 | `opencode-go` payload 회귀 6건이 모델 누락으로 실패 | `packages/ai/test/opencode-go-payload.test.ts`가 요구하는 `mimo-v2.5`, `mimo-v2.5-pro`, `kimi-k2.6`, `glm-5.1`, `minimax-m2.5`, `minimax-m2.7`을 현재 `getModels("opencode-go")` 결과에서 찾지 못한다. 생성 파일을 손으로 고치지 말고 카탈로그 생성 작업에서 공급자 응답과 diff를 검토한 뒤 같은 회귀를 다시 실행해야 한다. |
| P1 | TUI 너비 계산의 알려진 속성 결함 2건이 전체 시험을 실패시킴 | `packages/tui/test/width-invariants.property.test.ts`의 W4b와 W5b가 각각 ZWJ가 앞선 태국어 입력과 SGR로 분리된 하트 grapheme에서 실패한다. 요약상 일반 테스트 842개는 통과하지만 known-defect 속성 검사가 종료 코드를 실패로 만든다. |
| P2 | `AgentSession`이 정적 분석과 리뷰 가능 범위를 초과 | `packages/coding-agent/src/core/agent-session.ts`는 5,598줄이며 5,000줄 LSP 진단 상한을 넘는다. 모듈 크기 ratchet는 기존 baseline 아래에서 통과하지만, 이는 구조 개선 증거가 아니다. 동작 변경과 분리해 `specs/agent-session-split/spec.md`의 책임별 분해를 갱신하는 편이 안전하다. |
| P2 | 타입 경계 보조 진단과 미확인 파일이 남음 | 하네스 경로 100개 제한 검사에서 bare `object`, `unknown` 반환, 이중 assertion 관련 보조 진단 23건이 나왔다. 52개 파일은 확인 불가 또는 미실행이다. 이 항목들은 `tsgo` 오류와 동일시하지 않으며 개별 소스 검토 없이 일괄 수정하지 않는다. |
| P2 | 명세 원본의 상태 문구와 현재 동작이 서로 다른 시점을 가리킴 | 다수의 `spec.md`는 작성 당시 draft 상태를 그대로 보존한다. `specs/README.md`는 이를 현재 상태로 재해석하지 않고 전체 색인과 시점 구분을 제공해야 한다. |
| P3 | 저장소 리뷰 그래프를 생성하지 못함 | 프로젝트 파일 수가 2,333개 상한을 넘어 `project_report`가 비활성화됐다. 이번 판정은 모듈별 검사와 실제 테스트에 근거하며 전 저장소 호출 그래프 분석은 미검증으로 남긴다. |

## 다섯 축 검토

### Correctness

- coding-agent의 비-e2e 회귀 10,282개 통과는 현재 하네스의 강한 긍정 증거다.
- 전체 성공으로 확대 해석할 수 없는 AI와 TUI 실패를 별도로 유지한다.
- live provider, 유료 실행, 실제 원격 CI와 전체 e2e는 이번 검사에 포함하지 않는다.

### Readability and architecture

- `npm run check:module-size`는 통과하며 61개 모듈이 baseline보다 작아졌다고 보고한다.
  이 baseline은 다른 세션의 변경과 섞일 수 있으므로 이번 문서 작업에서 자동 갱신하지 않는다.
- import cycle 검사는 기존 34개 baseline을 유지한다. 새 순환 참조가 없다는 뜻이지 순환 참조가
  없다는 뜻은 아니다.
- `AgentSession`의 크기와 LSP 상한 초과는 향후 분해의 가장 구체적인 구조 신호다.

### Security

- `startSessionControl()`은 소유한 영속 세션, POSIX 전용 소켓, 0700 디렉터리, 0600 소켓,
  랜덤 토큰, 요청 크기와 연결 수 상한, 세대별 abort 제한을 확인한다.
- 이는 소스 검토와 회귀에 근거한 경계 확인이며 침투 시험이나 OS 수준 격리 증명은 아니다.
- 로그와 문서에 인증 정보를 기록하지 않았다.

### Performance

- 컨텍스트 예산과 캐시 관련 회귀는 coding-agent 전체 시험에 포함된다.
- 이번 작업은 A/B, p95, RSS, provider cache hit 또는 모델 품질을 측정하지 않았으므로
  성능 개선이나 회귀를 주장하지 않는다.

### Verification quality

- 저장소 표준 `test.sh`를 사용해 인증 정보 없는 격리 환경에서 비-e2e 시험을 실행했다.
- 전체 시험이 실패한 뒤에도 각 workspace의 결과를 개별 집계해 하네스 통과와 외부 실패를
  구분했다. 실패한 검사를 생략하거나 약화하지 않았다.
- 빌드는 저장소 규칙에 따라 이번 문서와 검사 요청에서 실행하지 않았다. 따라서 현재 `dist`나
  실행 중인 TUI 반영은 검증하지 않는다.

## 문서와 Spec Kitty 동기화

- 사용자 문서의 현재 진입점은 [Usage](usage.md), [Environment Variables](environment-variables.md),
  [Run Protocol](run-protocol.md), [SDK](sdk.md), [Sessions](sessions.md),
  [Compaction](compaction.md)과 [Metrics](metrics.md)다.
- 아래 2026-09-05 기록과 [Runtime Algorithms and Direction](runtime-algorithms.md)은
  시점별 기록으로 유지하고, 최신 판정은 이 문서의 앞부분에 기록한다.
- `specs/README.md`는 001부터 119까지 존재하는 명세를 색인한다. 원본 명세의 draft 문구는
  역사 기록이며 현재 동작은 소스, 테스트와 release tag로 확인한다.
- Spec Kitty CLI와 `.kittify/metadata.yaml`은 모두 3.2.7이며 `spec-kitty upgrade
  --agent-check --json`도 `action: none`, `reason: up_to_date`를 반환했다.
- 현재 `kitty-specs/attachment-preview-memory-operational-01M45JAP`는 2026-10-05에 승인된
  별도 미션이다. 이번 하네스 감사 결과를 그 미션에 덧붙이지 않는다.
- Spec Kitty 3.2.7의 `mission create`는 스캐폴드 커밋을 항상 수행한다. 이번 요청에는 커밋
  승인이 없으므로 새 미션을 만들지 않았다. `.kittify/config.yaml`의 자동 커밋 설정은 바꾸지 않고,
  `specs/README.md`의 명세 색인만 갱신했다.

## 실행 기록

| 명령 | 종료 상태 | 결과 |
| --- | --- | --- |
| `spec-kitty upgrade --agent-check --json` | 0 | 설치 버전과 최신 버전 모두 3.2.7 |
| `./test.sh` 초기 실행 | 1 | coding-agent 901개 파일, 10,282개 통과 및 57개 skip. AI 6개 실패와 TUI known-defect 2개로 전체 실패 |
| `npm run check:module-size` (`npm run check` 남) | 0 | 기존 baseline 유지, 61개 모듈 축소 보고 |
| `npm run check:import-cycles` (`npm run check` 남) | 0 | 기존 34개 baseline 유지 |
| LSP 보조 진단, 하네스 경로 최대 100개 | 부분 확인 | 35개 clean, 보조 진단 23건, 52개 미확인, `agent-session.ts` 상한 초과 |
| `npm run check` | 0 | Biome, 타입 검사, 문서 링크와 저장소 가드 통과 |
| AI payload와 catalog 대상 검사 | 0 | 2개 파일, 88개 통과 |
| TUI 속성 검사 | 0 | W4b와 W5b를 정식 회귀로 복귀, 10개 통과 |
| pi-lens 후속 회귀 | 0 | compaction과 cache invalidation 3개 파일, 82개 통과 |
| 무제한 스킬 admission 회귀 | 0 | ledger, 세션, read, worker, 자동 로드, 문맥 예산 44개 통과 |
| SWE-2 admission 회귀 | 0 | compaction 경계의 stale usage 제외를 포함해 74개 통과 |
| `./test.sh` 최종 실행 | 0 | 전체 비-e2e 통과. coding-agent 10,276개, AI 1,325개, TUI 844개 통과 |

## 최종 검증과 남은 범위

최종 `npm run check`와 `./test.sh`는 모두 종료 코드 `0`으로 통과했다. `git diff --check`도 종료 코드 `0`이다.
처음 링크 가드는 새 미추적 문서 링크를 거부했으므로, 신규 파일을 커밋하는 대신 기존 추적 문서인
이 파일에 감사 내용을 통합하고 2026-09-05 기록은 아래에 보존했다.

명시적으로 미검증인 항목은 전체 e2e, live provider, 유료 벤치마크, 성능 A/B, 원격 CI,
설치된 배포본, 현재 `dist`, 실행 중인 세션 반영, 전 저장소 호출 그래프다. 이 문서는
로컬 작업 트리의 시점별 감사이며 독립 리뷰어나 사람의 릴리스 승인을 대신하지 않는다.

---

## 2026-09-05 기록

기준은 `60f520f0c1`에서 시작한 현재 작업 트리입니다. 시작 시 다른 작업의
미커밋 변경이 존재했으며 이를 보존했습니다. 아래는 주요 실행 경로에 대한
소스·로컬 회귀 테스트 점검이지, 전체 코드 감사나 성능·SOTA 인증이 아닙니다.
이번 변경은 작업 트리 상태이며 배포·릴리스된 기능으로 간주하지 않습니다.

## 이번에 수정한 항목

| 우선순위 | 관찰한 문제 | 수정과 증거 |
| --- | --- | --- |
| P0 | WPL의 `shouldSubmit`이 BLOCKED 여부만 확인해 preview·증거 부족·검증기 오류도 제출 가능으로 표시 | `b2c-mapper.ts`에서 적용 가능 + non-preview + run ID + `CONFIRMED`를 모두 요구. `submission-gates.test.ts`로 실패·누락·성공 대조 |
| P0 | deep runner의 음수·비정수·실패 종료 코드와 공백 증거가 완료로 인정됨 | `deep-wall.ts`에서 비어 있지 않은 digest/command와 종료 코드 `0` 요구. `deep-wall-gates.test.ts` |
| P0 | 완료된 deep check가 기존 BLOCKED/INCONCLUSIVE의 사람 검토 요구를 삭제 | `evaluate-correctness-wall.ts`가 기존 검토 요구를 유지하고, 요청한 deep check가 불가능하면 제출을 보류 |
| P1 | 같은 테스트가 패키지 디렉터리에서는 통과하지만 저장소 루트에서는 오래된 WPL `dist`를 읽어 실패 | 루트 Vitest 프로젝트 설정과 coding-agent의 WPL 소스 alias 추가. 루트 실행에서 7개 실패를 재현한 뒤 같은 테스트 통과 |
| P1 | WPL 사용자용 웹 가입·상담 접점과 키 없는 CLI 안내가 없음 | `getAdaptOrchLinks()`와 `omk doctor adaptorch --links [--json]` 추가. 고정 URL·UTM만 제공하며 정책 판정과 분리 |

WPL의 `canApply`와 기존 shadow/soft/hard 적용 정책은 바꾸지 않았습니다.
증거 요건을 충족한 `shouldSubmit=true`도 사람의 커밋·병합·배포 승인을 대신하지 않습니다.
CTA를 verdict, 서명 receipt, 모델 프롬프트 또는 tool 실행 게이트에 끼워 넣지 않았습니다.

## 다음 개선 순서

| 우선순위 | 영역 / 현재 근거 | 후속 작업과 완료 기준 |
| --- | --- | --- |
| P0 | 전체 정적 검사: 아래 기존 파일의 Biome 오류 4개와 module-size 초과 5개 | 해당 변경 소유자가 수정한 뒤 `npm run check` 전체를 다시 통과시킬 것. 이번 작업 밖의 diff나 크기 baseline을 임의 수정하지 않음 |
| P1 | 완료·취소·재시도: `prompt-settlement.ts`, `session-termination.ts`, `tool-timeout-settlement.ts` | 중간 `agent_end`와 최종 완료를 계속 분리. timeout 후 계속 쓰는 도구, 큐 취소, 중단 복원 조합을 실제 세션 경계 회귀에 추가 |
| P1 | 컨텍스트·스킬: Context Budget V2와 Grok의 요청별 skill 선택은 별도 경로 | 공급자별 컨텍스트 비용·캐시 적중·compaction 후 명시 규칙 보존을 같은 작업으로 비교. 일반 공급자로 확장하기 전에 explicit-only 권한과 토큰 상한 회귀 확보 |
| P1 | 공급자·도구 계약: `tool-schema`와 종료 원인 분류 테스트 | 인증/모델 미지원/환경 실패를 후보 코드 실패와 계속 구분. JSON schema 정규화와 tool pair 수선 후 공급자별 키 없는 cassette 회귀를 일관된 진입점에서 실행 |
| P2 | 자원·스케줄링: DAG scheduler, resource admission의 현재 테스트 | `observe` 데이터를 먼저 수집하고 p95 지연·메모리·중복 도구 실행을 측정. adaptive 기본값 변경이나 자동 fan-out은 별도 승인·비교 실험 이후 |
| P2 | 구조: 큰 session/interactive 모듈과 버전이 다른 런타임 설명 | 동작 변경과 파일 이동을 분리하고 역할별 모듈 크기·import-cycle 기준을 유지. 오래된 문서는 실제 소비자·기본값·revision에 묶어 갱신 |
| P2 | CRM: 이번 변경은 링크 전달까지만 구현 | 사이트 측 동의 기반 UTM 보존 → 가입/상담 제출 → 첫 사용 이벤트를 연결하고, 로컬 평가와 호스티드 사용을 분리 집계. 링크 출력은 전환이 아님 |

측정은 [Turn metrics](metrics.md)의 동일 모델·공급자·작업·예산 비교 계약을 따릅니다.
회귀 테스트 통과만으로 더 빠르다거나 정확도가 높아졌다고 주장하지 않습니다.
AdaptOrch 브리지는 계속 기본 비활성·advisory이며, WPL은 기본 CLI에서
자동 dispatch/polling 루프가 되지 않습니다.

## 검증 기록

- 제출/deep-check 신규 회귀: 수정 전 **25개 중 17개 실패**, 수정 후 모두 통과.
- CRM 안내 신규 회귀: 수정 전 **8개 중 7개 실패**, 수정 후 모두 통과.
- WPL 관련 **9개 파일 / 68개 테스트 통과**. 변경한 mapper, deep wall, evaluator,
  service links 네 모듈의 V8 커버리지: **lines 98.74%, branches 94.7%, functions 100%**.
  `service-links.ts`는 모든 지표 100%.
- coding-agent 하네스/컨텍스트/자원/브리지/벽 회귀 **13개 파일 / 154개 통과**.
- 기존 doctor + 신규 offline handoff **2개 파일 / 20개 통과**.
- 실제 소스 CLI 진입점 3개 시나리오와 agent scheduler/timeout/harness,
  AI tool schema를 루트에서 함께 실행: **5개 파일 / 48개 통과**.
- 최종 루트 통합 실행: 위의 **29개 파일 / 290개 테스트 모두 통과**, 종료 코드 `0`.
- 루트 `node_modules/.bin/tsgo --noEmit`: 종료 코드 `0`. 변경 TypeScript 13개 파일의 LSP 오류 없음.
- 변경 소스·테스트 Biome 검사와 범위 지정 `git diff --check`: 종료 코드 `0`.
- `check:doc-links`, `check:feature-claims`, `check:private-home`, `check:import-cycles`:
  각각 별도 실행에서 종료 코드 `0`. private-home 검사는 추적 중인 파일 범위입니다.
- `npm run check`: 종료 코드 `1`, 아래 기존 파일의 import 정렬/포맷 오류 4개에서 중단.
  이후 연결된 전체 게이트가 실행됐다고 간주하지 않습니다.
- 별도 `npm run check:module-size`: 종료 코드 `1`, 이번에 수정하지 않은 아래 5개 모듈이
  기존 baseline을 초과. 새 baseline을 등록해 오류를 숨기지 않았습니다.

전체 검사를 막은 이번 작업 밖의 파일:

- `packages/ai/src/utils/oauth/meta.ts`
- `packages/ai/test/openai-responses-codex-turn-metadata.test.ts`
- `packages/coding-agent/test/mcp/tools.test.ts`
- `packages/coding-agent/test/session-termination.test.ts`

Module-size 초과 파일 (현재 pure LOC / baseline):

- `packages/agent/src/harness/reverse-skill.ts`: 905 / 792
- `packages/ai/src/types.ts`: 362 / 361
- `packages/coding-agent/src/core/model-registry.ts`: 886 / 885
- `packages/coding-agent/src/core/provider-usage.ts`: 996 / 994
- `packages/coding-agent/src/modes/interactive/interactive-mode.ts`: 5574 / 5473

주요 신규 계약 재실행:

```bash
LIVE_E2E=0 node node_modules/vitest/dist/cli.js --run \
  packages/adaptorch-wpl/test/submission-gates.test.ts \
  packages/adaptorch-wpl/test/deep-wall-gates.test.ts \
  packages/adaptorch-wpl/test/service-links.test.ts \
  packages/coding-agent/test/adaptorch-onboarding.test.ts \
  packages/coding-agent/test/adaptorch-doctor-cli.test.ts \
  packages/coding-agent/test/adaptorch-links-cli.test.ts
```

명시적으로 미검증: 실제 Docker runner, 실제 인증 API 요청, 사이트 가입·상담
저장, 클릭/전환 집계, 유료 provider 실행, 전체 e2e, 설치된 배포본/TUI 반영.
벤치마크·AdaptOrch 실행·배포·커밋은 수행하지 않았습니다.
CRM 사용법과 개인정보 경계는 [AdaptOrch 안내](adaptorch-onboarding.md)를 참조하세요.
