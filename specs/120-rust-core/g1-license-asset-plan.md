# G1 P1: 예정 고지 자산 목록

검토일: 2026-11-13. 상태: **제안 작성 완료, 미승인, 실제 고지 자산 미생성**.
[B1 체크리스트](g1-b1-approval-checklist.md)의 P1 제출 자료입니다.
기계 판독 목록: [g1-license-asset-plan.json](g1-license-asset-plan.json).
JSON SHA-256: `20a82cb53490da48d9dc89358f5da6857f9f3ef166b580095c1ded4a09c0f4ac`.

기존 [B1](g1-b1-review.json), [원문 검토](g1-license-review.json),
[N4 복사/고지 매핑](g1-rust-copy-notices.json), manifest와 lock을 재사용했습니다.
새 웹 조회, Cargo 실행, SDK 설치/동의, 빌드, 채택, 운영 NOTICE/배포물 변경과 K1 쓰기는 없습니다.
JSON의 `inputs`는 작성 전 증거의 해시입니다. 소스 이력의 P1 항목을 연결한 후 해시는
체크리스트에 별도로 기록하며, 순환 참조를 만들지 않습니다.

## 1. 목록의 범위

| 항목 | 수량 | 의미 |
| --- | ---: | --- |
| 고정 lock 패키지 | 84 | 기존 checksum/선언식 유지 |
| 선택 그래프 패키지 행 | 78 | 직접 5개와 전이 73개, 타깃/실행 종류 단서 포함 |
| 비활성 lock 패키지 행 | 6 | 삭제하지 않고 deferred 표시 |
| 선택 패키지 archive 고지 후보 | 142 | exact archive member와 해시를 대조한 원문 후보 |
| 고정 upstream 자료 | 12 | clipboard-win/N-API 완전 본문 6개, ObjC 선언문 6개 |
| ObjC 과거/나중 본문 자료 | 4 | Steven 고지는 적용 범위 보류, 나중 본문 3개는 참고 전용 |
| N4 Rust 자료 | 6 | 두 revision 각각 MIT/Apache 원문과 REUSE attribution 발췌 |
| quick-error README | 1 | 구식 선언식의 OR 해석 근거, 고지 전문 대체 아님 |
| 합계 | 165 | 그중 10개는 증거 전용으로 배포 예정 경로가 없음 |

**패키지 행이 존재한다는 뜻은 고지 완결성이나 배포 승인이 아닙니다.** 모든 행의
`selectedLicense`, `reviewer`, `decisionDate`는 비어 있고 `perFileNoticeAuditComplete`는 false입니다.
OR 대안의 본문을 후보로 함께 열거한 것이 모든 대안을 AND 의무로 만들거나 선택한 것은 아닙니다.
같은 해시의 본문도 버전/revision별 출처는 합치지 않습니다.

후속 [N2/N3 파일 범위 보완](g1-objc-notice-scope.md), [근거 JSON](g1-objc-notice-scope.json)은
`P1-A155`의 과거 Steven MIT 보존 후보를 행별로 구체화합니다. 기존 세 패키지에 더해
AppKit 4파일, CoreFoundation 19파일, CoreGraphics 2파일의 과거 root 고지 연결을
추가 검토 범위로 제안합니다. Steven의 직접 작성/소유 판정이 아니며 생성 파일에는 확대하지 않습니다.
이 추가 범위는 별도 보완 제안이고 위 P1 JSON/hash, 라이선스 선택과 승인 상태는 그대로입니다.

비활성 6개는 `crunchy 0.2.4`, `dispatch2 0.3.1`, `errno 0.3.15`,
`objc2-io-surface 0.3.2`, `redox_syscall 0.5.18`, `zlib-rs 0.6.8`입니다.
향후 source bundle에 이들의 crate가 들어가면 deferred를 배포 제외 근거로 쓰지 않고 목록을 확대해야 합니다.

## 2. 제안 파일 구조와 원문 보존

다음은 미래 배포물 내부의 **제안 경로**이며 현재 생성하지 않습니다.

```text
third-party/G1/MANIFEST.json
third-party/G1/NOTICE-INDEX.txt
third-party/G1/<crate@version>/archive/<original-notice-path>
third-party/G1/<crate@version>/upstream/<original-notice-path>
third-party/G1/objc2@0.6.5/rust/<revision>/LICENSE-MIT
third-party/G1/objc2@0.6.5/rust/<revision>/LICENSE-APACHE
third-party/G1/objc2@0.6.5/rust/<revision>/ATTRIBUTION.txt
```

- JSON의 `assets[]`는 원문 URL, archive/member 또는 revision, 원문/예정 내용 해시,
  보존 조건, 관련 gate와 제안 경로를 연결합니다. 증거 전용은 경로가 null입니다.
- full-text 자산은 원본 bytes를 보존하는 안입니다. REUSE attribution만 exact substring에 LF를
  붙이는 변환을 명시하고 원문 해시와 문자 범위를 함께 기록했습니다. 연도/권리자 이름을 만들지 않습니다.
- `MANIFEST.json`은 실제 포함 자료와 원문/출력 해시, 선택 경로, 적용 범위와 검토 결정을 담아야 합니다.
  이 제안 JSON을 실제 배포 manifest처럼 복사해 완료 처리하지 않습니다.
- `NOTICE-INDEX.txt`는 읽을 수 있는 색인/해당 고지용입니다. full license text를 링크로 대체하거나
  모든 Apache Work에 upstream NOTICE가 있다고 가정하지 않습니다.

