# G1 clipboard B1 검토 번들

검토일: 2026-11-13. 기준 HEAD: `3045c4ca2f548865b4638759a4e253cd23333688`.
상태: **임시 해석과 정적 검토 완료, 최종 B1 승인 및 채택은 미승인**.
범위: G1 Node clipboard addon 후보만. K1의 그래프, 승인, 구현과 독립적입니다.
기계 판독 증거: [g1-b1-review.json](g1-b1-review.json).
기존 동작/구현 제약: [G1 preflight](g1-dependency-review.md).
원문 보완: [ObjC/Apple/추가 라이선스 검토](g1-license-review.md),
[근거 JSON](g1-license-review.json). 고정 그래프는 유지하고 고지문 오탐만 정정했습니다.
후속 보완에서는 Cargo 명령, 빌드/채택, K1 쓰기를 하지 않았습니다.
추가 자료: [6개 버전 소스 이력과 파일별 출처](g1-source-history.md),
[이력 증거 JSON](g1-source-history.json), [B1 승인 체크리스트](g1-b1-approval-checklist.md).
추가 검색을 중단한 뒤 759개 Rust 파일의 exact source를 대조했고, 미확인 권리/고지는
체크리스트에 남겼습니다. 기존 B1/라이선스 JSON과 고정 그래프는 변경하지 않았습니다.
후속 [N4 Rust 복사/고지 보완](g1-rust-copy-notices.md), [근거 JSON](g1-rust-copy-notices.json)은
helper 최초 도입과 복사 도입을 정정하고 당시 Rust 소스/고지를 매핑합니다.
단일 복사 SHA 확증과 사람의 판정은 남아 있으며 B1 승인이나 빌드 허가가 아닙니다.
[P1 예정 고지 자산 계획](g1-license-asset-plan.md), [manifest JSON](g1-license-asset-plan.json)은
78개 선택/6개 비활성 패키지와 고지 후보의 원문/hash, 배포 조건을 연결합니다.
운영 자산은 생성하지 않았고 P1을 포함한 16개 승인란은 모두 비어 있습니다.
[N2/N3 버전별 고지/파일 범위 보완](g1-objc-notice-scope.md), [근거 JSON](g1-objc-notice-scope.json)은
main 파일 198개 전체와 고지 보유 snapshot을 대조해 30개 Steven 명의 행 포함 파일과
182개 과거 MIT 보존 검토 후보를 구분합니다. 원문 보존 제안이지 소유/완결성 승인이 아닙니다.
[미매핑 16파일/나머지 기여자 원출처](g1-objc-notice-origins.md), [근거 JSON](g1-objc-notice-origins.json)은
당시 source/선언과 이름 18개의 기여 맥락을 보완하지만 새 개인 고지를 확보하거나 승인한 것은 아닙니다.

## 승인 경계와 결과

최초 임시 해석의 소유자 요청은 다음 범위만 승인했습니다.

> G1에 한해 임시 lockfile 생성과 전이 의존성 검토를 승인하니, K1은 건드리지 말고 빌드나 채택 없이 정확한 B1 검토 번들을 준비해.

[B1과 G1](decisions.md)의 최종 채택 승인과 구분되는, G1 임시 해석에 한정된
예외입니다. K1의 J1/J2를 재사용하거나 변경하지 않았습니다. 실제 `Cargo.toml`,
빈 `src/lib.rs`, `Cargo.lock`, 다운로드한 소스와 원시 로그는 저장소 밖 임시
디렉터리에만 있습니다. 저장소에는 정제된 검토 JSON과 문서만 남깁니다.

- `cargo generate-lockfile`, `cargo metadata`, `cargo tree`만 실행했습니다.
- 의존성 컴파일, build script/proc macro 실행, addon 구현, 운영 편입은 하지 않았습니다.
- 운영 Cargo/npm manifest, lockfile, shrinkwrap, workflow, K1 파일에 쓰지 않았습니다.
- `cargo-audit`/`cargo-deny` 설치, 빌드, 실행도 하지 않았습니다.
- 성능, clipboard 동작, ABI, Node/Bun 로딩, 플랫폼 수용 여부를 증명하지 않습니다.

