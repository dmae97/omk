# 모델 목록·thinking 갱신 기록

확인일: 2026-09-22. 생성기와 공급자 어댑터를 수정한 뒤 `npm run models:refresh`로
두 카탈로그를 재생성했다. 생성 파일을 손으로 수정하지 않았다.

## 2026-09-22 갱신: Grok 4.7·MiMo v2.6과 reasoning/context 대조

`npm run models:refresh`를 종료 0으로 재생성했다. 전 소스가 응답했고 `--allow-partial`은 쓰지 않았다.
키 없는 Zyloo는 정적 6개를 유지했다. 이미지 카탈로그는 변화 없다.

| 항목 | 값 |
| --- | --- |
| 공급자 / 모델 | 40 / 1,826 → 1,847 |
| 추가 | 32 |
| 제거 | 11 |
| context 또는 maxTokens 변경 | 15 |
| thinking 맵 변경(기존 id) | 0 |

### 공식 원천과 대조

AdaptOrch `TopologyRouter`는 이 검증 DAG을 `hybrid`로 권고했다(width 2 exact, critical depth 4,
coupling density 0.66). 이는 실행 순서가 아니라 권고이다. 실제 검증은 공개 문서·공개 카탈로그 숫자와
생성 결과의 대조이며, 공급자 추론 호출은 하지 않았다.

| 모델 | 문서 context | 문서 effort | 카탈로그 |
| --- | --- | --- | --- |
| `grok-4.7` | 500,000 | `low/medium/high/xhigh`, 기본 `high`, 끄기 불가 | `xai` context 500,000, maxTokens 500,000. 네이티브는 `applyGrokThinking`이 `xhigh`까지 노출하고 `max/ultra`는 `xhigh` 별칭 |
| `grok-4.6` | 500,000 | 같은 사다리 | 변경 없음 |
| `grok-4.5` | 500,000 | `low/medium/high` (`xhigh` 없음) | `xhigh` 미노출 유지. 새 floor가 4.20 스냅샷에는 적용되지 않음 |
| MiMo v2.6 Pro/Flash | OpenRouter context 1,048,576, max completion 131,072 | route가 effort 목록을 선언하지 않음 | 선언 없는 사다리를 지어내지 않음. `reasoning: true`, map 없음 |
| GPT-5.6 계열 | OpenAI 문서 1.05M | `none/low/medium/high/xhigh/max` | 기존 생성기가 1,000,000으로 고정. 라이브 90개 모두 1,000,000 |

