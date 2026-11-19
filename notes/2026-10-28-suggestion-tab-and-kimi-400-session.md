# 세션 로그 2026-10-28: suggestion 탭 고도화 요청과 kimi sub 400 진단

- 저장소: `/home/dmae97/Project/omk`
- 기준 커밋: `674faa15d0` (`test(tools): 기본 내장 도구 목록에 explore를 반영하라`)
- 설치된 CLI: `omk 1.5.10` (`~/.omk/agent/bin/omk`)
- 작업 성격: 이번 세션은 조사와 진단만 수행했고, suggestion 탭과 kimi 400에 대한 코드 수정은 하지 않았다.

## 1. 요약

이번 세션에 들어온 요청은 세 갈래였다.

1. suggestion 탭을 OMK 사용법에 맞게 고도화
2. `omk`에서 Kimi Code 구독 사용 시 400 오류 해결
3. 현재 리서치 작업에 대한 세션 로그 작성

1과 2는 코드 변경 없이 진단 단계까지만 진행됐다. 3의 산출물이 이 문서다. 진단 과정에서 기존 리서치 자산(`research/kda-kimi-linear`, `research/scripts`, `research/notes`)의 상태를 확인했고, 함께 실행 가능한 검증만 실행했다.

가장 중요한 결론 두 가지다.

- Kimi 400은 현재 자격증명과 두 엔드포인트에서 재현되지 않는다. 즉 자격증명 만료나 엔드포인트 변경이 아니라 요청 형태(model id, thinking/cache 파라미터, OAuth 경로) 또는 일시적 계정 상태일 가능성이 크다.
- suggestion 탭과 구독 사용량 표시는 같은 `SubscriptionUsageReader`를 공유한다. 그래서 "suggestion 탭의 sub 400"과 "Kimi 400"이 같은 실패 경로일 수 있다.

## 2. 수행한 작업

### 2.1 리서치 자산 확인

| 경로 | 내용 | 이번 세션 상태 |
| --- | --- | --- |
| `research/kda-kimi-linear/` | Kimi Delta Attention + MLA + 3:1 하이브리드 구현, 검증 스크립트, 벤치마크 | 파일 확인, Node 테스트만 실행 |
| `research/scripts/` | `outcome_unknown_count.mjs`, `lane_branch_count.mjs`, `skill_autoload_g1g2.mjs` | 파일 확인만 |
| `research/notes/mock-run-5b4cc76945.md` | mock 실행 기록 (증거로 쓰지 않음 명시) | 확인 |
| `research/test/` | fixture 기반 러너 | 실행, 통과 |

### 2.2 실행한 검증

| 명령 | 결과 |
| --- | --- |
| `node research/test/run_tests.mjs` | `all ok`, exit 0 |
| `python3 -c "import torch"` | `ModuleNotFoundError: No module named 'torch'` |
| `curl https://api.kimi.com/coding/v1/usages` (Bearer, `kimi-coding` 키) | HTTP 200, `limits` + `usages` 정상 응답 |
| `curl https://api.kimi.com/coding/v1/messages` (`kimi-for-coding`, 1 token) | HTTP 200 |

Python 쪽 KDA 검증(`test_kda.py`, `test_modules.py`, `test_fla_crosscheck.py`, `train_smoke.py`, `benchmark.py`)은 이 환경에 torch가 없어 실행하지 못했다. README가 주장하는 `~1e-15` 동등성, MQAR 99.1%, FLA 대조 `3.3e-6`, `T^1.11` vs `T^1.72` 수치는 이번 세션에서 재현되지 않은 값이다.

### 2.3 Kimi 400 진단 경로

코드 상 실제 경로는 다음 하나로 좁혀진다.

- `packages/coding-agent/src/core/provider-usage.ts:39` 의 `KIMI_USAGE_URL = "https://api.kimi.com/coding/v1/usages"`
- 같은 파일의 `fetchKimiUsage()` 가 `Authorization: Bearer <credential>` + `User-Agent: KimiCLI/1.5` + `X-Msh-Platform: kimi_cli` 로 호출
- `SOURCES` 에 `kimi-code`(oauthOnly) 와 `kimi-coding`(api key) 두 항목이 같은 `kimi` 소스로 매핑
- `packages/coding-agent/src/modes/interactive/interactive-subscription-usage.ts` 가 status rail 과 suggestion controller 에 하나의 reader 를 공유
- 실패는 `catch { ... "usage unavailable" }` 로 흡수되므로, 사용자가 보는 400 은 이 경로의 상태 코드가 UI 로 새어 나온 것이거나 모델 요청 자체의 400 이다

로컬 인증 상태는 `~/.omk/agent/auth.json` 에서 `kimi-coding` 이 `api_key` 타입으로 설정되어 있음을 확인했다. 값은 이 문서에 기록하지 않는다.

## 3. 핵심 발견과 판단

