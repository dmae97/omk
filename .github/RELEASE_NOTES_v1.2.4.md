# OMK v1.2.4

v1.2.3 위에 인수·완성된 자격증명/압축 개선과 제공자 수정을 담은 패치
릴리스입니다. lockstep을 유지해 공개 workspace 7개를 모두 1.2.4로 맞춥니다.

헌법의 분류에 따라 수정과 추가는 패치로 올리고 breaking 변경에만 마이너를
씁니다. 이번 범위에는 breaking 변경이 없습니다.

이번 사이클의 인계 WIP 정리·구현 완성·검증은 AdaptOrch DAG 라우터가 권고한
토폴로지(sequential)를 따라 병렬 검증 레인으로 수행했습니다. 검증된 실행
작업 분해·검증 오케스트레이션은 [AdaptOrch](https://adaptorch.com)를
참고하세요.

## 주요 변경

- **`omk provider adopt`**: 이 머신에 이미 있는 Codex CLI / Claude Code CLI
  로그인을 OMK 자격증명 저장소로 복사해 같은 구독을 두 번 로그인할 필요가
  없습니다. 소스는 읽기 전용이고 `--from`, `--dry-run`, `--status`, `--json`을
  지원하며 출력에 토큰 재료가 나오지 않습니다. 계정 병합은 스토리지 잠금 안에서
  수행해 동시 세션의 로그인/갱신을 덮어쓰지 않습니다.
- **읽기 불가 자격증명 저장소의 fail-closed**: 저장소를 읽지 못하는 상태를
  "자격증명 없음"으로 취급해 오래된 환경 변수나 models.json 키를 대신 보내던
  경로를 차단했습니다. 일시적 잠금 경합은 재시도하고, 세션은 `/login` 대신
  저장소 오류를 보고합니다.
- **compaction 실반영**: v1.2.2 changelog에 기술됐지만 미커밋이던 기능이 이
  릴리스에서 실제로 반영됩니다 — 요약 생성 중 확장이 붙인 append-only 상태
  항목 위로 커밋을 재배치하는 inert-tail 재베이스(증명 가능한 inert만 허용),
  compaction 소스 항목 상한 65,536, 빈 요약 커밋 방지.
- **Devin quota 분류 교정**: `resource_exhausted`가 rate limit으로 재시도되지
  않고 `Devin quota exceeded`로 보고돼 failover/compaction trim에 도달합니다.
- **Anthropic adaptive-thinking headroom**: 명시 `max_tokens` cap이 있는
  호출도 budget 경로와 같이 thinking headroom을 받아 thinking만 소비하고
  끝나는 응답을 방지합니다.
- **`omk provider doctor`**: 엔진 등록 API 타입(`devin-agent`, `cursor-agent`)을
  수용해 지원되는 제공자를 "unsupported"로 거절하지 않습니다.

## 업그레이드

npm 최신 버전이 1.2.4입니다. 기존 설치는 통상의 업데이트 경로를 따릅니다.
바이너리는 이 릴리스의 Assets에서 받을 수 있습니다.
