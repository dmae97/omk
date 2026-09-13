# Release audit: v0.99.0

기준일: 2026-09-13. 사용자가 배포 준비 결과를 확인한 뒤 즉시 배포를 요청했다.
이 기록은 후보의 검증 근거이며 GitHub/npm 게시 완료를 미리 선언하지 않는다.

## 범위와 변경 로그

이전 공개 릴리스 `v0.98.5`는 main의 조상이며, 준비 시점의 GitHub Release와 공개 npm
`latest` 7개도 0.98.5로 일치했다. 원격 `v0.99.0`이 없음을 확인한 뒤 준비했다.

`decee7f157`부터 `ca75f4e5cc`까지의 frontier·Devin·Codex SSE·재시도·TUI·설계 문서와,
이번에 확정한 `3c7d3b4613`(TB 선택 v2), `b21daf1a76`(TB 감사 v2),
`003f7b081a`(문서·변경 로그·로컬 캡처 제외)을 포함한다. 마지막 세 단위는 각각
pre-commit 전체 검사를 통과했고, 선택기 40개·감사기 66개 CLI 검사를 통과했다.

TB 출력 계약 변경은 minor 증가로 처리했다. `selectionVersion: 2`의 nullable 예상
시간·총량과 `omk-tb21-audit-report-2`의 필수 완료시각을 Breaking Changes에 기록했다.
입력 manifest는 v1을 유지한다. 이전 버전 changelog 본문은 바꾸지 않았으며 다음
작업용 `[Unreleased]`는 비워 두었다. 새로운 벤치마크 성능이나 SOTA 우위는 주장하지 않는다.

## 버전·의존성

공개 7개 패키지, root/example manifests, 내부 의존 범위, lockfiles, CLI shrinkwrap,
book compiler의 `PACKAGE_VERSION`, README 버전 링크와 릴리스 노트를 0.99.0에 맞춘다.
외부 의존성의 버전·resolved URL·integrity 값은 변경하지 않았다. 모델 카탈로그도
재생성하지 않았다. 운영자 설정·인증·MCP·스킬 활성 목록은 변경하지 않았다.

첫 `version:minor` 실행은 manifest 증가 뒤 아직 이전 버전을 가리키는 내부 의존성을
npm 출시일 제한에 대조하다 중단됐다. 버전 증가를 재실행하지 않고, 기존
`sync-versions.js`와 lockfile/설치 동기화 단계만 이어갔다. 제한을 완화하거나 기존
태그를 이동하지 않았다. 추가적인 registry 패키지 버전 변경은 없음을 대조했다.

## 관측한 로컬 검증

- 환경: Linux, Node.js 24.19.0, npm 11.14.1.
- 새 버전의 `npm run build`가 7개 workspace 전체에서 종료 0이었다.
- `test.sh`를 인증 없는 별도 HOME·최소 환경에서 실행했다. 실제 운영자 auth 파일은
  건드리지 않았다. `taskset`으로 네 CPU에 제한했고 `LIVE_E2E=0`,
  `OMK_NO_LOCAL_LLM=1`, `OMK_OFFLINE=1`을 사용했다.
- 전체 테스트: **8,279 통과, 852 환경·실계정 조건 skip, 실패 0, 종료 0**.
  WPL 149, agent 870, AI 676, book compiler 22, coding-agent 5,695,
  protocol 137, TUI 730개가 통과했다. 이 수치는 CI 실행 결과가 아니다.
- 준비 단계의 TB 106개와 전체 guard 378개 통과를 전체 제품 테스트 수에 다시 더하지 않는다.
- 최종 후보 확인 중 공유 트리에 Devin 요청 코드·테스트·문서와 그 변경 로그가 별도로
  바뀐 것을 발견했다. 이 4개 파일의 후속 변경은 제외하고 `003f7b081a`와 릴리스
  메타데이터만 별도 detached worktree에 옮겼다. 변경 로그의 같은 파일에 섞인 후속
  항목도 원래 커밋의 본문과 대조해 분리했다. 운영자의 변경·인증은 덮어쓰지 않는다.
- 격리 후보에서도 전체 테스트 8,279개 통과·852개 조건 skip·실패 0을 재확인했다.
  공유 트리 실행과 같은 검사를 중복 합산하지 않았다.
- 격리 후보의 `npm run check`(Node guard 378개 포함), 7개 pack dry-run·공개 entrypoint
  import, 빌드 CLI의 `--version`·`--help`·`run --help`가 모두 종료 0이었다.
  모든 pack의 버전은 0.99.0이고, 필수 진입점 누락·비공개 상태 경로는 없었다.
- 후보 diff의 Gitleaks 검사는 완전 redaction과 기존 규칙으로 종료 0, 탐지 0건이었다.
- `--release`의 stale-worktree guard는 별도 최종 배포 gate다. 후보를 main에 연결하고
  이 작업의 임시 체크아웃을 제거한 뒤 기본 checkout에서 실행한다. guard나 이름을
  바꿔 검사를 피하지 않는다.

## 배포 완료 조건

기존 `build-binaries.yml`의 태그 기반 경로만 사용한다. 로컬 `npm publish`, 인증 변경,
새로운 실행 권한·모델 호출은 없다. release source와 tag의 동일 SHA 검사를 유지한다.
후보는 검토한 명시 경로만 stage하고 staged diff 전체를 확인한 뒤 commit·tag·push한다.

공식 workflow가 6개 플랫폼 바이너리 빌드, 검사·테스트, npm 7개 패키지 게시,
GitHub Release 생성을 완료해야 한다. 최종 판정은 태그의 main 포함,
GitHub `v0.99.0` Release와 7개 npm `latest`의 일치다. 기존 token 기반 인증을 사용하며
OIDC/Sigstore provenance는 주장하지 않는다. 실패 시 원인을 확인하고 기존 배포의
무결성 경계를 유지하며, 완료 전에는 배포 성공이라고 보고하지 않는다.
