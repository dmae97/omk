# G1 N2/N3: ObjC 버전별 기여 고지와 적용 파일 범위 보완

검토일: 2026-11-13. 상태: **파일/행별 보존 검토 범위를 좁힘, 고지 완결성과 권리 승인은 미완료**.
대상은 기존 G1의 동일한 ObjC 6개 버전입니다. [B1 체크리스트](g1-b1-approval-checklist.md)의
N2/N3에 연결하며, K1과 기존 의존성 그래프는 범위 밖입니다.
근거: [g1-objc-notice-scope.json](g1-objc-notice-scope.json).
JSON SHA-256: `39bfe158c7bda1034ba16ebe30cdc67a0deed79dbe018926bda26f62948a190d`.

기존 B1/라이선스/N4/P1 JSON, 임시 manifest/lock을 그대로 유지했습니다. 새 원격 조회,
Cargo 실행, 빌드, 채택, SDK 설치/약관 동의, 운영 NOTICE 변경, K1 수정/복원은 하지 않았습니다.
원시 소스와 blame 출력은 저장소 밖에만 보관했습니다. 작성자 이름을 새 copyright 문구로 만들지 않습니다.

## 1. 표본에서 198개 파일 전체로 확장

기존 [소스 이력 검토](g1-source-history.md)는 패키지별 대표 파일만 blame했습니다.
이번에는 archive의 Rust 파일 759개를 재대조하고, main repository에서 온 **198개 전체**에
`git blame --line-porcelain -M -C`를 적용했습니다. 테스트/예제/`build.rs`도 포함하지만 실행하지 않았습니다.

- 최종 파일 44,462행을 archive와 대조하고, blame이 지정한 원래 commit/path/행의 bytes와도 대조했습니다.
- 원래 소스의 상위 디렉터리와 root에서 정해진 고지 파일명 8종을 확인했습니다.
  `LICENSE.txt`, `LICENSE`, `LICENSE.md`, `LICENSE-MIT`, `LICENSE-MIT.txt`, `LICENSE-APACHE`, `NOTICE`, `COPYING`입니다.
- 별도 생성 저장소의 **561개 파일은 분리**했습니다. 생성 작업자나 위 수량을 권리자/배포 대상 수로 읽지 않습니다.
- 주석, 괄호만 있는 행, 기계적 편집도 비어 있지 않은 행 수에 포함됩니다.
  행 수/범위는 법적 창작성, substantiality 또는 소유 비율 지표가 아닙니다.

README 안의 조건, 다른 파일명과 외부 복사분까지 모두 감사한 것은 아닙니다.
blame의 이동/복사 휴리스틱과 author/coauthor metadata도 법적 권리자 증명이 아닙니다.

## 2. N2: 버전별 기여 단서와 분리한 파일 범위

| 고정 버전 | main 파일 / 별도 생성 파일 | Steven 명의의 비어 있지 않은 행이 남은 파일 | 과거 Steven MIT 고지 보존 검토 후보 파일 |
| --- | ---: | ---: | ---: |
| `objc2 0.6.5` | 95 / 0 | 18 | 93 |
| `objc2-encode 4.1.0` | 6 / 0 | 4 | 6 |
| `objc2-foundation 0.3.2` | 61 / 171 | 8 | 58 |
| `objc2-app-kit 0.3.2` | 8 / 294 | 0 | 4 |
| `objc2-core-foundation 0.3.2` | 23 / 46 | 0 | 19 |
| `objc2-core-graphics 0.3.2` | 5 / 50 | 0 | 2 |
| 합계 | 198 / 561 | 30 | 182 |

두 오른쪽 열은 다릅니다. **182개는 Steven이 작성/소유한 파일 수가 아닙니다.** 다른 작성자가
과거 MIT 고지가 존재하던 tree에서 수정한 행도 보존 후보에 포함됩니다. 파일 전체가 아니라
JSON의 origin/snapshot/combined 행 범위를 사용해야 합니다.

Steven 명의 행이 남은 주요 범위:

- `objc2`: runtime/retain/message/encode/macros와 예제/검사 코드 18개. 전체 경로 목록은
  `packages[].directStevenNonemptyFiles`, 실제 행은 `manualFiles[].directStevenNonemptyLineRanges`입니다.
- `objc2-encode`: `src/encoding.rs`, `src/helper.rs`, `src/lib.rs`, `src/parse.rs`.
- `objc2-foundation`: `src/array.rs`, `src/data.rs`, `src/dictionary.rs`, `src/enumerator.rs`,
  `src/iter.rs`, `src/lib.rs`, `src/string.rs`, `src/value.rs`.

