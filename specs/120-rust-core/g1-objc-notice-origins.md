# G1 N2/N3: 미매핑 16개 파일과 나머지 기여자의 고지 원출처 추적

검토일: 2026-11-13. 상태: **도입 원본/당시 선언과 기여 맥락 보완, 개인 고지 완결성 미확인**.
이전 [파일별 범위 검토](g1-objc-notice-scope.md)의 16개 미매핑 파일과 나머지 metadata 이름을
대상으로 삼았습니다. [B1 체크리스트](g1-b1-approval-checklist.md)의 N2/N3는 미승인으로 유지합니다.
증거: [g1-objc-notice-origins.json](g1-objc-notice-origins.json).
JSON SHA-256: `1c8e13788a89b594238e72c5a7bd4d7379609b76d7df4b0c0fda4711d50eadce`.

K1 쓰기/복원, Cargo 해석/빌드, 채택, 운영 NOTICE 변경, SDK 설치/약관 동의와 새 원격 조회는
하지 않았습니다. 고정된 기존 local Git object만 읽었고, 원시 코드/문서는 저장소 밖에 보관했습니다.
기존 B1/라이선스/N4/P1/파일 범위 JSON과 임시 manifest/lock은 유지했습니다.

## 1. 미매핑의 원인: 고지 삭제 이후 추가된 파일

16개 모두 최초 경로 추가와 당시 source, Cargo 선언, root 라이선스 문서/기여 정책을 연결했습니다.
모두 Mads Marquart 작성자 metadata이며 2025년에 추가됐습니다. 이것을 단독 소유 증명으로 쓰지 않습니다.

