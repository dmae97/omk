# Kimi Code 400 재현 매트릭스와 근본 원인 (2026-10-28)

- 대상: `omk` 1.5.10, provider `kimi-coding`, baseUrl `https://api.kimi.com/coding`, api `anthropic-messages`
- 결론 먼저: **모델과 thinking 조합이 아니라 MCP 도구 이름이 원인**이다. `21st` MCP 서버의 도구 이름이 숫자로 시작해서 Kimi가 요청 전체를 400으로 거부한다.

## 1. 재현 명령

```bash
# 실패 (기본 도구 세트, 21st MCP 포함)
omk -p "reply pong" --model kimi-coding/k3 --thinking high

# 성공 (도구 없음)
omk -p "reply pong" --model kimi-coding/k3 --thinking high --no-tools

# 성공 (내장 도구만)
omk -p "reply pong" --model kimi-coding/k3 --thinking high -nt -t read,bash,edit,write

# 실패 (내장 도구 제외, MCP/패키지 도구 유지)
omk -p "reply pong" --model kimi-coding/k3 --thinking high -nbt

# 실패 (확장 비활성, MCP/패키지 도구 유지)
omk -p "reply pong" --model kimi-coding/k3 --thinking high -nbt -ne
```

실패 시 출력:

```text
kind=configuration provider/model=kimi-coding/k3 retryable=false cause=configuration.invalid
message=400 {"error":{"type":"invalid_request_error","message":"function name is invalid, must start with a letter and can contain letters, numbers, underscores, and dashes"},"type":"error"}
```

## 2. 모델 x thinking 매트릭스

명령 형식: `omk -p "reply pong" --model kimi-coding/<model> --thinking <level>`

| model | off | medium | high | xhigh | max |
| --- | --- | --- | --- | --- | --- |
| k3 | 400 tool-name | 400 tool-name | 400 tool-name | 400 tool-name | 400 tool-name |
| k3.1-pro | 400 tool-name | 400 tool-name | 400 tool-name | 400 tool-name | 400 tool-name |
| kimi-for-coding | ok | ok | ok | ok | ok |

해석: thinking 레벨은 결과를 바꾸지 않는다. 모델은 결과를 바꾸지만, 그것도 thinking과 무관한 **도구 세트 차이** 때문이다(4절).

## 3. Kimi 도구 이름 규칙 (HTTP 직접 검증)

`POST https://api.kimi.com/coding/v1/messages`, `model: k3`, 도구 1개만 넣고 이름만 바꿔 측정했다.

| tool name | 결과 |
| --- | --- |
| `1abc` | 400 |
| `-abc` | 400 |
| `a.b` | 400 |
| `a:b` | 400 |
| `21st__search` | 400 |
| `_abc` | 200 |
| `A1_-` | 200 |
| `search_21st` | 200 |
| `mcp_21st_search` | 200 |
| `chrome-devtools__click` | 200 |
| `serena__find_symbol` | 200 |

실효 규칙: `^[A-Za-z_][A-Za-z0-9_-]*$`. 오류 문구는 "letter"라고 하지만 밑줄 시작은 통과한다. 같은 이름을 `kimi-for-coding`에 넣어도 `21st__search`는 400이므로 규칙 자체는 모델 공통이다.

## 4. 실제 요청에 실린 도구 목록

로컬 로깅 프록시(`127.0.0.1:8899`)를 임시 provider로 등록해 실제 payload의 `tools[].name`만 수집했다. 인증 정보는 기록하지 않았다.

| 모델 | tools 수 | 규칙 위반 | `21st__*` 수 | 결과 |
| --- | --- | --- | --- | --- |
| k3 | 295 | 51 | 51 | 400 |
| kimi-for-coding | 244 | 0 | 0 | 200 |

즉 k3 요청에는 `21st__*` 도구 51개가 실리고, kimi-for-coding 요청에는 아예 실리지 않는다. 차이 51개가 정확히 21st 도구 수와 일치한다.

위반 이름 예시(51개 전부 `21st__` 접두): `21st__search`, `21st__get_component`, `21st__video_create_project`, `21st__list_bookmarks` 등.

## 5. 원인 체인

1. `/home/dmae97/.omk/mcp.json`에 `21st` 서버가 등록되어 있다 (`https://21st.dev/api/mcp`, `mcp-remote` 경유).
2. `packages/coding-agent/src/core/mcp/tools.ts:22` `MCP_TOOL_NAME_SEPARATOR = "__"`.
3. 같은 파일 `buildMcpToolName()`이 `서버명__도구명`으로 이름을 만든다. 서버명이 `21st`라서 결과가 `21st__search`.
4. 같은 파일 `sanitizeToolNameSegment()`는 허용되지 않는 **문자만** 치환하고, 첫 글자 규칙은 강제하지 않는다.
5. Kimi의 anthropic-messages 구현은 첫 글자가 letter/underscore가 아니면 요청 전체를 400으로 거부한다.
6. 결과적으로 모델이나 thinking과 무관하게, 21st 도구가 실린 요청만 실패한다.

## 6. 수정 방향 (구현 완료, 9절 참고)

