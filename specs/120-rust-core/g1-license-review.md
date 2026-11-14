# G1 B1 라이선스 원문 보완

검토일: 2026-11-13. 범위: [G1 B1 번들](g1-b1-review.md)의 동일한 고정 그래프.
원문/해시/발췌 위치: [g1-license-review.json](g1-license-review.json).
상태: **원문 대조 완료, ObjC 고지 완결성과 SDK 파생물 권리 확인은 미완료**.
법률 의견이나 배포 승인 대신, 확인한 문언과 확인하지 못한 적용 사실을 구분합니다.

- manifest SHA-256: `79e5072e447530ac30d9acf3009002ee3e38e5e9c1fb6ba21ce988cca1383932`
- lock SHA-256: `297fb6d82458e35456f0baff9c69298d70b56cc58c48b897ad6cfdc9d68e847a`
- 보완 전 B1 JSON SHA-256: `04fcbe2d7806a865a9bfa09226e76a48c5f88cbd95fa8dc0ab424c42c3cba22e`
- 이 보완 JSON SHA-256: `9cc2665d3219856b69938e735a70a29f81f7944e0c59d5043a75d090207f0388`

84개 lock 항목, 78개 선택 패키지와 타깃별 feature/edge를 변경하지 않았습니다.
이번에는 Cargo 해석 명령도 실행하지 않았습니다. 새 lock, SDK 설치/약관 동의,
의존성 빌드/채택, 운영 NOTICE/배포물 변경, K1 쓰기는 없습니다.
원문 파일과 PDF는 임시 증거에만 보관하고 저장소에는 짧은 발췌와 출처/해시를 남깁니다.

## 1. 고지문 목록의 오탐 정정

이전 `licenseFiles` 검색은 `COPYING` 뒤의 점도 허용해 다음 두 파일을 잘못 포함했습니다.

- `objc2-foundation 0.3.2/src/copying.rs`: `NSCopying` 관련 Rust 구현
- `objc2-foundation 0.3.2/src/tests/copying.rs`: 그 테스트

둘 다 라이선스 문서가 아닙니다. 실제 archive member와 기존 해시는 일치하지만,
**파일 무결성과 파일의 법적 문서 분류는 별개**입니다. 두 항목을 라이선스 목록에서
제외하고 원래 해시/오탐 사유를 별도 보존했습니다. 다른 기존 목록의 `.rs/.c/.h`
오탐은 발견되지 않았습니다. 이는 전체 소스의 법적 감사 완료 주장이 아닙니다.

따라서 선택 패키지 중 독립 고지문이 archive에서 확인되지 않은 수는 **11 → 12**,
완전한 버전별 고지가 미확인인 ObjC 패키지는 **5 → 6**으로 정정합니다.
이 정정은 의존성 수량이나 선언 라이선스를 바꾸지 않습니다.

## 2. ObjC: 선언 라이선스, 회수한 본문, 남은 범위

각 archive의 `.cargo_vcs_info.json`과 manifest를 해당 archive checksum으로 검증했습니다.
아래 고정 revision의 전체 Git tree는 잘리지 않았으며, 라이선스 문서는 루트
`LICENSE.md`만 확인됩니다. 그 문서는 표준 라이선스를 외부 링크로 가리킵니다.

| 고정 패키지 | 선언식 | 정확한 upstream revision |
| --- | --- | --- |
| `objc2 0.6.5` | MIT | `d7d2fa23ceaa5e6096c923b081040e5d81b3b9df` |
| `objc2-encode 4.1.0` | MIT | `8d214f5477365ffcbcbb7de058c86ed9a518efb7` |
| `objc2-foundation 0.3.2` | MIT | `7b1abfd750a2cacaea71d6a56ecfb83cb7de560b` |
| `objc2-app-kit 0.3.2` | Zlib OR Apache-2.0 OR MIT | `7b1abfd750a2cacaea71d6a56ecfb83cb7de560b` |
| `objc2-core-foundation 0.3.2` | Zlib OR Apache-2.0 OR MIT | `7b1abfd750a2cacaea71d6a56ecfb83cb7de560b` |
| `objc2-core-graphics 0.3.2` | Zlib OR Apache-2.0 OR MIT | `7b1abfd750a2cacaea71d6a56ecfb83cb7de560b` |