**검토 결론:** 아래 정확한 그래프를 B1 판단 자료로 제출합니다. BSL-1.0/ISC/Unicode
의무와 ObjC 고지문/Apple SDK 권리 문제가 남아 있으므로, 해석 성공을 채택 가능 또는
라이선스 승인으로 취급하지 마십시오. 빌드와 운영 편입은 별도 승인이 필요합니다.

## 고정 입력

| 자료 | SHA-256 |
| --- | --- |
| 임시 manifest | `79e5072e447530ac30d9acf3009002ee3e38e5e9c1fb6ba21ce988cca1383932` |
| 임시 Cargo.lock | `297fb6d82458e35456f0baff9c69298d70b56cc58c48b897ad6cfdc9d68e847a` |
| 검토 JSON | `8cbc59748c4abefafb365d2fee95da351ad00ad6fd11597f9f1d075abc2617cd` |

JSON에는 manifest 원문, lock 버전/루트/전체 registry package 행, 각 패키지의
source/checksum, 라이선스 파일/실행 진입점 해시, 타깃별 feature/edge, 중복 버전,
RustSec 판정, 미해결 사항이 있습니다. 이것은 운영 lockfile이 아닙니다.
실제 lockfile은 임시 상태로 유지합니다. 이후 재해석 결과가 다르면 새 번들이 필요합니다.

모든 직접 후보는 `default-features = false`이며 버전을 `=`로 고정했습니다.

| 직접 후보 | 선택 feature | 종류 | 선언 라이선스 / MSRV |
| --- | --- | --- | --- |
| `arboard =3.7.0` | `image-data` | normal | MIT OR Apache-2.0 / 1.71.0 |
| `napi =3.16.2` | `napi4`, `dyn-symbols` | normal | MIT / 1.88 |
| `napi-derive =3.7.1` | `strict` | normal, proc macro | MIT / 1.88 |
| `png =0.18.1` | 없음 | normal | MIT OR Apache-2.0 / 1.73 |
| `napi-build =2.6.0` | 없음 | build helper | MIT / 1.88 |

임시 루트는 `publish = false`, edition 2024, `rust-version = "1.99"`, resolver 3,
`cdylib`이며 dev dependency나 루트 build script가 없습니다. `napi-build`는 미래
addon의 build helper를 검토하기 위해 명시했습니다. 실제 addon 코드는 없습니다.

Cargo 1.99.0 / Rustc 1.99.0, Linux x64 호스트에서 해석했습니다. 선택 패키지의 최고
선언 MSRV는 1.88.0입니다. 이는 메타데이터상 호환성일 뿐 컴파일 통과가 아닙니다.
격리된 HOME/CARGO_HOME과 target 경로, 설치된 toolchain 바이너리, 명시적 환경
allowlist를 사용해 기존 Cargo 설정, 인증, wrapper, RUSTFLAGS를 상속하지 않았습니다.

## 정확한 그래프와 수량

수량은 임시 루트를 제외한 registry **name/version 식별자** 수입니다. 전이 수량은
직접 후보 5개를 모두 뺍니다. normal/build edge를 포함하고 root dev edge는 없습니다.

| 타깃 | 전체 | 직접 | 전이 | build-script 패키지 | proc-macro 패키지 |
| --- | ---: | ---: | ---: | ---: | ---: |
| `x86_64-unknown-linux-gnu` | 58 | 5 | 53 | 9 | 2 |
| `aarch64-unknown-linux-gnu` | 58 | 5 | 53 | 9 | 2 |
| `x86_64-apple-darwin` | 62 | 5 | 57 | 9 | 3 |
| `aarch64-apple-darwin` | 62 | 5 | 57 | 9 | 3 |
| `x86_64-pc-windows-msvc` | 50 | 5 | 45 | 6 | 2 |
| `aarch64-pc-windows-msvc` | 50 | 5 | 45 | 6 | 2 |
| 6개 타깃 합집합 | 78 | 5 | 73 | 11 | 3 |

