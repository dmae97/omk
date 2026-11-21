# L0: 2.0.3 반영 대상 분류

기준일 2026-11-21. 공개 기준은 `v2.0.2` (`d4a0b7d6fa`). 작성 시점의 `origin/main`은 `9de7448587`이고, v2.0.2 이후 병합분은 테스트·문서 PR뿐이라 lane 범위에 영향이 없다.

분류 값: lane 번호(L1~L8)는 2.0.3에 넣는다. `later`는 2.0.3 게이트가 아니며 별도 PR로 진행한다. `drop`은 저장소에 넣지 않는다. 각 lane PR은 clean main에서 해당 항목만 다시 적용하고, 아래 원천을 통째로 복사하지 않는다.

## A. 로컬 엔진 패치

원천: `~/.omk/agent/engines/omk-2.0.2-release-RF4nWj`의 `git diff --cached v2.0.2`와 미추적 파일 (95개 경로). 버전·CHANGELOG·lock 파일은 처음부터 제외했다. 경로는 별도 표시가 없으면 `packages/coding-agent/` 기준이다.

| lane | 경로 |
|---|---|
| L1 | `src/core/sdk-provider-stream.ts`, `test/sdk-provider-stream-oauth-recovery.test.ts` (OAuth 거부 토큰 1회 갱신, 이벤트 전달 후 재시도 금지) |
| L1 | `src/migrations.ts`, `test/config-value-migration.test.ts` (tools/ 경고는 최상위 모듈 파일 또는 `index.*`가 있는 디렉터리에만) |
| L2 | 루트 `scripts/pi-inventory.mjs`, `scripts/test/pi-inventory.test.mjs` (삭제된 추적 파일 무시) |
| L2 | 루트 `scripts/check-ts-relative-imports.mjs`, `scripts/test/relative-import-boundary.test.mjs` (linked worktree 판정) |
| L2 | 루트 `scripts/prune-dist-orphans.mjs`, `scripts/test/prune-dist-orphans.test.mjs` |
| L2 | `vitest.config.ts` (`dist/**` 제외, omk-ai 소스 alias) |
| L2 | 삭제: `src/ci/verify-reporter.ts`, `src/core/domain-loadout-commands.ts` (`src`·`test`에서 참조 0건 확인) |
| L3 | `src/core/next-suggestion*.ts` 9개(신규 `next-suggestion-prose.ts`, `next-suggestion-display-log.ts` 포함), `src/modes/interactive/next-suggestion-*.ts` 6개, `src/modes/interactive/suggestion-active-editor.ts`, `src/core/turn-metrics-record.ts` (`quotaReadMs` 진단) |
| L3 | `packages/tui/src/components/editor.ts`, `editor-inline-suggestion.ts`, `packages/tui/test/editor-placeholder-multiline.test.ts`, `packages/tui/test/editor-skill-command-submit.test.ts` |
| L3 | 테스트: `test/next-suggestion*.test.ts` 7개, `test/fixtures/accept-trace/*`, `test/fixtures/spec103b/golden-scenario.ts`, `test/spec103b-cap-hit-trace.test.ts` |
| L4 | `src/modes/interactive/opentui-footer-model.ts`, `opentui-footer-render.ts`, `opentui-surfaces.ts`, `opentui-status-worker-protocol.ts`, `opentui-core.ts`, `opentui-status-worker.ts`, `hybrid-status-panel.ts`, `interactive-mode.ts`, `layout-class.ts`, `components/footer.ts`, `src/bun/cli.ts` (worker 진입 인수) |
| L4 | 테스트: `test/opentui-footer.test.ts`, `footer-width`, `hybrid-status-panel`, `interactive-mode-status`, `layout-class`. 문서 `docs/tui.md`, `DESIGN.md` |
| L5 | 루트 `scripts/stage-opentui-runtime.mjs`, `scripts/test/stage-opentui-runtime.test.mjs`, `scripts/build-binaries.sh`, `src/config.ts` (컴파일 실행에서도 패키지 루트 반환) |
| L6 | `src/core/native-subagent-package.ts`, `src/core/package-manager.ts` (설치 후 `repairNativePackage`), `resources/native-subagents/`, `resources/native-skill-optimizer/`, 테스트 `native-subagent-*` 3개와 `native-skill-optimizer-*` 2개 |
| L7 | `src/core/skill-section-selection.ts`, `skill-section-report.ts`, `skill-selector.ts`, `skill-clause-relevance.ts`, `skill-auto-load.ts`, `prompt-skill-message.ts`, `test/skill-selector-sections.test.ts`, `test/suite/skill-*.test.ts` 3개, `docs/skills.md` |
| L7 | `src/modes/interactive/resource-description.ts`, `test/interactive-mode-resource-description.test.ts` (자동완성 출처 태그) |
| later | `packages/ai/scripts/generate-models.ts` (`--reapply-holds`), `generate-image-models.ts`, `models.generated.ts`·`image-models.generated.ts` (+1,945줄), `test/opencode-go-catalog.test.ts`: 모델 카탈로그 갱신은 별도 PR |
| 확인 필요 | `docs/environment-variables.md`: 어느 lane의 변수인지 lane PR 작성 시 해당 줄만 가져간다 |

