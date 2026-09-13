# 시작 리소스 설명의 하네스 태그: 검증 기록

기준: `cabbb38389`. 실제 launcher의 version/help와 credentials 없는 offline TUI를 확인했습니다.
기본 시작 화면은 OMK였으며, 다른 실행기로 전환되는 현상은 재현되지 않았습니다.
외부 스킬 설명의 `[OMX]`가 자동완성에 원문으로 나타나는 경로는 재현했습니다.

## 현재 표시 규칙

`resource-description.ts`는 설명 앞의 `[OMX]` / `[OMO]` 장식 표기를 제거합니다.
설명이 태그만으로 구성되면 `OMK resource`를 표시합니다. source scope와 호출 이름은
그대로이며, formatter 자체가 원본 스킬이나 metadata를 수정하지는 않습니다.
일반 문장 속 제품명이나 `[preview]` 같은 다른 태그를 무차별 치환하지 않습니다.

초기 구현은 태그를 설명 뒤의 `resource tag`로 옮겼지만, 사용자의 후속 요구에 따라
현재는 그 꼬리표도 출력하지 않습니다. 출처와 라이선스는 원본·별도 provenance에서 보존합니다.

## RED → GREEN

현재 요구의 8개 검사 중 4개가 RED였습니다. 예:

```text
Expected: [t] Planning workflow
Received: [t] Planning workflow · resource tag: OMX
```

수정 후 다음 명령은 41개 테스트 통과, exit 0입니다.

```bash
(cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run \
  test/interactive-mode-resource-description.test.ts test/interactive-mode-startup-input.test.ts \
  test/cli-resource-paths.test.ts test/resource-loader.test.ts)
```

## 실제 진입점과 제한

원래 문제는 임시 home의 실제 TUI에서 같은 스킬을 추가하고 `/skill:deep`을 입력해
재현했습니다. 사용자 프롬프트를 전송하거나 credential을 복사하지 않았습니다.
표시 로직은 source CLI와 단위 검사로 확인하고, 설치된 실행기는 별도로 대조합니다.
소스 변경만으로 이미 설치·실행 중인 bundle이 바뀐다고 주장하지 않습니다.

개인 OMK 스킬 경로 이관·설정 백업·네이티브 스킬 검증은 별도의 운영 범위이며,
그 개인 파일이나 설정을 이 저장소에 복제하지 않습니다. 외부 확장이 자신의 UI를
직접 렌더링하는 모든 경로를 검사한 결과도 아닙니다.

변경 경로: `src/modes/interactive/{interactive-mode,resource-description}.ts`,
`test/interactive-mode-resource-description.test.ts`, [사용 안내](usage.md), 이 기록.
제안 메시지: `fix(tui): OMK 설명에서 외부 하네스 장식 표기 제거`.
