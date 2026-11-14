# OMK Rust v2.0.0 목표 검증, 2026-11-08

## 판정

**미완료, gaps_found. 실행 중인 버전은 1.5.10을 유지합니다.**

요청한 `/verify-goal`을 등록된 명령이나 실행 도구로 호출할 수 있는 경로는 이 세션에서 확인되지 않았습니다. 따라서 명령 실행 성공을 주장하지 않습니다. 저장된 목표, 요구사항, 현재 소스와 실제 검사 결과를 루트 에이전트가 직접 대조한 보고서입니다. GSD 단계 완료나 공식 verification owner의 통과 상태를 생성하지 않았습니다.

pstack의 `how`와 `Prove It Works`를 적용해 소스, 설치 산출물, 실행 중인 엔진을 구분했습니다. OMK `omk-update`, `programming`, `debugging` 절차로 백업, 최소 수정, 회귀 검사와 실제 진입점 검증을 수행했습니다. AdaptOrch는 순차 DAG를 권고했습니다. 외부 모델이나 서브에이전트는 실행하지 않았습니다.

## 이번 변경에서 확인한 결과

- 기존 npm 메타데이터 누락 차단을 해결했습니다. 검토된 lockfile과 정확한 후보 tarball로 오프라인 소비자 설치를 수행합니다.
- 실제 설치된 Node CLI의 native, missing, installed, compat-omitted, compat-explicit 5개 사례가 통과했습니다.
- 공개 SDK에서 재로드 및 cwd/session 교체 전후 도구 실행 4회를 확인했습니다. 자동 종료 검사도 유지했습니다.
- 회귀 검사 31개와 최종 `npm run check`가 통과했습니다. 루트 스크립트 테스트는 586개 통과, 30개 건너뜀, 실패 0개입니다.
- Rust 세 crate의 오프라인 테스트 37개, Clippy, 포맷 검사가 통과했습니다. 이는 기존 프로토타입 검증이지 Rust 실행 호스트 전환이 아닙니다.

자세한 명령, 실패 로그, 후보 해시와 보존 범위는 [Phase 2 수용 검사](phases/02-native-extensions-and-explicit-migration/02-ACCEPTANCE-20261108.md)에 기록했습니다.

## 목표별 대조

| 요구사항 | 현재 근거와 판정 |
|---|---|
| V2-BOUNDARY-01 | 기존 Phase 1 완료 기록 유지. 이번 작업으로 재인증하지 않음 |
| V2-CORE-01 | native 선택 경로의 Node 검사 통과. 기본값은 여전히 `omk+pi`, 최종 독립 코어 완료 아님 |
| V2-MIGRATE-01 | 기존 소스 구현과 보존 기록 유지. 전체 마이그레이션 수용 조건 미완료 |
| V2-API-01 | Node 통과. 설치된 선언 컴파일과 실제 Bun의 CJS 하위 경로 해석 실패 |
| V2-UI-01 | 서비스 생명주기와 렌더링 소유권의 전체 수용 검사 미실행 |
| V2-UI-02 | native UI, IME, 접근성, 터미널 소유권의 플랫폼별 실제 검증 미실행 |
| V2-R-01 | `Rscript` 없음. 독립 R 수치 검증 통과 주장 불가 |
| V2-RECOVERY-01 | 실행 소유권, 정산, 재시도, 장애 복구의 전체 진입점 수용 검사 미완료 |
| V2-HOST-01 | Rust crate 검사는 통과했지만 생산 실행 소유자는 여전히 Node |
| V2-DESKTOP-01 | 기존 관찰 프로토타입 존재. 완성된 native workbench 검증 아님 |
| V2-PLATFORM-01 | Windows, macOS, Linux 설치/업그레이드/롤백 수용 검사 미완료 |
| V2-RELEASE-01 | 선행 게이트 미충족. 버전 변경, 태그, 게시 및 엔진 교체 안 함 |

## 현재 재현되는 차단 항목

1. 실제 Linux x64 Bun 바이너리가 설치된 전이 CJS 의존성의 `@earendil-works/pi-ai/cjs`를 해석하지 못합니다. Node에서는 같은 사례가 통과합니다.
2. 설치된 공개 선언에서 `undici-types` 상대 참조 7개와 `@modelcontextprotocol/sdk/client/index.js` 참조 1개가 TS2307로 실패합니다. `skipLibCheck` 등으로 숨기지 않았습니다.
3. 독립 R, Rust 실행 소유권 이전, native UI와 플랫폼 수용 검증은 아직 남아 있습니다.

현재 공개 입력 3,736개의 후보 해시는 `678478e96ae537b53052c313bce9eec9d5fde5a851efa5dbbaa8cb9fa1b7a017`입니다. 기존 HEAD `48fb8e33a84d01fde163091ed36a8bca981d3bbe`와 작업 시작 전 변경을 보존했습니다.

다음 작업은 타입 선언과 Bun 해석 실패를 각각 재현하고 수정한 뒤 후보를 다시 동결하여 수용 검사를 실행하는 것입니다. 단순히 버전을 2.0.0으로 올리거나 Node 통과를 전체 Rust 업그레이드 완료로 보고하지 않습니다.
