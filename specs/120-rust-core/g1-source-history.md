# G1 ObjC 6개 버전의 소스 이력 추적

상태: **고정 소스의 출처 대조 완료, 기여자 고지 완결성/Apple 권리 승인 아님**.
검토일: 2026-11-13. 범위: [기존 B1 번들](g1-b1-review.md)의 동일한 6개 ObjC 버전.
증거: [g1-source-history.json](g1-source-history.json).
승인 항목: [B1 승인 체크리스트](g1-b1-approval-checklist.md).

- 기존 B1 JSON SHA-256: `8cbc59748c4abefafb365d2fee95da351ad00ad6fd11597f9f1d075abc2617cd`
- 기존 라이선스 보완 SHA-256: `9cc2665d3219856b69938e735a70a29f81f7944e0c59d5043a75d090207f0388`
- 이력 증거 JSON SHA-256: `4e62819933e1615c9e3445b8982ddbd72b6a9b89b7f75771b5ad62d06715e5ee`
- 후속 [미매핑 16파일/나머지 기여자 원출처](g1-objc-notice-origins.md), [근거 JSON](g1-objc-notice-origins.json): `1c8e13788a89b594238e72c5a7bd4d7379609b76d7df4b0c0fda4711d50eadce`
- 후속 [N2/N3 파일별 고지 범위](g1-objc-notice-scope.md), [근거 JSON](g1-objc-notice-scope.json): `39bfe158c7bda1034ba16ebe30cdc67a0deed79dbe018926bda26f62948a190d`
- 후속 [P1 예정 고지 자산 계획](g1-license-asset-plan.md), [manifest JSON](g1-license-asset-plan.json): `20a82cb53490da48d9dc89358f5da6857f9f3ef166b580095c1ded4a09c0f4ac`
- 후속 [N4 복사 코드/고지 매핑](g1-rust-copy-notices.md), [근거 JSON](g1-rust-copy-notices.json): `15a84497e1c691fabf41067c5c8e5c67949967127d294a3c4626e60268119a0b`
- 고정 lock SHA-256: `297fb6d82458e35456f0baff9c69298d70b56cc58c48b897ad6cfdc9d68e847a`

기존 B1/라이선스 JSON, 의존성 그래프, 운영 파일과 K1은 수정하지 않았습니다.
빌드, 재해석, 새 lock 생성, 채택, SDK 설치/약관 동의, upstream 연락/게시도 하지 않았습니다.
외부 소스와 Git clone은 저장소 밖 임시 증거에만 있으며, upstream 스크립트는 실행하지 않았습니다.

## 반복 조회의 한계와 바꾼 방법

라이선스 파일과 현재 디렉터리 로그의 반복 조회로는 버전별 완전한 고지를 얻지 못했습니다.
현재 경로만 보면 디렉터리 이동 전 이력, 병합된 선행 프로젝트, 별도 생성 코드 저장소를
놓칩니다. 커밋 작성자 목록과 나중에 추가된 일반 라이선스 본문도 고지 완결성의 증거가 아닙니다.

따라서 추가 검색을 중단하고, 이미 확보한 자료로 다음 대조표를 만들었습니다.

1. checksum이 고정된 발행 archive의 **모든 Rust 파일**을 열거합니다.
2. archive VCS revision/path에서 symlink와 `generated` gitlink를 해석합니다.
3. archive 파일의 Git blob SHA-1을 계산해 해당 revision의 tree object와 비교하고,
   별도로 SHA-256을 기록합니다. Cargo나 SDK는 실행하지 않습니다.
4. 초기 검토에서는 현재 경로 로그와 이동/병합 지점을 기록하고, 각 패키지의 지정 표본에만
   `git blame --line-porcelain -M -C`를 적용했습니다. 후속 N2/N3 검토는 아래처럼 main 파일 전체로 확장합니다.
5. 확인한 기여/원문 고지와 미확인 법적 적용 범위를 분리해 체크리스트로 넘깁니다.

이 방법은 **파일 출처**를 고정합니다. 모든 코드의 법적 저작자/권리자를 판정하거나,
전체 기여자의 고지를 찾았다는 뜻은 아닙니다. 표본 blame도 Git의 이동/복사 휴리스틱이며
독립적인 권리 증명이 아닙니다. author/coauthor는 법적 권리자 목록으로 변환하지 않았습니다.

## 759개 발행 Rust 파일의 exact source 매핑