- lock 전체는 84개입니다. 타깃 비활성 6개는 `crunchy 0.2.4`, `dispatch2 0.3.1`,
  `errno 0.3.15`, `objc2-io-surface 0.3.2`, `redox_syscall 0.5.18`, `zlib-rs 0.6.8`입니다.
  이들도 checksum/라이선스/실행 진입점/RustSec 목록에는 남겼습니다.
- 모든 타깃에서 `miniz_oxide 0.8.9`와 `0.9.1`이 함께 선택됩니다. macOS는
  `syn 2.0.119`와 `3.0.10`도 선택합니다. 승인 전 강제 통합하지 않았습니다.
- `windows-sys`는 G1에서 독립적으로 `0.61.2`로 해석됐습니다. K1을 갱신하지 않았습니다.
- 84개 archive checksum이 lock 및 다운로드한 registry index와 일치했고, 모두
  검토 시점에 non-yanked였습니다. 목록의 manifest/라이선스/실행 진입점 파일도
  archive member와 바이트 비교했습니다. 무결성 확인은 보안 감사가 아닙니다.

### metadata와 실제 선택 범위의 차이

`cargo metadata --filter-platform`도 feature와 optional edge를 과대 포함했습니다.
JSON은 `cargo tree --edges normal,build --no-dedupe`를 기준으로 유효 패키지,
feature, 부모/자식 edge를 기록하고 metadata의 dependency kind/cfg를 결합합니다.
metadata-only package/edge/feature는 별도 필드로 보존합니다.

- Linux metadata-only package 12개, Windows 11개, macOS 3개입니다.
- `image`의 유효 codec feature는 Linux `png`, macOS `tiff`, Windows `bmp,png`입니다.
  metadata의 모든 플랫폼 codec 합집합을 개별 타깃 승인 범위로 쓰지 않았습니다.
- Windows의 `bitflags/std`와 일부 `windows-sys` 기능도 metadata-only로 분리했습니다.
- `napi` 유효 feature는 `dyn-symbols,napi1,napi2,napi3,napi4`입니다. Tokio는 없지만
  `futures` 기본 기능이 executor와 `futures-macro`를 전이 선택합니다.
- `napi-build/wasi-heap-sync`는 전이 feature 통합으로 선택됩니다. 코드는 정확한
  WASI triple 조건으로 분기하며, WASI 자체는 이번 타깃 승인 범위가 아닙니다.
- `wayland-data-control`, `wl-clipboard-rs`, Tokio, C compiler helper `cc`는 선택되지
  않았습니다. Wayland CLI fallback과 Linux selection 소유권 제약은 그대로 남습니다.

이 그래프는 Linux 호스트의 dependency 해석 결과입니다. build dependency와 매크로는
미래 빌드 호스트에서 실행됩니다. feature 목록은 패키지 출현의 합집합이지 compiled-unit
그래프가 아니며, macOS/Windows native-host 그래프 또는 네이티브 빌드 증거가 아닙니다.

## 라이선스와 고지문 검토

선택된 78개 패키지의 선언식별 수량입니다. OR의 대안을 임의로 AND나 단일 라이선스로
바꾸지 않았습니다. 파일 검색/해시와 일부 원문 검토는 법률 의견이나 전체 소스 감사가 아닙니다.

| 선언식 | 수량 |
| --- | ---: |
| MIT OR Apache-2.0 | 37 |
| MIT | 13 |
| Apache-2.0 OR MIT | 5 |
| Zlib OR Apache-2.0 OR MIT | 4 |
| Unlicense OR MIT | 2 |
| BSL-1.0 | 2 |
| Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT | 2 |
| MIT OR Zlib OR Apache-2.0 | 2 |
| BSD-3-Clause OR Apache-2.0 | 2 |
| BSD-2-Clause OR Apache-2.0 OR MIT | 2 |
| MIT OR Apache-2.0 OR Zlib | 2 |
| Apache-2.0 | 1 |
| ISC | 1 |
| MIT/Apache-2.0 | 1 |
| (MIT OR Apache-2.0) AND Unicode-3.0 | 1 |
| 0BSD OR MIT OR Apache-2.0 | 1 |

