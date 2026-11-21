# OMK 2.0.3 로드맵 초안

기준: v2.0.2 태그 `d4a0b7d6fa` (2026-11-21 배포). 목표: 새로 설치한 2.0.3이 현재 로컬 엔진(`omk-2.0.2-release-RF4nWj`)과 같은 동작을 재현한다. 2.0.2 focused 계획(U0~U6)은 2.0.2에 실리지 않았으므로 2.0.3에서 다시 다룬다. 측정하지 않은 속도·비용 개선은 주장하지 않는다.

## 근거

| 항목 | 관측 |
|---|---|
| 로컬 엔진 전용 패치 | v2.0.2 대비 95개 경로(신규 디렉터리 포함), 공개 main에 없음 |
| 2.0.0 브랜치 | origin/main에 없는 비병합 커밋 15개 (OAuth 재시도 eecd9efaba, tools 경고 70074988ed 포함) |
| 작업 트리 | K1 Rust provider 단위 미커밋 (native/omk-providers, fixtures, specs/120-rust-core) |
| 열린 PR | #480 right rail 상태 (build-check-test 실패), #317 explorer (충돌), #391 gateway (draft) |
| 열린 이슈 | #104 10만 줄 세션 첫 그리기 약 6초 |
| 2.0.2 릴리스에서 발견 | verified-run이 0644/0755 외 권한(umask 002의 0664)을 거부, 테스트가 TMPDIR와 SSH_TTY에 의존, npm 토큰 bypass_2fa 누락을 publish 단계에서야 발견 |

## 기준선

비교군은 둘이다. 공개 v2.0.2 설치(npm `latest`와 Release binary)가 호환·복귀 기준이고, 현재 로컬 엔진이 목표 동작이다. 각 lane은 한 기능만 바꾸고 나머지는 v2.0.2와 같게 둔다. 판정은 v2.0.2에서 해당 시험 ID가 실패하거나 기능이 없고, 후보에서 통과하는지로 한다.

## 아키텍처

새 서비스, 저장 형식, 공개 wire schema는 추가하지 않는다. 2.0.2 focused ARCHITECTURE의 소유권 규칙을 그대로 따른다.

```text
launcher(~/.omk/agent/bin/omk) -> engine(packages/coding-agent/dist/cli.js)
  provider 호출 ─ sdk-provider-stream (L1: OAuth 거부 시 1회 갱신, forwarded 이후 재시도 금지)
  세션/턴 ─ skill selector (L7) ─ prompt
         └ next-suggestion controller (L3) ─ editor Tab/Enter (host가 stdin 소유)
  상태 스냅샷 ─ 표시 정책 ─ OpenTUI worker frame | native fallback (L4)
                                   └ 패키징된 runtime/asset (L5)
  subagent 부모 승인·기한 ─ child ─ 결과 1회 통합 (L6), bg registry는 기존 소유
  verified-run ─ git tree 구성 (L2: mode는 실행 비트로 100644/100755 결정)
CI: tag -> build-binaries.yml build -> publish-npm(L8 토큰 사전 검사) -> attest -> release
```

실패 경계: provider 재시도는 이벤트를 하나라도 전달한 뒤에는 하지 않는다. suggestion은 근거가 없거나 stale이면 비운다. OpenTUI 실패는 native 표시로 돌아가고 입력은 유지한다. subagent는 결과 불명 작업을 자동 재실행하지 않는다. publish는 8개 중 하나라도 실패하면 Release를 만들지 않고, 같은 tag workflow를 다시 돌려 복구한다.

## 가정과 위험

