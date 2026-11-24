# G1 N4: Rust PR #138944 복사 코드와 고지 매핑

검토일: 2026-11-13. 대상: `objc2 0.6.5/src/__macro_helpers/os_version/apple.rs`.
상태: **당시 소스와 고지 대조 자료 확보, 단일 복사 SHA 확증과 사람의 판정은 미완료**.
[B1 체크리스트](g1-b1-approval-checklist.md)의 N4를 보완하며, 승인란은 비워 둡니다.
증거: [g1-rust-copy-notices.json](g1-rust-copy-notices.json).
JSON SHA-256: `15a84497e1c691fabf41067c5c8e5c67949967127d294a3c4626e60268119a0b`.

기존 [B1 JSON](g1-b1-review.json), [라이선스 JSON](g1-license-review.json), 임시 manifest/lock,
759개 archive 파일 매핑은 그대로입니다. K1 쓰기/복원, Cargo 실행, 빌드, SDK 설치/동의,
채택, 운영 NOTICE 변경, upstream 연락/게시 또는 라이선스 선택을 하지 않았습니다.
원시 API 응답과 내려받은 코드는 저장소 밖에만 보관했습니다.

## 1. 최초 helper와 Rust 복사 도입을 구분

| 사실 | 고정 revision / 시각(UTC) | 의미 |
| --- | --- | --- |
| ObjC helper 최초 도입 | `69bd06107b2141789ae63edc81f776f2ae4955a0`, 2024-10-27 | PR보다 앞선 구현. `OnceLock`/ObjC runtime을 사용하며 PR 복사 표기가 없음 |
| Rust PR 생성 | [#138944](https://github.com/rust-lang/rust/pull/138944), 2025-03-25 | URL만으로 특정 소스 SHA가 고정되지 않음 |
| PR의 당시 head 갱신 | `a0061acd9d97cb70a67d0b080a04ebcd734b15b7`, 2025-04-04 11:52:31 | API timeline의 force-push 이벤트. commit 시각은 11:51:28 |
| ObjC의 복사 표기/재작성 도입 | [`e1c7b209eafe24e78dcbaef87143ccfc9ee8a8e8`](https://github.com/madsmtm/objc2/commit/e1c7b209eafe24e78dcbaef87143ccfc9ee8a8e8), 2025-04-04 12:11:59 | `Heavily copied from`과 PR URL이 추가됨. 최초 helper 도입과 다름 |
| PR의 다음 head 갱신 | `19cccaf8765763af17a3cd5dbe005e9602d8eca4`, 2025-04-04 12:13:31 | commit 시각 12:13:07. Darwin 파일의 `publically`를 `publicly`로 수정 |
| 현재 PR head / merge | `846d6a4466813f3ad12e2bf15db4071f22b8ae0b` / `349fbba24f0158c1ed293658c31de5c8a0954e5a`, 2025-09-05 | 당시 복사 원본으로 소급 단정하지 않음 |
| 발행 ObjC source | `d7d2fa23ceaa5e6096c923b081040e5d81b3b9df` | archive와 동일한 파일 blob `37259e72947efff040a9f969cc33844a54919281` |

timeline은 [1페이지](https://api.github.com/repos/rust-lang/rust/issues/138944/timeline?per_page=100)와
[2페이지](https://api.github.com/repos/rust-lang/rust/issues/138944/timeline?per_page=100&page=2)를
모두 회수했습니다. 가변 API snapshot은 조회 시각과 응답 hash를 JSON에 기록했습니다.

**대조 기준은 `a0061acd…`입니다.** 복사 도입본은 이 버전의 긴 블록과 `publically` 오타를
유지합니다. 앞선 `721f8eb0…`에는 일부 문서/FFI availability 주석이 없고, 뒤의 `19cccaf8…`는
오타를 고칩니다. September head에서는 CoreFoundation 코드가 별도 파일로 재구성됩니다.

다만 ObjC 주석과 commit 메시지는 **복사에 사용한 SHA를 명시하지 않습니다**. 시각과 내용이
부합해도 로컬 작업본/동일 blob을 가진 다른 revision을 배제할 수 없습니다.
`a0061acd…`는 재현 가능한 당시 소스 매핑이며, `exactCopiedRevision = null`을 유지합니다.
이 한계를 없애려면 복사자의 명시적 provenance 기록 등 추가 증거가 필요합니다.

## 2. 파일과 수정 범위

원본은 [`library/std/src/sys/platform_version/darwin/mod.rs`](https://github.com/rust-lang/rust/blob/a0061acd9d97cb70a67d0b080a04ebcd734b15b7/library/std/src/sys/platform_version/darwin/mod.rs)입니다.
SHA-256 `31ac90a787ea88e1261d1161247e4028c74a6e2eb543307f6faa6076ae95ff17`,
Git blob `627e716193bfba28fa81b47adc93b47611b2db2e`를 commit 파일 목록과 잘리지 않은 library tree에 대조했습니다.

| 원본 → ObjC 발행 파일 | 대조/수정 내용 |
| --- | --- |
| `current_version`, `lookup_version`, `version_from_sysctl` → 94–246행 부근 | cache/sysctl 흐름과 주석을 유지. `u32`/`NonZero`를 ObjC `OSVersion`에 맞추고 `libc` 호출을 local extern으로 변경 |
| `version_from_plist`, `parse_version_from_plist`, `Deferred` → 248–526행 부근 | plist 해석/CF 선언과 정리 흐름을 유지. 경로 변환은 `CString`/`OsStringExt`, `crate::mem`은 `core::mem`으로 변경 |
| 복사 도입 → 발행본 | MSRV용 C string literal 교체, simulator/macabi cfg 교체, cache 반환 변환, assertion formatting과 오타 수정 |

JSON에는 행 양끝 공백만 제거한 연속 일치 블록, 양쪽 1-based inclusive 행 범위와
정규화된 블록 hash가 있습니다. 비어 있지 않은 원본 행 8개 이상인 블록은 도입본 10개,
발행본 11개입니다. 예: 원본 253–352행 ↔ 도입본/발행본 345–444행.
**전체 파일의 byte equality나 법적 substantiality 비율을 주장하지 않습니다.**

별도로 ObjC 17–93행의 deployment-target 표는
[`1e5719bd…/compiler/rustc_target/src/spec/base/apple/mod.rs`, 207–231행](https://github.com/rust-lang/rust/blob/1e5719bdc40bb553089ce83525f07dfe0b2e71e9/compiler/rustc_target/src/spec/base/apple/mod.rs#L207-L231)을
직접 참조합니다. match arm/architecture 처리가 조정된 별개 참조이며, 이 SHA를 PR 원본과 혼동하지 않았습니다.
XNU, Zig, compiler-rt, libloading 링크는 이번 대조만으로 추가 복사/적용 라이선스가 입증된 것은 아닙니다.

## 3. 버전/파일별 원문 고지

| 매핑 | 확인한 원문 | 보존/판정 경계 |
| --- | --- | --- |
| `N4-RUST-DARWIN`: `a0061acd…` Darwin 구현 → ObjC helper | `LICENSE-MIT`: **`Copyright (c) The Rust Project Contributors`**. `COPYRIGHT`: MIT 또는 Apache-2.0, 기여자가 권리를 보유. `REUSE.toml`의 `library/**`: **`The Rust Project Developers (see https://thanks.rust-lang.org)`**, `MIT or Apache-2.0` | 두 고지 문자열을 혼합하거나 Mads 단독 명의로 대체하지 않음. MIT 경로 제안 시 exact MIT 허가/면책 전문과 REUSE attribution, 원본/변경 매핑을 보존하도록 인계 |
| `N4-RUST-TARGET-REFERENCE`: `1e5719bd…` compiler 표 참조 | 그 revision의 `LICENSE-MIT`에는 copyright 행이 없음. `REUSE.toml`의 `compiler/**`에는 위 Developers attribution과 같은 대안 선언이 있음 | 뒤 revision의 Contributors 행을 당시 본문인 것처럼 삽입하지 않음. 별개 원문과 attribution을 revision별로 보존하도록 인계 |

주요 exact 원문과 SHA-256:

| 원문 | SHA-256 |
| --- | --- |
| [`a0061acd…/LICENSE-MIT`](https://github.com/rust-lang/rust/blob/a0061acd9d97cb70a67d0b080a04ebcd734b15b7/LICENSE-MIT) | `b71bd43a069ca0641a9ecfe585ca7b3c53b5cc1608f8b68321168698e28b5ea1` |
| [`a0061acd…/LICENSE-APACHE`](https://github.com/rust-lang/rust/blob/a0061acd9d97cb70a67d0b080a04ebcd734b15b7/LICENSE-APACHE) | `62c7a1e35f56406896d7aa7ca52d0cc0d272ac022b5d2796e7d6905db8a3636a` |
| [`a0061acd…/REUSE.toml`](https://github.com/rust-lang/rust/blob/a0061acd9d97cb70a67d0b080a04ebcd734b15b7/REUSE.toml) | `6f5693d31a9c6f004b6defac2a8482c46ae3abe16fcce230bd8071e3327c1b45` |
| [`1e5719bd…/LICENSE-MIT`](https://github.com/rust-lang/rust/blob/1e5719bdc40bb553089ce83525f07dfe0b2e71e9/LICENSE-MIT) | `23f18e03dc49df91622fe2a76176497404e46ced8a715d9d2b67a7446571cca3` |

Darwin 경로에 더 구체적인 REUSE annotation/metadata 예외나 파일 머리의 별도 고지는
확인되지 않았습니다. 잘리지 않은 root/library tree에서 root `NOTICE`와 해당 경로의
상위 디렉터리별 별도 license/notice도 없었습니다. 이는 다른 참조 프로젝트나 전체 Rust의
추가 의무가 없다는 결론이 아닙니다. `COPYRIGHT`의 LLVM 예외를 이 Darwin 코드로 옮기지 않습니다.

MIT 원문은 copy/substantial portion에 copyright와 permission notice를 요구합니다.
PR 링크나 작성자 목록만으로 대체하지 않고 완전한 허가/면책 본문을 보존하는 안입니다.
Rust 부분의 Apache 대안을 검토한다면 §4(a)의 본문 제공, (b)의 변경 표시, (c)의 source 고지 보존,
(d)의 **조건부** NOTICE와 특허/상표 조항을 별도로 확인해야 합니다. 이것은 MIT-only
`objc2 0.6.5` 전체에 Apache/Zlib 대안을 새로 주는 근거가 아닙니다.

## 4. N4 인계와 검증

N4는 **부분 증거 확보, 미승인**입니다. 검토자가 남길 결정은 다음과 같습니다.

- 당시 비교 revision과 단일 복사 SHA 미확증의 차이를 수용하거나 필요한 추가 근거를 지정합니다.
- 위 두 파일/범위와 원문 고지를 P1 예정 license assets에 어떻게 보존할지 판정합니다.
- ObjC 전체 기여자 고지, Apple SDK 권리, N5 선택, B1 소유자 승인과 B2 실행 승인은 별도로 유지합니다.

검증은 저장소 밖 `verify.py --docs`로 수행합니다. 원문 27개 hash, archive/file/blob,
PR timeline, 10/11개 블록 행/hash, 고지 발췌와 문서 링크/빈 승인란을 대조합니다.
가짜 단일 SHA, 잘못된 원본, 블록 행 변조, 명의 변경, 소급 고지, hash 변조, B1 자동 승인,
라이선스 자동 선택의 음성 대조군 8개를 모두 거부했습니다.
이번 fresh baseline의 K1 보호 파일 27개, native Cargo 입력 12개와 기존 B1/라이선스 JSON,
임시 manifest/lock은 동일했습니다. 증거/범위 문서 검사 exit 0, 보호 비교 exit 0입니다.
이전 소스 이력 작업에서 관찰한 K1 동시 변경/exit 1 기록은 그대로 보존하며 이번 결과로 덮지 않습니다.
