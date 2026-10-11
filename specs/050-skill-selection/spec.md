---
description: "스킬이 많을 때 system prompt에서 스킬 목록을 빼고, 고정 skill_search 도구 하나와 task·todo 시작 때 대화 끝에 붙는 후보 메시지로 바꾼다 (기본 꺼짐)"
---

# Feature Specification: task·todo별 스킬 선택 (skill_search)

**Specification ID**: `050-skill-selection`
**Feature Branch**: `spec/050-skill-selection` (문서만, origin/main `5090224`에서 분기)
**Created**: 2026-10-11
**Status**: Draft (구현 전. 우선순위는 037보다 앞, Tech Lead 2026-10-11)
**Constitution**: [specs/constitution.md](../constitution.md)
**Input**: 인호 요청 "skills도 1191개 정도 있는데 … task별로 … 적절하고 다용도로 사용". Tech Lead가 방식과 수락 기준을 정했고 OMK가 맡는다.
**Depends on**: spec 042(`appendRunLog`), 049(`TodoKind`, 선택 입력), spec 051 / PR #117(`omk-ai/prompt-hash`의 `systemHash`·`toolsHash`·`messagesPrefixHash`, 캐시 안정성 테스트. 이 글을 쓸 때 열려 있음), 스킬 카탈로그 캐시 수정(별도 작은 PR, 다른 담당. 아래 "의존" 절).

## 지금 코드가 하는 일 (main `5090224`, 경로는 `packages/coding-agent/src/` 기준)

