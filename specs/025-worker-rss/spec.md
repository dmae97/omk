---
description: "omk -p worker RSS: defer models.generated, skill package resolve, settings lockfile"
---

# Feature Specification: Worker RSS Top-3 (print/worker path)

**Feature Branch**: `perf/worker-rss-*` (시리즈; 스펙 폴더 단일 `025-worker-rss`)
**Created**: 2026-10-06
**Status**: Draft → Implementing
**Input**: Investigate `omk -p` worker RSS; top 3 savings as PRs; exclude Conductor TUI strip
**OMK Preset**: `omk` (DAG-optimized, parallel-agent ready)
**Constitution**: [Project constitution](../constitution.md)

## CLI Harness Target Impact

**Classification**: advance (startup/module RSS for headless `-p` workers)

| Dimension | Baseline | Acceptance target | Regression floor | Verification command | Evidence artifact |
| --- | --- | --- | --- | --- | --- |
| Module graph (custom-only `-p`) | TSV: `models.generated` 1.21MB loaded; `package-manager`+glob ~170KB; settings reads pull `proper-lockfile` | models.generated not evaluated when CLI resolves from models.json only; package-manager not evaluated until package resolve needed; proper-lockfile not evaluated on SettingsManager read/create | Built-in list-models / package install / settings save still work | vitest lazy-import tests + optional ESM MODLOG TSV | `WORKER_RSS_TOP3.md`, PR bodies |
| RSS / heap (보조) | #74 stub −3MB RSS / −2.9MB heap for models subtree | Document measured Δ or "not remeasured"; primary signal is module non-load | No functional regression on mock `-p` | nice vitest / optional `--expose-gc` | PR "Not verified" section |

## 1. 목표 (goal)

`omk -p`(및 동일 CLI 그래프를 쓰는 RPC/멀티에이전트 워커) 프로세스마다 중복 로드되는 무거운 정적 자산을 줄인다. 대상은 다음 세 가지뿐이다.

1. **models.generated** (~1.21MB): 헬퍼만 쓸 때·커스텀 `models.json`만으로 모델이 정해질 때 카탈로그 미평가
2. **skills/패키지 resolve**: `DefaultResourceLoader`가 생성 즉시 `DefaultPackageManager`(+glob)를 끌어오지 않음
3. **settings lock**: `SettingsManager` 읽기/`create`가 `proper-lockfile`을 끌어오지 않음 (저장 시에만)

Conductor의 interactive-mode / omk-tui strip, Staff tiktoken(023), TL TUI windowing(022)은 범위 밖이다.

## 2. 수용 기준 (acceptance criteria)

### Win A — models.generated 지연

