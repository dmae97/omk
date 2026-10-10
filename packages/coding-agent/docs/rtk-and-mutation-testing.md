# RTK 출력 필터와 Stryker 개발 검사

## RTK는 실행기가 아니라 선택형 출력 필터

기본값은 꺼져 있다. RTK CLI를 별도로 설치한 뒤 다음 환경으로 **새 프로세스**를 실행한다.
이번 연결은 RTK 0.51.0의 `pipe` 모드로 검증했으며 RTK 자체를 npm 패키지에 포함하지 않는다.

```bash
rtk --version
OMK_RTK_OUTPUT=1 OMK_RTK_PATH=/absolute/path/to/rtk omk
```

`OMK_RTK_PATH`를 생략하면 `PATH`의 `rtk`를 사용한다. `OMK_RTK_OUTPUT=0` 또는 미설정은
기존 동작이다. 개인 설정, RTK hook, 자동 명령 rewrite나 telemetry를 활성화하지 않는다.
RTK 서브프로세스에는 자격증명/세션 환경을 넘기지 않고 `RTK_TELEMETRY_DISABLED=1`을 설정한다.

적용 범위:

- OMK 기본 `bash` 도구의 최종 출력만 처리한다. 원래 명령, 작업 디렉터리, 승인,
  sandbox, timeout, streaming과 exit code는 OMK가 계속 소유한다.
- 단순한 `vitest run`/`vitest --run`, `tsc --noEmit`/`tsgo --noEmit`과 알려진
  `node node_modules/...` 실행 형태만 인식한다.
- 원래 exit code가 0이고, 잘리지 않은 출력이 1 KiB 이상일 때만 처리한다.
  실패, 취소, pipe/redirect/복합 명령, npm script, quoted argument, help/watch는 그대로 둔다.
  `-h/-v/-w`, 대소문자/`--watch=...` 변형과 `--all`, `--showConfig`도 원문을 유지한다.
  도움말을 컴파일 성공으로 요약하지 않는다.
- 원본 바이트를 owner-only 임시 파일에 먼저 보존하고, 모델 출력에 `Full output:` 경로를 붙인다.
  필터 입력에서만 ANSI 제어 문자를 제거한다. 원본 파일과 streaming은 바꾸지 않는다.
- 필터는 `rtk pipe --filter vitest|tsc`를 shell 없이 실행하며 2초와 50 KiB 출력 상한을 둔다.
  미설치, stderr, 실패, 빈 출력, 더 커진 출력, timeout이면 원본으로 돌아간다.
  원래 실행 실패를 필터 exit code 0으로 성공 처리하지 않는다.
  `details.outputFilter.status`는 `applied`/`fallback`으로 필터 상태를 별도 기록한다.

성공 로그를 먼저 좁힌 실험이다. 실패 로그를 줄이거나 기본값을 켜려면 원인/stack 보존과
동일 provider 요청의 토큰 측정을 별도로 확인해야 한다. 출력 바이트 감소는 전체 비용 절감이 아니다.
통상적인 `tsc --noEmit` 성공은 출력이 없으므로 필터 후보가 되지 않는다. 컴파일 오류는
이번 연결에서 원문을 유지한다. `tsc` 필터의 실사용 절감 효과는 아직 측정하지 않았다.
외부 bash override(예: 별도 shell extension)가 실행 경로를 소유하면 이 기본 도구 옵션은 적용되지 않는다.

실제 native binary를 통한 통합 검사는 선택형이다.

```bash
cd packages/coding-agent
RTK_TEST_EXECUTABLE=/absolute/path/to/rtk node ../../node_modules/vitest/dist/cli.js --run test/rtk-output-live.test.ts
```

## StrykerJS는 개발 전용

루트 devDependencies에 `@stryker-mutator/core`와 공식 Vitest runner 10.0.0을 고정했다.
Node >=22와 기존 Vitest 3.2.6을 사용한다. 일반 `npm test`, `npm run check`, 사용자 세션에서는
mutation을 실행하지 않는다. 검사 전에 기존 프로젝트 절차로 의존성과 필요한 workspace build를 준비한다.