| 가정 | 틀리면 |
|---|---|
| 엔진 패치의 각 기능이 clean main 위에서 서로 독립적으로 분리된다 | L0에서 결합된 묶음은 한 PR로 합치거나 2.0.3에서 뺀다 |
| #480과 엔진 opentui 변경이 같은 문제를 다룬다 | 둘 중 하나를 닫고 다른 쪽에 합친다 |
| L6을 실제 모델 호출 없이 A1~A4, A6~A8, B1까지 판정할 수 있다 | A5는 미검증으로 표시. 승인 없으면 L6을 2.0.4로 미룬다 |
| CI 러너에서 npm 토큰 목록 API로 bypass_2fa를 읽을 수 있다 | L8은 문서와 로컬 사전 검사 스크립트만 남긴다 |

## 작업 (PR 하나씩, clean main에서)

| ID | 내용 | 원천 | 완료 조건 |
|---|---|---|---|
| L0 | 로컬 패치·2.0.0 커밋·작업 트리를 lane/later/drop으로 분류 (완료) | 엔진 status, git log | [L0-INVENTORY.md](L0-INVENTORY.md) |
| L1 | OAuth 거부 토큰 1회 갱신 재시도, tools/ 경고 오탐 수정 | 2.0.0 커밋 2개 | 기존 회귀 테스트 통과, cherry-pick 충돌 0 |
| L2 | verified-run 파일 권한을 git처럼 실행 비트로 판정, 테스트 TMPDIR 정규화, goal-controller flake 조사 | 2.0.2 릴리스 관측 | umask 002에서 verified-run 테스트 통과, 기본 셸에서 ./test.sh 실패 0 |
| L3 | next-suggestion v3 문구·현재 작업 판정 (U3/U4) | 엔진 패치 next-suggestion-* | 2.0.2 VALIDATION S1~S11 |
| L4 | OpenTUI 상태 rail·footer (U5), PR #480 정리 | 엔진 패치 opentui-*, #480 | T1~T7, #480 CI green |
| L5 | OpenTUI runtime 패키징 (U6) | stage-opentui-runtime.mjs, build-binaries.sh | T8: npm tarball과 standalone에서 실제 frame |
| L6 | native subagent·skill optimizer 패키지 (U1/U2) | native-subagent-package.ts, resources | A1~A8, B1 |
| L7 | skill selector 절 단위 선택·짧은 후속 문맥 | skill-section-*, bcf73f779a | 기존 skill 선택 테스트 + 신규 테스트 |
| L8 | publish 전 npm 토큰 사전 검사(bypass_2fa), 릴리스 노트 선행 조건 문서화 | 2.0.2 publish 실패 4회 | bypass_2fa=false 토큰에서 publish 전 단계가 명확한 메시지로 실패 |

의존: L0 -> 전부. L7 -> L3 (prompt-skill 경로 공유). L4 -> L5. 나머지는 독립. 순서: L1, L2, L8 (작고 근거 있음) -> L7 -> L3 -> L4 -> L5 -> L6 -> RC. 파일 단위 원천과 착수 조건은 [L0-INVENTORY.md](L0-INVENTORY.md)에 있다.

## 범위 밖

K1 Rust provider는 런타임에 연결하지 않은 채 별도 PR로 계속 진행하며 2.0.3 게이트가 아니다. #391 gateway, #317 explorer, Pi 독립 Phase 2~6, #104 성능은 다음 minor 이후 결정한다.

## RC와 배포

1. 각 PR: `npm run check`, `(umask 022; TMPDIR=/tmp) ./test.sh`, 해당 인수 시험 ID.
2. RC: clean clone 설치, npm tarball과 Linux x64 binary smoke, 실제 launcher tmux probe, 2.0.2 -> 2.0.3 -> 2.0.2 복귀 연습.
3. 릴리스 노트 PR 병합 후 `npm run release:patch`, CI publish, 8개 npm latest와 GitHub Release 대조.
4. 필수 ID 하나라도 미검증이면 그 lane을 빼고 출시하거나 No-Go.

## 미검증

엔진 패치의 각 기능이 clean main 위에서 단독으로 동작하는지 확인하지 않았다. L6은 실제 모델 호출 없이는 A5를 판정할 수 없다. #104 개선 폭은 측정 전이다.
