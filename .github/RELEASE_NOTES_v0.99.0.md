# OMK v0.99.0

TB 오프라인 도구의 출력 계약을 v2로 바꾸는 minor 릴리스입니다. Devin CLI 구독
adapter·하네스, 최대 2개 작업의 verified-run frontier, Codex SSE·재시도·리소스
설명 수정도 포함합니다. 공개 workspace 7개는 모두 0.99.0으로 맞춥니다.

## 호환성 변경

- checkout-only `scripts/tb-mini-suite.mjs`는 `selectionVersion: 2`를 출력합니다.
  결측·비유한·음수 예상 시간은 0이 아닌 `null`이며, 결측값이 있으면 총량도 `null`입니다.
  `knownExpertMinutes`와 `unknownExpertEstimates`를 사용해 구분하십시오.
  1~2개 선택은 난이도 가중치를 먼저 적용하므로 기존 선정 결과가 달라질 수 있습니다.
- `scripts/tb21-audit.mjs`는 `omk-tb21-audit-report-2`를 출력합니다. 유효한 시작·종료
  시각이 있어야 집계하고, 소수초는 최대 9자리까지 순서를 보존합니다. 입력 manifest는
  `omk-tb21-manifest-1`을 유지합니다. 기존 결과를 임의의 시각으로 채워 통과시키지 마십시오.
- 이 도구들은 npm CLI의 신규 하위 명령이 아닙니다. 보고서 소비자를 갱신하고, 비교 전에
  새 선정 결과·버전·데이터셋을 다시 고정하십시오.

[선정 계약](../packages/coding-agent/docs/metrics.md#capability-baseline)과
[감사 규칙](../packages/coding-agent/docs/tb21-audit.md)을 참고하십시오.

## 주요 변경

- Devin CLI 구독 adapter와 `devin/swe-2`, 요청 범위 `devin-harness` loadout·활성 스킬,
  계정 사용량 창을 연결했습니다. Node 전용 gzip 판독은 브라우저 정적 import 경로에서
  분리했습니다. 실계정 호환성은 이번 릴리스의 로컬 검증 범위가 아닙니다.
- verified command DAG는 승인된 `writer.maxConcurrentTasks: 2`를 지원합니다.
  생략하면 직렬 실행과 기존 계약 digest를 보존합니다. 시작된 작업은 오류·취소 뒤에도
  모두 회수하며, 최종 검증은 한 개의 고정 candidate에서 실행합니다.
- Codex SSE 헤더 대기는 설정된 `timeoutMs`와 기존 10초 최소값을 따릅니다.
- 재시도 backoff 중 전달된 메시지를 큐에 넣어 이중 실행과 run-journal 손상을 방지합니다.
- 리소스 자동완성 설명의 장식용 `[OMX]`·`[OMO]` 접두사만 제거합니다. 원본 metadata,
  호출 이름, 도구 권한은 그대로입니다.

## 검증과 배포 경계

[릴리스 감사](../packages/coding-agent/docs/release-audit-0.99.0.md)는 실제 로컬 검사와
후속 확인 조건을 기록합니다. 합성 테스트·pack dry-run은 실제 공급자 품질이나
벤치마크 우위의 증거가 아닙니다. verified-run의 실모델 writer·계획 변경·managed apply
등은 이번 릴리스에 추가되지 않았습니다.

공식 태그 workflow가 6개 플랫폼 바이너리, 검사·테스트, npm 7개 패키지 게시와
GitHub Release 생성을 담당합니다. 태그·GitHub Release·npm `latest`의 일치로 배포를
확인합니다. 기존 token 기반 CI 인증을 유지하며 OIDC/Sigstore provenance를 주장하지 않습니다.