```bash
npm install --ignore-scripts
npm run test:mutation:dry
npm run test:mutation
```

`stryker.config.json`의 대상은 `prompt-settlement.ts`와 `session-prompt-lifecycle.ts` 두 파일이다.
`vitest.mutation.config.ts`는 기존 config를 재사용하며 그 계약 테스트 두 파일만 실행한다.
Stryker sandbox를 유지하고 `inPlace`, dashboard 업로드, 자동 plugin 설치, 모델 호출은 사용하지 않는다.
동시성 1, mutant timeout 추가분 5초, initial dry-run 상한 2분으로 제한한다.

로컬 결과는 `.omk/runs/stryker/mutation.json`과 `index.html`이다.
`dryRunOnly` 성공은 runner 구성 확인일 뿐 mutation score가 아니다. 실제 결과에서는
Killed, Survived, NoCoverage, Timeout, CompileError와 RuntimeError를 구분한다.
Timeout을 의미 있는 assertion으로 세지 않고, 살아남은 변이는 source와 계약을 읽어 판단한다.
Stryker 기본 report 임계값을 내리거나 mutant 제외 목록을 넓혀 점수를 맞추지 않는다.
이 검사는 테스트의 탐지력을 보여주며 의미적 정확성이나 출시 승인을 증명하지 않는다.

초기 실행에서 233개 변이는 Killed 163, Survived 27, NoCoverage 35, Timeout 8로 나뉘었다.
카운터 증가/감소와 child/shard 해제 계약의 assertion을 보강했다. 같은 두 소스의 변이를
재실행해 결과를 비교하며, 도달 불가능한 exhaustive default와 중복 방어 조건은
점수를 위해 production code에서 삭제하거나 exclude하지 않는다.
두 번째 실행은 같은 source와 같은 233개 변이에서 Killed 216, Survived 6,
NoCoverage 2, Timeout 9였다. 반복 finish와 에러 정체성 테스트를 추가한 최종 실행은
Killed 219, Survived 3, NoCoverage 2, Timeout 9이며 CompileError/RuntimeError는 0이었다.
최종 설치는 패치된 qs 의존성을 사용하고 source와 변이 집합은 첫 실행과 같다.

남은 항목을 구분한다. Survived 두 개는 이미 성립한 terminal/non-null 불변식의 중복
방어 조건이다. 나머지 하나는 resolved waiter 집합을 비우는 메모리 정리의 테스트
빈틈이며 equivalent로 취급하지 않는다. NoCoverage 두 개는 타입상 exhaustive default다.
Timeout 아홉 개는 독립 assertion이 아니라 실행 제한으로 탐지된 변이로 별도 기록한다.
해당 항목을 exclude하거나 임계값을 낮추지 않았다.

개발 의존성 검사에서 새 `typed-rest-client → qs 6.15.1` 취약점을 발견해
Stryker 경로에만 `qs 6.16.0` override를 둔다. 전체 프로젝트의 기존 취약점이 모두
해결됐다는 뜻은 아니며, `npm audit fix`나 일괄 dependency update는 하지 않았다.

## 빌드 전 로컬 재검증 (2026-10-09)

메타인지 계약 점검 후 로컬 AdaptOrch `CommandVerifier`로 관련 명령을 직접 실행했다.
별도 에이전트, 모델 호출, synthesis, 업로드는 실행하지 않았다. 캐시와 환경 상속을 끄고
소스/config digest, 명령, cwd, exit code와 원본 로그를 묶었다. 검사 전후 대상 digest는 같다.
Node startup 양성 통제는 exit 0, 의도적 exit 23 음성 통제는 `passed=false`로 확인했다.
유한 제한은 주소 공간 64 GiB, CPU 120초, 파일 64 MiB, 공유 UID 프로세스 4096이다.
이는 OS/network sandbox나 의미적 정확성 증명이 아니다.