필수 판단 사항:

1. `clipboard-win 5.4.3`, `error-code 3.4.0`의 **BSL-1.0**과 `libloading 0.9.0`의
   **ISC**는 B1에서 명시적으로 검토해야 합니다. 외부 소스 복사에 대한 기존
   MIT/Apache 정책을 이 의존성들에 대한 자동 승인으로 해석하지 않았습니다.
2. `unicode-ident 1.0.27`은 허용 대안 선택 외에 **Unicode-3.0** 의무가 함께 적용됩니다.
   `quick-error 2.0.1`의 구식 `MIT/Apache-2.0` 표기는 보존하되, README에서 대안 선택의
   의미를 확인했습니다(6항).
3. 원문 보완에서 `objc2-foundation`의 `src/copying.rs`와 테스트가 고지문으로 잘못
   검색된 것을 정정했습니다. 독립 고지문 미확인 선택 archive는 **11개가 아니라 12개**입니다.
   N-API 계열 5개와 `clipboard-win`의 exact upstream LICENSE는 확보했으며,
   N-API의 LongYinan/GitHub 두 MIT 고지를 모두 보존해야 합니다.
4. ObjC 미확인 범위는 `objc2-foundation`을 포함한 **6개**입니다. 후속 원문 검토에서
   repository의 완전한 MIT/Apache/Zlib 본문과 과거 Steven Sheldon 고지를 추가 회수했습니다.
   다만 exact 버전별 기여자 고지 완결성은 확인되지 않았습니다. #826의 closed 상태나
   아직 open인 재라이선스 제안을 고지 완료/새 라이선스 허가로 해석하지 않았습니다.
5. Apple 약관 §2.4는 약관 준수를 조건으로 macOS 앱/library의 별도 서면 계약 없는 배포를
   명시합니다. §2.7의 SDK 자체/파생물 제한과 구분해야 하며, SDK에서 생성된 이 바인딩의
   Apple 권리와 실제 수락한 SDK 계약은 미확인입니다. 원문 보완에 페이지/해시/발췌를 기록했습니다.
6. `quick-error 2.0.1`의 README.rst는 Apache-2.0 또는 MIT 중 선택 가능함을 명시해,
   구식 슬래시 표현의 OR 해석을 원문으로 확인했습니다. 선언식이나 채택 상태는 바꾸지 않았습니다.
   BSL-1.0/ISC/Unicode/Apache/MIT의 고지 의무와 향후 포장안도 원문 보완에 구분했습니다.

고지문 URL과 해시는 JSON의 `upstreamNotices`에 있습니다. archive 안 VCS 정보는
출처 연결 자료이지 독립적인 재현 빌드 증명은 아닙니다. 외부 소스나 라이선스 본문을
운영 NOTICE 또는 배포물에 복사하지 않았습니다. 현 단계의 검토는 배포 준비 완료가 아닙니다.

## build script, proc macro와 네이티브 위험

선택 custom-build 진입점 11개와 proc-macro 진입점 3개의 경로/해시는 JSON에 있습니다.
진입점과 지정한 helper/loader/decoder 경로를 정적으로 읽었습니다. `libc`는
process/environment 관련 발췌를 확인했으며, 전체 코드/생성 코드의 보안 감사는 아닙니다.

| 선택 코드 | 정적 관찰과 미래 실행 조건 |
| --- | --- |
| `crc32fast`, `libc`, `quote`, `zerocopy` | rustc 버전/대상과 cfg 감지. `zerocopy`는 manifest도 읽습니다 |
| `proc-macro2`, `rustix` | rustc probe, OUT_DIR 쓰기/정리, wrapper/RUSTFLAGS에 영향받는 경로가 있습니다 |
| `num-traits` / `autocfg` | `autocfg` helper가 rustc compile probe를 수행합니다. 이번에는 실행하지 않았습니다 |
| `parking_lot_core`, `objc2` | sanitizer/대상 ABI cfg 선택 |
| `napi`, `napi-sys` | 대상/WASI cfg 설정. `napi`의 GNU Windows helper 분기는 MSVC 범위와 다릅니다 |
| `napi-build` | 자체 build.rs는 없지만 미래 addon build.rs가 실행할 helper입니다. macOS `dynamic_lookup`, GNU Linux `-z,nodelete` linker 정책을 확인했습니다 |
| `napi-derive`, `futures-macro`, `zerocopy-derive` | 컴파일 시 실행되는 매크로입니다. Tokio를 끈다고 제거되지 않습니다 |

