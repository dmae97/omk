# DESIGN.md — open-multi-agent-kit v1.2

## Product Identity

OMK is a provider-neutral verified agent runtime and operator control plane, not a mascot product or a single-provider shell.

Core sentence:

> Models execute. OMK routes, verifies, measures, and controls.

Design surfaces must show OMK as the control loop around execution: run state, evidence, telemetry, graph memory, scoped MCP/skills/hooks, worktree isolation, provider fallback, and operator controls. Never imply completion from narration alone; visual “done” states require command, diff, artifact, metric, or review evidence.

## Runtime Algorithm Reference

Runtime architecture visuals should summarize, not duplicate, the canonical
native root loop and routing algorithms in
[`docs/native-root-runtime-algorithms.md`](./docs/native-root-runtime-algorithms.md).
Show provider-neutral orchestration as a hardening milestone gated by evidence,
approval/sandbox policy, and adapter capability boundaries.

## Reference Design System

기준 디자인: **Night City Ops Console** — 검은 패널, 네온 시안/마젠타/앰버 포인트, 밀도 높은 메트릭 카드, 라우팅/증거/워크트리 상태가 한눈에 보이는 cyberpunk2077 + telemetry 중심 운영 콘솔.

현재 브랜드 기준 이미지는 `readmeasset/omk-control.webp` 이다. 로컬 런타임에서 한국어 별칭이 필요하면 프로젝트 루트의 `오픈멀티에이전트킷.webp`는 이 기준 이미지의 alias로만 취급하고, 배포/문서 링크는 패키징 검증이 되는 `readmeasset/omk-control.webp`를 사용한다. 이미지 provenance와 배포 전 확인 상태는 `readmeasset/ASSET_PROVENANCE.md`에 기록한다.

GitHub theme research inputs used for this refresh are palette inspiration only, not copied code or assets: `hyperb1iss/silkcircuit`, `mbadolato/iTerm2-Color-Schemes` Matrix/Darkmatrix schemes, `Murderlon/cyberpunk-iterm`, `djorborn/cyberpunk`, `pedruino/wave-cyberpunk-2077`, and `PandaAkiraNakai/starship-cyberpunk-preset`. Public TUI copy must remain OMK-owned (`OMK//CONTROL`, `NEON GRID ONLINE`, `Green Rain`, `Night City Ops Console`) and must not print external trademark splash text.

패키징 정책: `/public/assets/`는 웹사이트/디자인 작업용 **source-only reference asset**이며 현재 npm CLI 패키지에는 포함하지 않는다. 라이선스와 출처가 기록되지 않은 에셋은 source-only 상태로 유지하고, CLI/init 문서나 배포 패키지에 이미지가 필요하면 provenance(라이선스, 원출처, 사용 권한, 검토일)를 먼저 기록한 뒤 최소 선별본만 `readmeasset/` 또는 `docs/assets/`로 이동해 포함한다. `.gitignore`와 package audit은 `/public/assets/**`가 실수로 커밋되거나 npm tarball에 들어가는 것을 막는 방어선이다.

## Visual Direction

- **Mood**: 어두운 오퍼레이터 룸, 네온 HUD, 증거와 메트릭이 살아 있는 control-plane 화면
- **Shape**: 12–20px 반경의 견고한 패널, 얇은 네온 보더, dense metric cards
- **Layout**: 풀와이드 cockpit 우선, 좌측 작업/우측 메트릭 rail, summary-first 정보 밀도
- **Iconography**: mascots 대신 grid, scope, route, telemetry, evidence, worktree glyph
- **Animation**: scanline pulse, signal sweep, matrix drift, metric blink, status pop
- **Voice**: cute/mascot tone 금지. operator, telemetry, evidence, control, route, signal 어휘 사용

## Colors (Cyberpunk Control Plane)

### Page & Surface

