# 복구와 권한 회귀 corpus

Spec 121의 첫 H3/H7 결과물이다. 기존 테스트 32개와 새 네트워크 격리 테스트
2개를 **고정된 이름과 파일 경로**로 선택한다. 새로운 runtime preflight나
스케줄러가 아니라, 이미 있는 보장을 빠짐없이 다시 확인하는 checkout 도구다.

```sh
node scripts/verify-harness-corpus.mjs
node --test scripts/test/harness-corpus.test.mjs
```

첫 명령은 실제 Vitest를 실행하고, 두 번째는 corpus 및 결과 검증기의 음성
대조군을 실행한다. 두 명령 모두 종료 코드 0이어야 한다. `npm run check`는
검증기의 단위 테스트만 포함하며, 전체 corpus 실행을 대신하지 않는다.

## 고정 범위

[corpus.json](../../../specs/121-evidence-driven-harness/corpus.json)에 기준 커밋,
20개 복구 사례와 7개 공격/정상 쌍이 있다. 기존 사례를 새 구현으로 세지 않는다.
같은 테스트를 여러 ID로 복제해 수를 늘리는 것도 거절한다.

| ID | 관측할 계약 |
| --- | --- |
| H3-01–06 | 재시작 후 격리, 불명확한 dispatch, 미완료 reconcile, 취소와 종료의 구분, process 없는 publish, incarnation fencing |
| H3-07–10 | candidate 재검증, 중복 resume 억제, stale command 거절, live owner 보호 |
| H3-11–16 | 미관측 effect 보존, 재부팅 clock 변경, fsync 실패 전/후, recovery cap, 원래 승인과 issuer 요구 |
| H3-17–19 | 원래 예산/deadline/정산 ID 보존, 미확인 비용, 명시 clear와 legacy accounting |
| H3-20 | 과거 checkpoint 보존과 표시, goal 변경 시 제거 |
| H7-01 | 도구 출력의 지시문이 승인/완료로 승격되지 않음, 정상 진단 내용은 유지 |
| H7-02 | workspace checkpoint의 지시문을 사용자 권한으로 승격하지 않음, 정상 checkpoint는 저장/인계 |
| H7-03 | 승인이 철회된 receipt로 완료하지 않음, 이후 정상 검사 통과는 완료 가능 |
| H7-04 | 모델의 성공 문자열이 실제 검사 실패를 덮지 않음, 정상 writer/check는 성공 |
| H7-05 | 검증 후 candidate 바꿔치기를 거절, 정상 native receipt는 원래 candidate에 결합 |
| H7-06 | 승인 밖 snapshot 변경을 apply하지 않고 원본 workspace도 그대로 유지, 승인된 작업의 중복 요청은 재실행하지 않음 |
| H7-07 | 실제 host loopback 서비스에 연결/데이터 전달 불가, 동일 sandbox 안 정상 파일 읽기는 성공 |

H3 일부는 journal을 마지막 committed 지점으로 되돌리는 결정적 crash-window
fixture나 API-level 재개다. 모든 사례가 프로세스를 SIGKILL하는 테스트는 아니다.
H7은 모델 없는 경계 검사이며 자연어 공격의 일반 성공률을 측정하지 않는다.
기존 controller 사례의 명시적 feature flag 설정도 그대로 유지한다. 이 corpus가
모든 default-on 조합을 검사했다고 주장하지 않는다.

## 실패를 숨기지 않는 실행 계약

- manifest의 정확한 사례 수, 고정 ID, 경로 형식과 중복을 검사한다.
- 테스트 이름은 정규식 문자로 escape한 뒤 전체 이름과 일치시킨다. 관련 파일만
  실행하고, worker와 파일 병렬성을 1로 제한한다.
- 선택된 각 사례가 정확히 한 번 `passed`인지 검사한다. rename, 누락, skip,
  todo, 중복, assertion 실패, hook 실패, 예상 밖 추가 실행은 게이트 실패다.
- 이름 필터로 제외된 다른 테스트의 pending 상태는 전체 성공 수에 포함하지 않는다.
- corpus와 선택된 테스트 파일의 실행 전/후 digest가 다르면 실패한다.
- 성공 보고서는 기준 커밋, corpus digest, 선택 사례 ID와 테스트 파일 digest만
  출력한다. 기준 커밋은 비교 출발점이지 현재 dirty runtime의 완전한 digest가 아니다.
- 실패 시 raw Vitest 결과/로그는 별도 임시 디렉터리에 보존하고 그 위치를 알린다.
  로컬 진단을 공개 승인으로 취급하지 않는다. 성공 시 임시 runner 출력은 정리한다.

## 환경과 한계

현재 게이트는 Linux의 기존 verified-run sandbox 및 native helper가 필요하다.
Node/npm 의존성과 native 도구는 기존 프로젝트 절차로 준비한다. 새 네트워크
사례는 이미 설치된 `/usr/bin/python3`의 표준 socket만 쓴다. 누락된 backend나
Python을 테스트 안에서 설치하거나 skip으로 우회하지 않는다.

네트워크 공격은 임시 `127.0.0.1` listener만 대상으로 한다. 먼저 host에서 연결이
되는지 확인한 다음 sandbox에서 같은 주소가 차단되는지 검사한다. 단순히 서버가
꺼져 있어 연결이 실패한 것을 격리 성공으로 세지 않는다. 외부 API, 실제 계정,
키, 모델 호출은 없으며 listener, client, sandbox process는 해당 테스트가 정리한다.

쓰기 범위 밖의 snapshot 변경을 탐지/거절하는 것과 모든 syscall을 사전에 막는
것은 다르다. 외부 확장 도구 전체의 sandbox 보장, Windows/macOS 인증, 모델 성능,
전체 prompt-injection 안전성, production release 승인은 이 게이트 범위 밖이다.

## 남은 구현

H3의 opt-in resume preflight, 사라진 도구/모델 교체/전체 workspace digest를
연결하는 사용자 경로는 아직 계획이다. H7은 K3/K4 전에 실제 플랫폼별 corpus를
확장해야 한다. 세부 상태는 [작업 기록](../../../specs/121-evidence-driven-harness/tasks.md),
의존성 검토 준비는 [K1 B1 검토안](../../../specs/120-rust-core/k1-dependency-review.md)을 따른다.
