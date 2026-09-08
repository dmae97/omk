# TB 2.1 오프라인 결과 감사

`scripts/tb21-audit.mjs`는 명시한 두 Harbor job의 **기록된 결과**를 검증한다.
모델·Harbor를 실행하지 않으며 입력 파일이나 기존 요약을 수정하지 않는다.
저장소 checkout과 Node.js 22.19 이상이 필요하다. 공개 npm CLI의 하위 명령은 아니다.

## 사용

```bash
node scripts/tb21-audit.mjs \
  --manifest /path/to/evidence/manifest.json \
  --expect-manifest-sha256 <사전에-고정한-64자리-SHA256>
```

두 옵션 모두 필수다. 알 수 없는 옵션·중복 옵션·위치 인수는 거부한다.
manifest의 **원본 바이트**를 해싱하므로 줄바꿈이나 공백 변경도 digest를 바꾼다.
불일치를 없애려고 변경된 manifest의 해시를 자동으로 다시 승인하지 않는다.
해시 고정은 내용 식별 수단이지 서명, 실행 승인, 사전 등록의 증명이 아니다.

성공하면 JSON을 stdout에 출력한다. 실패하면 stdout은 비우고 stderr에
`{"status":"incomplete","code":"missing_cost"}` 같은 진단만 출력한다.
경로·JSON 파서의 원문·provider 오류 메시지는 진단에 복사하지 않는다.

| 종료 코드 | 의미 |
| --- | --- |
| 0 | 모든 입력 결과가 아래 계약을 충족함. 실제 전송·비교 조건 검증은 아님 |
| 1 | 파일·digest·결과 무결성 오류 또는 예기치 않은 내부 오류 |
| 2 | 옵션 오류 또는 manifest 스키마 오류 |

## Manifest v1

다음은 **합성 예시**다. 반복 문자 해시를 실제 평가의 provenance로 쓰지 않는다.

```json
{
  "schemaVersion": "omk-tb21-manifest-1",
  "runId": "example-run",
  "datasetRevision": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  "conditionsSha256": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
  "tasks": [
    {
      "id": "example-task",
      "checksum": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    }
  ],
  "arms": {
    "A": {
      "job": "arm-a",
      "modelName": "gateway/model-one",
      "harnessSha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "adapterSha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    },
    "B": {
      "job": "arm-b",
      "modelName": "compatible/model-one",
      "harnessSha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "adapterSha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    }
  }
}
```

- `tasks`는 1~1000개이며 중복 ID를 허용하지 않는다. ID는 영문·숫자로 시작하는
  128자 이하의 영문·숫자·`.`·`_`·`-` 문자열이다.
- `datasetRevision`은 전체 40자리 소문자 Git SHA, 나머지 해시는 64자리 소문자 SHA-256이다.
- `job`은 manifest 디렉터리 아래의 상대 경로다. 절대 경로, `..`, 역슬래시,
  빈 경로 조각, 동일한 두 job 경로와 심볼릭 링크를 거부한다.
- `modelName`은 각 arm의 Harbor `config.agent.model_name`과 정확히 비교한다.
  호환 공급자 이름이 다를 수 있으므로 두 라벨의 동일성이 실제 모델 동일성을 뜻하지 않는다.
- manifest의 모든 객체는 지정된 필드만 허용한다. 자격증명·환경 값·프롬프트를 넣지 않는다.
- `conditionsSha256`, `harnessSha256`, `adapterSha256`, `datasetRevision`은 **선언값**이다.
  이 도구가 조건 파일·실행 바이너리·컨테이너·데이터셋 저장소를 열어 대조하는 것은 아니다.

## 읽는 파일과 검증 규칙

```text
manifest.json
arm-a/
  trial-a/result.json
arm-b/
  trial-b/result.json
```

각 job의 바로 아래 디렉터리는 모두 trial로 간주한다. 별도 산출물 디렉터리는
job 바깥에 둔다. job 루트의 일반 파일(예: `config.json`, 전체 `result.json`)은
개별 trial 집계에 사용하지 않는다. 최신 job 검색이나 시간창 기반 원장 귀속은 없다.

각 task는 각 arm에 정확히 한 번 있어야 한다. v1은 재시도·다회 반복 집계를 지원하지
않으므로 추가 attempt를 거부한다. 마지막 결과로 덮어쓰거나 가장 좋은 시행을 고르지 않는다.
`trial_name`은 디렉터리 이름과 일치해야 하며 `id`는 두 arm 전체에서 유일해야 한다.
Harbor가 절대 task 경로를 기록한 경우 마지막 경로 조각을 manifest ID와 비교하고,
`task_checksum`도 고정된 task checksum과 대조한다.

`verifier_result.rewards.reward`는 숫자 0 또는 1이어야 한다. 값이 없거나 null이면
명시적인 `exception_info.exception_type`이 있을 때만 미해결로 집계한다.
성공 보상 1과 예외가 함께 있으면 모순으로 거부한다. `exception_info` 필드 자체가
없으면 예외 여부를 추측하지 않는다. timeout도 분모에 남는다.

`agent_result.cost_usd`는 0 이상의 유한한 숫자여야 한다. 누락·null은 **0이 아니라
미확인**이며 요약을 거부한다. 합산 overflow도 거부한다. 해결 task가 0개이면
`costPerSolved`는 null이다. 비용 단가·캐시 할인·실제 청구서 정합성은 별도 확인 대상이다.

manifest는 최대 256 KiB, 개별 결과는 최대 8 MiB까지 읽는다. 파일 읽기는 크기를
제한하고 일반 파일만 허용한다. 실행이 끝나고 쓰기가 멈춘 자료를 입력해야 한다.
이 검사는 같은 호스트의 동시 경로 교체를 격리하는 OS sandbox가 아니다.

## 보고서의 주장 범위

출력에는 arm별 task·해결·예외 수, 비용 합계·해결당 비용, 쌍대 성공표와 차이(pp),
manifest와 결과 파일의 해시가 포함된다. 원본 trial ID·task 절대 경로·kwargs·예외
메시지는 내보내지 않는다. 출력의 run/task ID는 manifest에서 승인한 식별자를 사용한다.

항상 `modelVerification: "configuration-only"`, `costSource: "harbor-agent-result"`를
표시한다. 설정이 같다는 사실로 실제 모든 provider 전송이 같았다고 추론하지 않는다.
Gateway 원장으로만 비용을 알 수 있는 과거 trial은 비용을 지어내지 않고 `missing_cost`로
거부한다. 신뢰할 수 있는 request ID별 원장 결합은 로드맵 R3의 후속 작업이다.

이 도구는 실제 실행을 증명하는 attestator나 통계적 우열 검정기가 아니다. 공개하기 전
식별자·가격·자료 보유 권한을 검토하고 [비교 계약](metrics.md)을 적용한다.

## 검사

저장소 루트에서 공급자·다운로드 없이 실행한다.

```bash
node --test --test-concurrency=1 scripts/test/tb21-audit.test.mjs scripts/test/tb21-audit-inputs.test.mjs
node node_modules/typescript/bin/tsc --noEmit --allowJs --checkJs --strict --target ES2022 --module NodeNext --skipLibCheck --types node scripts/tb21-audit.mjs scripts/lib/tb21-input.mjs scripts/lib/tb21-audit.mjs
```

프로젝트 Biome 설정은 기본적으로 `.mjs`를 포함하지 않는다. 실제 파일이 검사됐는지
확인하며, 빈 검사 결과를 통과 증거로 쓰지 않는다.