근거: [Grok 4.7](https://docs.x.ai/developers/models/grok-4.7),
[xAI reasoning](https://docs.x.ai/developers/model-capabilities/text/reasoning),
[OpenRouter models](https://openrouter.ai/api/v1/models),
[models.dev](https://models.dev/api.json).

### 생성기 보정

models.dev가 `grok-4.7`의 `reasoning_options`에 `xhigh`를 선언한다. 카탈로그 지연 시
`/thinking xhigh`가 `high`로 좁히지 않도록, xAI 문서의 "4.6 이후" 규칙을
`isDocumentedGrokXhighModel`로 두었다. `grok-4.20-*` 날짜 스냅샷은 이 사다리가 아니다.

### 추가·제거

추가는 `xai`·`openrouter`·`vercel-ai-gateway`·`github-copilot`·`opencode-go`의 `grok-4.7`,
Xiaomi 직접·토큰 플랜 3곳·OpenRouter·Vercel·OpenCode Go의 MiMo v2.6 Flash/Pro(와 Pro UltraSpeed),
OpenRouter `nex-agi/nex-n2.5-pro`·`mistralai/mistral-small-3.1-24b-instruct`,
Vercel `mixedbread/toast-1`·`quiverai/arrow-2`·`arrow-2-telos`, Hugging Face `tencent/Hy4-preview`다.

제거는 갱신 소스에서 더 이상 선정되지 않은 항목이다. NVIDIA `deepseek-v4-flash-0731`,
OpenCode `mimo-v2.5-free`, OpenRouter `anthropic/claude-opus-4`와 batch 별칭 7개,
`kwaipilot/kat-coder-pro-v2`가 해당한다. 공급자 폐기 공지나 모든 계정의 사용 불가는 아니다.

OpenRouter가 선언한 context·출력 상한 변경 15건은 목록 값을 그대로 반영했다.
예를 들면 `anthropic/claude-sonnet-4` context는 1,000,000에서 200,000으로, Aion 2.0/3.0 context는
131,072에서 1,048,576으로 바뀌었다. 이 숫자는 route 선언이지 공급자 원문 보증은 아니다.

### 검증과 한계

표적 vitest 12파일 151개 통과. `generate-models.ts` LSP diagnostics 없음.
공급자 추론, 전체 `npm run check`, build/install, commit/push는 실행하지 않았다.
계정별 사용 가능 여부와 실제 청구액은 검증 범위 밖이다.

## 2026-09-19 갱신: 라이브 재생성과 생성기 결함 3건 교정

`npm run models:refresh`를 종료0으로 재생성했다(전 소스 응답, `--allow-partial` 미사용,
키 없는 Zyloo는 정적 6개 유지). 결과는 **39 providers, 1,795→1,799 모델**, 추가 4·제거 0·
변경 22(가격 20, OpenRouter 선언 thinking 2), 이미지 카탈로그 54개 변화 없음.

첫 재생성에서는 제거 4·변경 220이 나왔고, 그중 상류 변화가 아닌 항목이 셋이었다.
각각 실패하는 검사를 먼저 쓰고(11개 RED) 생성기를 고친 뒤 다시 생성했다.

| 결함 | 원인 | 조치 |
| --- | --- | --- |
| `kimi-coding` 공급자 4개 전부 소실 | models.dev가 `kimi-for-coding` 키를 `kimi-code-plan-global`(api.kimi.ai)·`kimi-code-plan-cn`(api.kimi.com)으로 분리. 생성기는 옛 키만 읽어 조용히 빈 결과 | 세 키를 순서대로 조회. OMK endpoint(`api.kimi.com/coding`)·헤더·thinking 맵은 그대로. `kimi-coding-catalog.test.ts` |
| cursor 143·devin 55개 고정-노력 레인에 `xhigh/max` 추가 | 직전 커밋은 `--cursor-only`로 가족 단위 pass를 우회했지만 전체 재생성은 `applyModelMetadata`(Fable→xhigh/max, Opus 5→전체 사다리 등)를 정적 레인에도 적용 | devin/cursor 항목을 pass 이후에 붙여 fast path와 동일하게 유지. `fixed-effort-lanes.test.ts`가 정적 카탈로그와 생성 결과의 동일성을 검사 |
| OpenCode Zen `deepseek-v4.1-flash`가 구형 V4 맵(`high`, `xhigh→max`)만 받음 | V4.1 계약 보정 조건이 `opencode-go`만 인식 | [Zen 문서](https://opencode.ai/docs/zen/)가 같은 `chat/completions` gateway를 명시하므로 `opencode`도 `off/low/high/max`·`max_tokens`·`supportsReasoningEffort` 적용. `deepseek-v41-native.test.ts` route에 추가 |

두 번째 결함은 cursor/devin 항목이 정적 카탈로그와 다르게 저장될 때 즉시 실패하므로,
앞으로 fast path와 전체 재생성이 갈라지면 검사에서 드러난다.

### 추가된 항목

| 공급자 | 요청 ID | thinking | 가격(1M) | 근거 |
| --- | --- | --- | --- | --- |
| `opencode` | `deepseek-v4.1-flash` | `off/low/high/max`, `thinking.type`+`reasoning_effort`, `max_tokens` | $0.30/$1.20, cache $0.006 | Zen 문서 endpoint·가격표 |
| `opencode` | `qwen3.8-flash` | Messages 예산 경로(기존 Zen Qwen과 동일) | $0.15/$0.47, cache read $0.016·write $0.20 | Zen 문서 |
| `openrouter` | `z-ai/glm-5.3-flashx` | mandatory, `low/high/max` (route 선언) | $0.37/$1.25, cache $0.075 | OpenRouter `created` 09-18 |
| `openrouter` | `prism-ml/ternary-bonsai-2-27b` | optional off, `medium/xhigh` (route 선언) | $0.075/$0.50 | OpenRouter `created` 09-18 |

### 상류 변경(가격·선언)

- OpenCode Zen·Vercel의 `gpt-5.6-sol`은 "50% Off" 표시가 끝나 $4/$20(cache $0.40/$5)로 복귀. Vercel `gpt-5.6-sol-fast`는 $8/$40.
- OpenRouter DeepSeek 계열 인하: `deepseek-v4.1-flash` $0.15/$0.60, `deepseek-v4-pro` $0.54/$1.09, `-latest` 별칭 3개 동반 조정.
  목록 값이며 DeepSeek 직접 API의 시간대별 가격과 다르다.
- OpenRouter `moonshotai/kimi-k3`·`~moonshotai/kimi-latest` $1.70/$8.50, `z-ai/glm-5.3` $0.91/$2.86, `meta/muse-glimmer-30b` $0.35/$1.50, Nemotron 3 Ultra·3.5 Lightning 출력 상한 상향.
- `upstage/solar-pro-3`(`off/minimal~high`)·`solar-pro4`(`off/minimal~max`)가 route 선언을 얻어 thinking 맵이 생겼다.

### 조사했으나 넣지 않은 항목

- **Amazon Bedrock Kimi K3** (09-18 GA). [모델 카드](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-moonshot-ai-kimi-k3.html)
  기준 ID `global.moonshotai.kimi-k3`(Global $3/$15, cache read $0.30·write $3.75) ·
  `us.moonshotai.kimi-k3`(US $3.30/$16.50), in-region 없음, 1M context, 이미지 입력, Converse·도구·스트리밍 지원.
  같은 카드가 "Converse는 이전 턴의 reasoning content가 포함되면 `InternalServerException`"을 명시하는데,
  OMK `amazon-bedrock`은 non-Claude 모델의 thinking을 `reasoningContent`로 그대로 replay한다(`convertMessages`).
  카탈로그만 넣으면 두 번째 턴부터 실패하는 경로를 광고하므로, 공급자에서 이전 턴 reasoning을 제거하는
  수정과 유료 실검증을 묶은 후속 단위로 미룬다. models.dev bedrock 목록에도 아직 없다.
- **Qwen3.8-Omni-Flash** (Alibaba, 09-18): OpenRouter·Vercel·models.dev의 tool 지원 목록에 없다. Model Studio 직접 경로는 OMK 내장 공급자가 아니다.
- **Gemini 3.8 Live / Live Extended Thinking** (09-15~16): 오디오 네이티브 경로로 코딩 카탈로그 소스에 없다.
- **GPT-6 Astra Law** (`gpt-6-astra-law`): OpenAI가 "coming soon"으로만 공지, API 미제공.
- **Union Alpha**: `stealth/union-alpha`는 09-18 갱신에서 이미 빠졌고, 정식 `unbiased/pareto`($2.50/$7.50, cache $0.25, thinking 미선언)가 HEAD에 있다. 이번 갱신에서 변화 없음.

### 검증과 한계

표적 vitest 13파일 **149개 통과**(신규 `fixed-effort-lanes`·`kimi-coding-catalog`, 확장한
`deepseek-v41-native` 포함), 전체 `tsgo --noEmit`, 변경 파일 Biome, module-size·import-cycles
 baseline, `git diff --check` 모두 종료0. 공급자 추론, 전체 `npm run check`, build/install,
commit/push는 실행하지 않았다. 계정별 사용 가능 여부와 실제 청구액은 검증 범위 밖이다.

변경 단위: `packages/ai/scripts/{generate-models,catalog-thinking}.ts`, 생성 카탈로그, 검사 3파일, 본 문서.
제안 메시지: `fix(ai): 모델 카탈로그 09-19 갱신과 생성기 결함 교정 (kimi-coding 소실·고정 레인 확장·Zen V4.1 계약)`.

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

## 2026-09-23 대조: MiMo V2.6 커버리지와 xhigh

카탈로그를 다시 생성하지 않았다. 2026-09-22 갱신이 넣은 V2.6 항목을 라이브 소스와
대조하고, 빠지면 실패하는 검사를 추가했다. 공급자 추론 호출은 하지 않았다.

### 커버리지

`mimo-v2.6-pro`와 `mimo-v2.6-flash`를 올리는 현재 OMK 공급자는 모두 이미 갖고 있다.

| 공급자 | 상류 | 카탈로그 |
| `xiaomi`, 토큰 플랜 cn/ams/sgp | models.dev `xiaomi`가 Flash/Pro/Pro UltraSpeed | 네 곳 모두 세 모델. 토큰 플랜은 `xiaomi` 목록을 미러 |
| `openrouter` | 라이브 `/api/v1/models`의 `xiaomi/mimo-v2.6-*` 3개 | 그대로 |
| `vercel-ai-gateway` | 라이브 `ai-gateway.vercel.sh/v1/models` 3개 | 그대로 |
| `opencode-go` | Flash/Pro. UltraSpeed 없음 | Flash/Pro |
| `opencode` | Zen은 `mimo-v2.6-flash-free`만, context 200,000 | 그대로. 유료 Pro/Flash는 Zen 목록에 없음 |
| `huggingface` | 라우터는 V2.5/V2.5-Pro만 | V2.6 없음이 맞음 |

OMK에 없는 게이트웨이(nano-gpt, Kilo, CrossModel, EmpirioLabs, LLM Gateway, DevPass)는
이번 범위가 아니다.

### xhigh는 없다

MiMo V2.6은 xhigh를 지원하지 않는다. 상류가 선언하지 않은 사다리를 만들지 않았다.

- Xiaomi Chat Completions는 `thinking.type`의 `enabled`/`disabled`만 받는다.
  [openai-api](https://mimo.mi.com/docs/en-US/api/chat/openai-api), 2026-09-22 갱신.
- Responses 호환 `reasoning.effort`는 `none`/`low`/`medium`/`high`다. `none`만 끄고
  나머지는 동작이 같다. 문서 원문: "The reasoning intensity is not differentiated at this stage."
  [responses](https://mimo.mi.com/docs/en-US/api/chat/responses)
- models.dev의 `xiaomi`, 토큰 플랜 3곳, `openrouter`는 `reasoning_options: [{type: "toggle"}]`다.
  OpenRouter 라이브도 `supported_reasoning_parameters: null`이다.
- 라이브 Vercel 게이트웨이는 `xiaomi/mimo-v2.6-*`에 `none`/`minimal`/`low`/`medium`/`high`만
  선언한다. models.dev `vercel` 항목의 `xhigh`/`max`는 이 조회와 맞지 않아 따르지 않았다.

xhigh가 보이는 곳은 V2.5 라우트(Hugging Face, 일부 애그리게이터)이거나 MiMo Code 문서의
OpenAI 변형 목록이다. V2.6 계약이 아니다.

### 검증

`packages/ai/test/mimo-v26-catalog.test.ts` 46개 통과(종료 0). 21개 항목이 존재하고
`xhigh`/`max`/`ultra`를 노출하지 않는지, Xiaomi 4곳은 `thinkingFormat: "deepseek"` 토글인지
고정한다. 공급자 추론, `npm run check`, build/install, commit은 하지 않았다.

## 2026-09-23 갱신: Claude Opus 5.5와 GPT-6 Sol

AdaptOrch `TopologyRouter`는 증거, 생성, 검사를 `sequential`로 권고했다(width 1, critical depth 3).
실행 순서가 아니라 권고이다. `npm run generate-models`는 전 소스가 응답해 종료 0으로 끝났다.
공급자 추론은 하지 않았다.

| 모델 | 공식 원천 | 카탈로그 |
| Claude Opus 5.5 | `claude-opus-5-5`, context 1,000,000, output 128,000, effort `low/medium/high/xhigh/max`, thinking 끄기 불가 | `anthropic`, Bedrock 6개 지역 식별자, OpenRouter `anthropic/claude-opus-5.5`, Vercel `anthropic/claude-opus-5.5` |
| GPT-6 Sol | OpenAI 모델 색인에 없음. OpenRouter는 `none`부터 `max`, Vercel 라이브는 `high`까지 | OpenRouter `openai/gpt-6-sol`, `openai/gpt-6-sol-pro`와 batch. Vercel `openai/gpt-6-sol`. `openai` 공급자에는 넣지 않음 |

Vertex의 `claude-opus-5-5@default`는 OMK `google-vertex`가 쓰는 Gemini API가 아니므로 넣지 않았다.
기존 문서는 Opus 4.7/4.8과 Fable만 `xhigh`와 `max`를 갖는다고 적었지만, Opus 5.5 공식 문서가 같은 사다리를 선언한다.

검사: `packages/ai/test/opus55-gpt6sol-catalog.test.ts` 15개, `catalog-thinking.test.ts` 23개,
`mimo-v26-catalog.test.ts` 46개 통과. `catalog-thinking.ts`와 `bedrock-thinking.ts` 주 LSP는 오류 없다.
`npm run check`, build/install, commit은 하지 않았다.

근거: [Opus 5.5](https://platform.claude.com/docs/en/models/opus-5-5/overview),
[models.dev](https://models.dev/api.json), [OpenRouter models](https://openrouter.ai/api/v1/models),
[Vercel AI Gateway models](https://ai-gateway.vercel.sh/v1/models).

### 2026-09-23 후속 검증: 라이브 대조, 상류 드리프트, stale 검사 정리

AdaptOrch `TopologyRouter`는 증거/검사/보고 3노드를 `parallel`로 권고했다
(추가 비용 없음, 권고일 뿐 실행 순서 아님). 재생성으로 `npm run generate-models`
종료 0, 1,876개 route.

- **라이브 대조 일치**: OpenRouter(`openai/gpt-6-sol` 4종, effort `none`~`max`), Vercel
  (`openai/gpt-6-sol`은 `none/low/medium/high`만 선언 — `anthropic-messages` 예산 경로라
  thinkingLevelMap 생략이 일치), Anthropic 문서(1M context, 128K output, adaptive
  thinking 상시, effort 5단계) 모두 카탈로그 값과 일치했다.
- **상류 드리프트 반영**: 이전 단락의 "OpenAI 모델 색인에 없음"은 stale해졌다.
  models.dev가 `openai`/`azure`/`opencode`의 Responses route에 `gpt-6-sol`과
  `gpt-6-luna`를 새로 올렸고 네 소스 모두 effort `none`~`max`를 선언한다.
  `catalog-thinking.ts`에 `GPT6_SOL_LUNA_ID` 규칙을 추가해 해당 route에
  `off:"none"`/`minimal:null`/`low`~`max` 맵을 입혔다(Vercel은 anthropic-messages
  예산 경로, openai-codex는 별도 천장이라 제외). OpenCode의 `claude-opus-5-5`와
  OpenRouter의 `qwen/qwen3.8-omni-flash`(effort 미선언, 일반 Qwen 규칙 적용)도
  상류 신규 등재로 들어왔다.
- **stale 검사 정리**: `thinking-max-level.test.ts`가 기대하던 `z-ai/glm-5.2:batch`는
  OpenRouter 라이브 목록에서 제거됐고(현재 `z-ai/glm-5.2`, `z-ai/glm-5.2:free`만 존재),
  재생성 카탈로그는 정확하므로 검사 대상에서 빼고 주석을 남겼다.
- **정규식 대칭 보정**: `OPUS_55_ID`의 점 철자(`claude-opus-5.5`) 대안부가 `^|/`만
  허용하던 것을 `^|[./]`로 맞췄다. 오늘 카탈로그에는 해당 형태가 없어 동작 변화는 없다.
- **회귀 가드 추가**: `opus55-gpt6sol-catalog.test.ts`에 `claude-opus-5` 본체가 여전히
  `off`를 노출하는지, `openai`/`azure`/`opencode`의 `gpt-6-sol`이 선언 사다리를 노출하는지,
  `gpt-6-sol-fast`를 지어내지 않는지 검사를 추가했다(20개로 확장).
- **기존 한계 기록**: `bedrock-thinking.ts`의 `opus-(?:4-[678]|5(?:-5)?)(?:-|$)`는
  `opus-5-6` 같은 미래 ID도 매치한다(기존 `5` 분기와 동일한 관용, 이번 변경의 회귀 아님).
  `grok-thinking.ts` 정적 테이블은 정확-일치 키만 지원해 `grok-4.8+` 변형이 들어오면
  `isDocumentedGrokXhighModel` floor가 xhigh 맵은 입혀도 런타임 compat은 미적용이다.

재검증: 표적 vitest 14파일 204개 중 203 통과·1 skip(유료 Bedrock E2E). 변경 파일 Biome,
`tsgo --noEmit`, `git diff --check` 종료 0. 공급자 추론, `npm run check`, build/install,
commit은 하지 않았다. 계정별 사용 가능 여부와 실제 청구액은 검증 범위 밖이다.