| 발행 버전 | Rust 파일 | 그중 별도 생성 저장소 | 대조 일치 |
| --- | ---: | ---: | ---: |
| `objc2 0.6.5` | 95 | 0 | 95 |
| `objc2-encode 4.1.0` | 6 | 0 | 6 |
| `objc2-foundation 0.3.2` | 232 | 171 | 232 |
| `objc2-app-kit 0.3.2` | 302 | 294 | 302 |
| `objc2-core-foundation 0.3.2` | 69 | 46 | 69 |
| `objc2-core-graphics 0.3.2` | 55 | 50 | 55 |
| 합계 | 759 | 561 | 759 |

`objc2`는 `d7d2fa23ceaa5e6096c923b081040e5d81b3b9df`, encode는
`8d214f5477365ffcbcbb7de058c86ed9a518efb7`, 네 framework crate는
`7b1abfd750a2cacaea71d6a56ecfb83cb7de560b`에 고정했습니다.

framework crate의 `src/generated`는 main repository의 일반 디렉터리가 아니라
symlink입니다. [고정 .gitmodules](https://github.com/madsmtm/objc2/blob/7b1abfd750a2cacaea71d6a56ecfb83cb7de560b/.gitmodules)와
tree의 gitlink를 따라 [objc2-generated의 `4c2d6fb8…`](https://github.com/madsmtm/objc2-generated/tree/4c2d6fb86d17ed4b4b7e68e80994788b60521987)의
`Foundation`, `AppKit`, `CoreFoundation`, `CoreGraphics` 경로에 연결했습니다.

JSON의 `packages[].sourceFiles`에는 파일마다 archive SHA-256, 실제 source repository,
revision/path와 blob ID가 있습니다. 대상 feature가 꺼진 파일과 테스트도 archive 범위에
포함되므로, 이 수량을 컴파일/배포되는 코드 수량으로 읽으면 안 됩니다.

## 버전별 기여 이력과 고지의 의미

| 버전 | 확인한 이력 | 표본에서 확인한 기존 기여 | 고지 판정 |
| --- | --- | --- | --- |
| `objc2 0.6.5` | `objc2` → `crates/objc2` 이동, runtime/ID/encode 선행 이력 | `src/runtime/mod.rs`: Mads Marquart, Steven Sheldon, Patrick Walton, Lloyd Cunningham, George Burton | 현재 경로 로그에 없는 기여도 살아 있음. 알려진 MIT 고지를 보존할 범위와 다른 기여분의 applicable notice는 미완결 |
| `objc2-encode 4.1.0` | 선행 `rust-objc-encode` 병합, `objc2-encode` 디렉터리 이동 | `src/encoding.rs`: Steven Sheldon, Mads Marquart, Paul Mabileau | 현재 디렉터리 저자만으로 Steven의 기여를 누락하면 안 됨. MIT-only 유지, 전체 고지 매핑은 미완결 |
| `objc2-foundation 0.3.2` | 선행 Foundation 병합, 수동 코드와 icrate/generated 분리 이력 | `src/array.rs`: Mads Marquart, Steven Sheldon | 수동 코드의 과거 기여와 생성 코드 권리를 별도 취급. `copying.rs`는 여전히 고지문이 아닌 구현 파일 |
| `objc2-app-kit 0.3.2` | icrate의 framework 분리와 별도 생성 저장소 | `src/application.rs`: Mads Marquart | 표본 저자 1명이 패키지 전체 단독 권리자라는 뜻은 아님. 생성/수정 기여와 SDK 원문의 권리 분리 필요 |
| `objc2-core-foundation 0.3.2` | framework 추가 때 Foundation geometry 코드 이동, coauthor 기록 존재 | `src/geometry.rs`: Mads Marquart | 초기 추가 commit은 `samuelsleight`, `silvanshade`도 coauthor로 기록. 이것만으로 고지 문구/권리 범위를 만들 수 없음 |
| `objc2-core-graphics 0.3.2` | framework 추가 및 별도 생성 저장소 | `src/lib.rs`: Mads Marquart, Jo Bates | lib 표본은 생성 파일 전체의 기여/Apple 저작권을 대표하지 않음 |

표의 이름은 **Git metadata에서 관찰된 기여 표기**입니다. 새 copyright 문구를 작성한
것이 아닙니다. 더 넓은 현재 경로 author/coauthor 후보, 각 표본의 surviving line에
대응하는 commit과 과거 파일 경로는 JSON에 있습니다. 현재 경로 로그는 경로 생성
이후만 포괄하며, merge/squash 작성자나 생성 작업자도 포함할 수 있습니다.

주요 소스 이력 연결점:

- [선행 encode 병합 `4ac3a9d1…`](https://github.com/madsmtm/objc2/commit/4ac3a9d1d74181a8eb8280b9890be22fd67792e8)
- [선행 ID 병합 `542ac194…`](https://github.com/madsmtm/objc2/commit/542ac194a9a0089c9c71bcc4e84fdfbdbcfc6bdf)
- [선행 Foundation 병합 `0638bf65…`](https://github.com/madsmtm/objc2/commit/0638bf65a61445c00419fd53dfc1c4a267e780d1)
- [crates 디렉터리 이동 `b8f03dba…`](https://github.com/madsmtm/objc2/commit/b8f03dba9bda6bf91a9efcb6e3d9b8d99c7be0d5)
- [icrate framework 분리 `27176a9f…`](https://github.com/madsmtm/objc2/commit/27176a9f6d731c0f1b0bcbb67e26cccf59ba4dac)
- [CoreFoundation 추가/geometry 이동 `1eb7555a…`](https://github.com/madsmtm/objc2/commit/1eb7555a5b01e36bb5fef95672d9126543beaf4f)
- [CoreGraphics 추가 `eaf268dc…`](https://github.com/madsmtm/objc2/commit/eaf268dc5010e17cfecc26257417bcab0943ab38)

## 후속 N2/N3: 고지 보존 후보의 파일/행 범위

[N2/N3 보완](g1-objc-notice-scope.md)은 표본 대신 main 파일 198개 전체의 44,462행을
원래 commit/path/행과 대조했습니다. Steven 명의 비어 있지 않은 행이 남은 파일은
objc2 18개, encode 4개, Foundation 8개로 총 30개입니다. 과거 Steven MIT 고지가 존재하던
소스에서 이어진 행의 보존 검토 후보는 여섯 버전의 총 182개 파일입니다.
두 수량은 작성자/권리자 범위가 아니며, 561개 생성 파일은 자동 포함하지 않았습니다.

최초 commit에서 고지가 확인되는 Steven 명의 행은 50개입니다. 고지가 남아 있던
`757cd841…` snapshot과 원래 행/bytes를 연결하면 442개 모두에 별도 근거가 생깁니다.
이 차이를 유지하고, 나중 Mads 2026 고지는 과거 파일에 소급 배정하지 않습니다.
개인별 고지 완결성, 미매핑 16개 main 파일과 생성/SDK 권리는 여전히 미확인입니다.
전체 파일 목록, origin/snapshot/combined 행 범위와 P1 추가 범위는 새 JSON에 있으며,
기존 `packages[].representativeBlame`와 과거 검증 checkpoint는 그대로 보존했습니다.

추가 [원출처 추적](g1-objc-notice-origins.md)은 남은 16개 파일이 모두 2025년 고지 삭제 뒤
추가됐다는 점과 당시 선언/기여 정책을 고정했습니다. 나머지 18개 이름의 기여 commit을 확인하고,
그중 공동기여 trailer 3개 이름과 현재 선택 main-file 행의 commit 연결도 구체화했습니다.
새 개인 고지 원문은 회수하지 못했으며, 16개 파일을 고지 완료/면제 처리하지 않았습니다.
이 추가 작업의 보호 비교는 K1 문서와 기존 target 파일의 범위 밖 동시 변경으로 exit 1이며,
증거 검사 exit 0과 구분합니다. 해당 파일은 수정/복원하지 않았습니다.

## 실제 원문 고지와 복사 코드

[과거 MIT 고지](https://github.com/madsmtm/objc2/blob/757cd841d0293341dbefd9b99d7548dec244ffde/LICENSE.txt)의
`Copyright (c) Steven Sheldon`과 허가/면책 본문, 나중의
[MIT 고지](https://github.com/madsmtm/objc2/blob/ee9a7ada2131f5944b8750428e265c15632f2a19/LICENSE-MIT.txt)의
`Copyright 2026 Mads Marquart`를 출처와 함께 유지합니다. commit 날짜로 새 저작권 연도를
만들지 않았습니다. Git ancestry 검사에서 나중 본문 추가 commit `ee9a7ada…`는
세 고정 revision **어느 것의 조상도 아닙니다**. 나중 본문을 당시 source tree에 있었던
고지처럼 쓰거나 모든 과거 기여분의 완전한 허가로 간주할 수 없습니다.

발행된 `objc2 0.6.5`의
[`src/__macro_helpers/os_version/apple.rs`](https://github.com/madsmtm/objc2/blob/d7d2fa23ceaa5e6096c923b081040e5d81b3b9df/crates/objc2/src/__macro_helpers/os_version/apple.rs)는
Rust PR #138944에서 많이 복사했다고 명시합니다. 최초 helper 도입 `69bd0610…`과
**복사 표기/재작성 도입 `e1c7b209eafe24e78dcbaef87143ccfc9ee8a8e8`**을 구분합니다.
후속 요청에 따라 이 파일만 대상으로 [N4 소스/고지 매핑](g1-rust-copy-notices.md)을 보완했습니다.

당시 PR `a0061acd9d97cb70a67d0b080a04ebcd734b15b7`의 Darwin 구현을 블록별로 대조하고,
MIT의 `Copyright (c) The Rust Project Contributors`와 REUSE의
`The Rust Project Developers (see https://thanks.rust-lang.org)`를 각각 원문으로 기록했습니다.
별도 compiler 표 참조 `1e5719bd…`도 PR 원본과 분리했습니다. 단일 복사 SHA의 명시적 확증은
없어 **N4 부분 증거, 미승인**입니다. 같은 작성자라는 이유로 Rust 고지를 생략하지 않으며,
이 파일의 미래 배포물 포함 여부와 고지 포장은 여전히 별도 판정/검증 사항입니다.
[P1 제안](g1-license-asset-plan.md)은 이 Rust 원문과 attribution을 별도 자산 후보로 연결합니다.
제안 작성은 N4 판정, 전체 고지 완결성 또는 실제 배포 승인이 아닙니다.

## Apple SDK 확인 항목을 좁힌 결과

[framework 발행 revision의 문서](https://github.com/madsmtm/objc2/blob/7b1abfd750a2cacaea71d6a56ecfb83cb7de560b/crates/objc2/src/lib.rs)는
framework bindings가 **Xcode 26.0.1의 SDK에서 생성됐다**고 적고 있습니다. 이전의 일반적인
"SDK 버전 미확인"을 다음처럼 나눕니다.

- 확인: upstream이 보고한 generation context `Xcode 26.0.1`, 정확한 main revision과 generated gitlink.
- 미확인: 생성 당시 실제 SDK bytes/build number와 적용/수락한 계약, 결과물의 권리 범위.
- 별개: 미래 OMK native 빌더가 사용할 SDK/호스트와 실제 수락한 계약/증빙.

[고정 translator README](https://github.com/madsmtm/objc2/blob/7b1abfd750a2cacaea71d6a56ecfb83cb7de560b/crates/header-translator/README.md)도
SDK를 재배포하지 않는다고 설명합니다. 이것은 maintainer의 운영 설명이지, 파생 바인딩에 대한
Apple의 포괄 허가가 아닙니다. 최신 공개 약관을 과거 생성 당시 계약으로 소급 적용하지 않습니다.
구체적인 필요 증거, 담당 판단, 수용 조건은 체크리스트 A1–A7에 있습니다.

## 검증과 경계

아래는 최초 소스 이력 검증 checkpoint입니다. 후속 N4의 fresh baseline/검증 결과는
[별도 보완](g1-rust-copy-notices.md)에 있으며, 과거 동시 변경 기록을 덮어쓰지 않습니다.

- `inventory.py`: 759/759 archive Rust 파일의 main/generated blob 일치, exit 0.
- `verify.py`의 source 증거 검사는 버전/graph digest, 원문 hash, 수량, SDK 단서와
  체크리스트 불변식을 확인했습니다. 이 부분은 exit 0이며, 최종 보호 비교의 실패와 분리합니다.
- blob 변조, generated revision 변조, 고지 완결성 과장, B1 자동 승인, 항목 대리 승인,
  SDK 단서 조작, 나중 라이선스의 소급 적용의 음성 대조군 7개: 모두 거부.
- native Cargo 입력 12개, 원래 임시 G1 lock과 기존 B1/라이선스 JSON: 동일.
- K1 보호 파일 27개의 최초 비교는 exit 0이었으나, 최종 비교는 다른 작업의
  `specs/120-rust-core/k1-json-parity.md` 변경을 감지해 **exit 1**입니다. 전후 해시를
  기록했고 해당 파일을 수정/복원하지 않았습니다. K1 전체 불변/전체 검사 통과를 주장하지 않습니다.
- Cargo/build/test, native/SDK/clipboard 실행, source code 편입, 운영 NOTICE 변경은 없음.

체크리스트는 **판단 자료**입니다. 필수 항목의 근거와 사람의 판정이 남아 있으며,
이 소스 이력 대조가 B1 승인이나 배포 권리 확인을 대신하지 않습니다.