## B. `2.0.0` 브랜치의 미병합 커밋

`git log --no-merges origin/main..2.0.0` 14개 (병합 커밋 포함 15개).

| 커밋 | 내용 | 분류 |
|---|---|---|
| `eecd9efaba` | OAuth 거부 토큰 1회 갱신 재시도 | L1 (A의 엔진 패치는 이 커밋에 `forwarded` guard를 더한 판) |
| `70074988ed` | tools/ 경고 오탐 | L1 |
| `bcf73f779a` | 짧은 후속 요청에 최근 사용자 문맥 반영 | L7 |
| `03fcaf5b45` | Pi 인벤토리 범위와 SDK 예제 이름 | L2 |
| `f2afc580ee` | atelier 상태창·사이드바 단축키 충돌 | L4 |
| `c5eae57154` | 8개 패키지 후보 버전·설치 경계 검사 | L8 |
| `3ba1e7288f` | goal: 지난 generation 증거를 재검증 대상으로 표시 | later (L2의 goal-controller flake와 관련 여부를 먼저 확인) |
| `03f4e05910` | adaptorch handler 전용 DAG dispatch bridge | later |
| `da78d258ac` | 반복 TB trial 성공률·비용 감사 | later |
| `641869095c` | 복구·권한 경계 고정 corpus | later |
| `c9abbabf81` | bash: 세션 메타데이터 OMK 별칭 | later |
| `8cb75e40f6`, `0efddb5850`, `099c46845b` | K0 기록 경로, Rust Anthropic oracle, Rust 계획 문서 | later (K1 Rust 트랙) |

## C. 공유 checkout `Project/omk` 작업 트리

다른 세션이 진행 중인 미커밋 작업이다. 이 분류는 내용을 바꾸거나 커밋하지 않으며, lane PR이 같은 파일을 건드릴 때 충돌 위험을 표시하는 용도다.

| 묶음 | 대표 경로 | 분류 |
|---|---|---|
| decision assistance (staged 신규) | `src/core/decision-client.ts`, `decision-schema.ts`, `assistance-settings.ts`, `extensions/builtin/assistance.ts`, `docs/decision-assistance.md` | later, 소유 세션이 별도 PR |
| 상태창·설정 UI | `status-sidebar.ts`, `status-pane-layout.ts`, `status-panel-model.ts`, `settings-selector.ts`, `warning-settings-submenu.ts`, `hybrid-status-panel.ts`, `opentui-status-*` | L4와 같은 파일을 수정 중. L4 착수 전에 소유 세션과 순서를 정한다 |
| native 패키지 | `native-subagent-package.ts`, `resources/native-*`, `package-manager.ts` | L6과 같은 원천. 엔진 패치 판을 기준으로 한다 |
| verified-run DAG 테스트 시간 상수 | `test/verified-run-dag*.ts` 13개 | L2 참고 (timeout 조정이며 권한 판정 수정은 아님) |
| 릴리스·설치 스크립트 | `scripts/install.sh`, `scripts/local-release.mjs`, `scripts/test/install-upgrade.sh`, `local-release-output`, `build-binaries-output`, `ci-security-gates` 테스트, `.github/workflows/*` 4개 | L8 참고. workflow 변경은 사전 리뷰 대상 |
| adaptorch checkpoint, MCP extension call | `extensions/builtin/adaptorch-checkpoint.ts`, `core/mcp/extension-call.ts` | later |
| 패키지 `version` 필드·lock | 루트와 8개 `package.json`, `package-lock.json` | drop (버전은 release 스크립트만 바꾼다) |
| 저장소 밖 산출물 | `OMK_2.0.0_Focused_Roadmap_*.zip`, `OMK_2.0.2_Focused_Roadmap.zip`, `i.js`, `wrangler.toml`, `landing/assets/film/` | drop (로컬 보관) |
| 문서·지침 | `AGENTS.md`, `CLAUDE.md`, `DESIGN.md`, `ROADMAP.md`, `SECURITY.md`, `README.md`, `.planning/ROADMAP.md`, `examples/*context*` | later, 소유 세션 |

## lane별 착수 조건

| lane | 원천 | 선행 |
|---|---|---|
| L1 | B의 커밋 2개 + A의 `forwarded` guard | 없음 |
| L2 | A의 스크립트·삭제 + verified-run 권한 판정 신규 수정 | 없음 |
| L8 | `c5eae57154` + 토큰 사전 검사 신규 | 없음. workflow를 바꾸면 리뷰 |
| L7 | A의 skill 경로 + `bcf73f779a` | 없음 |
| L3 | A의 next-suggestion·editor 경로 | L7 이후 (prompt-skill 경로 공유) |
| L4 | A의 opentui 경로 + `f2afc580ee` + PR #480 | C의 상태창 작업과 순서 합의 |
| L5 | A의 패키징 경로 | L4 |
| L6 | A의 native 경로 | 없음. A5는 유료 모델 호출 승인 필요 |
