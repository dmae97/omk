# H2c — 권한과 실행 세대를 보존하는 Rust writer 재연결

작성: 2026-11-09. 기준 HEAD: `48fb8e33a84d01fde163091ed36a8bca981d3bbe`.
기존 미커밋 작업 위에서 이어서 구현했으며, 저장소 커밋/푸시/배포는 하지 않았다.
pstack의 검증 가능한 단위, 경계 검증, RED/GREEN 절차를 루트 에이전트가 직접
적용했다. 별도 모델이나 에이전트 위임은 사용하지 않았다.

## 구현 범위

`linux-command-v1`의 단일 writer에 한정한 실제 coordinator/CLI 재연결이다.
`OMK_RUST_EXECUTION_HOST`와 `OMK_RUST_EXECUTION_RECONNECT=1`을 계획/시작 전부터
선택해야 한다. 기본값은 기존 부모 단절 시 취소이며, 전역 설정은 변경하지 않았다.

- 새 `RunReconnectCommand`, `RunCoordinator.reconnect()`와 `omk run reconnect`를
  연결했다. `--execute`, 원래 계약 승인, execution ID, revision, generation이 필요하다.
- 새 부모는 기존 authority/session-owner lease를 배타적으로 확보한다. 관찰자의
  authority epoch와 session incarnation은 갱신하지만 원래 writer의 grant token,
  claims, authorization deadline, execution ID, run generation은 바꾸지 않는다.
- 재연결은 새 writer를 실행하거나 workspace를 다시 만들지 않는다. 기존 grant는
  종료 관측 전까지 claim을 유지한다. 성공 후 일반 verifier만 자신의 정상 grant로
  실행한다. 원래 work/verify 상한과 model request 사용량은 그대로다.
- 매 관찰/제어/종료 경계에서 현재 authority head, 소유권, 시작 기록, claims,
  namespace, native binding과 boot를 확인한다. 취소/만료된 권한은 취소와 종료
  확인만 허용하며 성공 판정으로 복구하지 않는다.
- `reconnected` 이벤트는 revision만 증가시킨다. 같은 명령으로 관찰 부모를 다시
  시작할 수 있고, 완료 중복 호출은 기존 결과와 서명된 증거를 재확인한다.
- Rust accepted 기록에 boot ID, 원래 시작 시각과 grant/intent/execution/generation
  binding을 저장한다. 복구된 시각은 관찰 시각을 역산하지 않는다.

## 저장 완료 범위 공개

직접 리뷰에서 파일의 완성된 종료 줄이 `fsync` 완료 전에 reader에 보일 수 있는
문제를 확인했다. Rust는 각 append를 sync한 뒤 private `<requestId>.head`에
공개할 바이트 수를 atomic rename으로 기록하고 디렉터리를 sync한다. reader는
그 prefix만 해석한다. 완성된 미공개 종료 줄도 결과로 인정하지 않는다.

append/head 공개 실패 후에는 record writer를 오염 상태로 고정한다. 기존 prefix
뒤에 다른 결과를 덧붙여 실패를 숨기지 않는다. marker가 없는 옛 기록은 읽을 수
있지만 재연결 결과를 제공하지 못한다. 완료 통지 전 영속화 원칙도 유지한다.

## 주요 변경 경로