| Token | Hex | Usage |
|-------|-----|-------|
| `--bg-page` | `#070B14` | 메인 배경 |
| `--bg-page-soft` | `#0B1220` | 부드러운 어두운 배경 |
| `--bg-page-deep` | `#03060D` | 깊은 배경 |
| `--bg-card` | `#101826` | 기본 카드 |
| `--bg-warm-card` | `#131D2E` | 보조 카드 |
| `--bg-soft` | `#162235` | 떠 있는 surface |

### Neon Core

| Token | Hex | Usage |
|-------|-----|-------|
| `--neon-cyan` | `#00D6FF` | signal, route, graph |
| `--neon-green` | `#00FFC2` | success, telemetry, active gauges |
| `--neon-magenta` | `#FF47B2` | control accent, focus, highlights |
| `--neon-purple` | `#9D4EDD` | orchestration accent |
| `--neon-amber` | `#FFB000` | warning, pending |
| `--neon-red` | `#FF5874` | fail, fault |

### Text Colors

| Token | Hex | Usage |
|-------|-----|-------|
| `--text-primary` | `#E8F8FF` | 본문 텍스트 |
| `--text-secondary` | `#9DB3C7` | 보조 텍스트 |
| `--text-muted` | `#758FA8` | 흐린 텍스트 |
| `--text-inverse` | `#070B14` | 밝은 surface 위 텍스트 |

### Semantic Colors

| Token | Hex | Usage |
|-------|-----|-------|
| `--green-600` | `#00FFC2` | 성공/통과 |
| `--green-100` | `#08271F` | 성공 배경 |
| `--red-600` | `#FF5874` | 실패/위험 |
| `--red-100` | `#2A0C16` | 위험 배경 |
| `--warning` | `#FFB000` | 경고 |
| `--warning-bg` | `#2B1E06` | 경고 배경 |
| `--info` | `#00D6FF` | 정보 |
| `--info-bg` | `#081E2B` | 정보 배경 |

### Border & Divider

| Token | Hex | Usage |
|-------|-----|-------|
| `--grid-border` | `#22324A` | 기본 보더 |
| `--grid-border-strong` | `#355377` | 강조 보더 |
| `--grid-glow` | `rgba(0, 214, 255, 0.24)` | focus/glow |

### Verdict Colors (에이전트 상태)

| 상태 | 색상 | Usage |
|------|------|-------|
| `PASS / DONE` | `#00FFC2` on `#08271F` | 성공/완료 |
| `FAIL / ERROR` | `#FF5874` on `#2A0C16` | 실패/에러 |
| `WARN / BLOCKED` | `#FFB000` on `#2B1E06` | 경고/블록 |
| `INFO / PENDING` | `#00D6FF` on `#081E2B` | 정보/대기 |

Operational status labels:

- `PASS`: verified by command, diff, review, metric, or artifact.
- `WARN`: scope drift, provider fallback, skipped check, or partial evidence.
- `BLOCKED`: missing permission, failed gate, dirty worktree, unavailable MCP, or protected-path checkpoint.
- `ADVISORY`: provider/reviewer/research output without write authority.

## Operational Information Hierarchy

HUD/cockpit must prioritize:

1. active goal / run / session
2. current provider / worker lane
3. changed files and worktree location
4. TODO / blocker state
5. evidence + telemetry status
6. scoped MCP / skills / hooks summary
7. provider route and fallback status
8. replay / inspect / graph links

## Typography

| Role | Font | Size | Weight |
|------|------|------|--------|
| Logo / Display | `'Cafe24 Ssurround'`, `'GmarketSans'`, `'Pretendard'` | 44–58px | 900 |
| Page Title | `'GmarketSans'`, `'Pretendard'` | 24px | 900 |
| Card Title | `'Pretendard'` | 17–20px | 900 |
| Body | `'Pretendard'`, `system-ui`, `-apple-system` | 13.5–15px | 600–800 |
| Labels / Captions | `'Pretendard'` | 11–14px | 800–900 |
| Code / CLI | `'JetBrains Mono'`, `'Fira Code'` | 13px | 400 |

Font Imports:
```css
@import url('https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css');
/* Cafe24 Ssurround, GmarketSans via Google Fonts or CDN */
```

## Design Tokens (CSS Custom Properties)

