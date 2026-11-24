# 반복 TB 결과의 오프라인 감사

`scripts/tb21-repeat-audit.mjs`는 기존 `tb21-audit.mjs`를 재사용해 여러 개의
**기록된** paired run을 집계한다. 모델, Harbor, 컨테이너를 시작하지 않고 파일을
수정하지 않는다. npm CLI 명령이 아닌 checkout 도구다.

```sh
node scripts/tb21-repeat-audit.mjs \
  --manifest /path/to/evidence/repeats.json \
  --expect-manifest-sha256 <사전에-고정한-repeat-set-SHA256>
```

두 옵션은 필수이며 중복/알 수 없는 옵션은 종료 코드 2로 거절한다. 무결성이나
결과가 불완전하면 1, 모두 통과하면 0. 실패 시 stdout은 비고 stderr에는
`{"status":"incomplete","code":"duplicate_trial_id"}`처럼 제한된 코드만 출력한다.

## Repeat-set v1

다음 해시는 **예시**이며 실제 자료의 해시가 아니다.

```json
{
  "schemaVersion": "omk-tb21-repeat-set-1",
  "k": 2,
  "repeats": [
    {"directory": "repeat-0", "manifestSha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},
    {"directory": "repeat-1", "manifestSha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"},
    {"directory": "repeat-2", "manifestSha256": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"}
  ]
}
```

각 directory는 repeat-set 파일 디렉터리 아래의 일반 디렉터리이고 그 안에
기존 [TB manifest v1](tb21-audit.md) 형식의 `manifest.json`과 두 arm의 job이 있다.
절대/상위/빈 조각/역슬래시 경로, 심볼릭 링크, 같은 directory/digest/run ID,
전체 반복과 arm 사이에서 재사용한 trial ID는 거절한다. 중간 디렉터리도 검사한다.

반복 수 n은 2–100, k는 1–n 정수다. manifest는 각각 256 KiB, trial result는
8 MiB로 기존 reader의 bound를 따른다. 이미 종료되고 변경이 멈춘 자료를 입력한다.
이 검사는 동시 파일 교체를 막는 OS sandbox나 서명이 아니다.

모든 반복은 같은 task/checksum 집합, dataset revision, conditions digest,
각 arm의 modelName/harness/adapter digest를 선언해야 한다. task 순서는 달라도
같은 집합이면 허용한다. job 경로와 run ID는 반복마다 달라질 수 있다.
모델 라벨이 arm 간 다른 경우 기존 감사와 동일하게 **실제 모델 동일성을 확인한
것이 아니다**. 조건 선언의 진위도 별도 wire/environment 증거가 필요하다.

각 repeat에서 기존 감사의 모든 규칙을 그대로 적용한다. task당 정확히 한
시행, 완료 시각, 모델 라벨, 이진 reward, 예외, 유한한 비용이 필요하다.
누락/불일치가 하나라도 있으면 전체 보고서를 거절한다. timeout은 실패로 남고
비용도 합산한다. 누락 비용을 0으로 대체하거나 가장 좋은 시행만 고르지 않는다.

## 계산

task별 n개 시행에서 c개가 성공했을 때:

- `passAt1 = c/n`
- `passAtK = 1 - C(n-c,k)/C(n,k)`
- `passAllK = C(c,k)/C(n,k)` — pass^k의 유한표본 추정량

k개를 중복 없이 뽑는 조합 기준이다. `(c/n)^k`와 다르다. 예를 들어 n=3,c=2,k=2면
pass@2는 1, passAll2는 1/3이다. k=n이면 하나 이상 성공/모두 성공 여부가 된다.
전체는 task별 지표의 단순 평균이며 반복을 별개 task로 계산하지 않는다.

비용은 모든 시행을 합산한다. `costPerSuccessfulTrial`은 총비용/성공 시행 수이며,
성공이 없으면 null이다. task별 한 번 이상 성공한 수로 나누는 값이 아니다.

출력 `omk-tb21-repeat-report-1`은 task별 결과와 arm별 평균, 비용, 예외 수,
repeat-set/각 manifest/각 result digest를 포함한다. raw trial ID, 경로, prompt,
provider error나 kwargs는 내보내지 않는다. task ID도 사전 검토한 공개/합성 ID만
사용한다. 출력은 자동 익명화 또는 공개 승인으로 취급하지 않는다.

## 주장 경계

항상 `independenceVerification: "not-verified"`,
`modelVerification: "configuration-only"`,
`completionVerification: "recorded-timestamps"`,
`costSource: "harbor-agent-result"`, `superiorityClaim: false`를 표시한다.

반복 입력의 일관성을 검사할 뿐, 실행 독립성, 실제 청구/모델, 채점기의 진실성,
환경 격리, 통계적 유의성이나 제품 성능 향상을 증명하지 않는다. CI의 합성
테스트는 계산/거절 경로의 증거이지 OMK 모델 벤치마크 결과가 아니다.
실제 비교는 [metrics 계약](metrics.md)을 따르며 유료 실행은 별도 예산 승인이 필요하다.

## 검증

```sh
node --test scripts/test/tb21-repeat-audit.test.mjs scripts/test/tb21-audit.test.mjs scripts/test/tb21-audit-inputs.test.mjs scripts/test/tb21-audit-completion.test.mjs
node node_modules/typescript/bin/tsc --noEmit --allowJs --checkJs --strict --target ES2022 --module NodeNext --skipLibCheck --types node scripts/tb21-repeat-audit.mjs scripts/lib/tb21-repeat-audit.mjs scripts/lib/tb21-audit.mjs scripts/lib/tb21-input.mjs
```

기존 단일 run CLI와 report v2는 변경하지 않았다. 반복 결과는 새로운 스키마와
명령으로만 제공한다. H2의 연구 근거와 후속 실험은
[harness research](harness-research-2026-11.md)와
[roadmap](harness-roadmap-2026-11.md)에 있다.
