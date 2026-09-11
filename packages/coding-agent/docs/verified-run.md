# Verified Run: 명령형·오프라인 AgentSession 실행

두 opt-in profile을 제공합니다. `linux-command-v1`은 승인된 명령 하나를,
`linux-scripted-agent-v1`은 실제 `AgentSession`과 내장 Faux adapter로 승인된 단계를
실행합니다. 명령은 격리된 복사본에서 실행하고, 고정한 산출물을 외부 검사로 확인한
뒤 회수합니다. 일반 세션과 기존 bash receipt의 동작은 바꾸지 않습니다.

**S90 전체 구현이나 M1–M4 완료를 의미하지 않습니다.** M1의 무과금 reference
경로와 native EvidenceReceipt v3 연결에 이어, M2의 **고정 candidate 이후 복구**를
지원합니다. 불변 입력이 저장된 새 run은 중단된 writer도 명시적으로 재시작할 수 있습니다.
실서비스 모델 adapter, Task DAG, TUI/RPC, 적용 승인은 아직 없습니다.

## 실행 경로

```text
계약 parser → 명시적 host 승인 → 단일 owner + v2 원장
  → 격리 writer → 실제 process close → candidate manifest + blobs
  → 읽기 전용 candidate에서 검사 → supervisor의 stdout 비교
  → native v3 receipt → Claim Closure → HMAC attestation → durable 수락 → 산출물 회수
```

Coordinator는 기존 durable file I/O·mutation lock·session owner lease를 재사용합니다.
판정에는 `omk-protocol`의 `evaluateProofClosure()`를 사용합니다. 새 모델 엔진,
외부 서비스, 의존 패키지는 추가하지 않습니다.

## 지원 범위

- Linux, `/usr/bin/bwrap`, 사용 가능한 user/PID/network namespace가 필요합니다.
  `start`는 실제 sandbox probe에 실패하면 실행을 거부합니다. 자동 fallback은 없습니다.
- 실행 파일은 `/bin/` 또는 `/usr/bin/` 아래에서 `/usr/`로 해석되는 파일입니다.
  `/usr`는 신뢰하는 host toolchain이며 읽기 전용으로 마운트합니다. 다른 runtime
  경로와 외부 dependency mount는 지원하지 않습니다.
- writer는 입력 복사본 전체를 수정할 수 있습니다. `writablePaths`는 **수락할 변경
  범위**입니다. 범위 밖 변경이 있으면 candidate를 수락하지 않습니다. 원본 프로젝트는
  마운트하지 않으며 수정하지 않습니다.
- verifier command도 불신 프로세스입니다. 별도 namespace에서 candidate를 읽기 전용으로
  받아 실행합니다. 승인된 각 검사의 exit code가 0이고 stdout 바이트가 계약과 같아야 합니다.
  비교 코드·기대값·원장·issuer key는 supervisor에만 있습니다.
- regular file의 바이트·경로·mode, 빈 디렉터리·삭제를 binding합니다. 디렉터리는 mode
  `0755`만 지원합니다. root 디렉터리 mode는 실행 기반 시설로 취급합니다.
  symlink, hardlink, 특수 파일, set-ID mode, 잘못된 UTF-8 이름은 거부합니다.
- root `.git`과 `.omk`는 이 profile의 입력에서 명시적으로 제외합니다. 그 밖의
  dotfile·untracked file은 포함합니다. Git submodule과 mutable dependency cache는
  지원하지 않습니다. 작은 입력 디렉터리부터 사용하십시오.
- network, host home, 상속 환경 변수, provider credential을 worker에게 주지 않습니다.
  신뢰 가정은 operator·host/kernel·supervisor 설치물입니다. 같은 UID의 악성 host
  프로세스나 악성 kernel을 방어하는 경계는 아닙니다.

`verified`는 **이 profile의 명시한 stdout 검사들에 대해 이 candidate가 통과했다**는
뜻입니다. 검사 품질·일반적인 의미적 정확성·S90 점수·배포 승인을 증명하지 않습니다.

## 계약

`contract.json` 예시입니다. `root`를 실제 절대 경로로 바꾸십시오.
`baseDigest`에는 먼저 64개의 `0`을 넣고 `plan` 결과의 실제 값을 채울 수 있습니다.