```css
:root {
  /* Spacing scale */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-8: 32px;
  --space-10: 40px;
  --space-12: 48px;

  /* Border radius */
  --radius-sm: 10px;
  --radius-md: 14px;
  --radius-lg: 20px;
  --radius-xl: 28px;
  --radius-pill: 999px;

  /* Shadows */
  --shadow-card: 0 14px 42px rgba(0, 214, 255, 0.10);
  --shadow-soft: 0 18px 64px rgba(0, 0, 0, 0.34);
  --shadow-button: 0 0 18px rgba(0, 214, 255, 0.26), inset 0 0 0 1px rgba(232, 248, 255, 0.10);
  --shadow-nav: 0 -10px 34px rgba(0, 214, 255, 0.08);
  --shadow-hover: 0 20px 54px rgba(255, 71, 178, 0.18);
  --shadow-glow: 0 0 24px rgba(0, 255, 194, 0.35);

  /* Touch target */
  --touch-target: 44px;
}
```

## Component Patterns

### Cards (control-card)

```css
.control-card {
  background: linear-gradient(180deg, rgba(16, 24, 38, 0.96), rgba(11, 18, 32, 0.92));
  border: 1px solid var(--grid-border);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-card);
  backdrop-filter: blur(10px);
  transition: transform 0.22s ease, border-color 0.22s ease, box-shadow 0.22s ease;
}
.control-card:hover {
  border-color: var(--neon-cyan);
  box-shadow: var(--shadow-hover);
}
```

### Primary Button

```css
.primary-button {
  display: inline-flex; align-items: center; justify-content: center;
  width: 100%; min-height: 56px; gap: var(--space-2);
  border: 1px solid rgba(0, 214, 255, 0.55); border-radius: 20px;
  background: linear-gradient(135deg, var(--neon-cyan), var(--neon-magenta));
  color: var(--text-inverse);
  box-shadow: var(--shadow-button);
  font-weight: 900; font-size: 16px;
  transition: transform 0.18s ease, box-shadow 0.18s ease, filter 0.18s ease;
}
.primary-button:hover {
  transform: translateY(-2px);
  filter: saturate(1.18);
  box-shadow: 0 0 28px rgba(0, 214, 255, 0.34), 0 0 30px rgba(255, 71, 178, 0.22);
}
.primary-button:active {
  transform: translateY(1px) scale(0.99);
}
```

### Secondary / Outline Button

```css
.secondary-button {
  display: inline-flex; align-items: center; justify-content: center;
  width: 100%; min-height: 56px; gap: var(--space-2);
  border: 1.5px solid var(--grid-border-strong); border-radius: 20px;
  background: rgba(16, 24, 38, 0.74);
  color: var(--text-primary);
  font-weight: 900; font-size: 16px;
}
.secondary-button:hover {
  border-color: var(--neon-green);
  box-shadow: 0 0 18px rgba(0, 255, 194, 0.18);
}
```

### Bottom Navigation

```css
.bottom-nav {
  position: fixed; bottom: 0; left: 50%; transform: translateX(-50%);
  width: 100%; max-width: 430px;
  height: calc(70px + env(safe-area-inset-bottom, 0px));
  display: flex; align-items: flex-start; justify-content: space-around;
  background: rgba(7, 11, 20, 0.92);
  backdrop-filter: blur(14px);
  border-top: 1px solid var(--grid-border);
  box-shadow: var(--shadow-nav);
  z-index: 50;
}
.bottom-nav-item.active {
  color: var(--neon-cyan);
  background: linear-gradient(180deg, rgba(0, 214, 255, 0.18), rgba(0, 214, 255, 0));
}
```

## OMK HUD / Cockpit Theme

OMK의 CLI HUD와 Cockpit는 dark cyberpunk terminal theme를 기본으로 사용한다. Startup/HUD/working 상태는 다음 문구 계층을 공유한다: `OMK//CONTROL`, `NEON GRID ONLINE`, `signal active`, `evidence gate armed`, `MCP/skills/hooks scoped`, `turn settled`. 완료는 narrative가 아니라 command/diff/artifact/review evidence가 있을 때만 verified로 표현한다.

