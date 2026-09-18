# OMK v1.0.0

소유자가 선언한 첫 마일스톤 릴리스입니다. 헌법의 'major 릴리스 없음' 규칙 아래
명시적 예외로 발행되며(`OMK_ALLOW_MAJOR_RELEASE=1`), lockstep은 그대로 유지해
공개 workspace 7개를 모두 1.0.0으로 맞춥니다. `patch`/`minor`만 허용하는 범프
정책은 이후에도 유지됩니다.

## 주요 변경

- **Neo 번들 스킬·`omk neo` CLI·ACP 모드**: `resources/neo/skills`의 공개 스킬
  6종이 사용자·프로젝트·명시 스킬이 없을 때 자동 채워지고(`OMK_BUNDLED_SKILLS=0`
  또는 `--no-skills`로 해제), 대화 전용 `--mode acp`가 추가되었습니다.
- **Cursor 제공자**: `cursor-agent` API가 Connect/gRPC 양방향 스트림으로 Cursor
  구독 모델을 제공합니다. `OMK_DEBUG_CURSOR=1`로 스트림 계측이 가능하고
  `--cursor-only` 카탈로그 생성 경로가 있습니다.
- **Devin 카탈로그 확장**: `swe-2` 논리 모델의 medium/high/max 계약을 유지하면서
  `GetCliModelConfigs` 관측치 기반의 wire UID 레인을 개별 모델로 제공합니다.
- **실행 사용 원장(R08)**: 인메모리 원장이 예약·전송·사용량·종료를 시도 단위로
  귀속합니다. 입장 시 `attemptId`가 고정되어 호출자 입력 변형으로 종료 처리가
  우회되지 않습니다. 회계 전용이며 하드 금융 한도가 아닙니다.
- **strict-evidence 계약**: 프로토콜에 스냅샷·리포트·완료 기록 타입과 평가
  연결이 추가되고, 코딩 에이전트 측 승인 어댑터가 포함됩니다.
- **서브에이전트 레인 결제**: 레인 실행을 settled/failed/unsettled로 모델링하고
  공유 풀 기준 미결제 자식을 추적합니다. 허가 가중치·heavy admission 경계가
  명시됩니다.
- **terminal-browser 확장 예제**: kitty 그래픽 플레이스홀더로 실제 브라우저를
  OMK TUI 오버레이에 렌더링합니다. `/browser` 명령과 open/close 도구를
  제공하며 ghostty·kitty 계열 터미널이 필요합니다.

## 안정성·분류 수정

- Codex 토큰 플랜 주간 쿼터 소진(`quota has been exhausted`)이 종료 쿼터로
  분류됩니다. 수일짜리 `retry-after`가 더 이상 지연 상한 예외로 번져 컴팩션
  요약 실패로 나타나지 않으며, 쿼터 failover가 발동합니다.
- 성공 형태의 빈 스트림 완료를 죽은 스트림으로 처리해 재시도 예산 소모·무한
  회전을 막고, union-alpha/ox-alpha 계열의 대체 경로 회전을 지원합니다.
- Anthropic-messages baseUrl의 버전 경로 중복(`/v1/v1/messages`)을 제거합니다.
- 최상위 추론 레벨이 wire 값이 `high`와 동일한 모델에서는 선택지에서 숨깁니다.
- ECRAF 도구 DAG 정규화 경계가 규칙·테스트로 고정됩니다.

## 모델 카탈로그

라이브 소스 기준으로 재생성했습니다. `union-alpha`(opencode, opencode-go,
openrouter/stealth)와 일부 항목이 업스트림에서 제거되었고 Cursor·신규 모델이
추가되었습니다. 해당 경로를 사용하던 세션은 `/model`로 다른 모델을 선택하십시오.

## 검증과 배포 경계

- 각 커밋은 pre-commit(`npm run check` 전체: lint·guard·module-size·constitution·
  typecheck·browser smoke)을 통과했습니다. 대상 회귀 테스트는 커밋별로 실행되어
  통과했습니다.
- 커버리지 비율, 전체 vitest 스위트, 실제 공급자 자격증명 라이브 검증, 설치된
  바이너리 동작은 이 문서의 검증 범위가 아닙니다.
- 공식 태그 workflow가 검사·테스트·6개 플랫폼 바이너리·npm 7개 패키지 게시와
  GitHub Release 생성을 담당합니다. 태그·GitHub Release·npm `latest` 일치로
  배포를 확인합니다. 기존 token 기반 CI 인증을 유지하며 OIDC/Sigstore provenance를
  주장하지 않습니다.