```json
{
  "schemaVersion": "omk.verified-run.v1",
  "profile": "linux-command-v1",
  "runId": "greeting-1",
  "goal": "greeting.txt에 hello 생성",
  "workspace": {
    "root": "/absolute/path/to/input",
    "baseDigest": "0000000000000000000000000000000000000000000000000000000000000000"
  },
  "writablePaths": ["greeting.txt"],
  "writer": ["/bin/sh", "-c", "printf hello > greeting.txt"],
  "checks": [
    {"claimId": "greeting", "argv": ["/bin/cat", "greeting.txt"], "stdout": "hello"}
  ],
  "budget": {
    "workMs": 5000, "verifyMs": 5000, "cleanupMs": 1000,
    "maxOutputBytes": 4096, "maxFiles": 100, "maxBytes": 65536
  },
  "apply": "artifact-only"
}
```

검사는 1–32개, 수정 경로는 1–128개이며 ID는 중복될 수 없습니다. 0·음수·무한
budget, 상대 executable, 경로 traversal, 알 수 없는 필드는 거부합니다.
`approved`, `trusted`, `actorRole`, `verified` 같은 JSON 필드는 승인이 아닙니다.
parser는 입력을 복사하고 중첩 배열·객체를 고정합니다.

계약·명령 인수·입력 파일에 credential을 넣지 마십시오. 계약 원문은 private 원장에
보존됩니다. 이 profile은 일반적인 secret scanner나 DLP를 제공하지 않습니다.

## 오프라인 AgentSession profile

위 계약의 `profile`과 `writer`만 다음으로 바꿀 수 있습니다. 다른 필드는 그대로
필요하며, 바뀐 계약 digest에 새 승인을 받아야 합니다.

```json
{
  "profile": "linux-scripted-agent-v1",
  "writer": {
    "kind": "scripted-agent",
    "steps": [
      ["/bin/sh", "-c", "printf hello > greeting.txt"],
      ["/bin/cat", "greeting.txt"]
    ],
    "maxRequests": 3
  }
}
```

이 모델 응답은 이미 승인된 step index를 순서대로 선택하는 합성 응답입니다.
실제 코딩 능력·일반적인 자연어 작업 생성을 평가하는 모델이 아닙니다. 원격 provider,
OAuth, API key, 과금은 사용하지 않습니다. step은 1–16개, 전체 논리 요청은 1–32개로
제한합니다. 위 예시는 두 tool turn과 마지막 종료 응답에 3개 요청을 씁니다.

신뢰하는 host에서 기존 `AgentSession`을 메모리 세션으로 조립합니다. 프로젝트·사용자
리소스를 reload/discover하지 않고, 허용 tool은 `verified_step` 하나뿐입니다. 이 tool은
계약의 정확한 다음 명령만 broker에 요청할 수 있습니다. **AgentSession 프로세스 자체를
OS sandbox에 넣은 것은 아니며, 불신 명령의 process가 각각 격리됩니다.** custom runtime
port를 주입하는 SDK host는 같은 신뢰 경계를 책임집니다.

원장의 `writer_opened → model_request / dispatch / exited → writer_closed`가 producer와
자식 실행을 구분합니다. 자식이 끝나도 producer가 열려 있으면 settled가 아니며 candidate를
고정할 수 없습니다. 중복 요청·cap 초과·닫힌 producer 재개를 거부합니다. 명령 실패는
마지막 모델 문구로 덮을 수 없습니다. `modelRequests`는 논리 요청 수이지 HTTP/과금 수가 아닙니다.

## CLI

```bash
omk run plan --contract contract.json --json
# baseDigest를 계약에 반영한 뒤 다시 plan하고 계약·검사·변경 범위를 검토합니다.
omk run start --contract contract.json --approve CONTRACT_DIGEST \
  --command-id start-1 --state-dir /private/operator-state/verified-runs
omk run inspect greeting-1 --state-dir /private/operator-state/verified-runs --json
omk run evidence greeting-1 --state-dir /private/operator-state/verified-runs
omk run artifact greeting-1 --candidate CANDIDATE_DIGEST --path greeting.txt \
  --state-dir /private/operator-state/verified-runs
```

기본 state 경로는 agent directory 아래 `verified-runs/`입니다. state와 workspace가
포함 관계이면 거부합니다. 계약 파일도 입력 디렉터리 밖에 두어 base digest의
자기참조를 피하십시오. `plan`은 파일을 읽고 hash만 계산하며 process를 시작하거나
state를 작성하지 않습니다.

출력은 JSON입니다. `artifact`는 manifest에 있는 정확한 상대 경로만 받아 base64로
반환합니다. 다른 candidate·절대 경로·traversal을 허용하지 않습니다. 기존 파일에
적용하거나 Git ref를 갱신하는 명령은 없습니다.