```txt
Primary:     #00FFC2 (telemetry green)
Secondary:   #00D6FF (signal cyan)
Accent:      #9D4EDD (control purple)
Background:  #070B14 (night black)
Surface:     #101826 (panel surface)
Text:        #E8F8FF (console text)
Muted:       #758FA8 (muted text)
Success:     #00FFC2
Error:       #FF5874
Warning:     #FFB000
Info:        #00D6FF
```

## Asset Usage Matrix

Asset provenance gate: 이 표는 디자인 의도만 설명한다. source-only reference asset은 provenance가 기록될 때까지 package/release 산출물에 포함하지 않는다.

| OMK Surface | Assets Used |
|-------------|-------------|
| HUD | ASCII/control glyphs first, optional provenance-cleared logo only |
| Cockpit | telemetry cards, route graph glyphs, metric chips |
| Dashboard | verified logo, route/evidence panels, status lights |
| Run Status | pass/warn/fail/pending badges with text labels |
| Social Preview | provenance-cleared OMK logo or neutral control-room art |
| Landing Page | dark control-grid reference, no mascot dependency |
| Error States | alert stripes, fault badges, operator guidance |

## Animation Presets

```css
.animate-fadeInUp    { animation: fadeInUp 0.6s cubic-bezier(0.22,1,0.36,1) both; }
.animate-bounceIn    { animation: bounceIn 0.72s cubic-bezier(0.2,0.85,0.25,1.18) both; }
.animate-float       { animation: float 3s ease-in-out infinite; }
.animate-paw-pop     { animation: paw-pop 160ms ease-out; }
.animate-card-3d     { animation: card-3d-tilt 0.7s cubic-bezier(0.2,0.85,0.25,1.1) both; }
.animate-scale-in    { animation: scale-in-bounce 0.65s cubic-bezier(0.2,0.85,0.25,1.18) both; }
.animate-glow-pulse  { animation: glow-pulse 2s ease-in-out infinite; }
.animate-count-pop   { animation: count-pop 0.5s cubic-bezier(0.2,0.85,0.25,1.15) both; }

/* Stagger delays */
.stagger-1 { animation-delay: 0.06s; }
.stagger-2 { animation-delay: 0.12s; }
.stagger-3 { animation-delay: 0.18s; }
.stagger-4 { animation-delay: 0.24s; }
.stagger-5 { animation-delay: 0.30s; }
```

## Rules

1. **Use tokens before inventing new values** — 모든 색상/간격/쉐도우는 CSS 변수 참조
2. **Neon cyan + green are the live-signal core** — route/telemetry/success에 우선 사용
3. **Amber and red are reserved for warnings/faults** — 강조 색상 남용 금지
4. **Dark surfaces first** — HUD/cockpit은 밝은 크림 테마 금지
5. **Metrics over mascots** — 상태, 증거, 라우트, worktree, MCP/skills/hooks 정보를 우선 노출
6. **Readable density** — compact하지만 숫자/라벨/근거가 한 화면에 보여야 함
7. **Reduced motion respected** — `prefers-reduced-motion` 미디어 쿼리 필수
8. **Color never the only indicator** — 상태 배지에 텍스트 + 색상 함께 사용
9. **Control-plane language only** — cute/mascot 표현 금지

## Accessibility

- 모든 인터랙티브 요소에 `aria-label` / `aria-current` 제공
- 포커스 링: cyan glow (`outline: 2px solid rgba(0, 214, 255, 0.7)`)
- 최소 터치 타겟 44px
- `prefers-reduced-motion: reduce` 전역 적용
- 색상 대비: WCAG AA 이상 (light text on dark panels)

## References

| Page | Reference Image |
|------|----------------|
| 대시보드 | `references/dashboard.png` |
| 랜딩 + 입력폼 | `references/landing-and-form.png` |
| 마이페이지 | `references/my-page.png` |
| 기록 | `references/records.png` |
| 결과 | `references/result.png` |
