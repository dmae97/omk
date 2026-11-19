# 모델 목록·thinking 갱신 기록

확인일: 2026-11-10. 생성 파일은 손으로 수정하지 않고 생성기로 갱신한다.

## 2026-11-10: Claude Fable 5.2와 Anthropic fallback

[공식 Fable 5.2 문서](https://platform.claude.com/docs/en/models/fable-5-2/overview)에
따라 `claude-fable-5-2`를 추가했다. 직접 API의 context는 1,000,000, 출력은 128,000이며,
1M tokens당 input/output/cache-read/5분 cache-write 가격은 $8/$40/$0.20/$10다.
Fable은 adaptive thinking이 항상 켜져 있으므로 `low/medium/high/xhigh/max`만 노출하고
`off`, `minimal`, manual `budget_tokens`와 sampling parameter는 보내지 않는다.

```bash
node packages/ai/scripts/generate-models.ts --fable-only
```

이 명령은 models.dev, OpenRouter와 Vercel의 Fable route만 갱신한다. 다른 모델과 정적
Cursor/Devin lane은 보존한다. 게이트웨이의 가격과 한도는 각 route의 선언이며 직접 API와
같다고 가정하지 않는다. 카탈로그 추가가 계정별 이용 권한이나 데이터 전송 동의는 아니다.
Fable 5.2의 데이터 보존 조건은 공식 문서를 확인하고 비공개 입력 전송 전에 검토한다.

[공식 refusal/fallback 계약](https://platform.claude.com/docs/en/build-with-claude/refusals-and-fallback)에
따라 Fable 5.x, Opus 5/5.5와 Sonnet 5.5의 공식 HTTPS API 요청에
`fallbacks: "default"`와 `server-side-fallback-2026-07-01` beta를 보낸다.
다른 proxy와 Haiku 5.5에는 보내지 않는다. Haiku는 서버 측 fallback을 지원하지 않는다.
권장 fallback이 없는 거부는 그대로 오류다. 성공한 stream은 실제 응답 모델을 기록하고,
등록된 모델이면 그 모델의 카탈로그 가격으로 계산한다. 미등록 모델은 요청 모델의
가격 추정치를 유지하므로 실제 청구액으로 간주하지 않는다. 남은 refusal의
`stop_details.category`는 후속 usage-only event에서도 보존한다.

검증은 전송 전 payload, 합성 SSE와 카탈로그 보존 비교로 수행한다. 유료 공급자 추론,
계정별 권한, 실제 fallback 선택과 청구액은 검증하지 않는다. 로컬 custom model과
인증 설정은 이 변경에 포함하지 않는다.

## 2026-10-30 후속: 기존 자격과 공식 사용 범위 재확인

설정된 환경 변수뿐 아니라 기존 자격 저장소, Muse/OpenCode CLI 저장소와 운영자가 이미
사용하던 API 메모의 공급자별 명시 라벨을 재확인했다. 원문 자격은 출력하거나 저장소에
복사하지 않았다. 메모에서 찾은 Mistral 키는 공식 API에서 HTTP 401이다. 같은 기존
Kimi Coding 키는 Moonshot의 중국/글로벌 공식 API 양쪽에서 HTTP 401이다.
발급/회수 여부를 확인할 수 없으므로 만료라고 단정하지 않는다.

- Windows의 기존 Ollama를 확인한 뒤 WSL의 원래 `127.0.0.1:11434/v1/models`도
  HTTP 200이다. 실제 설치된 Qwen 모델의 짧은 ID와 Hugging Face 전체 ID 두 개를
  확인했고, 이미 있던 짧은 ID는 보존하며 빠진 전체 ID 하나만 추가했다. 모델 파일을
  다운로드하거나 추론을 실행하지 않았다. `/api/show`는 도구, thinking, vision과
  아키텍처 context 262,144를 선언하지만 실행 서버의 할당 context를 보장하지 않는다.
  새 별칭에는 미확인 최대 출력이나 분화된 effort를 이식하지 않았다.
- DeepInfra의 공식 `/v1/openai/models`는 무인증으로 173개를 반환한다. 인증 키가
  없다고 목록 조회 자체도 막혔다고 분류했던 부분을 정정했다. 기존 도구 지원 목록의
  일치 ID 53개 중 context/가격이 달라진 29개를 이 공개 표면에 맞췄다. 공개 목록의
  `max_tokens`가 출력 전용 상한인지는 확인되지 않아 출력/effort 계약은 유지했다.
  공개 목록에 없는 기존 ID도 삭제하지 않았다. 실제 추론에는 별도 API 키가 필요하다.
- Together의 공식 최신 [quickstart](https://docs.together.ai/docs/quickstart)는
  `https://api.together.ai/v1`을 사용한다. 로컬의 옛 `.xyz` 주소를 현재 주소로 정정했다.
  무인증 요청의 401은 주소 도달 확인일 뿐 인증 복구가 아니다.
- Moonshot이 Kimi Coding 전용 키를 재사용하던 참조는 `$MOONSHOT_API_KEY`로,
  존재하지 않는 옛 Model Studio international 키 파일은 `$DASHSCOPE_API_KEY`로 바꿨다.
  새 키를 대신 만들거나 다른 상품/지역 키를 대입하지 않았다.
- Muse CLI의 기존 Meta 키로 목록 8개 조회는 성공했다. 그러나
  [공식 구독 문서](https://dev.meta.ai/docs/muse-code/subscriptions)는 구독 자격을
  Muse Code CLI 전용으로 한정한다. 이전의 "OAuth 만료"만으로 원인을 설명하거나
  `/login meta` 재로그인으로 OMK 구독 사용을 권하는 것은 적절하지 않다.
  구독 토큰을 OMK로 이식/갱신하지 않고, 별도의 일반 API 키를 위한 로컬 `meta-api`
  프로필을 준비했다. 이 프로필은 표준 Muse Spark 3개만 포함하고 Contributor 모델이나
  Muse 전용 헤더를 추가하지 않는다. `$META_API_KEY`는 일반 Model API 키여야 하며
  사용 시 종량제 비용이 발생한다. 기존 OAuth 기록과 기본 선택은 그대로 보존했다.
- CrofAI 운영사의 [현재 공지](https://www.nahcrof.com/)는 서비스 종료와 Polar를 통한
  기존 고객 환불 처리다. API 이전으로 추정하지 않는다. Zyloo API는 공개 DNS에서도
  NXDOMAIN이며 검색에 남은 정상 상태 문구를 실시간 확인으로 취급하지 않는다.
- 로컬 Qwen/Flash Next의 Windows와 WSL 포트 8080/18081은 응답하지 않는다.
  확인한 경로에 재사용 가능한 런처/서버가 없어 모델 설치나 방화벽 변경으로 확대하지 않았다.

사용자가 필요한 서비스를 계속 쓸 때만 공식 콘솔에서 자격을 준비한다. 기존 메모,
인증 저장소, 지정된 환경 파일과 Windows 사용자 환경에서 해당 키를 확보하지 못했다.

| 항목 | 사용자가 필요한 조치 | 로컬 참조 |
| --- | --- | --- |
| Mistral | [Studio](https://console.mistral.ai/home?profile_dialog=api-keys)에서 정상 API 키 확인/재발급 | `MISTRAL_API_KEY` |
| Moonshot | [중국 Kimi API 콘솔](https://platform.kimi.com/console/api-keys)의 직접 API 키 사용, Coding 키와 구분 | `MOONSHOT_API_KEY` |
| Together | [프로젝트 키](https://api.together.ai/settings/projects/~current/api-keys) 준비 | `TOGETHER_API_KEY` |
| Cohere | [대시보드](https://dashboard.cohere.com/api-keys)의 API 키 준비 | `COHERE_API_KEY` |
| Fireworks | [공식 키 페이지](https://app.fireworks.ai/settings/users/api-keys)의 API 키 준비 | `FIREWORKS_API_KEY` |
| Perplexity | [API Console](https://console.perplexity.ai/project/keys)의 키 준비 | `PERPLEXITY_API_KEY` |
| DeepInfra | [대시보드](https://deepinfra.com/dash/api_keys)의 키 준비 | `DEEPINFRA_API_KEY` |
| Model Studio international | [Singapore API 키](https://modelstudio.console.alibabacloud.com/ap-southeast-1/settings/api-key) 준비. 이미 동작하는 token-plan 키와 구분 | `DASHSCOPE_API_KEY` |
| MiMo Coding Plan | [플랜 관리](https://platform.xiaomimimo.com/#/console/plan-manage)의 Singapore 전용 `tp-` 키 확인. 직접 API 키로 대체 불가 | `MIMO_CODING_PLAN_API_KEY` |
| Meta | [Model API](https://dev.meta.ai/)의 일반 종량제 키 준비. Muse 구독은 공식 CLI에서 사용 | `META_API_KEY`, provider `meta-api` |
| 로컬 Qwen/Flash Next | 기존 서버/모델 설치 경로 복구 후 8080/18081 서버 시작. Ollama에 없는 과거 별칭은 원래 모델/Modelfile 필요 | 기존 설정 보존 |
| CrofAI/Zyloo | CrofAI는 필요하면 운영사 환불 확인, Zyloo는 운영사 복구/공식 주소 안내 확인 | API 키 재발급만으로 해결되지 않음 |

키 값은 채팅이나 셸 명령 이력에 넣지 않고 기존 비공개 환경 저장소에 해당 이름으로
저장한다. 구매, 결제 수단 등록, 타 서비스 키 전용, 사용자 로그인은 자동 수행하지 않는다.

설치본의 스키마/읽기 전용 레지스트리, 실제 Ollama HTTP 조회와 CLI 모델 목록 확인은
종료 0이다. 인증 파일 내용과 기본 설정은 백업과 byte 비교로 보존했다. 문서 링크 검사도
종료 0이며 엔진 코드는 이번에 바꾸지 않았다. 이전에 전달된 실패 보고의
`prompt-attempt-accounting.test.ts` 3개도 현재 소스에서 재실행하여 모두 통과했다.
모델 추론, 다운로드, 전체 빌드, 전체 테스트 실행과 현재 세션 재시작은 하지 않았다.
제안 메시지: `docs: 공급자 복구 상태와 공식 자격 사용 범위 정정`.

## 2026-10-29 후속: 실패 공급자 진단과 로컬 목록 보정

앞선 Python 조회의 403만으로 계정 차단을 판단하지 않았다. 실제 Node HTTP 경로에서는
Command Code 94개와 Groq 11개가 HTTP 200이다. 정확한 403 발생 계층은 확정하지 않았다.
존재하지 않는 옛 홈의 인증 파일 참조는 현재 파일로 바꾸고 파일 권한을 0600으로 제한했다.
키 내용과 기본 선택 설정은 보존했다. MiMo 별칭도 같은 공식 서비스의 기존 저장 자격을
참조하도록 보정했다. 인증 조회와 공개 메타데이터 갱신은 구분한다.

| 공급자 | 확인 결과와 처리 |
| --- | --- |
| Command Code | 인증 목록 94개, 현재 8개 추가. `supported_endpoints`에 따라 Messages 전용 모델의 잘못된 Chat Completions 경로 수정. 기존 목록에서만 남은 4개는 미검증 보존 |
| Groq | 인증 11개 중 도구 지원 텍스트 4개를 생성기에 반영. 음성/가드와 도구 미지원 제외. 구형 내장 3개 미선정, 실제 로컬 전용 2개 보존 |
| Kimi Coding | 경로 보정 후 인증 6개. 표시명과 context를 호출 표면과 대조. output/effort는 기존 호환 계약과 구분 |
| Nous | 경로 보정 후 인증 383개, 텍스트/도구 349개 반영. 기존 미검증 2개 보존 |
| Model Studio token plan | 경로 보정 후 인증 20개, 같은 endpoint의 보조 메타데이터와 대조한 텍스트/도구 12개 반영. 이미지/음성/비디오와 미확인 auto 제외 |
| Xiaomi/MiMo | 저장된 직접 API 자격으로 인증 7개, 텍스트 3개 확인. 이 자격으로 별도 coding-plan 권한까지 추정하지 않음 |
| Moonshot | 옛 경로는 수정했으나 해당 기존 키는 HTTP 401. Kimi Coding 키가 별도 Moonshot API 자격을 보장하지 않음 |
| Together, Mistral, Cohere, Fireworks, Perplexity, DeepInfra | 설정된 키가 환경/자격 저장소에 없음. 공개 models.dev와 공식 모델 문서를 대조하고 지원 메타데이터 갱신. 인증 검증 아님 |
| Model Studio international | 참조한 키 파일 자체가 없음. 같은 공식 endpoint의 공개 메타데이터만 갱신 |
| Meta | 저장 OAuth 만료, 별도 참조 키 파일 없음. 자격을 바꾸거나 갱신하지 않고 목록 보존 |
| Zyloo | 로컬과 공개 DNS 모두 API 호스트 NXDOMAIN. 정적 6개 보존, 최신 인증 확인 아님 |
| CrofAI | 기존 API가 다른 도메인으로 302, 이전 문서가 가리킨 API/문서는 404. 키를 새 호스트에 전송하지 않고 기존 목록 보존 |
| 로컬 Ollama, Qwen, Flash Next | 설정 포트 3개 모두 리스너 없음. 서버를 임의 기동하거나 모델 삭제하지 않음 |
| Cursor, Devin, WorkBuddy | 기존 정적 계약 보존. 이번 후속 작업에서 별도 인증 목록을 새로 확보하지 않음 |

Groq 생성기는 `GROQ_API_KEY`가 있으면 공식 `/openai/v1/models`의 호출 집합, 도구 지원,
modality, 가격과 한도를 우선한다. 키가 없으면 기존 보조 카탈로그를 사용한다.
HTTP 실패, 중복 ID, 빈/불완전 목록, 잘못된 한도나 가격은 저장 전에 실패한다.
인증 헤더가 다른 호스트로 이동하지 않도록 redirect는 거부한다.

후속 `npm run models:refresh`는 `--allow-partial` 없이 종료 0, 41개 공급자 2,235개 route,
이미지 63개다. Zyloo는 키 없이 정적 항목을 보존했으므로 모든 공급자의 인증 조회 성공을
뜻하지 않는다. 로컬 덮어쓰기는 34개 공급자, 1,445 → 1,865개 route다. 수치는 기반 모델
중복을 포함한다. 기존 custom-only 항목과 실패 공급자 목록은 보존했다.

Command Code의 새 행에 없는 출력 상한은 임의로 이식하지 않고 OMK 기본값을 사용한다.
새 행의 가격은 [공식 요금표](https://commandcode.ai/docs/resources/pricing-limits)를 확인했다.
Nous가 출력 상한을 선언하지 않은 행도 OMK 기본값을 사용한다. Model Studio 한도는
공개 보조 메타데이터이며 계정별 최대 출력 실행으로 확인한 값이 아니다. 목록 조회가
실제 추론, entitlement, 요금, 데이터 정책 동의의 검증을 대신하지 않는다.

개발 checkout과 설치본의 `npm run check`는 모두 종료 0이다. 표적 카탈로그/payload
254개, 생성기 guard 5개, 설치 레지스트리/resolver 115개와 설치 Groq/payload 46개가
통과했다. 중복 실행을 합산한 전체 테스트 수로 표현하지 않는다. 격리 컴파일 후 생성
카탈로그의 JS/declaration/map만 설치했고 어댑터 전체를 교체하지 않았다. 설치 레지스트리
새 프로세스는 3,132개 route를 읽었고, 실제 CLI `--list-models qwen3.8-27b`에서도
Groq의 현재 ID를 확인했다. 주 LSP 4파일과 세션 오류 진단은 차단 오류 없음이다.

인증 파일 내용, 기본 선택 설정과 참조한 키 내용은 백업과 byte 비교로 보존을 확인했다.
보존 목록, 인증 참조와 API별 경로를 직접 검토했다. 공급자 추론, OAuth 갱신, commit/push,
현재 세션 재시작은 하지 않았다. 제안 메시지: `fix(ai): Groq 인증 목록 우선과 공급자 조회 실패 진단`.

## 2026-10-29 전체 갱신과 Experiential Labs 호출 표면 대조

`npm run models:refresh`를 `--allow-partial` 없이 실행했다. 생성기 범위는
41개 공급자, 텍스트/도구 route 2,259 → 2,238개다. 추가 29개, 미선정 50개,
기존 항목 변경 151개이며 서로 다른 기반 모델 수가 아니다. OpenRouter 이미지 목록은
63개로 변화 없다. 현재 API 목록에서 빠졌다는 사실은 모든 계정의 사용 불가나
공식 폐기 공지를 뜻하지 않는다.

조회한 원천은 models.dev, NVIDIA NIM, OpenRouter, Vercel AI Gateway,
OpenCode Go, Experiential Labs의 공개 목록과 인증된 `/v1/models`다.
Experiential은 공개 957개와 호출 표면 314개를 대조해 도구 지원, 텍스트 출력,
활성 라우트를 만족하는 221개를 선정했다. 호출 표면의 `supports_tools: false`는
공개 설명보다 우선하고, `true`이면 오래된 공개 `supported_params` 누락 때문에
제외하지 않는다. 호출 표면의 context/output 상한도 상류 모델 설명보다 우선한다.
빈 중간 페이지나 잘못된 total은 실패하며 불완전한 목록을 쓰지 않는다.

OpenRouter와 Vercel의 현재 자체 API에 등재된 Mercury 3 등 5개 route의 이전
보류를 해제했다. 게이트웨이 가격/context/output을 10월 20일 스냅샷으로 되돌리던
규칙은 제거했다. 공급자 원본 모델의 한도와 게이트웨이 route의 선언은 구분하며,
GPT-4.1 nano의 문서화된 출력 상한과 기존 전송/effort 호환성 보호는 유지했다.
OpenCode Go는 라이브 28개와 명시적으로 보존한 `space-bunny` 1개를 포함한다.

### 최신 확인이 아닌 보존 항목

- Zyloo 인증 조회는 DNS 해석 실패다. 최종 생성은 키 없이 기존 정적 6개를 보존했다.
- Cursor, Devin, WorkBuddy 및 기타 정적 항목은 생성기에 기록된 계약을 유지했다.
  오늘 새로 실시간 목록을 검증했다는 뜻이 아니다.
- `catalog-pins.ts`에 남은 호환 ID, 미확인 직접 공급자 항목과 effort 보호는 유지했다.
- 계정별 entitlement, 모델 추론, 실제 청구와 최대 출력 실행은 검사하지 않았다.
  목록의 가격 0은 미가격값일 수 있으며 무료 보장이 아니다.

로컬 `models.json`은 별도 백업 후 동일 ID의 오래된 덮어쓰기도 함께 동기화한다.
인증 참조, 공급자 endpoint, 기본 선택 모델, 로컬 전용 모델은 보존한다.
조회가 거부되거나 자격을 확인할 수 없는 별도 공급자는 그 상태를 기록하고
목록을 추정해 삭제하지 않는다. 설치 카탈로그 반영과 실행 중 세션의 메모리 갱신은
별개이므로 새 프로세스에서 목록을 확인한다.

## 2026-10-18 Experiential Labs

[모델 페이지](https://platform.experientiallabs.ai/models)와
[공개 카탈로그 API](https://api.experientiallabs.ai/api/models), 인증이 필요한
[OpenAI 호환 모델 목록](https://api.experientiallabs.ai/v1/models)을 대조했다. 전체 952개
행 중 텍스트 출력, 도구 지원, 활성·라우팅 가능한 경로, `/v1/models` 호출 가능 조건을
모두 만족하는 235개를 `experientiallabs` 공급자로 추가했다. Reasoning은 공개 라우트의
상류 능력이 아니라 실제로 호출하는 `/v1/models` 표면을 기준으로 한다. 150개 모델이
`thinkingLevelMap`을 가지며, `none`은 `off`로 매핑하고 선언되지 않은 단계는 `null`로
숨겼다. 대표적으로 `glm-5.2`는 공개 라우트가 effort를 광고하지만 게이트웨이가
`reasoning_effort`를 400으로 거부하므로 provider-default로 두고, `gpt-6-sol`과
`gpt-6-luna`는 `/v1/models`가 선언한 `none/low/medium/high/xhigh/max`를 노출한다.

전송 경로는 OpenAI 호환 `https://api.experientiallabs.ai/v1`이고, 키는
`EXPLABS_API_KEY`를 먼저 읽고 없으면 `EXPERIENTIAL_API_KEY`를 읽는다. 이미지 입력은
text/image만 표현하는 OMK 모델 스키마에 맞춰 반영했고, PDF·비디오·오디오 입력,
임베딩·이미지·오디오 출력, 도구 미지원, 라우팅 불가 행은 텍스트 카탈로그에서 제외했다.

## 2026-10-17 OpenCode Go 카탈로그와 추론 제어

[공식 Go 문서](https://opencode.ai/v2/docs/console/go),
[실시간 모델 목록](https://opencode.ai/inference/go/v1/models),
[models.dev](https://models.dev/api.json)를 대조했다. 공식 API의 37개 중 도구 지원과
한도를 확인할 수 있는 36개를 등록한다. `omen-alpha`는 ID만 확인돼 임의 한도나
추론 단계를 만들지 않고 경고와 함께 보류한다.

Go 항목은 32 → 36개다. `beam-free`, `gemini-4-argon-contributor`, `glm-5.1`,
`kimi-k2.6`, `minimax-m2.5`, `qwen3.6-plus`, `qwen3.7-max`, `step-5-preview`를 추가하거나
복원했다. API에서 빠진 `cat-jam-free`, `step-5-preview-free`, `deepseek-v4-flash`,
`deepseek-v4-flash-vision-exp`는 제거했다. Flash는 `deepseek-v4.1-flash`를 사용한다.

models.dev의 deprecated 표기만으로 Go가 여전히 제공하는 ID를 삭제하지 않는다.
보조 목록에서 빠진 6개 legacy 항목은 마지막 Go 사양을 보존하되 실시간 목록에 있을
때만 포함한다. 해당 가격과 한도는 과거 기록이며 현재 요금 보장이 아니다.
MiniMax M2.5는 공개 모델 한도와 미가격값 0을 사용하며, 무료라는 뜻이 아니다.
현재 모델의 기본 가격도 장문과 peak/off-peak 구간 전체를 표현하지 않는다.

### 전송 경로

| API | endpoint |
| --- | --- |
| Chat Completions | `https://opencode.ai/inference/go/openai/v1/chat/completions` |
| Responses | `https://opencode.ai/inference/go/openai/v1/responses` |
| Messages | `https://opencode.ai/inference/go/anthropic/v1/messages` |
| Gemini | `https://opencode.ai/inference/go/google/v1beta/models/<id>:streamGenerateContent` |

모델마다 API가 다르므로 공급자 전체의 baseUrl을 한 주소로 덮어쓰지 않는다.
MiniMax M2.7은 기존 Bearer 인증 호환을 위해 Chat Completions를 유지한다.

### 추론 수준

| 모델 | OMK 제어 |
| --- | --- |
| GLM-5.2 / GLM-5.3와 Flash | `high/max` / `low/high/max` |
| Kimi K3 | `max`, off 없음 |
| Kimi K2.7 Code, MiniMax M2.5/M2.7 | 고정 사고를 high로 표시, effort를 보내지 않음 |
| Kimi K2.6, GLM-5.1, MiMo, LongCat | `off/high`, toggle만 전송 |
| DeepSeek V4.1 Flash / V4 Pro | `off/low/high/max` / `off/high/max` |
| Grok 4.6/4.7 | `low/medium/high/xhigh`, off 없음 |
| GPT-5.6 Luna와 GPT-6 Luna | `off/low/medium/high/xhigh/max`, off는 Responses `none` |
| Muse Spark Contributor | `minimal`부터 `xhigh`, OMK max는 xhigh 별칭, off 없음 |
| Hy3 / Hy4 preview | `off/low/high` / `off/high` |
| Beam Free, Space Bunny | `low/medium/high/xhigh/max`, off 없음 |
| Step 5 Preview, Gemini 4 Argon Contributor | `low/medium/high`, off 없음 |
| Claude Haiku 5.5 | `off/low/medium/high/xhigh/max`, adaptive와 output_config.effort |
| 현재 Qwen Messages와 MiniMax M3 | 예산 기반 off부터 high, 전달할 수 없는 상위 effort 숨김 |

legacy Qwen3.6 Plus와 Qwen3.7 Max는 기존 Chat Completions toggle을 유지한다.
MiMo와 LongCat은 `thinking.type`, legacy Qwen은 `enable_thinking`을 사용한다.
Chat Completions 모델의 사고 내용은 `reasoning_content`로 재전송한다.
Haiku는 [공식 migration](https://platform.claude.com/docs/en/models/haiku-5-5/migration-guide)에
맞춰 거부되는 manual budget 대신 adaptive를 사용하고 temperature를 생략한다.
Argon은 native `thinkingLevel`을 보내며 SDK에서 off를 요청해도 최저 LOW로만 내려간다.
[공식 thinking 문서](https://platform.claude.com/docs/en/build-with-claude/thinking)의 토글과
노력 수준을 서로 다른 제어로 취급한다.

### 세션과 로컬 적용

공개 stream/streamSimple 경로는 sessionId가 있으면 `x-opencode-session`과 OMK user agent를
공식 HTTPS Go 주소에 추가한다. caching을 꺼도 세션 헤더는 유지한다. 사용자 헤더가
우선하며 임의 proxy 주소에는 자동 전송하지 않는다. 직접 adapter 호출은 호출자가
헤더를 제공해야 한다.

Contributor는 데이터 정책이 다르다. Go 문서는 Gemini 4 Argon Contributor와 Muse Spark
Contributor의 입력과 출력을 학습에 사용할 수 있다고 명시한다. 카탈로그 등록이
비공개 코드 전송 동의나 모델 자동 선택을 의미하지 않는다.

워크스페이스 Privacy 설정이 학습 엔드포인트를 막고 있으면 요청은 라우팅 전에 400으로
끊긴다. 실제 오류 원문은 `This Go model trains on request data. Allow paid endpoints that
train on request data in your workspace's Privacy settings to use it.`이며, 같은 게이트가
Muse Spark Contributor에도 적용된다([upstream 보고](https://github.com/anomalyco/opencode/issues/44495)과
동일 계열). 해제는 Console의 해당 워크스페이스 `Settings`의 Privacy 항목에서 학습을
허용해야 하며, URL은 오류가 안내하는 `https://opencode.ai/workspace/<workspace-id>/go`
형식이다. 이는 계정 정책 변경이므로 저장소나 `models.json`으로 우회하지 않고, 켠 뒤에는
비공개 코드를 보내지 않는다. 학습을 피하려면 같은 모델의 일반 등급 경로를 쓴다:
`opencode/gemini-4-argon`(Console pay-as-you-go, 한시 50% 할인), `openrouter/google/gemini-4-argon`,
`google` 직결(GEMINI_API_KEY), `google-vertex`. Go 플랜은 contributor 등급만 제공한다.

Go만 갱신하려면 다음 명령을 사용한다. 다른 공급자와 이미지 목록은 보존한다.

```bash
npm --prefix packages/ai run generate-models -- --opencode-go-only
```

전체 `npm run models:refresh`도 새 Go 경로를 사용한다. 2026-10-17 최종 전체 재생성은
종료 0으로 완료했고 40 providers, 1,932 → 2,041 routes를 기록했다. native
Anthropic Messages/Bedrock/OpenCode/Vercel Claude 5.5 route는 adapter의
adaptive/off/replay 계약이 아직 완전하지 않아 생성기 필터에서 계속 제외했다.
Copilot(OpenAI-compatible), OpenCode Go(Messages+forceAdaptiveThinking), OpenRouter,
Devin route는 각자의 선언을 유지한다. 이미지 카탈로그는 61 → 63개다.
HTTP 실패, 잘못된 메타데이터와 빈 결과는 쓰기 전에 실패한다.
`models.json`의 동일 ID custom model은 내장 항목보다 우선하므로 과거 effort나 compat,
baseUrl도 별도로 확인한다. [모델 설정](models.md)을 참고한다.
현재 프로세스와 별도 설치 엔진은 소스 변경만으로 바뀌지 않는다.

검사는 카탈로그, payload, 네 API의 세션 헤더와 실패 경계를 확인한다. 표적 vitest
466개 통과, 실키 검사 9개 제외, 생성기 guard 5개 통과, 전체 타입 검사와 문서 링크,
module-size, import-cycle 검사는 종료 0이다. 첫 `npm run check`는 다른 작업의 임시
package.json 8개 파싱 오류에서 멈췄고, 그 파일들이 정리된 뒤 재실행한 전체 검사는 종료 0이다.

같은 날 상태 레일 USAGE에 OpenCode Go를 추가했다. Console의 고정 상태 endpoint
`/console/api/go/status`가 돌려주는 세 개의 계획 창(첫 사용 후 5시간 rolling, UTC 주,
유료 기간)을 기존 quota 파이프라인으로 표시한다. 인증은 저장된 OAuth user token이며,
API key만 있는 자격은 검증된 quota endpoint가 없어 호출하지 않는다. 오류/오프라인
때에는 값을 추정하지 않고 `usage unavailable`만 표시한다.

로컬 models.json은 보호 백업 후 Go 항목만 8 → 36개로 정정했다. 실제 설치 엔진에도
같은 Go 변경만 적용해 AI 패키지를 빌드했고, 설치 엔진의 `npm run check`는 종료 0이다.
새 CLI 프로세스에서 구형 ID 없이 정확히 36개가 표시되며, 설치 dist의 대표 추론
payload 5개를 외부 전송 없이 확인했다. 다른 공급자와 이미지 카탈로그는 보존했다.
진행 중인 세션은 메모리에 남은 이전 adapter를 사용하므로 재시작해야 한다.

공급자 추론, 계정별 entitlement, 실제 reasoning 양과 청구액은 검증하지 않았다.

## 2026-10-09 갱신: Mistral Large 4와 OpenCode Zen

[Mistral 공식 모델 카드](https://docs.mistral.ai/models/mistral-large-4-0)는 10월 6일 공개 프리뷰를
발표했다. 요청 ID는 `mistral-large-4`다. `mistral-large-4-0`는 문서에 병기된 이름이며,
그 이름을 쓰는 custom model도 같은 native reasoning 제어를 받는다.

| route | context / output | thinking | 공개 가격, 1M tokens |
| --- | --- | --- | --- |
| `mistral/mistral-large-4` | 1,048,576 / 262,144 | `none`, `high` | input $0.68, output $2.09, cache read $0.07 |
| `opencode/mistral-large-4` | 524,288 / 262,144 | `none`, `high`, Chat Completions | 같은 한시 할인 가격 |
| `opencode/big-pickle` | 200,000 / 32,000, text only | effort 목록 미선언 | 무료 기간의 목록 가격 0 |

Context와 출력 한도는 [models.dev](https://models.dev/api.json)의 해당 route 선언을 대조했다.
Zen endpoint/가격은 [공식 Zen 문서](https://opencode.ai/docs/zen/)와 공개 모델 API를 확인했다.
Mistral 가격은 [공식 가격표](https://docs.mistral.ai/inference/pricing)의 공개 프리뷰 할인 값으로,
영구 가격이나 실제 계정의 청구액이 아니다.

[공식 reasoning 계약](https://docs.mistral.ai/capabilities/reasoning)에 맞춰 native Large 4는
기존 Magistral `prompt_mode` 대신 `reasoning_effort`를 쓴다. `none`은 최소 사고와 trace 생략이며
추론 연산이 완전히 꺼진다는 뜻이 아니다. OMK 선택기는 `off/high`만 표시한다. native off는
기존처럼 제어를 생략해 서버 기본값을 보존하고, Zen off는 `reasoning_effort: none`을 보낸다.
기존 대형 Mistral 모듈의 reasoning 선택 책임만 작은 모듈로 옮겼으며, 크기 baseline은 늘리지 않았다.

Big Pickle은 이미 카탈로그에 있어 그대로 유지했다. Zen은 무료 기간에 수집한 입력을 모델 개선에
사용할 수 있다고 명시하므로 개인 정보나 비공개 코드를 보내지 않는다. 기본 모델과 인증은 변경하지 않는다.

재생성 시 함께 발견된 native Sonnet/Haiku 5.5는 보류했다. 현재 어댑터는 새 adaptive/off/replay
계약을 모두 구현하지 않아 카탈로그만 추가하면 실패하는 경로를 광고한다. 해당 native Messages/Bedrock
route를 생성기에서 제외하며, OpenRouter의 정규화된 별도 전송 계약은 유지한다. 공급자 원문은
[Sonnet 5.5](https://platform.claude.com/docs/en/models/sonnet-5-5/overview)와
[Haiku 5.5](https://platform.claude.com/docs/en/models/haiku-5-5/overview)에서 확인했다.

Together의 undated `DeepSeek-V4-Pro`는 갱신 목록에서 빠졌다. 실제 남은 `DeepSeek-V4-Pro-0813`에
기존 toggle/effort 계약을 적용해 effort 지원이 조용히 사라지지 않도록 했다.
[공식 quickstart](https://docs.together.ai/docs/deepseek-v4-quickstart)는 high/max와 toggle을 선언한다.
이번에는 기존 high만 명시하는 보수적 선택기를 유지한다. 최신 목록에서 미선정된 ID는 폐기 확정이 아니다.

검사는 공급자 추론 없이 요청 전 payload와 카탈로그를 대조한다. 생성 파일은 기존
`npm run models:refresh`로만 갱신한다. 계정별 사용 가능 여부, 실제 추론 품질과 청구액은 미검증이다.

검토한 재생성 결과는 코딩 route 1,905 → 1,932개(40 providers, 추가 43, 미선정 16,
기존 메타데이터 변경 67)다. native Claude 5.5 보류 18개를 포함한 최초 생성 1,950개와 구분한다.
이미지 목록은 57 → 61개(추가 4, 제거 0)이며 실제 이미지 생성은 하지 않았다.

## 2026-09-30 갱신: GPT-6.1 Sol·Codex GPT-6 계열

`npm run models:refresh`를 종료 0으로 재생성했다. 전 소스가 응답했고 `--allow-partial`은 쓰지 않았다.
키 없는 Zyloo는 정적 6개를 유지했다. AdaptOrch `TopologyRouter`는 증거→RED→생성기→재생성→감사→검증·문서
9노드를 `hierarchical`로 권고했다(coupling density 0.65, width 2, critical depth 7). 실행 순서가 아니라
권고이며, 서브에이전트 없이 한 세션에서 순서대로 진행했다. 공급자 추론은 호출하지 않았다.

| 항목 | 값 |
| --- | --- |
| 공급자 / route | 40 / 1,876 → 1,905 (재생성 1,912 중 Sonnet 5.5 7개 보류) |
| 추가 / 제거 | 56 / 27 |
| 가격 / context / maxTokens 변경 | 61 / 38 / 37 |
| thinking 맵 변경(기존 id) | 2 (`~anthropic/claude-sonnet-latest`, `~openai/gpt-sol-latest` 별칭이 새 모델을 가리키며 OpenRouter 선언이 mandatory로 바뀜) |
| 이미지 카탈로그 | 54 → 57 |

재생성은 Claude Sonnet 5.5의 6개 공급자 7개 route(`anthropic`, Bedrock global, Copilot, OpenCode, OpenRouter와 batch,
Vercel)도 냈다. 이 route의 thinking 맵과 compat은 작업 트리에 있던 별도 작업의 미커밋 `SONNET_55_ID` 규칙
(`catalog-thinking.ts`)에서 나왔다. 그 작업의 공급자 수정이 없으면 `reasoning` 없는 Anthropic Messages 요청이
`thinking.type.disabled`를 보내는데, 그 작업은 Sonnet 5.5가 이를 HTTP 400으로 거부한다고 문서를 인용한다.
그래서 이 7개 route는 커밋에서 빼고 Sonnet 5.5 요청 지원과 함께 반영하도록 남겼다. 커밋한 카탈로그는
이 7개를 뺀 재생성 결과와 순서까지 같다.

### GPT-6.1 Sol 공식 계약

[OpenAI 모델 문서](https://developers.openai.com/api/docs/models/gpt-6.1-sol): `gpt-6.1-sol`, 2026-09-29 출시,
context 1,050,000(입력 922,000), 출력 128,000, effort `low/medium/high/xhigh/max`(기본 `medium`).
**`none`과 `minimal`은 지원하지 않는다.** 가격(1M) $2 / $10, cache read $0.10, cache write $2.50.
models.dev의 `openai`·`azure`·`opencode`·`github-copilot`도 같은 사다리를, OpenRouter는 `mandatory: true`로
같은 5단계를 선언한다. GPT-6 Sol(6.0)은 `none`을 지원하므로 기존 `GPT6_SOL_LUNA_ID` 규칙을 넓히지 않고
`catalog-thinking.ts`에 `GPT61_SOL_ID` 규칙을 따로 두었다.

| route | 카탈로그 |
| --- | --- |
| `openai`, `azure-openai-responses`, `opencode`, `github-copilot` | Responses, `off:null`·`minimal:null`·`low`~`max`. context 1,050,000 |
| OpenRouter `openai/gpt-6.1-sol`, `-pro`, 각 `:batch` | 선언 그대로 `low`~`max`, off 없음 |
| Vercel `openai/gpt-6.1-sol`, `-fast` | anthropic-messages 예산 경로라 맵 생략(상위 tier 숨김). GPT-6 Sol과 같은 처리 |

### Codex(ChatGPT) GPT-6 계열과 `ultra`

원천은 Codex 클라이언트 번들 카탈로그다([`codex-rs/models-manager/models.json`](https://github.com/openai/codex/blob/b1e72963c3/codex-rs/models-manager/models.json),
커밋 `b1e72963c3` "Add GPT-6.1 Sol as the default catalog model", 2026-09-29). OMK `openai-codex`에는 그동안
GPT-5.x만 있었고, 이번에 네 모델을 넣었다.

| Codex 모델 | Codex effort | `multi_agent_reasoning_effort` | OMK `ultra` 와이어 |
| --- | --- | --- | --- |
| `gpt-6.1-sol` (priority 1, 기본) | low~max, ultra | `xhigh` | `xhigh` |
| `gpt-6-astra` | low~max, ultra | `xhigh` | `xhigh` |
| `gpt-6-sol` | low~max, ultra | 없음 | `max` |
| `gpt-6-luna` | low~max | 없음 | ultra 미노출 |

Codex는 `ultra`를 와이어로 보내지 않는다. `reasoning_effort_in_request`가 `multi_agent_reasoning_effort`를,
그것이 없거나 지원 목록 밖이면 목록의 최상위 비-ultra 수준을 보낸다([`client_tests.rs`](https://github.com/openai/codex/blob/8c3612fb63/codex-rs/core/src/client_tests.rs)의
`reasoning_effort_for_requests_*`). OMK 맵은 이 값을 그대로 보낸다. Codex 앱의 `ultra`는 "Maximum reasoning
with automatic task delegation", 즉 서브에이전트 자동 위임까지 켜지만 OMK 공급자는 위임을 시작하지 않는다.

context는 872,000으로 두었다. Codex의 기본 `context_window`는 272,000이고 사용자 설정은
`max_context_window`(872,000)로 clamp된다(`model_info.rs`). 272,000 초과분은 OpenAI 장문 가격 구간이다.
`off`는 노출하지 않는다. Codex 어댑터는 off에서 `reasoning`을 생략하므로 백엔드 기본값(`gpt-6.1-sol`은 `low`)이
적용되어 실제로 꺼지지 않는다. 가격은 OpenAI 공개 가격(cache write 포함)이다. ChatGPT 구독 사용량과는 별개다.

### 상류 제거와 stale fixture 정리

제거 27건은 갱신 소스에서 더 이상 선정되지 않은 항목이다. Fireworks는 Kimi K2.6·GLM-5.2·DeepSeek V4 구형 id를,
Together는 Kimi K2.6·K2.7 Code를 목록에서 뺐다. models.dev가 OpenCode Go의 `kimi-k2.6`·`qwen3.6-plus`·
`qwen3.7-max`에 `status: "deprecated"`를 붙여 생성기의 기존 deprecated 제외 규칙이 적용됐다. OpenCode Go
`/v1/models`와 문서는 K2.6을 아직 서빙하므로 이는 폐기 확정이 아니라 카탈로그 선정 제외다.

이 id를 고정한 검사 13건과 실키 검사 fixture 10곳을 현재 항목으로 옮겼다. 요청 형태를 검사하던
OpenCode Go K2.6 payload 검사 4건은 마지막 생성 항목과 같은 로컬 fixture로 대체했다. MiMo V2.6 Pro는
OpenRouter 모델 수준 `context_length`가 1,050,000으로 바뀌었다(top provider는 1,048,576).

기본 모델: Fireworks·Together·OpenCode Go 기본값이 사라진 K2.6을 가리켜 resolver가 첫 항목으로 조용히
대체될 상태였다. Fireworks·Together는 같은 전송 계약의 Kimi K3로, OpenCode Go는 `deepseek-v4.1-flash`로
옮겼다. OpenCode Go의 K3는 models.dev가 effort `max`만 선언하고 K2.7 Code는 선언이 없어, OMK 기본 계약
(`reasoning_effort` 문자열 전송)이 맞는지 검증되지 않았다. K2.6은 문자열 effort를 거부해 전용 규칙이 있었다.

### 넣지 않은 항목

- **Amazon Bedrock Kimi K3** (`global.`/`us.moonshotai.kimi-k3`): models.dev가 새로 올렸지만 제외했다.
  [AWS 모델 카드](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-moonshot-ai-kimi-k3.html)가
  2026-09-30에도 "Converse는 이전 턴 reasoning content가 포함되면 `InternalServerException`"을 명시하고,
  OMK Bedrock 어댑터는 non-Claude reasoning을 replay한다. 09-19 판단을 생성기 규칙과 검사로 고정했다.
- **Bedrock GPT-6.1 Sol**: Codex 소스에 `openai.gpt-6.1-sol` 상수가 있지만 models.dev bedrock 목록에 없다.

### 보정하지 않은 관찰

- `openai`의 `gpt-daybreak-blue-latest`·`gpt-daybreak-red-latest`(Codex에서는 숨김 모델)는 models.dev가
  effort `none~max`를 선언하지만 해당 규칙이 없어 일반 사다리(`off`~`high`)로 생성된다. `minimal`은 선언 밖이다.
- Codex 카탈로그는 GPT-5.6 Sol/Terra/Luna에도 `max`를 두지만 OMK는 GPT-5.6의 `max`·`ultra`를 `xhigh`로 보낸다.
  보수적 하향일 뿐 오류 경로는 아니며, 실계정 확인 없이 바꾸지 않았다. GPT-5.4는 09-24에 Codex 번들
  카탈로그에서 빠졌지만 OMK 항목은 유지했다.
- Codex 기본 모델은 `gpt-5.5` 그대로다. Codex 자체 기본값은 `gpt-6.1-sol`로 바뀌었다.
- `openrouter-images.test.ts`의 abort 검사 실패는 갱신 전 이미지 카탈로그로도 재현되어 이번 변경과 무관하다.

### 검증과 한계

신규 `gpt61-sol-catalog.test.ts` 31개(29개 RED 확인 후 GREEN), Bedrock Kimi K3 보류 검사(RED 후 GREEN),
기본 모델 검사(RED 후 GREEN). `packages/ai` 전체 vitest 925 통과·817 skip·1 실패(위 무관 항목),
coding-agent `model-resolver` 34개 통과. 전체 `tsgo --noEmit` 종료 0, 변경 파일 Biome 21개와 주 LSP 6파일
진단 없음, `git diff --check` 통과. 이상은 Sonnet 5.5 작업이 함께 있던 작업 트리에서 실행했다.
커밋 트리만 꺼낸 별도 worktree에서 전체 `npm run check`와 `packages/ai` vitest를 다시 돌렸다. 공급자 추론과
install은 하지 않았다.
coding-agent 검사는 빌드된 `omk-ai` dist를 읽으므로 새 카탈로그 반영은 빌드 후에 확인된다.
계정별 사용 가능 여부와 실제 청구액은 검증 범위 밖이다.

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