`autocfg`와 `napi-build`는 helper 2개이며 custom-build 패키지 수량 11개와 별도입니다.
`napi-derive/type-def`는 꺼져 있어 해당 파일 쓰기 경로는 선택되지 않습니다.
`NAPI_DEBUG_GENERATED_CODE`로 매크로 토큰이 출력될 수 있으므로 미래 빌드 환경에서
디버그/타입 생성 변수를 통제하고 인증과 불필요한 네트워크를 주지 않아야 합니다.

**로더 검토 필요:** `napi-sys 3.4.1`은 Unix에서 호스트 프로세스 심볼을 읽습니다.
Windows는 현재 프로세스/이미 로드된 library 뒤에 bare-name `node`/`libnode`
로드 fallback이 있고, setup 전체 실패는 panic입니다. Node/Bun 호스트 식별,
DLL 검색 경로, 심볼 가용성, library 수명과 optional-addon 실패 격리를 네이티브로
검증해야 합니다. fallback 성공 가능성을 안전성 증거로 삼지 않았습니다.

**입력 자원 경계:** `arboard`의 X11 PNG, macOS TIFF, Windows PNG/BMP 경로는
RGBA 반환 전에 디코딩/할당합니다. 확인한 진입 경로에는 OMK 호출자가 주는 한도가
없습니다. 반환 후 width/height/길이 검사만으로 앞선 디코딩 할당을 제한할 수는 없습니다.
원시 입력/디코딩 한도와 PNG 출력 성장, async 상태/종료 소유권을 별도로 해결해야 합니다.
사용자 실제 clipboard를 읽거나 덮어쓰지 않았습니다.

## RustSec 고정 스냅샷 검토

