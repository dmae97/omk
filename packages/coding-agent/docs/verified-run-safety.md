# Verified run의 안전 경계

`linux-command-v1`, `linux-command-dag-v1`, synthetic `linux-scripted-agent-v1`의 소스 구현을 설명합니다. 실제 provider 연결, 자동 shard 실행, active ECRAF, 원격 게시, managed apply의 지원 선언은 아닙니다.

## 권한과 복구

- `AuthorityStore`는 실행 시작 시 host clock을 읽습니다. 시각 인자를 생략해도 만료 검사를 수행하며, deadline과 같은 시각부터 신규 시작을 거절합니다. 테스트용 clock은 trusted host 구성에서 주입합니다.
- 현재 epoch, incarnation, token, claims와 실행 상태를 확인합니다. `lookup`의 `pending`은 조회 결과이며 실행 승인이 아닙니다.
- 게시 재시도는 기존 ref를 먼저 관찰합니다. CAS 결과만 기록하는 복구에는 새 effect를 시작하지 않습니다. `running`, `quarantined`, terminal grant를 새로운 CAS에 재사용하지 않습니다.
- 취소나 만료는 종료 증명이 아닙니다. 실행 identity가 없는 crash 기록은 계속 `unknown`으로 남습니다.
- dispatch journal 쓰기가 spawn 전에 실패하면 reservation을 정산합니다. `onReady` 이후의 오류를 pre-spawn 오류로 오인해 권한을 해제하지 않습니다.

## 후보와 Git

전체 manifest의 경로, 부모 디렉터리, 중복, 파일/디렉터리 충돌, POSIX mode, 크기, 내용 digest를 첫 object write 전에 확인합니다. Git으로 표현할 수 없는 mode는 거절하며, 검증 뒤 조용히 정규화하지 않습니다. `mktree -z`로 이름을 보존하고 sealed tree를 manifest와 다시 비교합니다. SHA-1과 SHA-256 저장소를 처리합니다.

Git 호출은 무작위 private hooks 디렉터리를 만들고 owner, 0700 mode, symlink 여부, 비어 있는지를 확인합니다. child 종료 뒤 자기 디렉터리만 정리합니다. 상속 Git config, hooks, fsmonitor, 자동 maintenance와 signing에 의존하지 않습니다. 같은 UID 또는 host 관리자 침해를 방어한다는 주장은 하지 않습니다.

현재 inclusion은 `.git`과 `.omk`를 제외한 전체 트리이며 알려진 민감 파일 이름을 거절합니다. 저장된 legacy 후보도 게시 전에 재검사합니다. 이는 비밀 내용 탐지기가 아니며, 사용자별 inclusion policy digest를 contract와 receipt에 연결하는 확장은 별도 작업입니다.

## 게시 deadline과 취소

`RunCoordinator.publish`와 CLI publish는 같은 취소 신호를 사용합니다. Git 객체 생성 전과 CAS 전에 신호와 권한을 다시 확인합니다. CAS 성공 뒤의 취소는 ref를 되돌리지 않습니다.

`PublishOptions.timeoutMs`는 정상 Git 작업 전체가 공유하는 monotonic 예산이며 기본값은 60초입니다. 각 child는 남은 예산과 30초 중 작은 timeout을 사용합니다. CAS 거절 뒤 결과를 재확인하는 읽기에는 별도의 최대 5초 정리 예산을 사용하며, 그 예산으로 쓰기를 재시작하지 않습니다. 동일 blob digest는 한 번만 기록합니다.

Git 실행은 아직 동기식입니다. 진행 중인 child 동안 Node의 signal handler 처리가 지연될 수 있으므로 즉각적인 비동기 취소를 약속하지 않습니다. timeout에는 direct child를 SIGKILL하지만, crash 이후 모든 Git 자손의 종료를 입증하는 영속 supervisor identity는 아직 없습니다. 결과가 불명확하면 권한을 quarantine합니다.

## 증거 조회

SDK의 `evidenceRead(runId)`와 `omk run evidence ID --json`은 다음 축을 구분합니다.

| 필드 | 의미 |
| --- | --- |
| `authenticity` | `valid`, `invalid`, `unverifiable` |
| `verification` | `passed`, `failed`, `incomplete` |
| `currentEnvironmentEligibility` | `matching`, `different`, `unsupported`, `unknown` |

정상 서명된 실패 영수증은 `valid`와 `failed`입니다. key가 없으면 `unverifiable`, 변조를 확인하면 `invalid`입니다. 현재 sandbox나 실행 파일이 없어도 과거 증거를 읽을 수 있습니다. 게시와 재실행은 별도의 현재 환경 검사를 유지합니다. 조회는 journal을 수정하거나 영수증을 재서명하지 않습니다.

## 저널의 incremental replay

같은 inode와 head 계보에서 읽은 committed prefix 바이트가 캐시와 정확히 같을 때만 suffix를 파싱합니다. 크기나 timestamp 일치만으로 prefix를 신뢰하지 않습니다. 교체, 축소, prefix 변경, GC, 재시작에서는 full replay 또는 오류로 돌아갑니다.

head CAS, reducer 사전검사, append fsync, head 게시, 재읽기 검증은 그대로 수행합니다. 외부 조회에는 복사된 projection을 반환해 caller가 cached state를 바꾸지 못하게 합니다. `OpenAuthorityStoreOptions.incrementalReplay: false`로 파싱 재사용만 끌 수 있으며 저장 형식은 바뀌지 않습니다. 전체 파일 읽기는 남아 있으므로 O(1) I/O나 일정한 mutation latency를 보장하지 않습니다.

## Shard helper

heavy-process capacity 0은 실행 0입니다. 실행 전 journal 쓰기가 실패하면 획득한 permit을 반환합니다. 예외가 나도 시작한 형제 작업을 abort하고 join합니다. runner 거절만으로 종료를 추정하지 않으며, 불명확한 작업은 permit과 journal 소유권을 유지합니다.

orphan attempt의 재시작은 trusted `observeTermination`이 해당 attempt의 종료를 확인한 뒤에만 가능합니다. `ShardRunner`는 자신이 소유한 실행 경계의 종료를 관찰한 후 resolve해야 합니다. 이 helper를 고쳤다는 사실이 verified DAG나 실제 provider에 자동 연결됐다는 뜻은 아닙니다.

## 회귀 검사

저장소 루트에서 좁은 offline 검사를 실행합니다.

```bash
LIVE_E2E=0 node node_modules/vitest/dist/cli.js --run \
  packages/coding-agent/test/safe-wiring \
  packages/coding-agent/test/verified-run \
  packages/coding-agent/test/workload-shard --maxWorkers=2
npm run check
```

전체 검증은 [Development](development.md)의 빌드 및 키 없는 테스트 절차를 따릅니다. 실제 계정의 인증 파일을 이동하지 않도록 검증용 checkout과 별도 HOME을 사용합니다. local pass, 설치 artifact smoke, 원격 CI, 실모델 효과 측정은 서로 다른 증거입니다.