- 찾기: `~/.omk/agent/skills`, `<cwd>/.omk/skills`, `~/.agents/skills`, 상위 `.agents/skills`, settings·`--skill`·확장 경로(`core/package-manager.ts:2345-2455`). 번들 Neo 스킬 6개가 더해진다(`core/bundled-skills.ts:9-31`).
- 읽기: 자동 발견은 스킬마다 `SKILL.md` **파일 경로**를 돌려주고, 시작할 때마다 각 파일을 통째로 읽어 frontmatter를 파싱하고 sha256을 낸다(`core/skills.ts:322-375`). 본문은 버린다.
- system prompt: 모델이 부를 수 있는 스킬 **전부**를 `<available_skills>`에 이름·설명·절대 경로로 넣는다(`core/system-prompt.ts:107-111, 211-215`, `core/skills-prompt.ts:15-46`). 개수 상한은 없다. 24개를 넘으면 설명만 200자로 줄인다(#68, `skills-prompt.ts:48-50`).
- `contextBudget`(기본 꺼짐, `core/settings-manager.ts:785`): 켜면 질의 관련도로 15개만 남긴다. **사용자 프롬프트마다** 다시 골라서, 새 프롬프트가 오면 system prompt 바이트가 바뀐다. 한 task 안(check, verify, fix turn 포함)에서는 system 해시가 하나다(#117 측정). 위치는 `core/context-budget-system-prompt-items.ts:89-111`, `core/agent-session.ts:2625-2630`이다. #117은 이 경우를 `it.fails`로 고정해 두었다.
- xAI(`GROK_OAUTH_PROVIDER = "xai"`)와 Devin harness도 사용자 프롬프트마다 스킬 ≤3개를 다시 골라 system의 `<active_skills>`에 넣는다(`core/agent-session.ts:2611-2623`, `core/system-prompt.ts:270-294`). 그래서 여러 프롬프트로 이어지는 세션에서는 프롬프트가 바뀔 때 xAI의 캐시 prefix가 통째로 깨진다. 번들 Neo 6개는 grok 허용 목록에 없어서, 번들 6개만 있는 TB 실행에서는 고르는 스킬이 없다(spec 051).
- worker: subagent worker는 같은 CLI(`--mode json -p --no-session`, `examples/extensions/subagent/index.ts:338-422`)라 스킬을 전부 다시 읽고 다시 싣는다.
- 이미 있는 순수 BM25: `metacognition/retrieval.ts`의 `searchCorpus`(MIT, I/O 없음, 문서 5,000개 상한).

## 근거 (OMK 측정, 2026-10-11, main `eda87d0`)

원본은 공유 박스의 `/workspace/omk-skill-baseline/BASELINE.md`(저장소 밖)다. 인호의 실제 1,191개는 박스에 없어서, 박스에서 찾은 실제 스킬 247개(설명 중앙값 194자)를 돌려 쓴 **합성 1,191개**로 쟀다. mock provider만 썼다($0). 토큰은 js-tiktoken `o200k_base` 기준이다.

| 조건 | system prompt 토큰 | 그중 스킬 목록 |
| --- | ---: | ---: |
| 기본(번들 6개) | 1,473 | 638 |
| 1,191개(#68 축약 적용) | **106,006** | 105,170 (스킬당 약 88) |
| 1,191개 + `contextBudget` 켬 | 2,605 | 1,414 |

- **128k 모델은 거부된다.** omk 자체 추정치(131k)가 창을 넘어 `-p`가 첫 호출 전에 exit 1로 끝난다(`core/session-input-admission.ts:179`).
- 시작·메모리(`-p` = worker 명령, 20쌍 교차, load1 ≤ 1.96, warm page cache): 첫 요청까지 **+332 ms**(95% CI +292..+366), idle RSS **+23.7 MiB**(+22.0..+24.5). 그중 약 192 ms는 1,191개 파일 읽기다. worker마다 이 비용을 다시 낸다.
- 목록의 약 1/3(홈 경로 기준 32.3k 토큰)은 `<location>` 경로다.

## 결정 (Tech Lead, 2026-10-11)

- **system에는 고정 도구 하나만.** 플래그가 켜져 동작하는 세션에서는 `<available_skills>` 목록을 system에 넣지 않는다. 대신 고정 `skill_search` 도구와 고정 안내 한 줄만 둔다.
- **후보는 대화 끝 메시지로.** task나 todo가 시작될 때 관련 스킬 몇 개(이름, 짧은 설명, 경로)를 대화 끝에 붙인다. 본문은 모델이 실제로 쓸 때 `read`로 읽는다.
- **system과 tools 바이트는 세션 내내 같다**(prompt cache). Staff Engineer의 system·tools 해시 감사 테스트를 그대로 적용한다.
- **선택 v1은 로컬 BM25**(이름 + 설명). 학습형이나 적응형 선택(omk MIT `src/metacognition/`의 `planSkills`, `skill-search-space.ts`)은 A/B에서 BM25를 이긴 뒤에만 붙인다. **Adaptorch 엔진은 독점 라이선스라 근빈의 서면 OK 전에는 호출하지 않는다**(038과 같은 관문).
- **시작할 때 인덱스를 만들지 않는다.** 첫 검색 때 만들고 디스크에 캐시한다. 플래그가 꺼지면 시작 시간과 RSS 변화는 0이다(Perf 기준 +10 ms, +5 MiB 이내). Perf Engineer가 확인한다.
- **`contextBudget`**: 050이 들어가면 그 스킬 처리를 대화 끝 메시지 방식으로 바꾸거나 없앤다. 그때까지는 기본 꺼짐 그대로다.
- **xAI/Devin harness 스킬도 대화 끝 메시지로 옮긴다**(Tech Lead, 2026-10-11). 이 범위에 넣는다.
- **실제 스킬 디렉터리는 공동 A/B가 끝날 때까지 건드리지 않는다.** 측정은 복사본이나 합성 세트로만 한다.
- **우선순위**: 050이 037보다 먼저다.

## Requirements

### R1 - 동작 조건 (P0)

- 플래그: `OMK_SKILL_SEARCH=on`(`on/1/true/enable/enabled`). 세션 시작 때 한 번만 읽는다.
- **켜져도 스킬이 적으면 동작하지 않는다.** 시작 시점의 model-invocable 스킬 수가 `SKILL_PROMPT_COMPACT_THRESHOLD`(24) 이하이면 050은 비활성이다. 이때 050의 R2–R5는 동작하지 않고, 요청은 R6을 뺀 부분에서 main과 같다(AC 5). `read` 도구가 없는 세션도 비활성이다(지금도 그 경우엔 목록이 없다).
- 모드는 세션 시작 때 정하고 세션 동안 바꾸지 않는다. `/reload`로 스킬 수가 바뀌어도 system과 tools는 그대로다. 인덱스만 다시 만든다.

### R2 - 고정 도구와 고정 안내 (P0)

- 도구 `skill_search`: 입력 `{ query: string (≤512자), limit?: 1..8 (기본 5) }`. 결과는 줄마다 `name — 짧은 설명 — 경로`이고 점수 순이다. 짧은 설명은 기존 `compactSkillDescription`(200자)을 쓴다. 본문은 돌려주지 않는다.
- system에는 `<available_skills>` 대신 고정 문장 한 줄만 넣는다: 스킬은 `skill_search`로 찾고, 쓸 때 `read`로 경로를 읽으며, 대화 중에 후보 메시지가 올 수 있다. 이 문장과 도구 스키마는 스킬 수나 내용과 상관없는 상수다.
- `disable-model-invocation` 스킬은 검색 결과에서도 빠진다. `/skill:name`과 `!skill:name` 명시 호출은 지금처럼 동작한다.

### R3 - 후보 메시지 (P0)

- **task 시작**: 사용자 프롬프트마다 상위 k개(기본 3, 최대 5)를 `_pendingNextTurnMessages`와 같은 경로로 사용자 메시지 뒤에 붙인다. 질의는 프롬프트 텍스트(앞 4,096자)다.
- **todo 시작**: 049가 있으면, 활성 todo가 바뀌는 `update_todo` 호출의 도구 결과 텍스트 끝에 후보 줄을 붙인다. 질의는 todo label에 `TodoKind`를 더한 것이다(R4).
- **같은 세션에서 이미 보여 준 스킬은 다시 넣지 않는다.** 점수가 하한(구현 PR에서 고정, run log로 조정) 아래면 메시지를 넣지 않는다.
- 메시지 형식은 짧은 머리말 한 줄과 후보 줄들로 고정한다. system이나 tools는 절대 바꾸지 않는다.

### R4 - 순위 (P0 BM25, P1 TodoKind)

- v1은 `metacognition/retrieval.ts`의 `searchCorpus`를 쓴다. 문서는 `name + " " + description`이다. 문서 5,000개 상한을 넘으면 앞 5,000개만 쓰고 그 사실을 run log에 남긴다.
- **049의 `TodoKind` 입력**: 고정 표(코드 상수, 눈으로 보이게)로 종류별 보조 단어를 질의에 더한다. 예: `verify` → test, check, verify / `debug` → debug, error, trace. 가중치를 학습하지 않는다. 049가 없거나 `unknown`이면 더하지 않는다. 쓴 종류는 run log에 enum으로 남긴다.
- 학습형 선택(`planSkills` 등)과 Adaptorch는 v1 범위 밖이다(결정 절).

### R5 - 지연 인덱스와 디스크 캐시 (P0)

- 인덱스(토큰화된 문서와 문서 빈도)는 첫 `skill_search` 호출이나 첫 후보 계산 때 만든다. 시작 경로에서는 `skill-search.ts`를 import하지 않는다.
- 디스크 캐시는 `<agentDir>/cache/skill-index-v1.json`이다. 키는 스킬 메타데이터(경로, 크기, mtime, ino)의 지문이다. 쓰기는 원자적(tmp + rename)으로 하고, 깨지면 miss로 본다(`skills-catalog-cache.ts`와 같은 규칙).
- 메타데이터를 시작 때 어떻게 얻는지는 아래 "의존"의 카탈로그 캐시 수정에 맡긴다. 050은 파일 읽기 방식을 바꾸지 않는다.

### R6 - 프롬프트마다 바뀌던 system 스킬 부분을 대화 끝으로 (P0, 플래그와 상관없음)

R6은 `OMK_SKILL_SEARCH`와 상관없이 적용한다. 두 경로 모두 지금 사용자 프롬프트마다 system을 바꾸는 곳이라서다(spec 051).

- **xAI/Devin harness**: system의 `<active_skills>`에는 세션 시작 때의 operator 기본값(settings의 `defaultActiveSkills`)만 둔다. 프롬프트마다 harness가 고른 스킬(이름, 위치 규칙은 지금과 같음)은 사용자 메시지 바로 뒤에 붙는 custom 메시지로 넣는다. 위치는 `_pendingNextTurnMessages`를 넣는 곳(`agent-session.ts:2606`) 옆이다. 고르는 규칙(`selectHarnessSkills`, 최대 3개)은 바꾸지 않는다.
- **`contextBudget`의 스킬 부분**: system의 스킬 부분은 세션 시작 때의 순서로 고정하고 질의로 다시 고르지 않는다. 질의 관련 상위 스킬은 위와 같은 custom 메시지로 붙인다. 050이 활성인 세션에서는 렌더러에 스킬을 아예 넘기지 않는다(`includeSkills: false`). 컨텍스트 파일 처리는 그대로다. 이것은 Tech Lead의 "바꾸거나 없앤다" 중 "바꾼다"에 해당하는 안이다(질문 5).
- **모듈 크기**: `agent-session.ts`는 module-size 여유가 약 3줄(4212/4215)이다. 그래서 고르기와 메시지 렌더는 작은 helper `core/prompt-skill-message.ts`에 두고, `agent-session.ts`에는 호출 한두 줄만 넣는다.
- **TB 영향**: 번들 6개에서는 grok harness가 고르는 스킬이 없고(허용 목록 밖), `contextBudget`은 기본 꺼짐이다. 그래서 공동 A/B 조건의 요청은 바뀌지 않는다(AC 5).
- 050이 비활성이거나 꺼져 있으면 #68 축약과 `<available_skills>` 목록은 main과 같다.

### R7 - worker (P0)

- worker env는 `OMK_SKILL_SEARCH`를 그대로 물려받는다. 리드의 후보 메시지는 worker에 넘기지 않는다.
- worker에서는 R3의 자동 후보 메시지를 끈다(`worker-env.ts`가 `OMK_SKILL_SEARCH_SUGGEST=0`을 넣는다). 그래서 **worker는 실제로 `skill_search`를 부를 때만 스킬을 읽는다.** 인덱스는 리드가 만든 디스크 캐시가 있으면 그걸 쓰고, 없으면 첫 검색 때 만든다.
- 시작 때 스킬 메타데이터를 읽지 않는 것은 카탈로그 캐시 수정(의존)과 함께 구현 PR에서 확인한다. 안 되면 AC 4를 못 채운 것으로 보고 이 spec을 다시 연다.

### R8 - run log (P0, spec 042)

`appendRunLog("skill-select", record)`로 `$OMK_RUN_LOG_DIR/skill-select.jsonl`에 쓴다. 숫자, enum, 해시만 넣는다. 질의 텍스트, 스킬 이름, 설명, 경로 원문은 넣지 않는다. 해시는 sha256 앞 12자다.

- `type: "index"`: `skills`, `docsUsed`, `buildMs`, `cacheHit`(bool), `cacheBytes`, `fingerprintHash`, `truncated`(bool).
- `type: "suggest"`: `trigger`(`task|todo`), `todoKind`(enum 또는 `none`), `k`, `skillHashes[]`, `topScore`(소수 셋째 자리), `belowFloor`(bool), `ms`.
- `type: "search"`: `queryTokens`, `limit`, `returned`, `skillHashes[]`, `ms`.
- `type: "read"`: 모델이 `read`로 연 파일이 스킬 경로일 때 `skillHash`, `suggested`(bool, 이 세션에서 후보로 보여 준 스킬인지), `via`(`suggest|search|none`).
- `type: "session"`(세션 시작 때 한 번): `active`(bool), `inactiveReason`(`flag_off|few_skills|no_read_tool|none`), `systemHash`, `toolsHash`. 해시는 #117의 `omk-ai/prompt-hash` helper로 계산한다. #117이 아직 머지되지 않았으면 그 PR을 의존으로 기다린다.
- `type: "harness-move"`(R6 메시지를 붙일 때): `source`(`grok-harness|devin-harness|context-budget`), `k`, `skillHashes[]`.
- `t`, `elapsedFraction`, `pid`, `role`은 `appendRunLog`가 붙인다.

## 의존: 스킬 카탈로그 캐시 수정 (별도 PR, 다른 담당)

지금 카탈로그 캐시는 디렉터리 경로만 덮는다. 자동 발견은 파일 경로를 주므로 1,191개가 매번 다시 읽히고, 캐시 파일은 `{}`로 남는다. 항목 상한도 64개다(`core/skills.ts:510-523, 576-587`, `core/skills-catalog-cache.ts:52-55`). 이 수정은 다른 사람이 별도 작은 PR로 한다. 050은 그 PR을 전제로만 쓰고 여기서 구현하지 않는다. 그 PR 없이도 050의 토큰 기준(AC 1)과 바이트 기준(AC 2)은 성립한다. AC 3의 플래그 켜짐 시작 비용과 AC 4는 그 PR에 달려 있다.

## Acceptance (Tech Lead, 그대로)

1. 1,191개 스킬일 때 system 토큰은 번들 6개 기본보다 2k 이상 늘지 않는다.
2. 대화 내내 system 바이트가 같고, Staff의 감사 테스트로 확인한다.
3. 시작 +10 ms / RSS +5 MiB 이내, 인덱스는 첫 검색 때 만든다.
4. worker는 실제로 검색할 때만 스킬을 읽는다.

### 측정 방법과 추가 항목 (OMK)

- **AC 1**: BASELINE.md와 같은 방법을 쓴다. mock에 실제로 나간 요청의 system 문자열을 `o200k_base`로 센다. 기준은 번들 6개 기본의 1,473 토큰이고, 합성 1,191개(복사본)에서 ≤ 3,473이어야 한다. `skill_search` 스키마가 늘리는 tools JSON 토큰은 따로 보고한다.
- **AC 2**: 플래그를 켜고 스킬 1,191개로 여러 턴을 돈다(task 2개, todo 변경, `skill_search`, `/reload` 포함). 모든 호출의 `systemHash`와 `toolsHash`가 첫 호출과 같아야 하고, 앞 호출의 `messagesPrefixHash`가 유지되어야 한다. helper는 #117의 `omk-ai/prompt-hash`를 쓴다.
- **AC 3**: 플래그 꺼짐 대 main(같은 스킬 수), 플래그 켜짐 대 꺼짐(1,191개, 카탈로그 캐시 PR 이후) 두 가지를 잰다. CI에는 `print-mode-worker-cold-path.test.ts` 방식의 `skill-search-flag-off-cold-path.test.ts`를 넣는다. 꺼짐과 비활성에서 `skill-search.ts`가 로드되지 않아야 한다. 인덱스 파일은 첫 검색 전에 없어야 한다.
- **AC 4**: worker 명령을 1,191개로 돌린다. 검색하지 않는 worker는 SKILL.md를 하나도 열지 않아야 한다(테스트에서 `fs` 열기 횟수를 센다). 검색하는 worker는 인덱스를 한 번만 만들거나 캐시를 읽는다.
- **AC 5 (TB 동일성)**: 공동 A/B 조건(번들 6개)에서 플래그를 켜도 나가는 요청이 오늘과 같아야 한다. "같다"의 뜻: 고정 시계, 같은 cwd, 같은 mock에서 첫 호출과 둘째 호출 요청 본문의 `messages` 배열(system 포함)과 `tools` 배열을 JSON 직렬화했을 때 **바이트 단위로 같다**. 다른 최상위 키도 같아야 하는데, 세션 id에서 나오는 키만 예외이고 그 목록은 테스트에 적는다.
- **AC 6**: 같은 세션에서 이미 보여 준 스킬은 후보 메시지에 다시 나오지 않는다. 점수 하한 미만이면 메시지가 없다.
- **AC 7**: run log에 질의, 스킬 이름, 경로 원문이 없다. 고유 문자열을 심고 파일 전체를 검색해 확인한다.
- **AC 9 (#117 연동)**: #117 `prompt-cache-stability.test.ts`의 `it.fails("keeps the prefix with contextBudget on (stable once spec 050 lands)")`가 050 구현 PR에서 빨갛게 바뀐다(이제 안정적이라서). 그 PR에서 `it.fails`를 `it`으로 바꾸고 통과해야 한다.
- **AC 10 (harness)**: #117의 native `xai` grok-harness 변형에서, 서로 다른 스킬을 고르는 두 사용자 프롬프트 사이에도 `systemHash`가 같아야 한다. #117이 "사용자 프롬프트 경계에서만 허용"으로 둔 예외를 지운다. 고른 스킬 이름은 대화 끝 custom 메시지에 들어 있어야 한다. Devin도 같은 테스트를 둔다.
- **AC 8**: 측정과 테스트는 복사본이나 합성 세트만 쓴다. 실제 스킬 디렉터리에 쓰기가 0건이다(`find -newermt`로 확인).

## A/B 측정 (자리만, 새 지출 없음)

- 고정점, arm, 과제, win 기준, 비용은 Bench Analyst가 정해서 이 절에 고정한다. 인호의 OK와 크레딧이 있을 때만 돈다.
- **TB 공동 A/B와의 관계**: 공동 A/B는 번들 6개 조건이라 050은 비활성(R1)이고, 고정점 `d69af96`은 바뀌지 않는다. AC 5로 보증한다.
- 050의 효과를 보려면 스킬이 많은 조건이 필요하다(질문 2). 판정 근거는 `skill-select.jsonl`의 `read.suggested` 비율과 통과율이다. BM25 대 학습형 비교도 같은 틀에서 한다.

## Non-goals

- 카탈로그 캐시 수정(별도 PR).
- 학습형 또는 적응형 선택, Adaptorch, metacon 연결(BM25를 이긴 A/B 뒤, Adaptorch는 서면 OK 뒤).
- 스킬 본문을 system이나 후보 메시지에 넣는 것.
- 실제 스킬 디렉터리 정리나 수정.
- reasoning effort(037).
- 같은 종류의 다른 캐시 문제는 메모만 남기고 범위 밖이다. 자정을 넘기면 system의 `Current date`가 바뀌는 것(`system-prompt.ts:223`), `agent-session.ts:2658`의 cache-boundary 판정을 `startsWith`로 바꾸는 것, xAI `x-grok-conv-id` 헤더는 Staff Engineer의 별도 PR이다(spec 051).

## 정해 주실 것 (Tech Lead)

1. **동작 문턱을 24(#68 문턱)로 둘지요.** 제 안은 24예요. 그 이하에서는 오늘과 바이트가 같아서 AC 5가 자동으로 성립해요.
2. **A/B 조건**: TB 과제는 번들 6개뿐이라 050이 비활성이에요. 스킬이 많은 조건(합성 1,191개 복사본을 agent dir에 두기)으로 따로 돌릴지, interactive 측정만 할지 정해 주세요.
3. ~~Grok/Devin harness `<active_skills>`~~: 정했어요. 플래그와 상관없이 대화 끝 메시지로 옮겨요(R6). 남은 건 `!skill`/`/skill:` 명시 호출(`bang-skill-invocation.ts`)이에요. 이것도 프롬프트마다 `<active_skills>`를 바꾸는데, 같은 방식으로 옮길지 정해 주세요. 제 안은 옮기는 거예요(spec 051의 제안과 같아요).
4. **AC 3의 기준점**: "플래그 꺼짐 대 main"과 "켜짐 대 꺼짐(카탈로그 캐시 PR 이후)" 둘 다 +10 ms / +5 MiB로 볼지요? 켜짐은 1,191개에서 오히려 줄어들 것으로 예상해요.
5. **`contextBudget`**: R6에는 "바꾼다" 안(system 고정 + 끝 메시지)을 적었어요. AC 9를 채우는 가장 작은 변경이라서요. 050이 기본 켜짐이 되면 스킬 부분은 아예 없애도 돼요. 그때 다시 정해 주세요.

## Expected Files (구현 PR)

- `packages/coding-agent/src/core/skill-search.ts`: 플래그 해석, 활성 판정, 인덱스(지연 생성과 디스크 캐시), BM25 호출, TodoKind 보조 단어 표, 후보 메시지 렌더, run log record
- `packages/coding-agent/src/core/tools/skill-search-tool.ts`: 고정 스키마 도구 (활성 세션에서만 등록)
- `packages/coding-agent/src/core/system-prompt.ts`, `skills-prompt.ts`: 활성 세션에서 목록 대신 고정 안내 한 줄
- `packages/coding-agent/src/core/prompt-skill-message.ts`: R6 helper(harness와 `contextBudget`이 고른 스킬을 끝 메시지로 렌더, task 시작 후보 메시지 연결). `agent-session.ts` module-size 여유가 3줄이라 로직은 여기에 둔다
- `packages/coding-agent/src/core/agent-session.ts`: helper 호출 한두 줄만
- `packages/coding-agent/src/core/system-prompt.ts`: `<active_skills>`는 operator 기본값만, budget 스킬 부분은 세션 시작 순서로 고정
- `packages/coding-agent/test/suite/prompt-cache-stability.test.ts`(#117): `it.fails`를 `it`으로 바꾸고 harness 예외 제거(AC 9, 10)
- `packages/coding-agent/src/core/extensions/builtin/todo-checklist.ts`: 활성 todo가 바뀔 때 후보 줄 (049가 있을 때)
- `packages/coding-agent/examples/extensions/subagent/worker-env.ts`: `OMK_SKILL_SEARCH`는 그대로 물려주고 `OMK_SKILL_SEARCH_SUGGEST=0`을 더한다(R7의 자동 후보 끄기. 034의 `OMK_DELIVERABLE_GUARD=0`과 같은 방식)
- `packages/coding-agent/docs/environment-variables.md`, `docs/skills.md`
- Tests: `test/skill-search.test.ts`(R3, R4, AC 6, 7), `test/skill-search-request-identity.test.ts`(AC 2, 5), `test/skill-search-worker.test.ts`(AC 4), `test/skill-search-flag-off-cold-path.test.ts`(AC 3)
