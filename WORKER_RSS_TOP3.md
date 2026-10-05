# omk -p worker RSS — top 3 (OMK)

스펙: [`specs/025-worker-rss/spec.md`](./specs/025-worker-rss/spec.md)

기준 모듈 목록: `/workspace/omk-staff-repro/worker-modules-omk-p.tsv`  
(`omk --provider mock --model mock-1 -p …` 워커 프로세스, ESM load 훅으로 `bytes\tmoduleUrl` 수집)

## 워커가 무엇인지

`omk -p`는 **별도 worker_threads가 아니라** print-mode Node 프로세스다. 멀티에이전트는 이 프로세스를 여러 번 띄우므로, 프로세스마다 아래 정적 그래프가 중복된다. RPC 자식(`rpc-client` → `spawn(node, cli)`)도 동일한 CLI 그래프를 다시 로드한다.

## 측정된 상위 모듈 (소스 바이트)

| 모듈 | bytes | 비고 |
| --- | ---: | --- |
| `packages/ai/dist/models.generated.js` | 1,213,820 | 최대. `models.ts`가 모듈 로드 시 전체 카탈로그 Map 구축 |
| `interactive-mode.js` + `packages/tui` | ~686KB + ~419KB | **Conductor 소유** (022/024 reserved, #77 tip). 손대지 않음 |
| `typebox` (660 파일) | ~825KB | `model-registry-schema` + `omk-ai` Type. 카탈로그 로드와 연동 |
| `openai` SDK | ~503KB | mock/`openai-completions` 스트림 시 lazy import — 실제 호출에는 필요 |
| `domain-loadouts.js` | 58,289 | `sdk` → `domain-dispatch` 정적 경로 (025 범위 밖 후속) |
| `package-manager.js` + `glob` | ~88KB + ~83KB | `resource-loader` 생성자에서 항상 `new DefaultPackageManager` |
| `settings-manager.js` | 36,196 | 모든 세션. `proper-lockfile`은 CJS라 TSV 바이트 0이나 require됨 |
| `skills.js` + catalog cache | ~20KB + ~8KB | reload 시 스킬 스캔 |
| `resource-loader.js` | 39,701 | 스킬/확장/테마 로드 허브 |

#74 attribution(stub): `models.js`/`models.generated.js` 제거 시 **약 −3 MB RSS / −2.9 MB heap**.

## 선택한 3가지 수정 (스펙 025)

1. **Lazy `models.generated` + built-in 카탈로그 지연** — 모듈 −1.21MB, RSS ~−3MB (커스텀-only `-p`)
2. **스킬/확장 패키지 resolve 지연** — `DefaultPackageManager`(+glob)를 resource-loader에서 lazy — ~−170KB 소스
3. **settings-manager `proper-lockfile` 지연** — 읽기 경로에서 lockfile 미로드 (#76/#78과 비중복)

## 반려 / 스킵

| 후보 | 이유 |
| --- | --- |
| interactive-mode / omk-tui / marked strip | Conductor (reserved 024 / #77). 금지 |
| highlight.js / jiti / undici | #74/#76/#77/#78 |
| skill prompt compact | #68 |
| js-tiktoken | Staff (reserved 023) |
| TUI windowing | Tech Lead (reserved 022 / #79) |
| domain-loadouts 전체 lazy | 유효하나 025 3대 테마 밖. 후속 |
| 워커 간 IPC로 스킬/설정 공유 | 제품 결정 |

## 검증하지 않은 것

- 멀티 워커 동시 RSS 합산 (단일 `-p` 기준)
- Bun `--compile` 카탈로그 번들 포함 여부(스모크만)
- 기본(확장·스킬 가득) 홈에서의 RSS — 확장 없는 mock 하네스 위주
