# OMK Atelier

[Pi Atelier](https://github.com/michaelmjhhhh/pi-atelier) 0.15.0의 상태 레일, 활동 사이드바, 편집기 프레임을 OMK에 연결합니다. 추가 런타임 의존성은 없습니다.

이 저장소에서는 `.omk/extensions/atelier/index.ts`가 자동 발견됩니다. 새 OMK 세션이나 `/reload` 이후 사용합니다. 이미 실행 중인 프로세스는 파일 작성만으로 바뀌지 않습니다.

```text
/atelier                       설정 메뉴, F6으로도 열기
/atelier display               표시 순서, 패널, 프리셋 설정
/atelier sidebar               사이드바 토글
/atelier sidebar auto          좁아지면 접고 넓어지면 다시 열기
/atelier sidebar manual        수동 크기 조절
/atelier sidebar on|off         표시 상태 변경
/atelier sidebar tools          도구 목록 토글
/atelier usage                 자식 사용량 그래프
/atelier disable               기본 푸터와 편집기로 복귀
/atelier enable                상태 레일 재활성화, 사이드바는 별도 표시
/atelier-theme dark             omk-atelier-dark 선택
/atelier-theme light            omk-atelier-light 선택
```

수동 모드에서는 `Ctrl+Shift+R` 후 좌우 화살표 또는 구분선 드래그로 폭을 바꿉니다. Enter/마우스 놓기는 확정, Escape는 취소합니다. 92열 미만에서는 접힙니다. 기본 44열 자동 모드는 124열 미만에서 접고 132열에서 다시 엽니다.

## tmux 사이드바

tmux 안에서 시작하면 같은 사이드바 내용을 별도의 오른쪽 pane에 표시합니다. OMK 입력창에서 `Ctrl+Q`를 누르면 그 pane만 닫거나 다시 엽니다. OMK나 tmux 세션 전체를 종료하지 않고 전역 tmux 키 설정도 바꾸지 않습니다. 기본 폭은 44열이며 처음 열 때 OMK pane에 최소 93열이 필요합니다. tmux의 `resize-pane`으로 폭을 바꾸면 다시 그립니다.

저장소 루트에서 새 세션이나 기존 대화를 시작합니다.

```bash
bash scripts/omk-tmux.sh
bash scripts/omk-tmux.sh --resume <session-id>
```

이미 tmux 안이면 중첩하지 않고 `omk`를 실행합니다. 실행 중인 OMK를 tmux 안으로 옮기지는 않으므로 현재 대화는 `/quit` 후 `--resume`으로 이어갑니다. tmux 밖에서는 기존 native 사이드바를 유지하며 `Ctrl+Q`도 같은 Atelier 사이드바를 제어합니다. `/reload`는 현재 확장만 갱신합니다.

기존 상태, TODO, 사용량 렌더러를 재사용하고 소유자 표시가 일치하는 pane만 정리합니다. `/reload`, `/atelier disable`, 정상 종료 때 출력 연결을 닫습니다. tmux 모드의 자동 접기와 `Ctrl+Shift+R` 대신 tmux의 크기 조절을 사용하세요.

## 연결과 설정

- `index.ts` -> `vendor/extensions/index.ts` -> footer/editor/sidebar, OMK 확장 이벤트와 공유 이벤트 버스.
- `vendor/src/split-pane.ts` -> `src/split-pane.ts` -> OMK `TUI.setRightGutter`와 비포커스 overlay. 본문을 가리지 않고 실제 공간을 확보합니다.
- `resources_discover`와 패키지 `omk.themes` -> `themes/*.json`. 기존 명시 테마는 시작 시 변경하지 않습니다. `/atelier-theme` 선택은 호스트의 테마 전환 동작을 사용합니다.
- 사용자 설정: OMK agent 디렉터리의 `pi-atelier.json`. 프로젝트 설정: `.omk/pi-atelier.json`. upstream 이름을 유지하므로 별도 전역 설정 마이그레이션은 하지 않습니다.
- 세션 토큰, 비용, 컨텍스트, 읽기 전용 Git 상태, 실시간 도구 상태, `todo`와 OMK `update_todo`를 표시합니다. 알 수 없는 사용량은 추정 관측값으로 꾸미지 않습니다.
- 다른 확장은 `registerSidebarPanel`을 이 패키지의 `index.ts`에서 가져올 수 있습니다. 이벤트 채널, 이름공간, 텍스트 한도, 제어문자 제거는 upstream 계약을 유지합니다. 새 외부 패널은 Display에서 활성화합니다.
- 다른 프로젝트에서 사용하려면 검토한 이 패키지 디렉터리를 `omk install /absolute/path/to/atelier`로 명시 설치합니다. 이번 작업은 전역 설치, 기본 테마 강제 변경, 엔진 교체를 하지 않습니다.

## Usage 연결

`USAGE`는 세션의 입력/출력/캐시 읽기/캐시 쓰기/전체 토큰과 보고된 비용을 표시합니다. 세션 토큰은 호스트 푸터처럼 전체 assistant 이력을 합산하며, 컨텍스트는 현재 요청 기준입니다. 비용은 모델 가격 기준 추정치이며 구독 청구액이 아닙니다.

`QUOTA` 패널은 호스트의 모든 설정된 구독 그룹을 받아 사용 비율, 5H/7D 등의 관측 창, 리셋까지 남은 시간을 표시합니다. 네이티브 xAI 응답에 관측된 `productUsage` 행이 있으면 같은 호스트 스냅샷에 포함되어 여기에도 나타납니다. `usagePercent`가 없는 행은 0%로 보이지 않습니다. 활성 그룹이 먼저 나오며 호스트 `subscriptionUsageProviders` allowlist를 그대로 따릅니다. 0은 실제 관측값일 때만 표시합니다. Meta의 `no observed usage yet`, offline, 미지원 API는 추정으로 채우지 않습니다.

패널은 기본 표시되고 저장된 숨김 설정은 유지합니다. 좁거나 낮은 터미널에서는 푸터 요약도 제공하며 Display에서 순서/표시를 조절할 수 있습니다. 확장이 별도 인증 파일이나 provider API를 읽지 않고 `footerData.getSubscriptionUsage()` -> 기존 TTL/revision 캐시를 사용합니다. 이 API가 없거나 `undefined`를 반환하면 `No subscription usage source on this host` 빈 상태로 표시하고 푸터 요약은 비웁니다. 빈 배열은 `No configured subscription providers`로 구분합니다. 실제 provider 진단 메시지와 조회 예외의 `usage unavailable` 표시는 유지합니다. `/reload`만으로 구버전 엔진 자체에 새 API가 생기지는 않습니다.

## 제한

호스트에는 사용자 정의 푸터와 편집기가 각각 하나뿐이므로 다른 확장과 충돌하면 로드 순서가 적용됩니다. 기본 프레임으로 돌아가려면 `/atelier disable`을 사용합니다. 터미널 배경색 자체는 호스트/터미널 설정이며 테마가 전역 터미널 배경을 강제로 바꾸지 않습니다.
Atelier가 활성화되면 `Ctrl+Q`는 내장 레일 대신 Atelier 사이드바를 제어합니다. 별도의 내장 레일이 고정된 호스트에서는 `settings.json`의 `pinStatusSidebar`를 `false`로 설정해 중복을 피하세요. 내장 고정 설정 자체는 변경하지 않습니다. native 모드는 사이드바 해제/종료 때 기존 gutter 콜백을 복원하며 나중에 등록된 다른 소유자의 gutter는 지우지 않습니다. 프로젝트 신뢰 확인 API가 없는 호스트는 프로젝트 설정과 작업공간 검사를 비활성화한 채 사용자 설정으로 표시합니다.

자식 비용 그래프는 소유자가 확인된 pi-subagents 기록과 현재 세션의 성공한 `bg_delegate`/`bg_result`에 묶인 검증된 final receipt 사용량을 읽습니다. Native delegate는 마지막 응답의 관측값만 표시하며 전체 실행 비용으로 추정하지 않습니다. OMK의 모든 `bg_run`/AdaptOrch 작업 비용을 지원한다고 가정하지 않습니다. Kitty/iTerm2 그래픽은 호스트가 지원할 때만 사용하고 나머지는 텍스트 그래프로 표시합니다. OS 알림은 upstream의 macOS/Windows 지원을 유지하며 Linux 알림은 추가하지 않습니다.

## 검증

저장소 루트에서 실행합니다.

```bash
npm --prefix .omk/extensions/atelier run typecheck
npm --prefix .omk/extensions/atelier test
```

독립 TUI 확인은 저장소 밖의 임시 작업 디렉터리에서 `omk --no-session --no-extensions -e /absolute/path/to/atelier/index.ts`로 실행합니다. 모델 요청 없이 메뉴, 표시/숨김, 폭 변경, 테마 전환, `/reload`를 확인할 수 있습니다.

## 출처

upstream 커밋 `776c1e3701d7fced2115cdef27a58ca9f0f0bf07`을 고정했습니다. [MIT 라이선스](vendor/LICENSE)와 [upstream 문서](vendor/UPSTREAM.md)를 보존합니다. 런타임 호환 수정은 `split-pane.ts`, `editor.ts`, `image-compositor.ts`, `palette.ts`, `run-activity.ts`, `todos.ts`, `sidebar.ts`, `extensions/index.ts`에 있습니다. TypeScript 상대 import는 저장소 규칙에 맞춰 `.ts`로 정규화했습니다. 파일별 원본/적용 해시는 `UPSTREAM.json`에 기록합니다. 원본 렌더러 훅은 사용하지 않으며 OMK 테마 토큰과 native TODO 입력을 연결했습니다.