전체 main-file blame에는 **14개 작성자 표기**가 있고, 그중 13개에 비어 있지 않은 행이 있습니다.
현재 디렉터리 이력만으로 놓쳤던 Alexander Bulaev, George Burton, Jeff Muizelaar,
Patrick Walton, Zach Leytus 등의 파일/행도 연결했습니다. 예를 들면 다음과 같습니다.

| 관찰한 metadata 이름 | 좁힌 파일 | 고지 판정 |
| --- | --- | --- |
| Alexander Bulaev | `objc2/tests/use_macros.rs` | 이름에 대응하는 별도 copyright 본문은 이번 제한 자료에서 미확보 |
| Jeff Muizelaar | `objc2/src/rc/autorelease.rs` | 동일. 작성자 표기를 새 고지문으로 바꾸지 않음 |
| Zach Leytus | `objc2-foundation/src/set.rs` | 동일. 현재 디렉터리 로그 밖의 기여 단서 유지 |
| Paul Mabileau | objc2의 `rc/mod.rs`, `retained.rs`, `weak.rs`, encode의 `encoding.rs`, `helper.rs` | 알려진 root 고지와 개인 명의 고지의 완결성을 구분 |
| Jo Bates | Foundation/AppKit/CoreFoundation/CoreGraphics의 `src/lib.rs` | 생성 파일 전체의 저작권을 대표하지 않음 |
| Lloyd Cunningham | `objc2/src/runtime/mod.rs`의 빈 행 1개 | 이전 표본의 1행을 실질 기여/저작권의 증거로 과장하지 않음. metadata 기록은 유지 |

Mads Marquart 명의 행은 198개 main 파일 모두에서 관찰됐지만 단독 소유를 의미하지 않습니다.
현재 path history/coauthor에만 남은 이름과 실제 surviving-line 작성자도 JSON에서 분리했습니다.
위 개인들에 대해 새 명의/연도를 만들거나, 고지를 못 찾았다는 이유로 허가가 없다고 단정하지 않습니다.

## 3. N3: 최초 행 시점의 고지와 이후 고지 보유 스냅샷을 구분