코드 (근본 수정):

- `sanitizeToolNameSegment()` 또는 `buildMcpToolName()`에서 첫 글자가 letter/underscore가 아니면 접두를 붙인다. 예: `mcp_21st__search`, `t_21st__search`.
- 접두 추가로 `MAX_TOOL_NAME_LENGTH`를 넘길 수 있으므로 절단 로직과 함께 처리한다.
- 회귀 테스트: 서버명 `21st`에 대해 `buildMcpToolName()` 결과가 `^[A-Za-z_]`를 만족하는지, 200자 경계에서 잘리지 않는지 확인한다.

당장의 우회 (코드 수정 없이):

```bash
# 1) 21st MCP 서버를 세션에서 제외 (설정에서 비활성화하거나 아래처럼 이름을 직접 제외)
omk -p "..." --model kimi-coding/k3 --exclude-tools 21st__search,21st__get_component

# 2) 내장 도구만 사용
omk -p "..." --model kimi-coding/k3 -nt -t read,bash,edit,write,web_search

# 3) 도구가 필요 없을 때
omk -p "..." --model kimi-coding/k3 --no-tools
```

`kimi-for-coding`이 통과하는 것은 도구 세트가 우연히 빠졌기 때문이지 규칙이 완화된 것이 아니다. 우회책으로 권하지 않는다.

## 7. 함께 발견한 설정 문제

- `/home/dmae97/.omk/mcp.json`의 `21st` 항목에 API 키가 평문으로 들어 있다. 이 파일은 저장소 밖이지만 백업과 대화 로그로 복제되기 쉽다. 키 회전과 환경변수 참조 방식으로의 전환을 권한다.
- `~/.omk/agent/models.json`의 `kimi-coding.apiKey`가 `cat /home/yu/.omk/agent/secrets/kimi-coding-plan.key` 셸 명령이다. 이 경로는 존재하지 않는다(실제 파일은 `/home/dmae97/.omk/agent/secrets/kimi-coding-plan.key`). 인증 저장소 값이 우선 적용되어 지금은 동작하지만, 저장소가 비워지면 즉시 실패한다.
- 두 파일 모두 이번 진단에서 읽었으며 값은 이 문서에 남기지 않았다.

## 8. 재현 환경 정리

- `~/.omk/agent/models.json`은 백업에서 복원했고 임시 provider `kimi-probe`는 제거했다 (provider 34개, `kimi-coding` 모델 3개 원상 복구 확인).
- 로깅 프록시 프로세스는 종료했고 `127.0.0.1:8899` 리스닝이 닫힌 것을 확인했다.
- 수집한 도구 이름 목록은 `/tmp/kimi-probe/toolnames*.json`에만 있으며 저장소에는 커밋하지 않는다.

## 9. 구현

변경 파일 2개, +47 / -2.

- `packages/coding-agent/src/core/mcp/tools.ts`: `sanitizeToolNameSegment()`가 정리 후 첫 글자를 검사해 letter가 아니면 `mcp_`를 붙인다. 선행 밑줄은 제거하고, 빈 라벨은 `mcp`로 대체한다. `buildMcpToolName()`의 64자 절단 로직은 그대로 두었고, 접두가 붙은 뒤에도 서버 접두가 유지되는 것을 테스트로 고정했다.
- `packages/coding-agent/test/mcp/client.test.ts`: 이름 규칙 테스트 3개 추가. `21st` 회귀, dash/dot/빈 라벨, digit-leading 서버의 장문 절단 케이스를 덮는다.

동작:

| 입력 | 이전 | 이후 |
| --- | --- | --- |
| `sanitizeToolNameSegment("21st")` | `21st` | `mcp_21st` |
| `buildMcpToolName("21st", "search")` | `21st__search` | `mcp_21st__search` |
| `sanitizeToolNameSegment("_internal")` | `_internal` | `mcp_internal` |
| `sanitizeToolNameSegment("!!!")` | `_` | `mcp` |
| `buildMcpToolName("", "search")` | `__search` | `mcp__search` |
| `sanitizeToolNameSegment("weird name!@#")` | `weird_name_` | `weird_name_` (변화 없음) |

검증:

| 명령 | 결과 |
| --- | --- |
| `npx vitest run packages/coding-agent/test/mcp` | 19 files, 168 tests passed |
| `npx biome check <두 파일>` | No fixes applied, 오류 없음 |
| `diagnostics` (tools.ts) | No diagnostics |
| `curl` `POST /v1/messages` + `mcp_21st__search` | 200 |
| `curl` `POST /v1/messages` + `mcp_21st__video_create_project` | 200 |

호환성 주의: 도구 이름이 바뀌므로 `--exclude-tools`/`--tools` 허용 목록이나 권한 규칙에 `21st__search` 형태를 적어 둔 설정은 `mcp_21st__search`로 갱신해야 한다.

남은 단계: 설치된 CLI는 1.5.10 빌드라 이 수정이 아직 반영되지 않았다. 재빌드 또는 재설치 후 `omk -p "reply pong" --model kimi-coding/k3 --thinking high`로 400이 사라지는지 확인해야 한다.