[고정 LICENSE.md](https://raw.githubusercontent.com/madsmtm/objc2/7b1abfd750a2cacaea71d6a56ecfb83cb7de560b/LICENSE.md)는
MIT-only 패키지를 명시합니다. [재라이선스 제안 #23](https://github.com/madsmtm/objc2/issues/23)은
조회 시 open 상태입니다. `objc2-foundation/Cargo.modified.toml`의 향후 기여 조건도
이미 발행된 전체 패키지의 MIT 선언을 Zlib/Apache로 바꾸는 근거가 아닙니다.
**MIT-only 3개에 Zlib의 바이너리 고지 예외를 적용할 수 있다고 판단하지 않았습니다.**

### 추가로 확보한 실제 고지문

[commit `ee9a7ada…`](https://github.com/madsmtm/objc2/commit/ee9a7ada2131f5944b8750428e265c15632f2a19)는
루트에 완전한 MIT/Apache/Zlib 본문을 추가합니다. 세 파일은 모두 회수하고 해시를 기록했습니다.

- [LICENSE-MIT.txt](https://raw.githubusercontent.com/madsmtm/objc2/ee9a7ada2131f5944b8750428e265c15632f2a19/LICENSE-MIT.txt)
- [LICENSE-APACHE.txt](https://raw.githubusercontent.com/madsmtm/objc2/ee9a7ada2131f5944b8750428e265c15632f2a19/LICENSE-APACHE.txt)
- [LICENSE-ZLIB.txt](https://raw.githubusercontent.com/madsmtm/objc2/ee9a7ada2131f5944b8750428e265c15632f2a19/LICENSE-ZLIB.txt)

이 본문의 저작권 표기는 `Copyright 2026 Mads Marquart`입니다. 이전 고지를 삭제한
[licensing clarification commit](https://github.com/madsmtm/objc2/commit/cfb199226661ec6e4939fcd7cd7531b3c5453076)의
부모에서 [과거 LICENSE.txt](https://raw.githubusercontent.com/madsmtm/objc2/757cd841d0293341dbefd9b99d7548dec244ffde/LICENSE.txt)도
확보했습니다. 여기에는 `Copyright (c) Steven Sheldon`과 MIT 허가/면책 본문이 있습니다.
과거 고지 삭제 이력을 기존 기여분의 고지 의무 면제로 해석하지 않았습니다.

### 확보한 본문을 완전한 버전별 고지로 확정하지 않는 이유

[#826](https://github.com/madsmtm/objc2/issues/826)은 closed이지만 다음 두 답변을 구분해야 합니다.

- 소유자 `madsmtm`의 [2026-10-10 답변](https://github.com/madsmtm/objc2/issues/826#issuecomment-6103078978)은
  과거 버전 라이선스가 `license` 필드에 적힌 대로라고 확인합니다.
- 고지가 충분한지 묻는 질문에 대한 [2026-10-11 답변](https://github.com/madsmtm/objc2/issues/826#issuecomment-6107377999)은
  다른 기여자가 있으므로 충분하지 않을 수 있으며 법적 판단을 할 수 없다는 취지입니다.
  보완 JSON의 `O-NOT-SUFFICIENT`에 원문과 API snapshot 위치를 기록했습니다.
- [#23의 후속 답변](https://github.com/madsmtm/objc2/issues/23#issuecomment-6436745865)은 #826을 가리킬 뿐,
  모든 기여자의 고지가 완전하다는 추가 확약이 아닙니다. #826 질문 목록의 `objc2 0.6.4`를
  이 번들의 `0.6.5`와 같은 버전으로 취급하지 않았습니다.

결론은 **고지문 본문과 과거 표기는 회수했으나, 6개 정확한 버전/파일의 기여자 고지
완결성은 미확인**입니다. 이름이나 연도를 만들어 채우지 않았고 새 재라이선스 권한을
주장하지 않습니다. 과거/현재 고지의 적용 파일 매핑과 추가 고지 확인이 채택 전 과제입니다.

후속 [N4 Rust 복사 코드/고지 매핑](g1-rust-copy-notices.md),
[근거 JSON](g1-rust-copy-notices.json)은 `objc2 0.6.5` helper만 보완합니다.
복사 표기 도입 `e1c7b209…`과 당시 PR 비교 원본 `a0061acd…`를 구분하고,
Rust MIT의 `Copyright (c) The Rust Project Contributors`와 REUSE attribution을
파일/범위에 연결했습니다. 단일 복사 SHA 확증, N4 사람의 판정과 전체 고지 완결성은
여전히 미완료이며, 이 문서의 기존 JSON/선언 라이선스나 Apple 권리 판정을 바꾸지 않습니다.

## 3. Apple: macOS 라이브러리 배포와 SDK 자체/파생물은 구분

원문은 [Apple의 Xcode and Apple SDKs Agreement](https://www.apple.com/legal/sla/docs/xcode.pdf)입니다.
조회한 PDF는 **EA2002**, 마지막 페이지 날짜 표기 **`06/08/2026`**, 총 16페이지입니다.
SHA-256: `5e6bd16bcba3dd591bde1c57f7c6f19f08a194c84cdc54485c4660f90e2a26ec`.
16페이지 모두 정상 텍스트 계층을 추출했으며 OCR이나 SDK 실행은 필요하지 않았습니다.

| 원문 위치 | 확인한 내용 | G1에서의 경계 |
| --- | --- | --- |
| §2.4, p.4 | 약관 준수 조건으로 macOS 앱과 라이브러리는 Apple과 별도 서면 계약 없이 배포 가능 | macOS 라이브러리는 일괄 금지라는 결론을 내리지 않음. 이 addon의 준수 확인/채택 승인은 아님 |
| §2.2A, p.3, §2.4, p.4 | macOS SDK와 다른 Apple SDK의 제한을 구분. macOS App Store 배포는 별도 Developer Program 계약 대상 | iOS 등의 제한을 macOS CLI에 그대로 옮기거나 App Store 권리까지 추론하지 않음 |
| 정의, p.1–2 | SDK에 headers/APIs/libraries/소스와 오브젝트 코드 등이 포함됨 | 앱/library object 배포와 SDK header, `.tbd`, framework, 도구/소스 재배포를 구분 |
| §2.7, p.5 | Apple Software의 재배포/재허가와 복사/수정/파생물 생성을 제한하고 명시적 허가 및 OSS/sample-code 예외를 둠 | §2.4를 SDK 구성물의 포괄적 재배포 허가로 확대하지 않음 |
| §2.5, p.4 | 허용된 복사본의 Apple 고지 보존 요구 | 고지 보존만으로 원래 없던 복사/배포 권리가 생기지는 않음 |
| Important Note, p.1 | Apple-branded macOS 기기에서의 Apple Software 실행 조건 | Linux의 Cargo 타깃 해석은 native macOS SDK 빌드/권리 증거가 아님 |

정확한 문구는 보완 JSON의 `A-*` 발췌 7개에 페이지, source hash, 정규화된 문자 범위와 함께
있습니다. 인용 총량은 짧게 제한하고, 위 표는 조건을 생략한 허가문 대신 원문 위치를 제공합니다.

[Apple의 약관 안내](https://www.apple.com/legal/sla/) 자체가 웹에서 보는 버전과 제품에 동봉된
버전이 다를 수 있다고 알립니다. 따라서 이 PDF를 미래 빌더가 실제 수락한 약관이나,
바인딩 생성 당시 적용된 SDK 계약으로 단정하지 않았습니다. 계정 접속이나 대리 약관 동의도 없습니다.

ObjC 고정 `LICENSE.md`는 SDK 파생 바인딩의 배포 허용 여부가 불명확하다고 명시합니다.
현재 확보한 사실로는 **macOS 앱/library의 조건부 배포 허용은 확인**, **이 6개 바인딩의
Apple 권리까지 완결적으로 확인하지는 못함**으로 판정합니다. 실제 생성/빌드 SDK 버전,
해당 계약, 결과물에 포함될 SDK 자료의 범위와 파생 바인딩의 법적 분류를 별도 확인해야 합니다.
MIT/Apache/Zlib 선택만으로 Apple 권리가 생긴다고 보지 않으며, 준거법상 효력이나
API 저작권성에 대한 법률 결론도 내리지 않습니다.

## 4. 추가 라이선스: 원문 의무와 보수적인 향후 포장안

아래 원문은 기존 exact archive 또는 archive VCS 정보에 연결된 exact upstream commit입니다.
보완 JSON에 archive SHA/member 경로 또는 commit URL, 파일 SHA, 발췌를 기록했습니다.
표의 포장안은 **제안일 뿐**, 라이선스 선택이나 운영 NOTICE 반영이 아닙니다.

| 대상 | 원문에서 확인한 의무 | 향후 제안/주의 |
| --- | --- | --- |
| `clipboard-win 5.4.3`, `error-code 3.4.0` / BSL-1.0 | 기존 저작권 고지와 허가/제한/면책을 포함한 전체 문구 보존. 해당 copy/derivative가 오직 source processor가 생성한 machine-executable object code일 때만 명시적 예외 | npm/Bun 파일이라는 이름만으로 예외 성립/불성립을 단정하지 않음. 예외에 기대지 않고 원문 고지를 함께 싣는 보수적 방안 |
| `libloading 0.9.0` / ISC | `Copyright © 2015, Simonas Kazlauskas`와 허가 고지를 모든 copy에 보존 | 확인한 원문에는 바이너리 전용 예외 없음. 완전한 LICENSE/면책을 함께 보존하는 방안 |
| `unicode-ident 1.0.27` / Unicode-3.0 | copyright/permission을 모든 copy 또는 동봉 Documentation에 포함. 고지 외 광고/판매 촉진에서 권리자 이름을 쓰려면 사전 서면 허가 | MIT/Apache 대안을 골라도 AND Unicode 조건은 남음. `Copyright © 1991-2023 Unicode, Inc.`와 해당 버전 LICENSE-UNICODE를 실제 배포물에 포함하는 방안. URL만 남기는 안은 채택하지 않음 |
| `quick-error 2.0.1` / 구식 `MIT/Apache-2.0` 표기 | 발행된 README.rst License 절이 Apache-2.0 또는 MIT 중 선택 가능하다고 명시 | **OR 해석의 원문 확인은 완료**. manifest 원문은 유지. 미래에 MIT를 택하면 `Copyright (c) 2015 The quick-error Developers`와 MIT 고지 보존 |
| `gethostname 1.1.0` / Apache-2.0 | §4(a) 수령자에게 라이선스 제공, §4(b) 수정 파일 변경 표시, §4(c) 배포 Source의 해당 고지 보존, §4(d) Work에 NOTICE가 있으면 해당 attribution 재현 | object 배포도 라이선스 제공 대상. 조건부 NOTICE를 무조건 새로 만들어야 하는 의무로 오독하지 않음. §3 특허 범위/소송 시 종료와 §6 상표 제한도 검토 대상 |
| N-API 계열 5개 / MIT | exact upstream LICENSE의 LongYinan 및 GitHub 두 MIT 고지에 copy/substantial-portion 보존 조건이 각각 존재 | 두 블록 모두 보존. package metadata나 링크만으로 대체하지 않는 포장안 |
| MIT-only ObjC 3개 / MIT | copy/substantial-portion에 copyright/permission 고지 포함 | 앞 절의 버전별 완결성 미확인 때문에 일반 MIT 본문만 넣고 완료로 판정하지 않음 |
| ObjC triple-license 3개 | 선언된 대안 중 하나만 선택 가능. Zlib은 원출처 오인 금지, 수정 source 표시, source 고지 제거/변경 금지 | Zlib의 product acknowledgment는 권고이며 의무가 아님. 다만 이를 MIT-only 패키지나 Apple SDK 권리의 우회로로 사용하지 않음 |

BSL, ISC, MIT, Unicode 및 Apache의 확인한 문구에서는 OMK 독점 소스를 공개하라는 조건을
찾지 못했습니다. 이는 전체 소스/별도 파일 조건이나 법률 문제의 부재를 보장하지 않습니다.
다른 MIT/Apache 등 OR 후보의 대안도 이번에 자동 선택하지 않았으며, 기존 파일별 고지
목록과 미래 배포물의 실제 license assets 확인은 계속 필요합니다.

주요 추가 원문:

- [error-code 3.4.0 archive](https://static.crates.io/crates/error-code/error-code-3.4.0.crate)의 `LICENSE`와
  `clipboard-win 5.4.3`의 pinned upstream `LICENSE`
- [libloading 0.9.0 archive](https://static.crates.io/crates/libloading/libloading-0.9.0.crate)의 `LICENSE`
- [unicode-ident 1.0.27 archive](https://static.crates.io/crates/unicode-ident/unicode-ident-1.0.27.crate)의 `LICENSE-UNICODE`
- [quick-error 2.0.1 archive](https://static.crates.io/crates/quick-error/quick-error-2.0.1.crate)의 `README.rst`, `LICENSE-MIT`, `LICENSE-APACHE`
- [gethostname 1.1.0 archive](https://static.crates.io/crates/gethostname/gethostname-1.1.0.crate)의 `LICENSE`

## 5. 검증과 남은 게이트

- 원문 56개 hash와 발췌 23개 문자 범위 대조: 통과.
- 인용 변조, 원문 hash 변조, 그래프 확대, Apple 포괄 허가 주장, 오탐 수량,
  채택 승인, 미부여 ObjC 재라이선스의 음성 대조군 7개: 모두 거부.
- 기존 native Cargo 입력 12개와 원래 G1 임시 lock: 시작 시점과 동일.
- K1 보호 비교는 **exit 1**: 다른 작업의 `specs/120-rust-core/k1-json-parity.md` 변경을
  관찰했습니다. 전후 hash를 보존했으며 이 작업은 수정/복원하지 않았습니다.
  원문 검증 통과를 K1 전체 불변이나 전체 검사 통과로 표시하지 않습니다.
- 전체 문서 검사도 기존 범위 밖 `speak-like-you-eat.md` 미추적 링크로 exit 1입니다.
  이를 고치기 위해 다른 작업 파일이나 검증 조건을 바꾸지 않았습니다.
- `npm run check`, Cargo build/test, addon/SDK 실행, 채택과 배포는 하지 않았습니다.

남은 게이트는 6개 ObjC 정확한 버전의 고지 완결성, 실제 SDK 계약/파생물 권리 판단,
소유자의 exact B1 승인 및 별도 편입/빌드 승인입니다. 이번 보완은 그 게이트를 자동 통과시키지 않습니다.