- commit: [`af7b3ec33460b8e2de8d422e16d628518891a519`](https://github.com/RustSec/advisory-db/tree/af7b3ec33460b8e2de8d422e16d628518891a519)
- archive SHA-256: `9063bca1f9337bb085c3e9fcd0c3978f5422de9fa57e70e922510232913f6141`
- 전체 lock 84개를 package-name/range로 대조했습니다. 타깃을 이유로 advisory를 제외하지 않았습니다.
- 이름이 일치한 advisory 16건 모두 선택 버전이 patched 범위를 만족했습니다.
  이 중 `zlib-rs` 1건은 검토 타깃 비활성 lock 항목입니다.
- 최근 `rustix 1.1.6`은 `RUSTSEC-2026-0486`의 `>= 1.1.6` patched 경계에 있습니다.
- 선택 버전은 모두 stable이며, 해당 comparator branch를 숫자 비교로 확인하고
  inclusive/exclusive 및 caret 경계 대조군도 검사했습니다. 근거 범위와 원문 해시를 JSON에 보존했습니다.

**이 스냅샷에서 영향받는 버전은 발견되지 않았습니다.** 이는 `cargo-audit` 통과,
알려지지 않은 취약점 부재, 악성 코드 부재 또는 전체 공급망 안전성을 뜻하지 않습니다.
채택이 늦어지면 RustSec와 yanked 관찰을 갱신해야 합니다.

## 재현과 검증

새 임시 디렉터리에서 JSON의 manifest 원문과 동일한 빈 `src/lib.rs`를 사용합니다.
원래 빈 파일은 주석 한 줄이며, digest가 JSON에 있습니다. 설치된 1.99.0 toolchain을
명시하고 격리 HOME/CARGO_HOME/target 경로와 환경 allowlist를 적용합니다.

```sh
cargo generate-lockfile
cargo metadata --locked --format-version 1
cargo metadata --locked --format-version 1 --filter-platform <target>
cargo tree --locked --target <target> --edges normal,build --prefix depth --no-dedupe --format '{p}|features={f}|license={l}'
```

마지막 두 명령은 표의 6개 타깃에 각각 실행했습니다. **총 14개 Cargo 명령 모두 exit 0**입니다.
나중의 fresh resolution은 다른 버전을 고를 수 있으므로, exact 재현은 원래 임시 lock의
해시를 확인해야 합니다. graph JSON을 새 운영 lock으로 자동 변환/편입하지 마십시오.

최초 해석 시점의 검증입니다. 아래 당시 결과를 현재 전체 검사 통과로 재사용하지 않으며,
라이선스 파일 분류와 ObjC 수량은 원문 보완의 정정이 우선합니다.

- manifest/lock/source/graph/count/feature/edge/license/advisory 불변식 검사: exit 0.
- 수량, 승인 상태, lock digest, feature, edge, 라이선스 누락을 변조한 음성 대조군 6개:
  모두 거부. 검증 스크립트와 수집 스크립트 해시는 JSON에 기록했습니다.
- 기존 native Cargo manifest/lock 12개와 K1 검토/채택 문서 5개: 시작 해시와 동일.
  기존 G1 preflight JSON도 그대로 보존했습니다.
- 공유 checkout에서 다른 작업의 K1 소스/테스트와 root package.json 등 변경을
  관찰했습니다. 해당 경로의 전후 해시는 JSON/로컬 증거에 구분해 남겼고,
  이 작업은 수정하거나 복원하지 않았습니다. 저장소 전체/K1 전체 불변을 주장하지 않습니다.
- 임시 Cargo target 디렉터리와 빌드 산출물 생성 없음. 실제 lock은 임시에만 존재합니다.
- 최초 저장소 쓰기는 이 문서, 동명의 JSON, preflight 후속 링크뿐이었습니다.
  후속 원문 보완의 쓰기는 이 문서/JSON과 `g1-license-review.md`/JSON 4개에 한정됩니다.

`npm run check`는 네이티브 빌드 단계를 포함하므로 실행하지 않았습니다. 런타임 테스트,
네이티브 clipboard 테스트, addon 빌드, 플랫폼 runner, 커밋/푸시/배포도 실행하지 않았습니다.
G1 문서의 상대 링크/공백/JSON digest 검사와 scoped `git diff --check`는 exit 0입니다.
`node scripts/check-doc-links.mjs`는 exit 1입니다. 다른 작업의
`packages/coding-agent/docs/packages.md`가 아직 추적되지 않은 `speak-like-you-eat.md`를
참조하기 때문이며, G1 범위 밖이므로 수정하지 않았습니다. 전체 문서 검사 통과 주장은 없습니다.

후속 원문 대조는 56개 source hash와 23개 발췌를 확인했고, 음성 대조군 7개를 거부했습니다.
보호 비교는 다른 작업의 `k1-json-parity.md` 변경을 감지해 exit 1입니다. 해당 문서를
수정/복원하지 않았으며 native Cargo 입력 12개와 원래 G1 임시 lock은 동일합니다.
자세한 검증 범위와 실패 근거는 원문 보완에 있습니다.

## 다음 게이트

- [x] G1 임시 lock 해석, 6개 타깃 그래프, 전이/라이선스/실행 코드 목록 고정
- [x] checksum/파일 일치 및 pinned RustSec 대조
- [x] 빌드/운영 채택/K1 쓰기 없이 정제된 B1 판단 자료 작성
- [ ] 정확한 번들 해시와 라이선스 의무에 대한 소유자 최종 B1 승인
- [ ] ObjC 6개 버전의 기여자 고지 완결성과 실제 SDK/파생 바인딩 배포 권리 확인
- [ ] 별도 편입/빌드 승인과 native-host 그래프/ABI/보안 검증
- [ ] 기존 G1 preflight의 회귀, 6개 네이티브 타깃, Node/Bun 포장 및 Pi-zero 수용 기준
