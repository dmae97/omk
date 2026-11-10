# Rust 실행 호스트 H1 구현 결과, 2026-11-08

## 구현 범위

**검증 도구만 수정한 작업이 아닙니다. Linux writer/verifier의 실제 샌드박스 실행 감독을 Rust로 연결했습니다.**

`OMK_RUST_EXECUTION_HOST`로 명시적으로 선택하면 기존 `RunCoordinator`와 `executeSandbox` 경로가 새 Rust 바이너리를 사용합니다. Rust가 gated sandbox 생성, commit 이후 실행, stdout/stderr 합산 예산, monotonic timeout, 취소, 프로세스 그룹 종료와 namespace 종료 확인을 맡습니다. 실패 시 같은 명령을 Node로 재실행하지 않습니다.

Node는 승인, 영속 권한 원장, 저널, DAG 스케줄링, 후보 검증, 복구 조정과 Git 발행을 계속 소유합니다. 기본 실행 경로와 설치 엔진은 변경하지 않았습니다. 전체 Rust 에이전트나 2.0.0 완성으로 보고하지 않습니다.

## 변경 경로

- `native/omk-execution/`: 실제 실행 바이너리, typed start/control protocol, 소유 프로세스 관리, namespace identity, bounded transport, 예산 reducer와 테스트. 기존 11개 Serde 의존성을 그대로 고정했으며 새 외부 의존성과 unsafe Rust는 없습니다.
- `packages/coding-agent/src/core/verified-run/broker.ts`: 명시적 native backend 선택과 환경 해시 연결. Git 발행은 기존 Node 경계를 유지합니다.
- 같은 디렉터리의 `rust-host-binding.ts`, `rust-host-execution.ts`, `rust-host-protocol.ts`, `sandbox-types.ts`: 바이너리 소유자/권한/해시 고정, 부모 채널, 독립 종료 재확인과 공유 타입.
- `packages/coding-agent/test/verified-run-rust-host*.test.ts`: 실제 프로세스와 공개 coordinator 경로를 검증하는 15개 검사.
- `scripts/architecture/verify-execution-budget.R`, `verify-execution-budget.mjs`: 새 production 예산 reducer에 대한 독립 base-R 계산과 변조 negative control.
- `packages/coding-agent/docs/rust-execution-host.md`, `omk-2-migration.md`, native README/의존성 고지: 사용법, 소유권과 미구현 범위.

작업 시작 HEAD는 `48fb8e33a84d01fde163091ed36a8bca981d3bbe`입니다. 이전 패키지 검증 변경을 보존했고, 커밋, push, 발행, 전역 설치와 엔진 교체는 하지 않았습니다.

## 실제 실행 증거

| 검사 | 관측 결과 |
|---|---|
| Rust `cargo test --offline --locked` | 7개 통과, 실패/무시 0 |
| Rust `cargo clippy --offline --locked --all-targets -- -D warnings` | 종료 0 |
| Rust `cargo fmt --check` | 종료 0 |
| Rust release build, `--offline --locked --bins` | 종료 0 |
| 새 Node/native 통합 검사 3파일 | 15개 통과, 건너뜀 0, 종료 0 |
| source CLI `run plan`, `run start`, `run artifact`, `run events` | 모두 종료 0. 실제 writer/verifier 2회 dispatch, 검증된 산출물 `native-runtime`, 원본 폴더 불변 |
| 기존 검사를 포함한 13파일 matrix | 최초 97/98 통과. 기존 Git 발행 사례 1개는 ambient umask로 `mode_unrepresentable` 실패 |
| 위 실패 파일을 `umask 022`로 재실행 | 4/4 통과, 종료 0. 파일 모드 보호와 테스트 기대값은 변경하지 않음 |
| 최종 `npm run check` | 종료 0. 스크립트 테스트 586 통과, 30 건너뜀, 실패 0. 컴파일러/가드 포함 |

Native 통합 검사는 살아 있는 namespace의 조상 프로세스를 확인해 Rust가 실제 소유자인지 검사합니다. 승인 콜백이 Error, null 또는 0을 던져도 후보 명령은 시작하지 않습니다. 재로드를 가장한 가짜 제공자나 버전 문자열을 native 실행 증거로 쓰지 않았습니다.

취소, 분리된 자식, timeout, 출력 상한, readonly mount, 부모 EOF, 잘못된 request ID, 출력을 읽지 않는 부모와 실제 native owner SIGKILL을 다뤘습니다. SIGKILL 시 coordinator 저널의 active execution이 남고 settlement가 `quarantined`인 것을 확인했습니다. 요청된 취소를 종료 관측으로 대신하지 않습니다.

## R 수학적 검증

기존 로컬 R 4.4.3을 절대 경로로 실행했습니다. 이전의 “PATH에서 Rscript를 찾지 못함”은 R 설치 자체가 없다는 뜻이 아니었습니다. R이나 패키지를 설치하거나 다른 프로젝트 oracle을 수정하지 않았습니다.