| 경로 | 역할 |
|---|---|
| `native/omk-execution/src/record.rs`, `protocol.rs`, `supervisor.rs` | boot/start/binding, 동일 monotonic 시작점, fsync-published prefix |
| `packages/protocol/src/run-reconnect.ts`, `index.ts` | 엄격한 재연결 명령 계약 |
| `packages/coding-agent/src/core/verified-run/native-reconnect.ts` | 원래 실행 관찰, 종료 정산, 후보 봉인과 기존 검증 경로 |
| 같은 디렉터리의 `native-reconnect-binding.ts`, `native-reconnect-event.ts` | 원래 권한/세대 연결, 현재 소유자 fencing, 세대를 늘리지 않는 이벤트 |
| 같은 디렉터리의 `rust-host-record.ts`, `rust-host-reattach.ts` | committed-prefix 해석과 관찰/취소 분리, boot-bound liveness |
| 같은 디렉터리의 `rust-host-binding.ts`, `rust-host-execution.ts`, `owned-execution.ts`, `writer-phase.ts`, `broker.ts`, `sandbox-types.ts` | 명시적 writer-only 선택, 기존 grant binding, 환경 digest |
| 같은 디렉터리의 `coordinator.ts`, `event-parser.ts`, `projection.ts`, `run-types.ts` | 기존 서비스와 journal 계약 연결 |
| `packages/coding-agent/src/commands/verified-run-cli.ts`, `verified-run-cli-args.ts` | 실제 CLI 명령/허용 플래그 |
| `packages/coding-agent/test/verified-run-rust-reconnect*.test.ts`, `helpers/native-reconnect.ts` | 실제 CLI 부모 재시작, 권한/세대/예산 경계 |
| `packages/coding-agent/test/verified-run-native-record-head.test.ts` | 미공개 suffix, 잘못된 head, 권한/심볼릭 링크 거부 |

기존 host/record/durability 테스트와 Rust protocol/witness 테스트도 갱신했다.
사용법과 제한은 `packages/coding-agent/docs/rust-execution-host.md` 및
`native/omk-execution/README.md`에 반영했다. 의존성과 lockfile은 변경하지 않았다.

## RED/GREEN 증거

증거 디렉터리:
`/mnt/omkdata/tmp/opencode/omk-rust-reconnect-20261109-01a1be6d/`

- `red-assertion.log`: 실제 CLI 부모를 SIGKILL한 뒤 기존 구현이 writer를 유지하지
  않고 취소하여 `detached === true` 단언이 실패했다. 앞선 `red.log`의 단순
  checkpoint timeout 대신 이 명시적 단언을 RED로 사용했다.
- `head-red.log`: 기존 reader가 head를 무시해 미공개 종료 결과와 잘못된 marker를
  수용하는 7개 단언이 실패했다.
- `head-native-red.log`: 실제 호스트에서 head 임시 경로를 막았을 때 이전 바이너리가
  여전히 `finished`를 내보냈다. 대상 테스트 하나가 의도대로 실패했으며 나머지
  두 테스트는 `-t` 선택 때문에 제외됐다.
- 최종 GREEN에서는 실제 terminal payload가 파일에 존재해도 head 공개가 실패하면
  통지/reader 어느 쪽도 성공으로 인정하지 않는다.
- 중간 guard 실행의 유일한 실패는 revision `0`을 stale-revision 사례에 넣어
  parser 단계에서 거부된 fixture 오류였다. 유효하지만 오래된 revision `1`로
  바꾸었으며 검증기나 기대 오류 범위를 완화하지 않았다.

## 최종 실행 결과

| 명령/범위 | 결과 |
|---|---|
| `cargo build --release --offline --locked --manifest-path omk-execution/Cargo.toml --bins` | 종료 0, 실제 host 바이너리 생성 |
| `cargo test --offline --locked --manifest-path omk-execution/Cargo.toml -- --test-threads=1` | 종료 0, 12 passed / 0 ignored |
| `cargo check --offline --locked --manifest-path omk-execution/Cargo.toml` | 종료 0 |
| `cargo clippy --offline --locked --manifest-path omk-execution/Cargo.toml --all-targets -- -D warnings` | 종료 0 |
| `cargo fmt --manifest-path omk-execution/Cargo.toml --check` | 종료 0 |
| Protocol `test/run-reconnect.test.ts` | 종료 0, 9 passed |
| 실제 binary를 지정한 최종 Node 16파일 matrix | 종료 0, 101 passed / 0 skipped |
| `NODE_OPTIONS=--max-old-space-size=4096 taskset -c 0,1 npm run check` | 종료 0, script 588 passed / 30 skipped / 0 failed, root typecheck 포함 |

Cargo는 증거 디렉터리의 `cargo.sh`로 네트워크 비활성 bwrap, 읽기 전용 소스/툴체인,
별도 Cargo cache/target에서 실행했다. build job과 test thread는 각각 1개다.
원래 host cache를 복사했으며 새 dependency를 설치하지 않았다.