종료 코드: 정상 조회·candidate_ready는 `0`, 실패·미수락·무결성 오류는 `1`, 잘못된
명령·계약은 `2`입니다. 실행 중 SIGINT/SIGTERM은 해당 자식에 취소를 전달합니다.
`run resume`는 아래의 제한된 복구만 지원합니다. `run cancel` 원격 제어와 `run apply`는
아직 지원하지 않습니다.
소스 체크아웃에서는 root에서 `node --import tsx packages/coding-agent/src/cli.ts run ...`로
동일 경로를 사용할 수 있습니다. 이 변경만으로 설치된 TUI가 갱신되지는 않습니다.

## SDK

```typescript
import { createRunCoordinator, planVerifiedRun } from "open-multi-agent-kit";
import { parseRunContract, VERIFIED_COMMAND_VERSION } from "omk-protocol";

const contract = parseRunContract(decodedJson);
const plan = planVerifiedRun(contract);
const coordinator = createRunCoordinator(operatorStateRoot);
// host가 사용자 승인을 확보한 후에만 호출합니다. plan 결과 자체는 승인이 아닙니다.
const state = await coordinator.start(contract, {
  schemaVersion: VERIFIED_COMMAND_VERSION,
  kind: "start", runId: contract.runId, commandId: "start-1",
  expectedRevision: 0, expectedGeneration: 0,
  contractDigest: approvedDigest
}, { approvedContractDigest: approvedDigest, signal });
```

`inspect(runId)`, `evidence(runId)`, `artifact(runId, candidateDigest, path)`는 실행을
재시작하지 않습니다. SDK 호출자는 신뢰하는 host이고 승인 채널 인증을 책임집니다.
이 API를 worker나 불신 plugin에 직접 노출하지 마십시오. `createRunCoordinator()`는
표준 session adapter를 주입합니다. 저수준 `new RunCoordinator(root)`는 명령형 실행만
가능하며, adapter 없이 scripted profile을 실행하면 `writer_backend_missing`으로 실패합니다.

## 고정 candidate 이후 복구

새 실행은 `budget_anchored`에 Linux boot ID와 boot-relative 시작·work/verify/cleanup
기한을 기록합니다. `candidate` 사건은 실제 검증 기한도 고정합니다. 프로세스가 끝나도
기한을 새로 주지 않으며, 중단·재시작에 걸린 시간도 소비됩니다.

```bash
omk run inspect greeting-1 --recovery --state-dir /private/operator-state/verified-runs
omk run resume greeting-1 --execute --approve CONTRACT_DIGEST \
  --candidate CANDIDATE_DIGEST --revision REVISION --generation GENERATION \
  --command-id resume-1 --state-dir /private/operator-state/verified-runs
```

`inspect --recovery`는 읽기 전용입니다. `readiness: "ready"`도 실행 권한이나 lease
획득을 뜻하지 않으며 `ownership: "lease_required"`로 표시합니다. `resume`은 `--execute`와
정확한 contract/candidate/revision/generation을 요구합니다. 오래된 참조, 다른 candidate,
명령 ID 충돌, 살아 있는 owner의 lease는 거부합니다.

SDK도 같은 경계를 사용합니다.

```typescript
const recovery = coordinator.inspectRecovery(runId);
const state = recovery.state;
const resumed = await coordinator.resume({
  schemaVersion: VERIFIED_COMMAND_VERSION, kind: "resume",
  runId, commandId: "resume-1",
  expectedRevision: state.revision, expectedGeneration: state.generation,
  contractDigest: approvedDigest, candidateDigest: selectedCandidateDigest
}, { approvedContractDigest: approvedDigest, signal });
```

실제 재개는 다음 순서입니다.

1. 원장 무결성과 명령 binding을 검사하고 단일 owner lease를 획득합니다.
2. 같은 boot·줄어들지 않은 단조 clock·기존 검증 기한을 확인합니다.
3. 이전 verifier가 남아 있으면 기록된 namespace init의 종료를 확인합니다.
4. key·candidate blobs·검사 환경이 그대로인지 확인합니다.
5. `resumed`를 append/fsync하여 generation을 올린 뒤 새 복사본에서 모든 검사를 실행합니다.
6. 같은 candidate와 새 generation의 실행·v3 receipt로 새 attestation을 수락합니다.

writer·AgentSession은 재실행하지 않습니다. 이전 model 요청 수, candidate digest, key,
검증 기한을 보존합니다. 이전 부분 receipt는 파일로 남지만 새 generation의 성공 증거로
자동 재사용하거나 다시 서명하지 않습니다. 총 generation은 3까지, 즉 재개는 최대 두 번입니다.
동일 resume 명령은 저장된 진행 상태를 조회할 뿐 다시 실행하지 않습니다. append 결과가
불확실한 경우에도 같은 ID로 맹목 재실행하지 않습니다.