1. `modelsAreEqual` / `clampThinkingLevel` / `calculateCost`만 호출하면 `models.generated`가 평가되지 않는다.
2. `ModelRegistry`가 커스텀 `models.json`만으로 `find`/`resolveCliModel`에 성공하면 built-in 카탈로그(`getProviders`/`getModels`)를 호출하지 않는다.
3. `--list-models`, 커스텀에 없는 provider/model, interactive 목록 등 built-in이 필요한 경로는 기존과 동일하게 동작한다.
4. **측정**: vitest load/mock 카운터로 (1)(2) 고정. 보조로 ESM MODLOG TSV에 `models.generated` 행 부재(커스텀-only `-p`). 추정 절감: 소스 −1.21MB, RSS ~−3MB(#74).
5. **`main()` 기준 (리뷰 후 추가)**: `baseUrl`·`apiKey`·`api`를 모두 적은 커스텀 provider로 `omk -p`를 끝까지 돌린 뒤 `isBuiltInModelsCatalogLoaded() === false`. `main()`을 거치는 vitest(`print-mode-lazy-models-catalog.test.ts`)로 고정한다.
   - 모듈 최상위에서 카탈로그를 부르지 않는다(`interactive-login-options.ts`의 provider Set은 처음 쓸 때 만든다).
   - `models.json` 검증·파싱은 답이 달라질 때만 `getProviders()`/`getModels()`를 부른다. provider에 `baseUrl`이나 `apiKey`가 없거나, 모델에 `api`/`baseUrl`이 없어 built-in 기본값을 물려받아야 할 때다.
   - **로드돼도 되는 경우**: `models.json`의 provider가 built-in 기본값(api, baseUrl)에 기대는 경우, 그리고 `models.json` 없이 built-in provider/model로 실행하는 경우. 후자는 모델을 찾으려면 카탈로그가 필요하므로 지연 로드의 대상이 아니다.

### Win B — 스킬/확장 패키지 resolve 지연

1. `resource-loader` import 직후(또는 `reload()` 전) `package-manager` 모듈이 평가되지 않는다.
2. 패키지 설정·추가 패키지 소스가 있는 픽스처에서는 resolve 결과가 기존과 동일하다.
3. **측정**: vitest로 package-manager 미로드 증명. 추정: 소스 −~170KB (package-manager+glob).

### Win C — settings proper-lockfile 지연

1. `settings-manager` import + `SettingsManager.create`/읽기만으로 `proper-lockfile`이 평가되지 않는다.
2. 저장·잠금 기존 테스트 통과. #76/#78(undici) 파일과 충돌·재오픈 없음.
3. **측정**: vitest mock 카운터로 읽기 경로 load 횟수 0.

### 공통 게이트 (각 PR)

- biome check (변경 파일)
- `node scripts/check-module-size.mjs`
- `node scripts/check-import-cycles.mjs`
- `packages/coding-agent`: `../../node_modules/.bin/tsgo --noEmit -p .` (+ ai 변경 시 packages/ai도)
- `nice …/vitest run <relevant>`

## 3. 안 하는 것 (out of scope)

- interactive-mode / omk-tui / marked / highlight.js strip (Conductor; reserved 024 / #77)
- TUI windowing (Tech Lead; reserved 022 / #79)
- js-tiktoken WeakMap (Staff; reserved 023)
- undici / http-dispatcher 분리 재오픈 (#76/#78)
- skill prompt compact 재작업 (#68)
- per-provider 카탈로그 코드젠 전면 개편, `getModel` async API 파괴
- 워커 간 IPC로 스킬/설정 공유 (제품 결정)
- domain-loadouts 전체 lazy (후속 후보만)

## 4. 건드리는 파일 (files touched)

### 공통

- `specs/025-worker-rss/spec.md` (본 스펙; 시리즈 단일 폴더)
- `WORKER_RSS_TOP3.md` (분석·측정 메모)

### Win A (PR: lazy models)

- `packages/ai/src/models.ts`
- `packages/coding-agent/src/core/model-registry.ts`
- `packages/coding-agent/src/core/model-resolver.ts` (필요 시)
- `packages/ai/test/*` 또는 `packages/coding-agent/test/*` (미로드 증명)

### Win B (PR: lazy skill packages)

- `packages/coding-agent/src/core/resource-loader.ts`
- 필요 시 소형 헬퍼 (module-size 준수)
- `packages/coding-agent/test/*resource-loader*` 또는 신규 lazy 테스트

### Win C (PR: lazy settings lock)

- `packages/coding-agent/src/core/settings-manager.ts`
- `packages/coding-agent/test/settings-manager*.ts` 또는 신규 lazy-lock 테스트

## Agent-Oriented Requirements

### Requirement 1 — Lazy models.generated (Priority: P1)

**Agent**: coder  
**Evidence Gate**: command-pass  
**Risk**: medium  

**What**: `models.ts`가 카탈로그를 sync lazy(`createRequire` 상대 경로)로 로드; `ModelRegistry`는 커스텀 모델 우선, `ensureBuiltIns()` 온디맨드.  
**Verify**: vitest — helpers-only 시 catalog unloaded; custom-only resolve 시 `areBuiltInsLoaded()===false`.

### Requirement 2 — Lazy package-manager in ResourceLoader (Priority: P1)

**Agent**: coder  
**Evidence Gate**: command-pass  
**Risk**: medium  

**What**: `DefaultPackageManager` 정적 import/생성자 즉시 생성 제거; resolve 필요 시점에만 로드.  
**Verify**: vitest — import/construct without reload does not evaluate package-manager.

### Requirement 3 — Lazy proper-lockfile in SettingsManager (Priority: P2)

**Agent**: coder  
**Evidence Gate**: command-pass  
**Risk**: low  

**What**: lockfile을 저장/잠금 경로에서만 dynamic import.  
**Verify**: vitest — create/read does not load proper-lockfile; save still locks.

## Verification Commands

```bash
export PATH=/workspace/tools/node-v22.23.3-linux-x64/bin:$PATH
node_modules/.bin/biome check <changed-files>
node scripts/check-module-size.mjs
node scripts/check-import-cycles.mjs
cd packages/ai && ../../node_modules/.bin/tsgo --noEmit -p .   # Win A
cd packages/coding-agent && ../../node_modules/.bin/tsgo --noEmit -p .
nice ../../node_modules/.bin/vitest run <relevant-tests>
```

## Prior art

- #74 attribution table (models −3MB RSS stub)
- #76/#78 undici (do not reopen)
- #77 Conductor highlight / upcoming TUI strip (do not touch)
