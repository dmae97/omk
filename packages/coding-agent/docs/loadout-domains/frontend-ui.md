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
2. Identify the design system in use (Tailwind v4 / shadcn/ui / CSS modules / vanilla). Match it exactly; never introduce a second system.
3. For visual work: drive iteration with the chrome-devtools or playwright MCP (navigate, screenshot, diff) — do not claim "looks good" without a captured frame.
4. Accessibility: run the fixing-accessibility + contrast-checker + use-of-color skills. Every interactive element needs a reachable name, visible focus, and AA contrast.
5. Motion: prefer the transitions-dev / animate / 12-principles-of-animation skills; gate heavy effects behind fix-motion-performance so animation never blocks the main thread.
6. Prefer composition over boolean-prop sprawl (vercel-composition-patterns). Keep components small; extract when a prompt would exceed ~150 lines of spec.
7. Before claiming done: typecheck-after-edit hook must pass, plus the web-quality-audit skill (perf/a11y/SEO/best-practices).

HARD RULES: no inline styles when a token/utility exists; oklch tokens for color; mobile-first responsive; real content over placeholders; pixel-match the target first, customize later.
```

## Curated skills (48)

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
- `redesign-existing-projects`
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
- `image-to-code`
- `visual-ralph`
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

## Curated hooks (3)

- `typecheck-after-edit`
- `pre-shell-guard`
- `protect-secrets`

## Routing triggers (26)

| kind | pattern | weight |
|---|---|---|
| keyword | `ui` | 3 |
| keyword | `frontend` | 5 |
| keyword | `component` | 3 |
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
| regex | `\b(react|vue|svelte|next\.?js|nuxt)\b` | 4 |
| regex | `\b(tailwind|css|styled|emotion|radix)\b` | 4 |
| extension | `.vue` | 6 |
| extension | `.tsx` | 4 |
| extension | `.jsx` | 4 |
| extension | `.css` | 5 |
| path | `components/` | 4 |
| path | `app/page` | 3 |
