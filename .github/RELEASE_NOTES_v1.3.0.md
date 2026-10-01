# OMK v1.3.0

v1.2.4 이후 기본 대화형 흐름과 verified run을 제품 경로에 연결한 마이너
릴리스입니다. lockstep을 유지해 공개 workspace 7개를 모두 1.3.0으로 맞춥니다.

헌법에 따라 수정과 추가는 패치, 호환성을 깨는 변경은 마이너로 올립니다. 이번
범위에는 verified run 취소의 상태 계약 변경이 있어 마이너입니다. 아래
"호환성"을 먼저 확인하십시오.

## 주요 변경

- **증거로 끝나는 `/goal`**: `/goal verify <command>`로 목표의 인수 검사를
  승인합니다. 검사는 기본 bash sandbox 안에서 영수증과 함께 실행됩니다. 턴이
  끝날 때마다 다시 실행되고, 통과하면 목표가 완료됩니다. 실패하면 명령과 종료
  코드만 붙여 다음 라운드를 시작합니다. 검사 출력은 모델에 보내지 않습니다.
  `/goal complete`는 이 세션의 통과 영수증이 현재 작업 공간과 일치할 때만
  완료합니다. 검사 뒤 파일을 고치거나 새 파일을 만들면 증거가 무효가 됩니다.
- **목표 루프 복구**: 1.2.4까지는 대화형 `/goal` 루프가 다음 턴을 보내지
  못했습니다. 라운드는 소모되지만 세션이 `Agent is already processing`으로
  메시지를 거부했습니다. 이제 턴이 완전히 끝난 뒤(재시도가 없을 때) follow-up으로
  이어 갑니다. 재시도될 시도는 라운드를 쓰지 않습니다. wall clock이 뒤로 가도
  목표 전이가 실패하지 않습니다. SDK로 목표를 직접 전이할 때는 새로 export한
  `nextDurableGoalTimestamp()`를 `now`로 넘기면 같은 규칙이 적용됩니다.
- **`omk run cancel`, `omk run gc`**: 다른 셸에서 실행 중인 verified run을 요청
  파일로 취소합니다. PID signal은 쓰지 않습니다. 복구할 수 없는 run의 파생 작업
  공간만 정리하고, 원장·영수증·attestation은 남깁니다. `--execute`가 없으면
  보고만 합니다.
- **재개 가능한 취소**: 실행 중 취소한 verified run은 `paused`로 남습니다.
  `restart-writer`, `resume`, `retry-tasks`로 이어 갈 수 있습니다. 검증 중 취소된
  검사를 실패 검사로 서명하던 결함도 고쳤습니다.
- **부하 중 verified run 중단 제거**: 권한 저장소가 뒤로 가는 wall clock을
  `operation_failed`로 처리하던 문제를 단조 시계로 해결했습니다. 부하가 걸린
  WSL2에서 동시 실행 30회를 돌렸을 때 이 실패가 3회에서 0회로 줄었습니다.
  계약 밖 오류는 이제 `operation_failed (Error ENOTDIR)`처럼 종류와 code를
  함께 보여 줍니다.
- **MCP와 세션 수명**: 시작 중 종료한 MCP 서버만 `failed`로 격리합니다. 잘못된
  도구 결과는 `mcp.invalid_tool_result`로 거부합니다. transport 재연결은 물리적
  종료를 기다립니다. 요청을 보내기 전에 전체 입력을 모델 창과 대조합니다.
  `RpcClient`의 대기자·stderr·종료 수명도 정리했습니다.

## 호환성

- 실행 중 취소된 verified run의 상태가 `failed`에서
  `paused`(`failure: cancelled`)로 바뀝니다. 원장에는 새 event `interrupted`가
  기록되며, 1.2.4 이하는 이 원장을 읽지 못합니다. 취소를 terminal로 다루던 상태
  소비자는 `paused`를 처리해야 합니다.
- 승인된 인수 검사가 있는 목표의 `/goal complete`는 이 세션에서 통과한 영수증을
  요구합니다. 승인이 없으면 기존 규칙(현재 generation의 증거)을 따릅니다.
- Context Budget V2의 선택 캐시 정책이 `sel-4-codeunit`으로 바뀌어 이전 정책의
  캐시 항목은 재사용하지 않습니다.

## 업그레이드

npm 최신 버전이 1.3.0입니다. 기존 설치는 통상의 업데이트 경로를 따릅니다.
바이너리는 이 릴리스의 Assets에서 받을 수 있습니다. 실행 중인 OMK는 새 버전을
설치한 뒤 다시 시작해야 반영됩니다.