회수한 실제 고지는 [`757cd841…/LICENSE.txt`](https://github.com/madsmtm/objc2/blob/757cd841d0293341dbefd9b99d7548dec244ffde/LICENSE.txt)의
`Copyright (c) Steven Sheldon`과 MIT 허가/면책 전문입니다.
SHA-256: `e353f37b12aefbb9f9b29490e837cfee05d9bda70804b3562839a3285c1df1e5`.

독립 검증에서 **Steven 명의 442개 비어 있지 않은 행 모두의 최초 commit에 이 고지가 있었다는
가정은 실패**했습니다. 실제 원래 commit의 고지와 직접 연결된 것은 50행입니다.
따라서 그 가정을 채택하지 않고, 고지가 남아 있던 삭제 직전 스냅샷을 별도로 대조했습니다.

- notice-bearing snapshot: `757cd841d0293341dbefd9b99d7548dec244ffde`.
- 해당 6개 crate 경로 아래 존재하던 main Rust 파일 181개를 추가 blame했습니다.
- 현재 파일과 snapshot의 **원래 commit/path/행이 같고 실제 행 bytes도 같은 경우**만 연결했습니다.
- 그 결과 Steven 명의 442행 모두가 이 고지 보유 스냅샷과 연결됩니다.
  이것을 “442행의 최초 commit에 고지가 있었다”로 바꾸지 않습니다.

| 고정 버전 | Steven 명의 비어 있지 않은 행 | 최초 commit 고지 직접 대조 | 고지 보유 snapshot 연결 |
| --- | ---: | ---: | ---: |
| objc2 | 375 | 50 | 375 |
| objc2-encode | 44 | 0 | 44 |
| objc2-foundation | 23 | 0 | 23 |
| 나머지 3개 | 0 | 0 | 0 |
| 합계 | 442 | 50 | 442 |

작성자와 무관한 보존 후보 전체는 최초 snapshot 고지에 연결되는 34,969행,
삭제 직전 snapshot에 연결되는 35,399행이며, 중복을 뺀 합집합은 **182개 파일의 35,435행**입니다.
이는 해당 원문을 보존할 코드 범위를 검토하는 자료이지 모든 기여자의 허가/고지 완결성 증명이 아닙니다.
root 고지가 후대에 삭제됐다는 이유로 기존 보존 의무가 면제됐다고 해석하지 않습니다.

### AppKit/CoreFoundation/CoreGraphics에서 새로 좁힌 보존 후보

이 세 패키지에는 Steven 명의 비어 있지 않은 행이 관찰되지 않았지만, 과거 root MIT 고지와
연결되는 행은 있습니다. 작성자를 Steven으로 바꾸지 않고 **root 고지 보존 후보**로만 인계합니다.

- AppKit: `src/application.rs`, `src/image.rs`, `src/lib.rs`, `src/text.rs`.
- CoreFoundation: `packages[].legacyMitCandidateFiles`의 19개. 예를 들어 `src/geometry.rs`는
  과거 Foundation geometry 이동 이력과 연결되는 행을 포함합니다. 생성된 46개 파일과는 별개입니다.
- CoreGraphics: `src/image.rs`, `src/lib.rs`.

기존 [P1 계획](g1-license-asset-plan.md)의 `P1-A155`는 처음 세 패키지만 열거했습니다.
이번 `p1ScopeAmendmentProposal`은 위 세 패키지의 구체적인 행 범위도 보존 검토 후보로 추가합니다.
기존 P1 JSON/hash와 승인 상태는 변경하지 않고 **별도 범위 보완 제안**으로 연결합니다.
어느 패키지의 선언 라이선스도 바꾸지 않습니다.

### 나중 Mads 고지와 미매핑 파일

[`ee9a7ada…/LICENSE-MIT.txt`](https://github.com/madsmtm/objc2/blob/ee9a7ada2131f5944b8750428e265c15632f2a19/LICENSE-MIT.txt)의
`Copyright 2026 Mads Marquart`는 실제 원문으로 유지합니다. 그러나 이 commit은 세 고정 release
revision 어느 것의 조상도 아니라는 검사를 다시 확인했습니다. Mads 명의 행이 있다는 이유만으로
나중 본문을 과거 198개 파일의 완전한 고지로 배정하지 않습니다.

과거 MIT와 이번 방법으로 연결되지 않은 main 파일은 16개입니다. 예: objc2의
`examples/hello_world_app.rs`, AppKit의 `src/event.rs`, CoreFoundation의 `src/url.rs`.
전체 목록은 `packages[].noLegacyMatchManualFiles`에 있습니다. 이들은 **고지 불필요** 판정이 아닙니다.
별도 고지/README/복사 이력이나 다른 기여자의 원문 확인이 남아 있습니다.

후속 [미매핑 파일/기여자 원출처 추적](g1-objc-notice-origins.md),
[근거 JSON](g1-objc-notice-origins.json)은 이 16개 파일의 2025년 도입과 당시 선언/기여 정책,
나머지 이름 18개의 기여 commit/프로젝트 고지 맥락을 추가합니다. 개인 고지 원문은 새로
회수하지 못했으므로 이 문서의 이전 JSON/hash, 182/16 범위와 미승인 상태는 유지합니다.

## 4. 생성 파일과 복사분의 경계

- 생성 저장소 `4c2d6fb8…`의 root 파일명 조회에서는 별도 고지문이 없었습니다.
  generator metadata의 Mads/silvanshade 이름도 SDK 원문 권리자나 재배포 허가가 아닙니다.
  561개 생성 파일에 위 main-code 고지를 자동 배정하지 않습니다.
- 759개 Rust 파일의 제한된 문구 검색 결과 10건을 분류했습니다. `NSMetadataItemCopyrightKey`,
  `NSCopyrightDocumentAttribute` 같은 API 이름은 copyright notice가 아니며,
  일반 설명의 `derived from`도 별도 복사/라이선스 선언으로 바꾸지 않습니다.
- objc2 helper의 명시적 Rust 복사 선언은 기존 [N4 매핑](g1-rust-copy-notices.md)을 그대로 사용합니다.
  이 helper의 이전 코드 일부가 과거 MIT 범위와 연결돼도 Rust 원문 고지를 대체하지 않습니다.

## 5. 검증과 남은 판정

저장소 밖 `verify.py --docs`로 759개 파일 hash/blob, main 파일 198개와 원래 44,462행,
고지 보유 snapshot 연결, 버전별 범위, 문서 링크와 빈 승인란을 대조했습니다. exit 0입니다.
최초 고지/후대 snapshot 혼동, 범위 확대, Steven 작성자 오인, 생성 파일 자동 귀속,
나중 고지 소급, 작성자=권리자 단정, 고지 명의 조작, 미매핑=면제, hash 변조,
완결성/승인 조작의 음성 대조군 11개를 모두 거부했습니다.
보호 입력 비교도 exit 0이며 K1, native 입력과 기존 B1/라이선스/N4/P1 JSON은 동일했습니다.

N2/N3는 **부분 근거가 더 구체화된 미승인 항목**입니다. 적용 material/행의 법적 판단,
전체 contributor notice, 생성/SDK 권리, 라이선스 선택, 실제 배포물 고지 검사와 B1/B2 승인은
여전히 별개입니다. 이 보완을 이유로 체크박스를 채우거나 미확인 고지를 지우지 않습니다.