Node matrix는 `packages/coding-agent`에서 다음 명령으로 실행했다.

```sh
EXECUTION_HOST_TEST_BINARY="$WORK/target/release/omk-execution-host" \
  node ../../node_modules/vitest/dist/cli.js --run --maxWorkers=1 \
  test/verified-run-rust-reconnect.test.ts \
  test/verified-run-rust-reconnect-guards.test.ts \
  test/verified-run-rust-reconnect-cli.test.ts \
  test/verified-run-native-record-head.test.ts \
  test/verified-run-rust-host-record.test.ts \
  test/verified-run-rust-host-durability.test.ts \
  test/verified-run-rust-host.test.ts \
  test/verified-run-rust-host-protocol.test.ts \
  test/verified-run-rust-host-binding.test.ts \
  test/verified-run-native-witness.test.ts \
  test/verified-run-authority-wiring.test.ts \
  test/verified-run-authority-restart.test.ts \
  test/verified-run-cancel-resume.test.ts \
  test/verified-run-writer-restart.test.ts \
  test/verified-run-cli.test.ts \
  test/verified-run-journal.test.ts
```

`WORK`는 위 증거 디렉터리다. Protocol 테스트는 `packages/protocol`에서 같은 runner의
`--run --maxWorkers=1 test/run-reconnect.test.ts`로 실행했다.
최종 host SHA-256:
`23906cea4144ea19d340334aa5d314af2192240cd0f49f1f5c0c06abfa34e49c`.

실제 OMK source CLI 테스트는 원래 부모와 첫 재연결 부모를 차례로 SIGKILL하고,
살아 있는 관찰자와 경쟁하는 두 번째 프로세스를 거부한 뒤 동일 명령으로 완료했다.
writer 실행 횟수는 1, 전체 dispatch는 writer/verifier 각 1회, generation은 1이었다.
원래 grant와 budget 객체는 유지됐고 원본 workspace는 변경되지 않았다.

권한 만료 테스트 한 건은 trusted authority clock을 만료 이후로 고정했다. 취소와
종료 확인은 실제 native process를 사용했다. 실제 work deadline 만료는 별도의
시간 기반 프로세스 테스트로 검증했다. 둘을 혼동하지 않는다.

LSP가 모든 파일의 clean 상태를 확인한 것은 아니다. 부수 AST 경고 중 nested
ternary를 정리했고, 경계 parser 관련 힌트와 일부 서버 미응답은 별도로 남았다.
실제 Cargo/Clippy/root TypeScript 검사는 통과했다. R 정책 이식은 없으며 root의
30개 optional skip을 새로운 R 검증으로 세지 않는다.

## 직접 리뷰와 남은 범위

직접 리뷰에서 다음을 확인했다: 기본값 불변, 재발급 없는 grant 사용, epoch/incarnation
fencing, `await` 이후 재검증, 후보 검증 전 실제 종료 확인, 저장 공개 실패 거부,
완료 중복 호출의 서명 증거 재검증, 테스트 소유 프로세스 정리. 최종 검사 후
남은 host 프로세스는 없었다. 독립 모델 리뷰나 플랫폼 전체 검증은 주장하지 않는다.

- verifier, DAG, scripted-agent/session 재연결은 미지원이다.
- candidate가 이미 봉인된 후 검증 도중 죽으면 기존 명시적 `resume` 경로를 사용한다.
- 자동 재연결, cross-boot 실행 복구, native record 자동 GC는 구현하지 않았다.
- 원래 effect-started 기록을 잃은 compacted authority history는 재연결을 거부한다.
- Rust가 grant ledger/다중 run scheduler/provider/UI/publication을 인수한 것은 아니다.
- 패키지 입력이 바뀌었으므로 이전 artifact candidate의 합격을 현재 빌드에 재사용할
  수 없다. 설치형 Node/Bun/타입 소비자 gate와 플랫폼 검증은 별도다.
- 버전과 설치된 OMK 엔진은 1.5.10 그대로이며 2.0.0 milestone 완료/출시를 선언하지 않는다.

제안 커밋 메시지: `feat: 기존 권한과 세대를 보존하는 Rust writer 재연결 추가`.
