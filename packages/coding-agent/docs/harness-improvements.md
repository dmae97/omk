# OMK 하네스 개선 점검 — 2026-09-05

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