1. **실제 Rust host 예산 reducer**: R의 누적합과 최초 위반 인덱스 계산으로 6,566개 고정 trace를 비교했습니다. 시간/출력 상한의 정확한 경계, clock regression, 첫 실패 고정, 큰 정확 정수를 포함하며 허용 오차 없이 결정과 retained bytes가 일치했습니다. 바꾼 결정을 R이 거부하는 negative control도 통과했습니다.
2. **기존 TS/R/Rust DAG policy**: DAG 2,214개와 메모리 경계 16개가 일치했습니다. R은 별도로 JS invalid 입력 15개와 WPL 상태쌍 196개도 확인했습니다. WPL은 Rust 포트가 아닙니다.
3. **기존 oracle 회귀/semantic negative controls**: 실제 R과 Rust 바이너리를 지정하여 60개 모두 통과, 건너뜀 0개입니다. root check의 선택적 R 건너뜀을 R 통과로 계산하지 않았습니다.

예산 불변식은 `0 <= retained <= limit`입니다. 초기값은 0이고, `chunk <= limit-retained`일 때만 더하므로 귀납적으로 상한을 보존합니다. 거절 시 retained는 불변이고, 처음 발생한 실패가 이후 입력에서 해제되지 않습니다. 시간 판정은 `elapsed >= timeout`에서 거절합니다. README에 이 계약과 증명 범위를 기록했습니다.

이는 유한 입력 검증과 해당 reducer의 수학적 논증입니다. 전체 프로그램의 형식 증명, OS의 hard real-time 보장, process recovery의 수학적 증명을 주장하지 않습니다. 기존 DAG Rust 포트 역시 아직 multi-run scheduler 소유권 이전이 아닙니다.

## 직접 리뷰에서 수정한 문제

- **실제 소유자 RED**: 처음에는 Node 실행 조상에 Rust가 없어 새 통합 검사가 실패했습니다. production broker 연결 후 통과했습니다.
- **출력 backpressure**: 동기 stdout write 때문에 부모가 읽지 않으면 취소가 멈추는 실패를 재현했습니다. bounded 비차단 출력 큐와 제한된 terminal flush로 수정했습니다. 큐 고갈은 실패이며 성공 receipt를 만들지 않습니다.
- **EOF/종료 경합**: 입력 reader들이 종료된 직후 채널 disconnect를 즉시 `unsettled`로 처리해 정상 취소 정산을 놓쳤습니다. 기존 deadline 안에서 실제 child/namespace 종료를 계속 관측하도록 수정했습니다.
- **거짓값 예외**: null/0 승인 예외가 정상 결과로 바뀌지 않도록 오류 존재 여부와 오류 값을 분리했습니다.
- **타입 의존 사이클**: broker와 native adapter 간 type-only cycle도 저장소 가드가 거부했습니다. 공통 sandbox 타입을 분리하고 기존 broker export는 보존했습니다.
- **보존 범위**: 다른 작업의 패키지 검증 변경, native 기존 crate, 기본 Node 경로와 Git 발행 정책을 유지했습니다. 새 source를 통과시키려고 가드, expected output, R 허용오차 또는 실패 기준을 완화하지 않았습니다.

pstack `Model the Domain`에 따라 gate를 Waiting/Ready/Committed 상태로 표현했습니다. `Prove It Works`에 따라 실제 프로세스 조상, 공개 coordinator와 source CLI를 검사했습니다. OMK programming/debugging/R 가이드를 적용했으며 직접 리뷰입니다. 독립 서브에이전트 리뷰나 다중 모델 합의를 주장하지 않습니다.

## 잔여 범위와 다음 구현

- Rust 영속 실행 기록/재접속/복구 조정, grant ledger와 multi-run scheduler 이전.
- provider/session/tool lifecycle, native workbench/UI와 Windows/macOS 지원.
- 기존 Phase 2 Bun CJS 및 배포 선언 실패, 패키징/업그레이드/롤백 수용 검사.
- hostile same-user 바이너리 교체 경쟁은 파일 해시 관측만으로 해결되지 않습니다. operator-owned executable과 private stdio 신뢰 모델이며 원격 서비스가 아닙니다.
- source와 로컬 release 바이너리는 검증했지만 설치 엔진은 1.5.10입니다. 새 바이너리를 설치하거나 전역 기본값으로 활성화하지 않았습니다.

다음 단위는 Rust의 영속 실행 기록과 재접속 후 reconciliation을 실제 호출 경로에 연결하는 것입니다. 이번 정산/unknown 계약을 보존하고, 그 뒤에 scheduler 및 예산 원장의 소유권을 순서대로 옮겨야 합니다. 완료율을 임의로 산정하지 않습니다.

## 증거 보존

로컬 journal: `/mnt/omkdata/tmp/opencode/omk-rust-host-20261108-01a1b83a/`.

- `budget-red.log`, `node-red/`, `backpressure-red/`: 실제 실패 기록.
- `native-final/`, `node-final/`, `authority-umask022/`: 명령과 종료 코드, 통합 로그.
- `cargo-test-final.log`, `cargo-clippy-final.log`, `cargo-fmt-final.log`, `cargo-release-final.log`, `cargo.sh`: 제한된 Cargo 실행.
- `cli/receipt.json`과 CLI command receipts: 실제 source CLI 검증.
- `budget-oracle-release/receipt.json`, `dag-oracle.log`, `r-controls/`: R 결과와 negative controls.
- `root-check-pass/`: 최종 저장소 검사.
- `verification.json`: 소스/바이너리/주요 로그 SHA-256과 최종 범위.

이 작업의 테스트 프로세스는 모두 종료됐습니다. 증거와 빌드 산출물은 재검토를 위해 보존하며 다른 작업의 디렉터리는 정리하지 않았습니다.