새 broker는 명령 실행 전에 bwrap의 private `--info-fd`에서 PID namespace init을 확인하고
`process_ready`를 내구성 있게 기록한 다음 stdin gate를 엽니다. boot ID·PID·시작 tick·namespace
identity를 함께 사용합니다. PID만 보고 다른 프로세스를 종료하지 않습니다. gate 대기 중
취소되거나 기록에 실패하면 늦은 callback이 명령을 실행할 수 없습니다.

**`resume`으로 복구하지 않는 경우:** candidate 고정 전 중단, 열린 writer, 알려진 terminal 실패,
namespace가 살아 있거나 상태를 알 수 없는 경우, `process_ready`가 없는 dispatch, 원장 손상,
key/blob/환경 변경, budget 만료, reboot/clock 불명, 예전 clock 정보 없는 원장입니다.
이때 기록과 미정산 ID를 보존합니다. 재개 가능성을 추측해 원장을 수리하거나 예산을 늘리지
않습니다. writer는 아래 별도 명령의 조건을 충족해야 하며, 그 외에는 reconciliation 또는
새로 승인한 run이 필요합니다. 모든 crash window를 처리하는 M2 전체 구현은 아닙니다.

## 불변 입력에서 writer 재시작

새 `start`는 원본 입력의 blob·manifest를 저장하고 `input_checkpoint`를 append/fsync한
뒤에만 writer나 모델 요청을 시작합니다. `inputDigest`는 승인한 `workspace.baseDigest`와
같아야 합니다. 이미 진행 중인 예전 run에는 이 정보를 추측해서 덧붙이지 않습니다.

```bash
omk run inspect greeting-1 --writer-recovery --state-dir /private/operator-state/verified-runs
omk run restart-writer greeting-1 --execute --approve CONTRACT_DIGEST \
  --base INPUT_DIGEST --revision REVISION --generation GENERATION \
  --command-id restart-1 --state-dir /private/operator-state/verified-runs
```

SDK는 `inspectWriterRecovery(runId)`와 `restartWriter(command, approval)`를 제공합니다.
command는 `kind: "restart_writer"`, `baseDigest`, 기존 contract/ref/command ID 필드를
사용합니다. `--recovery`와 `--writer-recovery`는 서로 다른 조회이며 같이 지정할 수 없습니다.

이 작업은 **중단된 명령을 이어 실행하는 것이 아니라**, 승인된 writer 전체를 새
`writer-N` 디렉터리에서 재실행합니다. 변경된 원본 프로젝트나 예전 부분 출력은 입력으로
쓰지 않습니다. 이전 디렉터리·관측·receipt는 보존하며 새 결과를 다시 고정·검증합니다.

- 현재 두 profile의 격리된 로컬 작업만 대상입니다. 원격/opaque 부작용의 재실행 보장이 아닙니다.
- writer namespace의 종료를 확인하고 단일 owner lease와 새 generation을 획득합니다.
- 원래 work/verify/cleanup 기한을 유지합니다. 기다린 시간과 이전 `modelRequests`는 환급하지 않습니다.
- scripted writer는 남은 요청 수가 모든 step과 종료 응답에 충분해야 합니다. 새 시도의 완료 판정에
  과거 요청을 끌어다 쓰지 않습니다. 같은 명령 ID의 재요청은 조회이며 추가 writer를 만들지 않습니다.
- generation 상한 3은 `resume`과 `restart-writer`가 공유합니다.
- input checkpoint 누락·손상, live/unknown namespace, stale ref, 부족한 시간/요청, 환경·key 변경,
  알려진 terminal 실패는 거부합니다. candidate가 이미 고정됐다면 writer 재시작 대신 `resume`을 씁니다.

`ready`는 필요한 조건을 관측했다는 뜻일 뿐이며 실제 lease 획득을 보장하지 않습니다.
input pin 이전 또는 process identity 기록 이전의 crash window는 여전히 자동 복구하지 않습니다.

## 내구성·예산·복구 한계

- 원장 `version: 2`는 기존 v1 transcript journal과 별도입니다. 순서·hash chain·상태
  전이를 검증하고 append/fsync 성공 후에만 메모리 상태를 갱신합니다. write 실패는
  해당 store를 폐쇄합니다. 읽기 중 torn tail·중간 손상을 자동 수리하지 않습니다.
