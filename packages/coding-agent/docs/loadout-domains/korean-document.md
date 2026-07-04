# Korean Document (HWP/HWPX) (`korean-document`)

> Inherited domain capability document. Auto-generated from `src/core/domain-loadouts.ts` — do not edit by hand.


## Identity

| field | value |
|---|---|
| id | `korean-document` |
| authority | `write-scoped` |
| tools | read, grep, find, ls, edit, write, bash |
| command mode | `scoped-shell` |

## Routing prompt

> Prepended to the lane task prompt when the router selects this domain.

```text
DOMAIN: Korean Document (HWP/HWPX). You are operating in a document extraction/rendering/export lane for Korean Hangul documents.
Use OMK skills, MCP, and hooks to orchestrate rhwp-style capability without vendoring Rust, WASM, or CLI binaries into the repo.

SEQUENCE:
1. Detection first: identify HWP/HWPX by extension plus container sniffing. HWP is normally OLE Compound File Binary; HWPX is normally ZIP/XML package content. Never trust extension alone. Record filename, byte size, hash, detected format, and whether the file appears encrypted/protected.
2. Load current docs with context7 before coding against @rhwp/core, rhwp APIs, pdf rendering packages, or browser automation APIs. Use project-installed tools when present; do not add or vendor rhwp Rust/WASM/CLI artifacts unless the user explicitly requests dependency work.
3. Extraction path: produce bounded text and markdown outputs, structured metadata, section/page outline, tables, images/assets references, equations/charts notes, and warnings for unsupported controls. Keep private document content bounded: short excerpts, counts, hashes, and output paths rather than dumping whole documents.
4. Render path: use rhwp-oriented skills for layout/page fidelity. Use chrome-devtools/playwright only to render or capture web/WASM/canvas/SVG views that already exist in the project. Capture SVG/page snapshots and PNG evidence with viewport/page labels.
5. Export path: support text, markdown, svg, png, and pdf outputs. Prefer native/project export APIs when available; otherwise assemble via browser-rendered SVG/canvas/PDF flows. Always write artifacts to an explicit output directory and report a manifest.
6. Metadata path: collect page count, section count, dimensions, fonts, embedded images, tables, headers/footers, footnotes/endnotes, equations/charts, fields, protection/encryption status, and conversion warnings.
7. Evidence: bounded-evidence and document-artifact-guard require an artifact manifest containing input hash, detected format, commands/tools used, output paths, output byte sizes, page/sample counts, warnings, and at most small redacted excerpts. stop-verify must pass before done.

HARD RULES: no vendored rhwp binaries; no fake conversion claims; no full private document dump in chat; output artifacts must be traceable; every render/export claim needs bounded evidence.
```

## Curated skills (10)

- `rhwp`
- `rhwp-edit`
- `rhwp-advanced`
- `hwp`
- `kordoc`
- `document-conversion`
- `document-extraction`
- `pdf`
- `react-pdf`
- `verification-loop`

## Curated MCP servers (4)

- `filesystem`
- `context7`
- `chrome-devtools`
- `playwright`

## Curated hooks (5)

- `pre-shell-guard`
- `protect-secrets`
- `bounded-evidence`
- `document-artifact-guard`
- `stop-verify`

## Routing triggers (17)

| kind | pattern | weight |
|---|---|---|
| keyword | `hwp` | 7 |
| keyword | `hwpx` | 8 |
| keyword | `rhwp` | 8 |
| keyword | `hancom` | 6 |
| keyword | `hangul document` | 6 |
| keyword | `한글 문서` | 7 |
| keyword | `아래아한글` | 7 |
| keyword | `한컴` | 6 |
| keyword | `hwp to markdown` | 8 |
| keyword | `hwp to pdf` | 8 |
| keyword | `hwpx to pdf` | 8 |
| keyword | `svg export` | 3 |
| keyword | `document metadata` | 4 |
| regex | `\b(hwp|hwpx|rhwp|hancom)\b` | 7 |
| regex | `\b(extract|render|export|metadata)\b.*\b(hwp|hwpx)\b` | 6 |
| extension | `.hwp` | 9 |
| extension | `.hwpx` | 9 |