- ~~Kimi 400은 재현 불가~~ 이 항목은 이후 세션에서 정정됐다. 같은 날 추가 조사에서 400이 재현됐고 원인은 **MCP 도구 이름**이었다. 상세는 `notes/2026-10-28-kimi-400-root-cause-matrix.md` 참고.
- 확정 원인: `/home/dmae97/.omk/mcp.json`의 `21st` MCP 서버가 만드는 `21st__*` 도구 이름이 숫자로 시작해서 Kimi anthropic-messages 엔드포인트가 요청 전체를 400으로 거부한다. 모델(`k3`, `k3.1-pro`)과 thinking 레벨은 무관하다.
- 사용량 엔드포인트와 메시지 엔드포인트 단독 호출은 200이므로 "구독 만료"나 "엔드포인트 폐기" 가설은 지지되지 않는다.
- suggestion 탭과 구독 표시가 같은 reader 를 공유하므로, suggestion 탭 고도화는 사용량 표시 실패를 격리해서 다뤄야 한다. 최근 커밋 `603a6cba8a` ("사용량 소스가 없는 호스트를 오류 대신 빈 상태로 표시") 와 `829bfdd683` (`fix/subscription-usage-empty-host`) 가 이미 같은 문제 계열을 다뤘다.
- 저장소에는 이번 세션과 무관한 미커밋 변경이 있다. `packages/ai/scripts/generate-models.ts`, `packages/ai/src/models.generated.ts`, `packages/ai/test/gpt61-sol-catalog.test.ts`, 그리고 `README.md`/`docs/{context-files,models,pstack}.md`, `init-cli.ts`, `pstack-install.ts`, `context-init.test.ts` 이다. 이번 세션은 이 파일들을 건드리지 않았다.
- 리서치 리포지토리에는 "증거로 쓰지 않음" 표기가 붙은 mock 실행 기록이 있다. 리서치 주장을 인용할 때 mock 결과와 실측 결과를 섞지 않아야 한다.

## 4. 미해결 질문과 위험

1. "sub 400" 의 실제 출처가 사용량 엔드포인트인지 모델 요청인지 확정되지 않았다. 재현 시점의 정확한 model id, thinking 레벨, provider(`kimi-code` vs `kimi-coding`), 오류 본문이 필요하다.
2. `kimi-code` OAuth 자격증명은 이번에 검증하지 않았다. `auth.json` 에 `kimi-code` 항목이 없어 api key 경로만 확인했다.
3. suggestion 탭의 현재 UX 계약(무엇을 언제 제안하는지, 승인/거절 기록 방식)을 코드로 끝까지 읽지 않았다. `next-suggestion-{types,candidate,controller,run}.ts`, `next-suggestion.ts`, `next-suggestion-accept-trace.ts` 가 남은 조사 대상이다.
4. 진단 중 `auth.json` 을 읽었고 토큰이 터미널 출력에 노출됐다. 이 문서에는 값을 남기지 않았지만, 셸 히스토리나 세션 로그에 남았을 수 있다. 필요하면 해당 계정 토큰 회전을 검토해야 한다.
5. Python 리서치 검증은 torch 미설치로 미실행이다. README 수치는 이 환경에서 미검증 상태다.

## 5. 다음 단계

Kimi 400:

1. 사용자가 400 을 본 시점의 정확한 명령, model id, 오류 본문을 확보한다.
2. `omk -p "hi" -m kimi-coding/k3` 와 `-m kimi-coding/k3.1-pro` 를 각각 실행해 model 단위로 분리한다.
3. 동일 요청을 `thinking=high`, `xhigh` 로 나눠 파라미터 조합을 분리한다.
4. `fetchKimiUsage` 의 실패를 `"usage unavailable"` 로 뭉개지 말고 상태 코드를 진단 로그에 남기는지 확인한다.
5. `packages/coding-agent/test/subscription-usage.test.ts` 에 400 응답 케이스를 회귀 테스트로 추가한다. 현재는 정상 파싱과 origin 고정만 검증한다.

suggestion 탭 고도화:

1. `next-suggestion-controller.ts` 부터 읽어 제안 생성, 표시, 수락 추적의 현재 계약을 정리한다.
2. OMK 사용법(`AGENTS.md` 계약, 검증 우선, 최소 변경)에 맞는 제안 규칙을 정의한다. 제안은 실행이 아니라 다음 행동 후보여야 한다.
3. 사용량 표시 실패가 제안 품질을 떨어뜨리지 않도록 빈 상태 경로를 먼저 고정한다.
4. 변경 후 `packages/coding-agent/test` 의 suggestion 관련 테스트와 `lens_diagnostics` 로 확인한다.

## 6. 아티팩트

- 이 문서: `notes/2026-10-28-suggestion-tab-and-kimi-400-session.md`
- 리서치 구현: `research/kda-kimi-linear/README.md`, `kda.py`, `mla.py`, `hybrid.py`, `modules.py`
- 리서치 검증: `research/kda-kimi-linear/test_kda.py`, `test_modules.py`, `test_fla_crosscheck.py`, `train_smoke.py`, `benchmark.py`
- 리서치 계측: `research/scripts/outcome_unknown_count.mjs`, `lane_branch_count.mjs`, `skill_autoload_g1g2.mjs`
- 리서치 fixture 러너: `research/test/run_tests.mjs`
- 진단 대상 코드: `packages/coding-agent/src/core/provider-usage.ts`, `packages/coding-agent/src/modes/interactive/interactive-subscription-usage.ts`

## 7. 외부 출처

- Kimi Linear 논문 (저장소 README 가 근거로 인용, 이번 세션에서 원문 재확인은 안 함): https://arxiv.org/abs/2510.26692
- flash-linear-attention (README 의 외부 대조 대상): https://github.com/fla-org/flash-linear-attention
- Kimi Code 사용량 엔드포인트 (코드 상수, 직접 조회 200 확인): https://api.kimi.com/coding/v1/usages
