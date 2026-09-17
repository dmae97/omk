# 모델 목록·thinking 갱신 기록

확인일: 2026-09-09. 생성기와 공급자 어댑터를 수정한 뒤 `npm run models:refresh`로
두 카탈로그를 재생성했다. 생성 파일을 손으로 수정하지 않았다.

## 2026-09-17 후속: OpenCode Go DeepSeek V4.1 ID 변경

[OpenCode Go 공식 endpoint 목록](https://opencode.ai/docs/go/)의 현재 ID는
`deepseek-v4.1-flash`다. 직접 DeepSeek의 `deepseek-flash`와 구분한다.
9월 17일 카탈로그 갱신은 새 ID를 반영했지만, 생성기의 V4.1 메타데이터 보정은
이전 ID만 인식해 `low/max`와 `max_tokens` 설정이 누락됐다.

생성기 조건에 Go의 새 ID를 추가하고 기존 Go ID의 보정도 유지했다. 회귀 테스트는
공급자별 실제 요청 ID를 사용하며 `off/low/high/max`, 이미지 입력, 출력 상한,
전송 직전 `thinking`과 `reasoning_effort` 검사를 그대로 유지한다.
ID만 교체한 상태에서도 5개 실패가 재현됐으며 메타데이터 수정 후 통과했다.

`node packages/ai/scripts/generate-models.ts`로 생성한 결과 중 해당 Go 모델의
메타데이터 변경만 포함했다. 실시간 목록에서 함께 발생한 다른 모델의 추가/삭제,
가격/상한 변경은 이번 수정에 포함하지 않았다. 생성 파일 값을 수작업으로 만들지 않았다.
공급자 추론이나 계정별 사용 가능 여부는 검증하지 않았다. 아래 9월 10일 표는 당시 기록이다.

## 2026-09-17 갱신: OpenRouter Union Alpha (stealth)

`stealth/union-alpha` 추가 요청으로 `npm run models:refresh`를 종료0으로 재생성했다.
생성 파일은 손대지 않았다. 전 소스가 응답했고 `--allow-partial`은 쓰지 않았다.

| 항목 | 값 |
| --- | --- |
| 요청 ID | `stealth/union-alpha` (OpenRouter) |
| context / maxTokens | 262,144 / 131,072 |
| 입력 | text, image |
| tool 지원 | `tools`, `tool_choice` |
| 가격 | prompt/completion 모두 `0` |
| **thinking** | **없음 — route가 `reasoning`을 선언하지 않음** |

목록과 `/api/v1/models/stealth/union-alpha/endpoints` 모두
`supported_parameters`가 `max_tokens, temperature, top_p, tools, tool_choice,
response_format`이다. `reasoning`도 `include_reasoning`도 없다. 선언이 없으므로
수준을 지어내지 않고 `reasoning: false`로 들어갔으며 `thinkingLevelMap`도 없다.
이름이 frontier 계열을 연상시킨다는 이유로 effort를 이식하지 않는다.

`created`는 2026-09-16으로 직전 갱신(09-09) 이후에 생긴 항목이다. 한 모델만
집어넣는 경로가 없어 카탈로그 전체가 8일치 드리프트를 함께 반영한다.
OpenRouter 371 → 376, 전체 추가 57 · 제거 28(고유 4)이다. 제거는
`deepseek.r1-v1:0`과 mistral `devstral-small-2` · `mistral-medium` · `pixtral-12b`로,
갱신 소스에서 더 이상 선정되지 않았다는 뜻이며 공급자의 폐기 공지나 모든 계정의
사용 불가를 뜻하지 않는다.

가격 `0`은 stealth 공개 기간의 목록 값이다. 무상 사용을 보장하지 않으며 stealth
해제 시 달라질 수 있다. 실제 청구는 계정에서 따로 확인한다.

표적 검사 `latest-model-thinking` · `catalog-thinking` · `latest-thinking-payload`
51개가 통과했다. 공급자 추론은 호출하지 않았다.

## 2026-09-10 재검증: DeepSeek V4.1 Flash 제공 경로

공식 문서·공개 API에서 확인한 기존 OMK 공급자 4곳을 반영했다.
현재 설정의 인증·endpoint·선택 모델은 변경하지 않았다.

| OMK provider | 요청 model ID | 입력 | 추론 요청 |
| --- | --- | --- | --- |
| `deepseek` | `deepseek-flash` | text/image | `thinking.type` + `reasoning_effort: low/high/max` |
| `opencode-go` | `deepseek-flash` | text/image | `thinking.type` + `reasoning_effort: low/high/max` |
| `openrouter` | `deepseek/deepseek-v4.1-flash` | text/image | `reasoning.effort: low/high/max` |
| `vercel-ai-gateway` | `deepseek/deepseek-v4.1-flash` | text/image | adaptive `thinking` + `output_config.effort: low/high/max` |

네 경로 모두 `off/low/high/max`를 노출한다. 새 native ID는 누락돼 있었고,
OpenCode Go ID는 목록에는 있었지만 thinking 계약이 빠져 있었다. 직접/Go 경로는
출력 상한을 `max_tokens`로 보내며, off는 명시적 `thinking.type: disabled`로 보낸다.
기존 직접 `deepseek-v4-flash`는 제거하지 않고 **V4.1 Flash 호환 별칭**으로 표시한다.
기존 별칭의 `xhigh → max` 호환 매핑도 유지한다.

DeepSeek 공식 가격은 시간대별이다. native 정적 비용은 peak 가격
(input/output/cache-read: $0.30/$1.20/$0.006 per 1M tokens)을 저장한다.
Off-peak는 절반이며, Vercel·OpenCode Go 목록이 제공하는 기본 가격과 다를 수 있다.
현재 숫자형 스키마는 시간대를 표현하지 않으므로 실제 청구액이라고 주장하지 않는다.
V4 Pro도 현재 공식 peak 가격으로 정정했으며, 9월14일 예정된 리다이렉트는 미리 적용하지 않았다.

`npm run models:refresh` 종료0: **37 providers, 1,333 coding models**,
HEAD `29624c3962` 대비 **81 추가·35 제거**. OpenRouter 371, Vercel 235,
이미지 54개다. 모든 필수 소스가 응답했고, 키 없는 Zyloo는 기존 정적 목록을 유지했다.
제거는 갱신 소스에서 미선정됐다는 뜻이며 모든 계정의 폐기 여부까지 증명하지 않는다.

`deepseek-v41-native.test.ts` 신규 11개가 먼저 실패했고, 생성기 보완·재생성 후
11개 모두 통과했다. 기존 gateway 4개를 포함한 표적 5파일 62개도 통과했다.
실제 모델 추론은 호출하지 않고 전송 직전 payload, 출력 상한, 토글·effort를 확인했다.
models.dev에 있는 신규 provider 이름만 보고 별도 어댑터를 임의 등록하지 않았다.

근거: [DeepSeek 출시·별칭](https://api-docs.deepseek.com/updates/),
[직접 모델·가격](https://api-docs.deepseek.com/quick_start/pricing),
[직접 thinking 계약](https://api-docs.deepseek.com/guides/thinking_mode),
[OpenCode Go ID·endpoint](https://opencode.ai/docs/go/),
[OpenRouter models](https://openrouter.ai/api/v1/models),
[Vercel models](https://ai-gateway.vercel.sh/v1/models).

## 2026-09-09 후속 갱신 기록: DeepSeek V4.1 Flash

다시 조회한 목록에서는 OpenRouter와 Vercel 모두 정식 ID
`deepseek/deepseek-v4.1-flash`를 제공한다. 이전 Vercel beta 항목 대신 이 ID를 사용한다.
OpenRouter가 선언한 수준은 `low/high/max`, thinking은 선택적이다. 두 route 모두
OMK에서 `off/low/high/max`를 노출한다.

- OpenRouter: `reasoning.effort: "max"`.
- Vercel Messages: `thinking.type: "adaptive"`와 `output_config.effort: "max"`.
  이는 게이트웨이 요청 형식이다. DeepSeek 네이티브 API가 Claude의 adaptive 형식을
  받는다는 뜻이 아니다. 고정 thinking-budget 경로로 낮추거나 요청 출력 상한을 늘리지 않는다.

후속 재생성 결과는 코딩 모델 1,332개(OpenRouter 371개)이며, 아래 이전 집계는
2026-09-09 갱신의 기록으로 유지한다. `deepseek-v41-thinking.test.ts`에서 정식 ID,
두 route의 max payload와 상한 보존을 공급자 호출 없이 확인한다. 실제 게이트웨이의
내부 매핑·모델 추론량은 별도 검증 대상이다. 후속 표적 검사 90개, 전체 타입 검사,
주 LSP 2파일과 diff 검사는 종료0으로 통과했다. `npm run check`는 아래에 기록한 기존
서식/import 오류3건에서 중단했다.

후속 변경 단위는 `catalog-thinking.ts`, 생성 카탈로그, `deepseek-v41-thinking.test.ts`,
adaptive-envelope 회귀 및 이 문서다. 제안 커밋 메시지는
`fix: DeepSeek V4.1 Flash 정식 경로와 max effort 전달 보정`이다.
실제 추론·빌드·커밋은 실행하지 않았다.

참고: [Vercel Messages effort](https://vercel.com/docs/ai-gateway/sdks-and-apis/anthropic-messages-api/reasoning),
[게이트웨이 effort 매핑](https://vercel.com/docs/ai-gateway/models-and-providers/reasoning).

## 목록 확인 범위

| 소스 | 확인 | 적용 범위 |
| --- | --- | --- |
| [OpenRouter models](https://openrouter.ai/api/v1/models) | HTTP 200, 431개 | tool 지원 364개 + 기존 auto 항목 = 365개 |
| [models.dev](https://models.dev/api.json) | HTTP 200, 213개 공급자 | 기존 생성기가 지원하는 공급자들의 공개 메타데이터 |
| [Vercel AI Gateway](https://ai-gateway.vercel.sh/v1/models) | HTTP 200, 373개 | tool 지원 235개 |
| [NVIDIA NIM](https://integrate.api.nvidia.com/v1/models) | HTTP 200, 80개 ID | tool 메타데이터·기존 호환성 필터를 충족하는 19개 |
| Zyloo | 키 미설정 | 기존 정적 6개 유지. 최신 목록 확인으로 표시하지 않음 |

코딩 카탈로그는 **37개 공급자, 1,287→1,326개 모델**(74개 추가·35개 제거),
OpenRouter 이미지 카탈로그는 **54개**다. 모델 수는 route별 항목 수이며 서로 다른 기반 모델 수가 아니다.
models.dev는 공급자 원본 API나 계정별 권한 증명이 아닌 보조 카탈로그다.

OpenRouter 추가 항목에는 GPT-6 Astra/Pro와 batch 변형, Mercury 2.5, Nex N2.5
Mini/Pro free, Qwen3.8 Max 0902가 있다. OpenAI·Azure·OpenCode·Copilot에도 해당
소스가 제공하는 Astra 항목을 반영했다. Copilot GPT-6는 Responses 경로를 사용한다.
Vertex의 신규 Gemini 항목은 **Vertex 자체 목록에 있는 ID만** 추가한다.

삭제 목록도 대조했다. 예를 들어 OpenRouter의 `qwen/qwen3.8-max` 대신
`qwen/qwen3.8-max-0902`, `inception/mercury-2.5-preview` 대신 정식 Mercury 2.5가
목록에 있다. Copilot 구형 route, Moonshot 구형 Kimi, NVIDIA 2개 항목도 갱신 소스에서
더 이상 선정되지 않는다. 이것을 공급자의 공식 폐기 공지나 모든 계정의 사용 불가로
해석하지 않는다. 소스 응답 실패를 숨기는 `--allow-partial`은 사용하지 않았다.

자동 라우팅 항목 `openrouter/auto`·`openrouter/auto-beta`의 가격 `-1` 표시는 미정
가격이다. 이를 음수 요금으로 계산하던 코딩·이미지 카탈로그 경로를 교정했다. 기존 숫자형 카탈로그의
미가격값 0으로 저장하며 **무료라는 뜻이 아니다**. 실제 선택된 모델의 사용량·청구를
별도로 확인해야 한다.

## Thinking: 모델 이름보다 해당 route의 계약

OpenRouter의 `reasoning.supported_efforts`로 표시할 수준을 만들고,
`reasoning.mandatory`로 끄기 가능 여부를 구분한다. 선언이 있는 수준은 과거의 이름별
추정보다 우선한다. 선언 자체가 없는 경우에는 기존 fallback을 유지하며 지원 범위를
새로 지어내지 않는다.

**토글과 노력 수준은 별개다.** 선택적 thinking 모델은 노력 목록에 `none`이 없어도
`reasoning.enabled: false`로 끌 수 있다. 반대로 mandatory 모델에는 끄기를 노출하지
않는다. Mercury 2 계열의 기존 tool-use/instant-mode 제한도 유지한다.

| 모델·route | 이번 정합성 규칙 |
| --- | --- |
| GPT-6 Astra, OpenAI/Responses 및 OpenRouter | low·medium·high·xhigh·max. OMK `ultra`는 공식 천장 `max`의 선택기 별칭이며 와이어에 `ultra`를 보내지 않음. off/minimal 미노출 |
| Claude Opus 5, Anthropic Messages | adaptive thinking, low·medium·high·xhigh·max. off는 high 이하에서 가능 |
| Claude Opus 5, Bedrock | legacy budget 대신 adaptive 및 xhigh 사용. application profile의 표시명 매칭 보존 |
| Gemini 3.7/3.8 Flash, Google/Vertex | low·medium·high. minimal은 API 오류. SDK의 off 요청도 LOW로 처리하며 완전 비활성화로 주장하지 않음 |
| DeepSeek V4, 직접 API | low·high·max. 기존 OMK xhigh→max 별칭 보존 |
| DeepSeek V4, OpenRouter | 해당 route가 선언한 high·xhigh 및 optional off. 직접 API의 max 문자열을 이식하지 않음 |
| Qwen3.8 Max 0902, OpenRouter | mandatory, minimal·low·medium·high·xhigh. 추정으로 max를 추가하지 않음 |
| GLM-5.2, OpenRouter | optional off·high·xhigh. ZAI 직접 route의 max 규칙과 구분 |
| Nex N2.5 free, OpenRouter | off·medium·high |
| Muse Spark 1.3, OpenRouter | gateway가 선언한 max 사용. 직접 Meta의 max→xhigh 규칙과 구분 |

수준 이름은 제공된 API 값이지 모델 간 동일한 추론량이나 토큰 보장이 아니다.
OpenRouter의 batch 항목을 모델 목록에 포함했다고 OMK가 Batch API를 별도로 구현한
것은 아니다. 실제 route 지원과 과금은 공급자 계약을 따로 확인해야 한다.

## 로컬 덮어쓰기와 적용

`models.json`의 동일 ID custom model은 새 카탈로그보다 우선할 수 있다.
기존 `thinkingLevelMap`이나 `compat.supportsReasoningEffort: false`가 남아 있으면
새 수준이 숨겨지거나 전송되지 않는다. [모델 설정](models.md)을 함께 확인한다.

Model Studio의 DeepSeek V4는 `thinkingFormat: "qwen"`과
`supportsReasoningEffort: true`를 모델 단위로 설정하면 `enable_thinking`과
공식 low/medium/high/xhigh/max 값이 전송된다. 네이티브 DeepSeek의 `thinking` 객체와
혼동하지 않는다. 인증·주소·모델 ID·기본 선택 모델 변경은 thinking 수정과 분리한다.

소스 변경을 설치 CLI에 적용하려면 검토한 build/install 및 새 프로세스가 필요하다.
로컬 모델 설정만 바꾼 경우에도 진행 중인 요청의 모델 snapshot이 바뀌었다고 간주하지
않고 모델 목록을 다시 로드한 새 세션에서 확인한다.

## 검증과 한계

카탈로그 누락/수준 오류 16개, Bedrock Opus 5 payload 오류 2개, Gemini off payload
오류 4개, 직접 DeepSeek low/max 누락 2개를 먼저 실패로 확인했다. 추가 검토에서
OpenRouter의 토글과 effort 목록을 혼동한 경로도 2개 RED 검사로 교정했다.

검사는 합성 payload를 전송 직전에 포착하거나 HTTP fetch를 대체한다. 공급자 추론,
OAuth 갱신, 벤치마크, 설치·배포는 하지 않는다. 실제 계정별 사용 가능 여부, rate limit,
생성 품질과 청구액은 검증 범위가 아니다. 특히 OpenRouter의 모델 존재를 근거로
ChatGPT/Codex 계정에서 같은 모델을 사용할 수 있다고 추론하지 않는다.

```bash
npm run models:refresh
# packages/ai에서: 공급자 추론 없이 표적 검사
node ../../node_modules/vitest/dist/cli.js --run test/latest-model-thinking.test.ts test/catalog-thinking.test.ts test/latest-thinking-payload.test.ts --maxWorkers=1 --no-file-parallelism
# 저장소 루트에서
node_modules/.bin/tsgo --noEmit --pretty false
npm run check
```

### 현재 검사 결과와 커밋 체크포인트

- 표적 검사 **251개 통과**, 유료 Bedrock E2E 1개 제외. 동일 검사의 재실행은 합산하지 않았다.
- 전체 `tsgo --noEmit --pretty false`, 표적 Biome, 주 LSP 11파일, import-cycle 검사,
  `git diff --check`는 통과했다. 원래 대형 어댑터의 thinking 책임을 작은 모듈로 분리해
  이번 변경으로 module-size baseline을 늘리지 않았다.
- `npm run check`는 기존 범위 밖 Biome 오류3건에서 중단했다:
  `packages/ai/src/utils/oauth/meta.ts`, `packages/coding-agent/test/mcp/tools.test.ts`,
  `packages/coding-agent/test/session-termination.test.ts`.
  별도 module-size 검사의 기존 초과6건과 미추적 문서 링크 문제도 남아 있다.
  전체 저장소 PASS라고 표현하지 않는다.
- 카탈로그/생성기 단위: `packages/ai/scripts/{generate-models,generate-image-models,catalog-thinking,catalog-pricing}.ts`, 생성 카탈로그2개,
  catalog/level 회귀와 본 문서. 제안 메시지: `feat: 최신 모델 목록과 route별 thinking 메타데이터 반영`.
- 어댑터 단위: `packages/ai/src/providers/{google,google-vertex,google-thinking-disable,amazon-bedrock,bedrock-thinking,openai-completions}.ts`,
  payload 회귀와 직접 사용 문서. 제안 메시지: `fix: 신규 모델 thinking 토글과 effort 전송 정합성 교정`.
- 사용자 로컬 설정 변경은 저장소 커밋에 포함하지 않는다. 인증·주소·ID·기본 모델을
  보존한 원본 백업과 별도 의미 비교로 검증한다. build/install·stage/commit·push는 하지 않았다.

근거 문서:
[OpenAI Astra](https://developers.openai.com/api/docs/models/gpt-6-astra),
[Claude Opus 5](https://platform.claude.com/docs/en/models/opus-5/whats-new-opus-5),
[Gemini thinking](https://ai.google.dev/gemini-api/docs/generate-content/thinking),
[DeepSeek thinking](https://api-docs.deepseek.com/guides/thinking_mode),
[Model Studio DeepSeek](https://www.alibabacloud.com/help/en/model-studio/deepseek-api).
