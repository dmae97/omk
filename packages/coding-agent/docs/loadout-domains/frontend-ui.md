# Frontend & UI (`frontend-ui`)

> Inherited domain capability document. Auto-generated from `src/core/domain-loadouts.ts` — do not edit by hand.


## Identity

| field | value |
|---|---|
| id | `frontend-ui` |
| authority | `write-scoped` |
| tools | read, grep, find, ls, edit, write, bash |
| command mode | `scoped-shell` |

## Routing prompt

> Prepended to the lane task prompt when the router selects this domain.

```text
DOMAIN: Frontend & UI. You are operating in a frontend/UI capability lane.
Prioritize visual craft, correct component composition, and accessibility.

SEQUENCE:
1. Read the target component(s)/page(s) in full before editing. Do not edit blind from search snippets.
2. Identify the design system in use (Tailwind v4 / shadcn/ui / CSS modules / vanilla). Match it exactly; never introduce a second system. Use context7 for current framework/library docs before changing unfamiliar APIs.
3. Website clone / visual QA work follows the ai-website-cloner-template gate contract:
   Reconnaissance -> Design-Token Foundation -> Component Specs -> Asset Gate -> Build Gate -> QA Gate.
   Reconnaissance uses Chrome/Playwright: chrome-devtools first for live inspection, playwright when deterministic multi-viewport screenshots or scripted interaction sweeps are needed. Capture screenshots at responsive sizes 1440/768/390, getComputedStyle design-token samples, assets, page topology, hover/click/scroll/time-driven behavior, and responsive breakpoints.
4. Design-Token Foundation is sequential: fonts, oklch/shadcn-compatible tokens, global CSS, page-level motion primitives, icon extraction, downloaded assets, and typed content structures. Do not dispatch component builders until the foundation exists.
5. Component Specs are contracts: component-spec-before-build requires a spec artifact before implementation. Specs include exact getComputedStyle values, DOM structure, interaction model, all states, assets, verbatim content, and responsive behavior. Split anything whose builder prompt would exceed ~150 lines.
6. Asset Gate: real extractable assets are downloaded, named, and referenced before build; no mock assets when source assets are available.
7. Build Gate: one builder per section or sub-component receives the full spec inline plus screenshot path, target file, imports, breakpoint behavior, and a typecheck/build requirement. Assembly wires sections into page-level layout and behaviors.
8. QA Gate: visual-diff-after-edit requires side-by-side visual diff artifacts against the reference at 1440/768/390. Test interactions with Chrome/Playwright; run web-quality-audit for perf/a11y/SEO/best-practices and typecheck-after-edit before done.
9. Evidence must include screenshots, getComputedStyle captures, responsive sizes 1440/768/390, side-by-side visual diff artifacts, Chrome/Playwright command/tool results, changed files, and known discrepancies.
10. Accessibility: run the fixing-accessibility + contrast-checker + use-of-color skills. Every interactive element needs a reachable name, visible focus, and AA contrast.
11. Motion: prefer the transitions-dev / animate / 12-principles-of-animation skills; gate heavy effects behind fix-motion-performance so animation never blocks the main thread.
12. Prefer composition over boolean-prop sprawl (vercel-composition-patterns). Keep components small and spec-driven.

HARD RULES: no inline styles when a token/utility exists; oklch tokens for color; mobile-first responsive; real content over placeholders; pixel-match the target first, customize later; no visual claim without bounded screenshot/diff evidence.
```

## Curated skills (58)

- `frontend-design`
- `frontend-ui-engineering`
- `frontend-patterns`
- `baseline-ui`
- `impeccable`
- `shape`
- `make-interfaces-feel-better`
- `transitions-dev`
- `animate`
- `polish`
- `layout`
- `typeset`
- `colorize`
- `oklch-skill`
- `high-end-visual-design`
- `minimalist-ui`
- `design-taste-frontend`
- `design-taste-frontend-v1`
- `redesign-existing-projects`
- `brandkit`
- `imagegen-frontend-web`
- `imagegen-frontend-mobile`
- `web-design-guidelines`
- `fixing-accessibility`
- `contrast-checker`
- `use-of-color`
- `fixing-motion-performance`
- `12-principles-of-animation`
- `to-spring-or-not-to-spring`
- `mastering-animate-presence`
- `pseudo-elements`
- `shadcn`
- `next-best-practices`
- `next-cache-components`
- `vercel-react-best-practices`
- `vercel-composition-patterns`
- `vue-best-practices`
- `vue`
- `svelte-code-writer`
- `react-pdf`
- `remotion-best-practices`
- `web-quality-audit`
- `audit-and-fix`
- `browser-qa`
- `webapp-testing`
- `e2e-testing`
- `playwright-cli`
- `image-to-code`
- `visual-ralph`
- `visual-regression`
- `visual-diff`
- `gstack-design-review`
- `gstack-design-html`
- `gstack-design-shotgun`
- `clone-website`
- `ui-design-brain`
- `interface-design`
- `emil-design-eng`

## Curated MCP servers (4)

- `chrome-devtools`
- `playwright`
- `filesystem`
- `context7`

## Curated hooks (6)

- `typecheck-after-edit`
- `pre-shell-guard`
- `protect-secrets`
- `component-spec-before-build`
- `visual-diff-after-edit`
- `bounded-evidence`

## Routing triggers (41)

| kind | pattern | weight |
|---|---|---|
| keyword | `ui` | 3 |
| keyword | `frontend` | 5 |
| keyword | `component` | 3 |
| keyword | `컴포넌트` | 4 |
| keyword | `디자인` | 4 |
| keyword | `css` | 4 |
| keyword | `tailwind` | 5 |
| keyword | `responsive` | 4 |
| keyword | `layout` | 3 |
| keyword | `design` | 3 |
| keyword | `accessibility` | 4 |
| keyword | `a11y` | 4 |
| keyword | `animation` | 4 |
| keyword | `pixel-perfect` | 5 |
| keyword | `landing page` | 5 |
| keyword | `redesign` | 4 |
| keyword | `button` | 2 |
| keyword | `modal` | 2 |
| keyword | `shadcn` | 5 |
| keyword | `clone` | 3 |
| keyword | `website clone` | 7 |
| keyword | `clone website` | 7 |
| keyword | `rebuild website` | 6 |
| keyword | `recreate website` | 6 |
| keyword | `pixel-perfect clone` | 8 |
| keyword | `visual diff` | 6 |
| keyword | `design tokens` | 5 |
| keyword | `component spec` | 5 |
| keyword | `getcomputedstyle` | 5 |
| keyword | `reconnaissance` | 5 |
| keyword | `클론` | 5 |
| keyword | `스크린샷` | 4 |
| regex | `\b(react|vue|svelte|next\.?js|nuxt)\b` | 4 |
| regex | `\b(tailwind|css|styled|emotion|radix)\b` | 4 |
| regex | `\b(visual qa|responsive sweep|interaction sweep|computed styles?)\b` | 6 |
| extension | `.vue` | 6 |
| extension | `.tsx` | 4 |
| extension | `.jsx` | 4 |
| extension | `.css` | 5 |
| path | `components/` | 4 |
| path | `app/page` | 3 |