재검증 중 `tsc --noEmit -h`의 실제 도움말을 컴파일 성공으로 바꾸는 오분류를 재현했다.
짧은 옵션, 대소문자/값 변형과 정보 출력 옵션을 원문 경로에 남기도록 선택 조건 한 줄을
수정했다. 기존 코드에서 실패한 선택기 테스트와 실제 TypeScript/RTK 공개 호출 회귀가 통과한다.
관련 8개 파일의 90개 테스트와 설정 계약 검사 2개, 대상 LSP/린트, 의존성/구조 guard가 통과했다.
동일한 두 소스와 233개 변이의 재검사도 Killed 219, Survived 3, NoCoverage 2, Timeout 9다.
Stryker 초기 계약 테스트 27개도 통과했으며 검사 오류는 없다. 위 잔여 mutation 빈틈은 유지한다.

전체 저장소가 통과했다는 뜻은 아니다. `npm run check`는 built CLI 산출물 부재로
399개 검사 중 3개가 실패했다. 별도 `tsgo --noEmit`는 `omk-agent-core/node` 두 import,
확장 `tools.test.ts`는 미빌드 `omk-ai` entry, 문서 링크 검사는 기존 `context-files.md`의
미커밋 `project-context.md` 링크에서 막힌다. 빌드/타입 별칭/다른 작업 stage로 우회하지 않았다.
현재 `npm audit`는 13건이며 `qs`/`typed-rest-client` advisory는 없다. 검사 시점의 데이터다.
이 단계에서는 전체 빌드를 실행하지 않았다. Windows, 설치된 TUI와 실제 provider 토큰/비용은 미검증이다.

## 빌드 후 확인 (2026-10-09)

원래 공유 체크아웃과 최신 원격 main 기반의 분리 후보에서 `npm run build`가 통과했다.
후보에서는 기존 렌더러 분리를 유지하면서 RTK 연결만 병합했다. AdaptOrch 로컬 검사에서
관련 회귀 90개, 추가 도구 테스트 69개, 설정 계약 2개와 `tsgo --noEmit`, 문서 링크가 통과했다.
빌드된 `createBashTool` 공개 경로에서도 실제 Vitest 30개 출력이 필터링되고 TypeScript
도움말은 원문을 유지했다. 이는 설치된 엔진 교체나 현재 TUI의 자동 갱신이 아니다.
Mutation 재검사도 같은 소스와 233개 변이에서 Killed 219, Survived 3, NoCoverage 2,
Timeout 9를 유지했다. Sandbox 정리 후 후보의 `npm run check`가 exit 0으로 통과했으며
구조 계약 399개, 전체 타입 검사, 문서/패키지 경계와 브라우저 smoke 검사를 포함한다.

`npm run check`와 Stryker를 같은 트리에서 동시에 실행하면 Stryker sandbox의
`biome.json`이 nested root configuration으로 잡힐 수 있다. Mutation 종료와 자동 sandbox
정리 후 전체 검사를 순차 실행하며, ignore 설정이나 guard baseline을 넓히지 않는다.

## 확인한 외부 계약

- [RTK 0.51.0 pipe 구현](https://github.com/rtk-ai/rtk/blob/v0.51.0/src/cmds/system/pipe_cmd.rs)
- [RTK telemetry opt-out](https://github.com/rtk-ai/rtk/blob/v0.51.0/src/core/telemetry_cmd.rs)
- [Stryker 10.0.0 Vitest runner](https://github.com/stryker-mutator/stryker-js/blob/v10.0.0/packages/vitest-runner/package.json)
- [Stryker runner 설정](https://stryker-mutator.io/docs/stryker-js/vitest-runner/)

RTK와 Stryker의 라이선스는 Apache-2.0이다. Difftastic, opensrc, Hypa 전체와 Hypergrep은
이 연결 범위에 넣지 않았다. 현재 실행 중인 다른 세션이나 설치된 OMK bundle이 소스 수정만으로
갱신되었다고 가정하지 않는다.