- generation은 명시적인 `resume` 또는 `restart-writer`에서만 증가하며 기존 원장을 다시 쓰지 않습니다.
  기존 v1/v2 attestation과 clock 없는 원장은 읽을 수 있지만 복구용 clock·세대를 추측해
  채우지 않습니다. clock 없는 미완료 실행의 resume은 `legacy`로 차단합니다.
- 작업 시간에는 preflight·원장·snapshot 시간이 포함됩니다. dispatch 의도 기록 뒤
  기한을 재확인합니다. verify에는 별도 시간 한도를 적용하고 cleanup 예약을 작업이나
  검사에 빌려주지 않습니다. 동기 filesystem 작업까지 강제 중단하는 wall-clock SLA는 아닙니다.
- process kill 요청과 실제 close를 구분합니다. cleanup 시간 뒤에도 close가 없으면
  `quarantined`와 active ID를 유지합니다. 원장 재생만으로 이를 settled로 바꾸지 않습니다.
- output byte cap은 process별 합산 stdout/stderr에 적용합니다. 파일 수·바이트 cap은
  snapshot 수락 한도이며 실행 중 disk·RAM·PID의 OS 강제 한도가 아닙니다. cgroup,
  실 provider의 HTTP attempt/과금 집계, run 간 전역 budget은 미구현입니다.
- manifest·blob·native v3 receipt·attestation을 먼저 내구성 있게 보존하고 마지막에 수락
  event를 씁니다. orphan artifact가 남을 수 있으며 GC는 없습니다. 새 attestation v3는 각
  native receipt의 core digest와 현재 generation/run/candidate/contract/검사/환경을 묶습니다. 두 번째
  authoritative replay ledger는 만들지 않습니다.
- `evidence()`는 `receiptFormat: "v3"`와 검증된 `receipts`를 반환합니다. native core의
  `status: "passed"`는 process exit 0을 뜻하며 stdout assertion 통과와 다릅니다. 예전
  attestation v1은 `receiptFormat: "legacy"`, 빈 `receipts`로 읽고 자동 재서명·승격하지 않습니다.
  v3 material 누락·손상이나 주입된 mutable envelope의 ledger/authority 필드는 거부합니다.
- native receipt 출력은 강제 credential redaction 뒤 stdout/stderr별 최대 앞 32 KiB의
  digest만 보존합니다. 정확한 stdout assertion에는 별도로 인증된 원본 byte digest를
  사용합니다. 이 broker의 receipt 시간은 시작 wall reference와 단조 경과시간으로 종료
  시각을 투영합니다. 별도로 다시 읽은 wall clock이 뒤로 가도 시간 순서가 뒤집히지 않습니다.
  재개 권한·예산 판정은 이 wall 표시가 아니라 저장된 boot-relative 기한을 사용합니다.
  기존 v3 schema와 일반 bash receipt는 바꾸지 않습니다.
- issuer key는 worker 밖 `0600` 파일입니다. 재조회는 저장된 key와 MAC을 검사합니다.
  key를 잃으면 과거 receipt를 다시 서명하지 않습니다. candidate/toolchain/receipt/blob
  변조는 수락 조회를 막습니다. 환경 hash는 kernel·sandbox argv·직접 executable을
  binding하며 `/usr`의 모든 shared library를 pin한 image digest는 아닙니다.

## 구현·검증 상태

| 항목 | 현재 상태 |
| --- | --- |
| M1의 명령형 CLI/SDK 경로 | 실제 Linux sandbox·candidate·외부 검사·회수 연결 |
| M1의 AgentSession reference + v3 bridge | 실제 CLI/SDK 연결. 합성 model adapter만 지원 |
| 실서비스 모델·완전한 toolchain image pin | 미구현 |
| M2: 고정 candidate 이후 검증 재개 | 실제 SIGKILL→CLI resume 검사 통과. 원래 예산·세대 fencing 적용 |
| M2: 불변 입력 기반 writer 재시작 | 실제 SIGKILL→CLI restart 검사 통과. 이전 요청 수·기한·부분 출력 보존 |
| M2: 모든 crash window 복구 | 미완료. input/process pin 없는 상태는 자동 복구 차단 |
| M3 Task DAG·부분 retry·adoption | 미구현 |
| M4 TUI/RPC·MCP·GC·적용 승인/CAS | 미구현. CLI/SDK 조회·개별 artifact 회수 제공 |
| S90 전체 G01–G20·성능/정상 회귀 하한 | 미측정. 부분 테스트로 점수를 부여하지 않음 |

직접 검증 기록과 제한은 [TDD 증거](verified-run-testing.md)에 있습니다.