## 3. 특별 의무와 보류 사항

| 대상 | 이 제안의 처리 | 남은 판정 |
| --- | --- | --- |
| BSL: clipboard-win/error-code | 완전한 원문을 보존하는 후보. npm/Bun 혼합물에서 object-only 예외에 의존하지 않음 | 실제 배포 material별 적용 범위 |
| ISC: libloading | 기존 copyright/허가/면책 원문 보존 후보 | binary-only 면제를 만들지 않음 |
| Unicode: unicode-ident | `LICENSE-UNICODE`를 MIT/Apache 대안과 별개로 유지 | AND 조건과 광고/이름 사용 제한 검토 |
| quick-error | 원래 `MIT/Apache-2.0` 선언 유지, README의 either/option 근거 연결 | MIT/Apache 대안 선택은 미실행 |
| Apache: gethostname 및 향후 선택분 | 본문 제공, 수정 표시, source 고지, 조건부 NOTICE를 구분 | §3/§6과 실제 NOTICE/수정 파일 범위 |
| N-API 5개 | LongYinan/GitHub의 두 MIT 블록을 모두 담은 exact 원문, 각 revision 연결 | URL/일반 MIT 템플릿으로 대체하지 않는 포장 검토 |
| ObjC 6개 | 선언문은 증거 전용, Steven 과거 고지는 파일 범위 보류, 나중 본문은 소급 허가로 사용하지 않음 | N2/N3/N5와 전체 contributor/file 고지 미완결 |
| N4 Rust 복사분 | 당시 비교 `a0061acd…`와 별도 compiler 참조 `1e5719bd…`의 원문/attribution을 분리 | 단일 복사 SHA 미확증 유지, N4 사람의 판정과 선택 경로 |
| tiff `tests/COPYRIGHT` | 테스트 이미지용 조건부 항목으로 분리 | 해당 테스트 자료가 source bundle에 포함되는지 확인. native object 포함을 주장하지 않음 |
| rustix/linux-raw-sys `COPYRIGHT` | libstd 유래 코드/파일별 예외를 확인하라는 원문을 보존 | 일반 MIT 본문만으로 copied-code/file-header 검토를 닫지 않음 |

N4의 Rust 대안을 MIT-only ObjC 전체에 부여하지 않습니다. 보존 제안만으로 Apple SDK 파생물의
복사/재배포 권리도 생기지 않습니다. 일부 파일의 별도 고지나 NOTICE를 모두 감사한 상태는 아니며,
실제 source/header/테스트까지 포함되는 배포라면 그 범위의 추가 검토가 필요합니다.

## 4. 배포 형태별 조건

| 형태 | 미래 포장안 | 현재 상태 |
| --- | --- | --- |
| Node npm addon | `.node`/JS와 함께 검토된 full texts와 색인을 포함하고 최종 tar의 file allowlist/bytes를 확인 | 미빌드, 미검증 |
| Bun archive/executable | 추출 가능한 내부 파일 또는 동봉 배포 자료로 같은 자산 제공. 컴파일이 자동 포함한다고 가정하지 않음 | 미빌드, 미검증 |
| source/crate bundle | 실제 포함된 모든 source/crate/테스트의 고지를 유지. 타깃 비활성이나 dead-strip으로 source 고지를 제외하지 않음 | 조건부 계획, 포함 목록 미확정 |
| Apple SDK 유래 자료 | generated binding/주석/headers/`.tbd`/framework/도구를 구분하고 A1–A7 권리 판단을 먼저 확보 | 권리 미해결, 자동 포함 금지 |

build script/proc macro가 그래프에 있다는 사실도 object 배포에 그 코드가 포함된 증거는 아닙니다.
반대로 build-time 코드라는 이유만으로 모든 source 배포에서 고지를 빼지 않습니다.

## 5. P1 수용 조건과 검증

P1 제안은 준비됐지만 다음을 검토자가 결정해야 합니다.

1. N2–N5의 남은 범위/대안과 Apple A1–A7의 권리 판단을 증거에 연결합니다.
2. 각 배포 형태의 실제 포함 자료, 추가 file-header/NOTICE 검토와 full-text 경로를 확정합니다.
3. B1 소유자 승인과 B2 별도 실행 허가를 기록한 뒤에만 자산 생성/빌드를 수행합니다.
4. V1에서 실제 npm/Bun/source payload, 동봉 고지 bytes와 recipient 접근 가능성을 확인합니다.

범위 검사 `verify.py --docs`는 archive 84개 checksum, 자산 165개 원문/발췌 해시,
78/6 행과 기존 그래프, 의무 연결, 문서 링크와 빈 승인란을 확인했습니다. exit 0입니다.
Unicode 누락, 원문 해시 변조, 비활성 행 삭제, 선언문의 완전 고지 오인, 나중 본문의 소급 허가,
자동 라이선스 선택, B1 자동 승인, Apple 권리 자동 통과, 전체 파일 감사 과장의 음성 대조군
9개를 모두 거부했습니다. 보호 입력 비교도 exit 0이며 K1과 운영 파일을 수정/복원하지 않았습니다.

체크리스트의 16개 승인 박스는 모두 비워 둡니다. 이번 결과는 **고지 포장 제안**이지
완전한 attribution 확인, 법률 판단, 채택/배포 승인 또는 실제 산출물 검증이 아닙니다.
