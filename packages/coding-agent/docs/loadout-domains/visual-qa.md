# Visual QA & Website Cloning (`visual-qa`)

> Inherited domain capability document. Auto-generated from `src/core/domain-loadouts.ts` — do not edit by hand.


## Identity

| field | value |
|---|---|
| id | `visual-qa` |
| authority | `write-scoped` |
| tools | read, grep, find, ls, edit, write, bash |
| command mode | `scoped-shell` |

## Routing prompt

> Prepended to the lane task prompt when the router selects this domain.

```text
DOMAIN: Visual QA & Website Cloning. You are operating in a browser-driven UI reconstruction and verification lane.
This domain carries the ai-website-cloner-template workflow inside OMK loadouts without copying its project scaffold.
Pipeline: Reconnaissance -> Design-Token Foundation -> Component Specs -> Asset Gate -> Build Gate -> QA Gate.

SEQUENCE:
1. Pre-flight: browser automation is required. Prefer Chrome/Playwright: chrome-devtools for live inspection, playwright for deterministic screenshot, viewport, and interaction replay. Use context7 for current framework and Playwright docs before coding against unfamiliar APIs.
2. Reconnaissance: capture full-page screenshots at responsive sizes 1440/768/390, getComputedStyle color/type/spacing tokens, assets, page topology, z-index/sticky overlays, scroll/click/hover/time behavior, and responsive breakpoints. Save bounded artifacts and behavior notes.
3. Design-Token Foundation: update only the target project's existing frontend foundation: fonts, globals, tokens, icon extraction, downloaded assets, typed content structures, and page-level motion primitives. Foundation is sequential.
4. Component Specs: component-spec-before-build requires one spec per section/sub-component before implementation. Specs include exact getComputedStyle values, DOM structure, all states, interaction model, assets, verbatim text, screenshots, and responsive behavior. Split specs that would create a builder prompt over ~150 lines.
5. Asset Gate: real extractable assets are downloaded, named, and referenced before build; no mock assets when source assets are available.
6. Build Gate: dispatch or implement one section/sub-component at a time from its spec; builders receive the full spec inline, not a pointer. Require typecheck-after-edit and the target project's build/smoke command before merging/assembling.
7. QA Gate: wire sections into page layout, then visual-diff-after-edit requires side-by-side visual diff artifacts against the reference at 1440/768/390. Re-test scroll, hover, click, tab, carousel, modal, and animation behavior with Chrome/Playwright.
8. Evidence: bounded-evidence records screenshots, getComputedStyle captures, responsive sizes 1440/768/390, side-by-side visual diff paths, Chrome/Playwright command/tool results, changed files, known discrepancies, and any remaining fidelity gaps.

HARD RULES: no guessed CSS values; no builder without a spec artifact; no mock assets when real assets are extractable; no completion claim without visual diff evidence; general Playwright test failures without visual/reconstruction intent stay in qa-testing.
```

## Curated skills (17)

- `clone-website`
- `browser-qa`
- `webapp-testing`
- `e2e-testing`
- `playwright-cli`
- `web-quality-audit`
- `audit-and-fix`
- `visual-regression`
- `visual-diff`
- `visual-ralph`
- `image-to-code`
- `frontend-ui-engineering`
- `frontend-design`
- `fixing-accessibility`
- `contrast-checker`
- `use-of-color`
- `fix-motion-performance`

## Curated MCP servers (4)

- `chrome-devtools`
- `playwright`
- `filesystem`
- `context7`

## Curated hooks (7)

- `component-spec-before-build`
- `visual-diff-after-edit`
- `typecheck-after-edit`
- `pre-shell-guard`
- `protect-secrets`
- `bounded-evidence`
- `stop-verify`

## Routing triggers (17)

| kind | pattern | weight |
|---|---|---|
| keyword | `visual qa` | 8 |
| keyword | `visual diff` | 8 |
| keyword | `screenshot diff` | 8 |
| keyword | `website clone` | 8 |
| keyword | `clone website` | 8 |
| keyword | `pixel-perfect clone` | 9 |
| keyword | `responsive sweep` | 7 |
| keyword | `interaction sweep` | 7 |
| keyword | `component spec` | 7 |
| keyword | `getcomputedstyle` | 7 |
| keyword | `design tokens` | 6 |
| keyword | `assembly qa` | 6 |
| keyword | `reconnaissance` | 6 |
| keyword | `클론` | 6 |
| keyword | `스크린샷` | 5 |
| regex | `\b(pixel[ -]?perfect|visual regression|viewport sweep)\b` | 7 |
| regex | `\b(recreate|rebuild|reverse-engineer)\b.*\b(website|page|site)\b` | 7 |
