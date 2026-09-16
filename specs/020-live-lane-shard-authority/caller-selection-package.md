# Caller Selection Package — Canonical Production Child Caller

**Spec**: `specs/020-live-lane-shard-authority/spec.md` (Unblock Condition 1)
**Status**: PROPOSED — 승인 대기. 승인 시 spec.md의 "Current Blocker"를 구현 amendment로 대체한다.
**조사일**: 2026-09-14. 본 문서는 실측(grep·파일 비교·테스트 존재) 근거만 담는다.

## 1. 후보 인벤토리 (전수)

조사: `child_process|spawn(` 전수(packages/*/src · examples/ · 설치 익스텐션), 코어 도구 레지스트리,
`pi-package-intake-candidates.ts` 상호참조.

| # | 후보 | 성격 | 판정 |
| --- | --- | --- | --- |
| C1 | **subagent 확장** — `examples/extensions/subagent/`(index.ts 1372줄). 설치본 `~/.omk/agent/extensions/subagent/index.ts`와 **바이트 동일**(diff 무차이), `state/subagent-deadline-profiles.json`으로 활성 사용 확인 | 하위 에이전트를 `omk` CLI 자식 프로세스로 스폰하는 **유일한 생산 spawner** | **유일 후보** |
| C2 | 코어 프리미티브 — `subagent-orchestration.ts`, `subagent-lane-launcher.ts`, `WorkloadPermitPool`, `prompt-settlement.ts` | 권한 부여자(요구가 통과해야 할 대상) | 후보 아님 |
| C3 | 도구 수준 spawn — bash·grep·find·MCP stdio transport·backend 등 | child-**agent 아님**(도구 프로세스) | 범위 밖 |

C1 유일성 보강 근거: 코어 도구 목록에 `subagent` 도구 없음(grep 0), `pi-package-intake-candidates.ts:171`
주석 "OMK already has the subagent tool + AdaptOrch WPL for orchestration" — 생산 도구의 실체가 C1.

## 2. 계약 매핑 — C1 vs spec 020 요구

| 요구 | C1 현재 상태 | 간극 |
| --- | --- | --- |
| Req1.1 단일 production caller | 유일 생산 spawner | — |
| Req1.2 plan 경유(`buildSubagentOrchestrationPlan`) | ✗ 자체 정책만: `maxParallelTasks`(비-ultra 8)·`concurrency min(4,n)`·ultra 무제한 (`deadline-budget.ts:16-18`) | plan 경유 추가 |
| Req1.3 부모 admission + 공유 permit pool 주입 | ✗ 세션 private (`agent-session.ts:2158` `_workloadPermitPool`, `:2133` `getCurrentResourceAdmission()`) | **공개 핸들 신설 필요** |
| Req1.4 자식 상한 축소만 | ✗ ultra 무제한이 부모 상한을 우회 | `configuredMaxParallelLanes`로 환원 |
| Req1.5 부모 abort → queued permit 취소 + 프로세스 트리 reaping | 부분 ✓ — abort→프로세스 그룹 TERM→KILL(grace 1.5s/force-settle 2s, `managed-process.ts`), README "Ctrl+C propagates to the entire detached subagent process tree". queued permit 취소는 launcher 책임 | launcher 경유로 완성 |
| Req2 소유권·결정적 폭 | `readScope`/`writeScope`는 `SubagentLaneSpec`에 존재(`subagent-orchestration.ts:45-46`) — C1은 스코프를 공급하지 않음 | 태스크→writeScope 매핑 |
| Req3 정산 카운터 | ✗ 호출 0 (blueprint G02) | launch 전 +1·terminal cleanup −1 배선 |
| Req4 opt-in 명령 샤딩 | 별건(executor는 internal) | 본 패키지 범위 밖, Req1 승인 후 |

## 3. Seam 간극과 해소안

- **G1 (핵심)**: `ExtensionContext`(`extensions/types.ts` ExtensionContext)에 admission·permit pool·settlement 접근이 없다.
  해소: 코어 공개 API 추가 — `open-multi-agent-kit`에 세션 바인딩 디스패처(예: `createSubagentLaneDispatcher`)를 노출해
  decision getter·공유 pool·promptRunId·정산 증감을 캡슐화. C1은 이미 `open-multi-agent-kit`을 임포트하므로
  개발/컴파일 바이너리(가상모듈) 양쪽 경로가 성립.
- **G2**: C1의 `executionPolicy` → `configuredMaxParallelLanes`로 환원(ultra=undefined는 부모 admission 상한으로 수렴).
- **G3**: 정산 증감 주체 = G1 핸들이 launchLane 래핑 시 수행(spec Req3.1–3.2).
- **G4**: 스코프 공급 규칙 — 스코프 미지정 lane의 기본값은 구현 시 확정(권고: fail-closed=writer 취급).

## 4. 권고

**Canonical funnel = C1 (subagent 확장)**, 배선 = C1의 spawn 루프를 `launchSubagentLanes`의 `launchLane`
콜백으로 이관 + G1 공개 핸들 신설. 근거:

1. 유일한 생산 spawner(설치본=소스 동일로 롤아웃 경로 단순),
2. 취소·프로세스 트리 소유가 3후보 중 유일하게 성숙,
3. spec Non-Goal "Adding another child runtime beside an existing caller" 준수(새 런타임 없음).

## 5. Unblock Conditions 대조

| # | 조건 | 상태 | 필요 작업 |
| --- | --- | --- | --- |
| 1 | canonical caller 선정·문서화 | **본 패키지** | 소유자 승인 → spec.md amendment |
| 2 | e2e 취소/프로세스트리 fixture | 미비 | `managed-process.test.ts` 기반 lane 경유 fixture 신규 |
| 3 | owned-path 충돌 fixture | 미비 | 신규 |
| 4 | parent-child evidence 매핑 승인 | 미비 | 매핑 문서 + 승인 |
| 5 | resource-observation review | spec 017 의존 | 선행 필요 |

## 6. 승인 후 실행 순서 (spec Planned Files 기준)

1. 코어: 공개 디스패처 핸들 + 세션 바인딩(`agent-session` → `sdk` 노출)
2. C1: spawn 루프 → `launchSubagentLanes` 이관, `executionPolicy` 환원, `writeScope` 공급
3. 정산: `prompt-settlement` 증감 배선
4. 테스트: `live-subagent-lane-integration`·`prompt-settlement-live-work`(+Req4 `live-shard-integration`)
5. 설정 표면: `resourceGovernor`에 lane 상한 노출(G3 해소)
