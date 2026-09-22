# 원자적 커밋 계획기

`omk-agent-core`의 `planAtomicCommits`는 변경을 검증 가능한 후보 그룹으로 나누는 순수 함수입니다. Git, 파일시스템, provider, 시계를 호출하지 않습니다. 세션 종료 시 커밋하거나 기존 tool scheduler를 대체하지 않습니다.

## 지원 API

```typescript
import { planAtomicCommits, type CommitPlannerInput } from "omk-agent-core";

export function inspectObservedChanges(hostObserved: CommitPlannerInput) {
  const plan = planAtomicCommits(hostObserved);
  return { groups: plan.groups, validationOrder: plan.validationOrder };
}
```

`hostObserved`는 신뢰된 host adapter가 관측한 사실이어야 합니다. 타입 검사나 parser 통과만으로 그 사실이 인증되는 것은 아닙니다. 현재 edit receipt를 수집하고 인증하는 adapter는 연결하지 않았습니다. 모델이 JSON에 `provenance: "verified"`, `settled: true`를 적었다고 소유권이나 종료가 증명되지 않습니다.

공개 타입은 `ChangeAtom`, `ChangeRelation`, `CommitPlannerInput`, `CommitGroup`, `CommitPlan`입니다. atom은 repository/worktree/session/intent ID, 모든 변경 경로, package 식별자, receipt 참조, preimage와 patch 식별자, dependency completeness, writer settlement, review 필요 여부를 포함합니다. rename은 이전 경로와 새 경로를 같은 atom에 담습니다.

패키지 경계와 의미 관계도 host가 제공하는 입력입니다. 폴더명, import, mtime, dirty 상태에서 이를 추측하지 않습니다. nested workspace를 자동 탐색하거나 새로운 Git 작업을 시작하는 API는 아닙니다.

## 그룹과 순서

- `together(A, B)`: 양방향 연결입니다. 분리하면 계약이 깨지는 변경을 같은 후보로 묶습니다.
- `depends(A, B)`: A가 B를 prerequisite로 갖습니다. dependency-first 순서를 생성합니다.
- `separate(A, B)`: 같은 SCC에 포함되면 `CONTRADICTORY_BOUNDARIES`로 차단합니다.

재귀 없는 SCC로 서로 분리할 수 없는 그룹을 계산합니다. 현재 repository/worktree/session의 그룹과 그 prerequisite closure만 선택하고, 무관한 foreign atom은 `unrelatedAtomIds`에 남깁니다. 그룹 ID와 dependency-first layer 내 순서는 ID의 코드 단위 비교로 결정합니다. locale, 입력 배열 순서와 중복 symmetric relation에 의존하지 않습니다.

| 상태 | 의미 |
| --- | --- |
| `candidate` | 정확한 snapshot 검증의 후보. 커밋 실행 허가가 아닙니다. |
| `review` | cross-intent closure 또는 명시적 review가 필요합니다. |
| `blocked` | foreign/unknown 소유권, 미종료 writer, 불완전한 closure, 경계 모순 등으로 진행할 수 없습니다. |

prerequisite가 candidate가 아니면 dependent도 차단합니다. 동일 SCC뿐 아니라 선행 그룹이 다른 intent인 경우에도 review가 필요합니다. 이 review 판정을 모델이 승인으로 바꾸는 API는 없습니다.

## file-level 경계와 입력 검증

v1은 서로 다른 atom이 같은 repository/worktree의 같은 파일을 독립적으로 소유한다고 추정하지 않습니다. 같은 파일 또는 file/descendant 경로가 겹치면 `AMBIGUOUS_FILE_OWNERSHIP`으로 보류합니다. 선택되지 않은 foreign atom도 겹침 검사에 포함합니다. `together`나 `depends`를 추가해 이 경계를 우회할 수 없습니다. 연속된 자기 편집을 하나의 정확한 file-level atom으로 만들거나, 후속 hunk 소유권 증명을 제공하는 것은 host adapter의 책임입니다.

다른 repository/worktree의 같은 상대 경로는 동일 파일로 취급하지 않습니다. 한 후보에 다른 repository의 변경이 의존성으로 들어오면 foreign ownership으로 차단합니다.

모든 safety flag는 실제 boolean이어야 합니다. truthy 문자열, 잘못된 enum, sparse array, 누락된 ID/edge evidence, 중복 atom ID, 알 수 없는 relation node는 `TypeError`입니다. 경로는 제어문자, 비정상 Unicode, 절대 경로, 역슬래시, 콜론, 빈 segment, `.`/`..`와 대소문자 변형 `.git` segment를 거절합니다.

입력 한도는 atom 20,000개, relation 100,000개, 전체 path entry와 package entry 각각 100,000개, atom당 path/package entry 각각 256개입니다. atom/relation 배열 길이는 atom 해석 전에 확인하고, 전체 entry 예산을 넘기는 atom은 해당 배열의 원소를 읽거나 복사하기 전에 거절합니다.

경로는 4,096 UTF-16 code unit, 나머지 text 식별자는 512개까지입니다. header, atom, relation의 인식된 문자열 값은 중복 제거 전에 모두 합산하며 총 8,388,608 UTF-16 code unit을 넘으면 거절합니다. enum 문자열도 포함합니다. 각 한도는 누적되며, 개수 한도 이내인 입력도 문자열 총량을 넘으면 거절합니다. 예산은 호출마다 새로 시작합니다. 이는 입력 파싱 작업의 상한이지 OS 경로 보안이나 실행 시간 보장은 아닙니다. symlink/junction, case folding, Git common-dir, submodule/LFS와 실제 scope 검사는 아직 host adapter 책임으로 남아 있습니다.

결과와 중첩 배열은 freeze됩니다. `canonicalInput`은 planner schema, policy version, repository/worktree/session, base, atom/receipt/patch와 relation evidence를 정규화한 JSON입니다. host는 이를 digest에 결합할 수 있지만, 이 문자열 자체는 인증된 receipt나 검증 성공이 아닙니다.

## 아직 제공하지 않는 기능

- edit receipt 관측과 인증, 의미 관계 자동 추출
- 원본 HEAD/index/working tree를 보존하는 production snapshot broker
- exact-prefix 검사, 실제 hook 실행, lease/fencing, 전용 candidate ref 게시와 crash recovery
- `/commit plan`, `/commit apply`, `/commit status` 명령
- shutdown 자동 커밋, 기존 index에서의 자동 staging, source branch 전진

별도 임시 Git fixture에서 snapshot commit, hook veto, CAS 충돌, alternate-index 함정을 확인했지만 production executor의 검증으로 계산하지 않습니다. 이 계획기만으로 preserve-mode 전체 P0가 완료된 것은 아닙니다. 기존 수동 Git 지침과 [Verified run 안전 경계](verified-run-safety.md)는 그대로 적용됩니다.

## 검사

```bash
cd packages/agent
LIVE_E2E=0 node ../../node_modules/vitest/dist/cli.js --run test/atomic-commit --maxWorkers=1
```

검사는 공개 API, strict input, mixed ownership, cross-intent review, 400개 seeded graph의 독립 reachability oracle, 12,000-node chain/fanout, browser bundle을 포함합니다. 단위 테스트의 합격률을 production 안전확률이나 Git 게시 승인으로 해석하지 않습니다.
