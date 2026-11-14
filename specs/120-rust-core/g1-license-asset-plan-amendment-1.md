# G1 P1 보완 1: ObjC archive 전체 member의 고지 근거 등급

검토일: 2026-11-13. 상태: **제안 작성 완료, 미승인, 실제 고지 자산 미생성**.
기존 [P1 예정 고지 자산 계획](g1-license-asset-plan.md)을 보완합니다. 기존 P1 JSON과 hash는 그대로입니다.
증거: [g1-license-asset-plan-amendment-1.json](g1-license-asset-plan-amendment-1.json).
JSON SHA-256: `b274247ea0c8e69e35c34be09f5a8a3a9f69fa154bb2d7b76ebbe1376dc206ae`.

이번 작업은 [N2/N3 파일별 범위](g1-objc-notice-scope.md), [미매핑/기여자 원출처](g1-objc-notice-origins.md),
[N4 복사 고지](g1-rust-copy-notices.md)와 [소스 이력](g1-source-history.md)을 하나의 member 목록으로
연결합니다. K1 쓰기, Cargo 실행, 빌드, 채택, 라이선스 선택, 운영 NOTICE 변경과 원격 조회는 하지 않았습니다.

## 1. 범위: Rust 파일만이 아닌 archive 전체

이전 자료는 ObjC 6개 crate의 Rust 파일 759개를 다뤘습니다. archive에는 README, CHANGELOG,
`Cargo.toml.orig`, `translation-config.toml`, 주제 문서 Markdown과 cargo가 만든 metadata도 있습니다.
이번에는 checksum이 고정된 6개 `.crate`의 **일반 파일 member 817개 전체**에 등급을 붙였습니다.

| 고지 근거 등급 | member | 제안 처리 |
| --- | ---: | --- |
| 과거 Steven MIT 보존 후보 | 219 | `P1-A155`를 기록된 **행 범위**에 적용하는 안. 작성자/소유 판정 아님 |
| 고지 삭제 후 추가된 Rust 파일 | 16 | 고지 원문 미확보. 보류, 면제 아님 |
| 고지 삭제 후 추가된 비Rust 문서 | 3 | 동일. `cross_compiling.md`, `swift.md`, `list_unsupported.md` |
| 별도 생성 저장소 파일 | 561 | Apple/생성 자료 권리 결정 전 source 배포 차단 |
| cargo 패키징 metadata | 18 | `.cargo_vcs_info.json`, `Cargo.lock`, 정규화 `Cargo.toml`. 마지막은 `Cargo.toml.orig` 처리 결과를 따름 |
| 합계 | 817 | **완전한 고지 매핑 member 0개** |

비Rust 저작 파일은 고정 revision의 Git blob과 archive bytes를 대조한 뒤 blame했습니다.
비어 있지 않은 행의 origin commit에 Steven MIT `LICENSE.txt`가 있거나, 고지 보유 snapshot
`757cd841…`의 blame key와 일치할 때만 보존 후보 행으로 셌습니다. 앞선 Rust 범위와 같은 결합 기준입니다.

## 2. 파일 안의 미해결 행과 overlay

보존 후보 219개 중 **116개는 일부 행만 과거 MIT와 연결**됩니다. 나머지 4,618개 비어 있지 않은
행은 고지 삭제 이후 기여 등으로 여전히 고지 원문이 확인되지 않았습니다. 파일 전체에
과거 MIT를 적용했다고 기록하지 않고, JSON의 `legacyMitLineRanges` 밖 행을 미해결로 둡니다.

추가 표시(overlay)는 다음과 같습니다.

- Steven 명의 행 포함 30개: 기존 N3 결과와 동일합니다.
- N4 1개: `objc2 0.6.5/src/__macro_helpers/os_version/apple.rs`에 Rust 원문/attribution
  `P1-A159`–`P1-A164`를 함께 연결합니다. 단일 복사 SHA 미확증은 유지합니다.
- Apple/generator metadata 단서 10개: `translation-config.toml`, `Cargo.modified.toml`,
  `list_data.md`, `list_unsupported.md`. A4 material 분류 대상으로 추가했습니다.

## 3. 기존 P1 자산의 변경 제안

| 대상 | 기존 | 제안 | 상태 |
| --- | --- | --- | --- |
| `P1-A155` 과거 Steven MIT | objc2, encode, Foundation | 6개 crate 전체의 219개 member, 행 범위 단위 | 제안, 미승인 |
| 새 보류 항목 | 없음 | 19개 member와 부분 파일의 4,618개 미해결 행 | 고지 원문 필요, 자산 없음 |
| 새 차단 항목 | 없음 | 생성 파일 561개 | Apple 권리 결정 전 차단 |
| `P1-A149`–`A154`, `A156`–`A158` | 증거 전용 | 변경 없음 | 고지 전문/소급 허가로 사용하지 않음 |
| `P1-A159`–`A164` | N4 보류 | 해당 1개 member에 연결 | N4 판정 전 보류 |

나중 Mads 2026 본문, `LICENSE.md` 선언, 당시 기여 정책 또는 Git 작성자 이름으로 보류 항목을
채우지 않습니다. 실제 고지 원문, 권한 있는 원출처 설명 또는 검토자의 기록된 판단이 필요합니다.
MIT-only 3개 crate에 다른 대안을 부여하지 않으며, triple-license 3개의 선택도 하지 않았습니다.

## 4. 배포 형태에 대한 의미

- source/crate를 배포한다면 이 817개 목록이 최소 검토 범위입니다. 비활성 그래프나 dead strip으로
  member를 제외하지 않습니다. 생성 파일 561개와 보류 19개는 현재 결정으로 배포할 수 없습니다.
- object만 배포하는 경우에도 어떤 member가 실제 산출물에 들어가는지는 V1에서 확인해야 합니다.
  이 목록을 컴파일 단위나 실제 포함 증거로 쓰지 않습니다.
- `about_generated/list.rs`가 포함하는 Markdown 두 개도 목록에 들어 있으므로 문서 배포 시 함께 판단합니다.

## 5. 검증

저장소 밖 `verify.py --docs`로 6개 archive checksum과 817개 member hash를 독립적으로 다시 읽었습니다.
Rust 등급은 기존 근거 JSON과, 비Rust 등급은 Git blob/blame 증거와 origin `LICENSE.txt`,
snapshot blame을 다시 계산해 대조했습니다. 문서 링크, 빈 승인란과 기존 P1 JSON 불변도 확인했습니다.
**증거 검사 exit 0, 보호 비교 exit 0**입니다.

member 누락, 생성 파일의 MIT 재분류, 행 범위 확대, 보류 항목의 자산 연결, N4 표시 삭제,
완전 고지 주장, 라이선스 선택, hash 변조, P1 승인, 배포 승인의 음성 대조군 10개를 모두 거부했습니다.
이번 보호 기준점은 작업 시작 시 새로 잡았습니다. 이전 작업에서 관찰한 K1 동시 변경 기록은 그대로 둡니다.

P1은 여전히 **제안 상태**입니다. N2–N5, A1–A7 판정과 B1 소유자 승인, B2 실행 허가 없이
고지 자산을 만들거나 배포하지 않습니다.