기준 변경은 [`cfb19922…`](https://github.com/madsmtm/objc2/commit/cfb199226661ec6e4939fcd7cd7531b3c5453076),
2025-01-22 05:36:02 +01:00입니다. 이 commit은 Steven MIT 고지 전문을 삭제하고
`LICENSE.md`의 선언/외부 링크와 `CONTRIBUTING.md`의 기여 라이선스 정책을 추가합니다.
16개 파일의 도입과 남아 있는 행의 origin commit은 모두 이 변경 이후입니다.

| 버전 / 파일 | 최초 경로 추가 commit | 날짜 | 원출처/자료 성격 |
| --- | --- | --- | --- |
| objc2 / `examples/hello_world_app.rs` | `4c02571f1d187af7f0d7ebbb107731426d3f2ae5` | 2025-01-22 | 문서 재작성 때 추가한 AppKit 예제 |
| objc2 / `src/topics/about_generated/list.rs` | `330ffafd856bac804a60e4aa0eec5c21ccd05a0c` | 2025-03-19 | Markdown을 포함하는 문서 wrapper |
| Foundation / `src/tests/measurement.rs` | `77246d8933f820bab7af5963fb3565f935c4a4ee` | 2025-09-12 | generic bounds 검사 코드 |
| Foundation / `src/url.rs` | `fe4092729fed039c2b04b3cafec0324ce77441c3` | 2025-04-16 | CFURL과 함께 추가한 NSURL 경로 변환 |
| Foundation / `src/user_defaults.rs` | `5de79373431c8d527b7a028aeb2df67b0a6b4ddf` | 2025-09-10 | Send/Sync 구현 |
| AppKit / `src/event.rs` | `2c3732793ac4cc413d46a62498ed0b0361a43077` | 2025-05-12 | NSEventMask 변환 helper |
| AppKit / `src/gesture_recognizer.rs` | `8aa3fcb72126ef84f196715f5b479c7d4e1e4bcf` | 2025-09-29 | 중복/누락 API method 선언 |
| AppKit / `src/slider.rs` | `8aa3fcb72126ef84f196715f5b479c7d4e1e4bcf` | 2025-09-29 | 같은 API 선언 변경 |
| AppKit / `src/slider_cell.rs` | `8aa3fcb72126ef84f196715f5b479c7d4e1e4bcf` | 2025-09-29 | 같은 API 선언 변경 |
| CoreFoundation / `src/filedescriptor.rs` | `3c2cc50eb39be5b7bbacd70b4b3acdb023d07e6e` | 2025-03-20 | AsRawFd adapter |
| CoreFoundation / `src/thread_safety.rs` | `576190c8c67f40811cd67170080ba06c6cf2e516` | 2025-04-12 | thread-safety 구현과 검사 |
| CoreFoundation / `src/url.rs` | `fe4092729fed039c2b04b3cafec0324ce77441c3` | 2025-04-16 | Foundation URL 코드와 함께 도입 |
| CoreFoundation / `src/user_notification.rs` | `557cf98d85e839c4a8e5ffef782dc43843fa8d85` | 2025-04-12 | CoreFoundation inline functions 추가 |
| CoreGraphics / `src/bitmap_context.rs` | `531c17060d09bea26f143be1679e1df7056af2ba` | 2025-09-16 | bitmap FFI/반환형 adapter |
| CoreGraphics / `src/thread_safety.rs` | `fe86e602798f13b5e4da0a435201878c40eeafcd` | 2025-04-12 | Send/Sync 구현 |
| CoreGraphics / `tests/invalid.rs` | `fc3d77ab72f75845efdb492bd1d0c16242534d30` | 2025-09-27 | CoreGraphics 동작 검사 코드 |

날짜는 commit metadata의 현지 시각 기준입니다. 전체 revision/path, source/blob/hash와 이후 남은 행의
origin commit은 JSON에 있습니다. `--follow`/copy 검출은 경로 이력의 휴리스틱이며 외부 복사가 없다는 증명이 아닙니다.

당시 가까운 Cargo manifest와 workspace 상속을 읽으면 현재 고정 버전의 선언과 일치합니다.
objc2/Foundation 5파일은 MIT, 나머지 11파일은 선언된 triple-license 맥락입니다.
**라이선스 선언 맥락 16/16을 찾았지만, 완전한 개인 고지 매핑은 여전히 0/16입니다.**
이전의 “과거 Steven MIT와 미매핑 16개”를 “고지 불필요” 또는 “모두 해결”로 바꾸지 않습니다.
나중 Mads 2026 본문을 당시 파일에 있었던 고지처럼 소급하지도 않습니다.

## 2. 당시 기여 정책은 확인, 동의/재라이선스 증명은 아님

각 도입 commit의 `CONTRIBUTING.md`에는 다음 정책이 존재합니다.

> When contributing, you agree to license your work under the trio
> `Zlib OR Apache-2.0 OR MIT` license (regardless of what the crate's current
> license is).

정확한 원문 hash와 문자 범위를 JSON `policyExcerpt`에 기록했습니다. 이는 **당시 정책의 존재**입니다.
개별 기여자의 실제 동의/권한이나 과거 타인 기여분 재라이선스 완료를 인증한 것이 아닙니다.
MIT-only 고정 crate 전체에 Zlib/Apache 대안을 부여하거나, 선언/링크를 copyright 고지 전문으로
대체하는 데 사용하지 않습니다.

## 3. 나머지 기여자 18개 이름의 원출처

기존 surviving-line 작성자 표기 중 Steven/Mads를 제외한 12개와 path-history/coauthor 표기 6개를
따로 추적했습니다. 원래 commit, 당시 LICENSE/README/Cargo/CONTRIBUTING, 원래 source 본문/머리의
고지 단서를 연결했습니다. **별도의 개인 명의 copyright 원문은 이번 자료에서 새로 회수하지 못했습니다.**

| 표기 | 확인한 원출처 / 프로젝트 고지 맥락 | 여전히 구분할 점 |
| --- | --- | --- |
| Alexander Bulaev | `b7dfa8f6…`, macro 호환성 변경. 당시 Steven MIT 전문 | 개인 명의 고지나 모든 행의 소유 인증은 아님 |
| Bruce Mitchener | `1931cbde…`, clippy 변경. 당시 Steven MIT 전문 | 기계적 편집도 포함된 metadata |
| George Burton | `70c6d1ae…`, `e0a0547e…`의 Encode/protocol 변경. 당시 Cargo의 MIT 선언 | 이 두 origin commit에서는 독립 고지 전문을 확인하지 못함. 후대 고지 snapshot과의 연결은 이전 보완을 유지 |
| Jeff Muizelaar | `2f906ee2…`, autoreleasepool 변경. 당시 Steven MIT 전문 | 개인 명의 원문 미회수 |
| Jo Bates | `3478b6f2…`, unstable-darwin-objc 변경. 선언문/기여 정책 맥락 | 이미 전문 삭제 이후. 정책을 개인 고지로 만들지 않음 |
| John Nunley | `ad281bc5…`, main-thread 판정 변경. 당시 Steven MIT 전문 | 개인 명의 원문 미회수 |
| Lloyd Cunningham | `5cd5c5b6…`, Sel Sync 변경. 당시 Steven MIT 전문 | 현재 남은 metadata는 빈 행 1개로, 실제 저작권 기여를 판정하지 않음 |
| Patrick Walton | `90ff608e…`, selector cache 변경. 당시 Steven MIT 전문 | 개인 명의 원문 미회수 |
| Paul Mabileau | `7b2d8246…`, `cb335afb…`, encode/rc 변경. 당시 Steven MIT 전문 | workspace 선언과 MIT-only crate 선언을 분리 |
| Zach Leytus | `d74d7cbd…`, NSSet 추가. 당시 Steven MIT 전문 | 개인 명의 원문 미회수 |
| silvanshade | `906cd883…`, `935c3dbd…`, Apple Silicon/argument 구현. 당시 Steven MIT 전문 | 작성자/공동기여 metadata와 개인 고지를 분리 |
| 王宇逸 | `3ef04f07…`, `bf18cb9f…`, no_dead_strip 변경. 당시 Steven MIT 전문 | 개인 명의 원문 미회수 |
| Akira Moroo | `3913d407…`, Virtualization framework. 당시 Steven MIT 전문 | 현재 분석한 main-file origin commit 연결은 없음. 선택 밖 framework 기여를 전체 패키지 권리로 확장하지 않음 |
| Alexander Ekdahl | `5d7f8e0e…`의 공동기여 trailer, MLCompute 추가. 당시 Steven MIT 전문 | 위와 같은 main-file 연결 한계 |
| Jan Walther | `84876184…`의 공동기여 trailer, generator must_use 변경. 당시 Steven MIT 전문 | main-file 연결이 없다는 사실이 생성 코드 영향 부재라는 뜻은 아님 |
| Sebastian Imlay | `581f0986…` 공동기여 trailer. 당시 Steven MIT 전문 | 현재 Foundation `src/lib.rs` 1행의 origin commit과 연결 |
| cynecx | `b5c0afc0…` 공동기여 trailer. 당시 Steven MIT 전문 | 현재 objc2 5파일, 비어 있지 않은 31행의 origin commit과 연결 |
| samuelsleight | `1eb7555a…` 공동기여 trailer / `c89bf6f6…` 작성자. 당시 Steven MIT 전문 | 현재 9개 main 파일, 89행의 origin commit과 연결 |

총 18개 중 16개 이름은 해당 기여 commit의 **프로젝트 Steven MIT 고지 맥락**을 연결했습니다.
이것은 그들의 고지를 Steven 명의로 대체한다는 뜻이 아닙니다. 원래 개인 고지가 있었는지,
프로젝트/집합적 고지로 충분한지와 실제 적용 범위는 확인/판정이 남아 있습니다.

공동기여자 3명의 행 수는 그 사람 명의로 판정한 행 수가 아니라 **공동기여 trailer가 있는 commit에
연결된 행 수**입니다. 여러 사람이 같은 commit에 참여할 수 있으므로 개인 소유/창작성의 몫을
계산하지 않습니다. 이 구분은 JSON의 `ownershipOfLinkedLinesCertified = false`로도 유지합니다.

## 4. 추가로 확인해야 할 원출처

- `user_notification.rs`의 도입 메시지는 inline functions 추가라고 명시하고, `event.rs`도 Apple API
  alias/helper를 구현합니다. 실제 SDK/header 판본과 고지/권리 확인이 필요합니다. 임의의 Apple OSS
  판본 라이선스를 실제 SDK의 적용 라이선스인 것처럼 대입하지 않습니다.
- CFURL/NSURL 코드의 Apple OSS, Swift issue, trash-rs 링크는 원출처 조사 단서입니다.
  링크 존재만으로 해당 프로젝트 코드의 복사나 라이선스 적용을 확정하지 않습니다.
- `about_generated/list.rs`는 `list_data.md`, `list_unsupported.md`를 포함합니다.
  향후 source/docs 배포라면 Rust wrapper만 확인하지 않고 이 자료의 포함/고지 범위도 확인해야 합니다.
- 16개 post-removal 파일의 개인/집합적 고지 원문과 처리 근거, 18개 이름의 남은 attribution 범위는
  검토자의 기록된 판단 또는 권한 있는 원출처 설명이 필요합니다. 이번에는 upstream에 연락하지 않았습니다.

## 5. 검증과 보호 비교

저장소 밖 `verify.py --docs`로 대상 16개, 기여자 18개, metadata commit 48개와 인용된 source 기록
173개를 대조합니다. Git object/원문 hash, 도입 선언, 공동기여 trailer/행 연결, 정책 발췌,
문서 링크와 빈 승인란의 **증거 검사는 exit 0**입니다. 선언=완전 고지, 정책=동의,
명의 조작, MIT-only 재라이선스, hash 변조, 미해결 삭제, 공동기여=소유, 날짜 소급,
프로젝트 고지 맥락 조작, 자동 승인의 음성 대조군 10개를 모두 거부했습니다.

**보호 비교는 exit 1**입니다. 범위 밖 동시 변경으로 `k1-json-parity.md`의 hash가
기준점 `183a9d3b…`에서 초기 비교 `4f0fb0d4…`, 후속 문서 비교 `d1c0a683…`로 달라졌습니다.
기존 native target 임시 파일 37개의 삭제도 관찰했습니다. 이 값은 각 비교 시점의 관찰입니다.
전후 기록을 보존했으며 이 작업은 해당 파일을 수정/복원하거나 Cargo를 실행하지 않았습니다.
검토 JSON/임시 manifest/lock의 무결성과 모든 K1 파일의 불변을 같은 것으로 보고하지 않습니다.

N2/N3의 추적 근거가 추가됐을 뿐, 개인 고지 완결성/Apple 권리/라이선스 선택/B1/B2 승인은
여전히 미확인 또는 미승인입니다. K1 변경을 되돌리거나 검증 조건을 완화해 통과시키지 않습니다.
