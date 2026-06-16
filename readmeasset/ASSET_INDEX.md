# README asset index

Curated OMK//CONTROL assets in this directory. Assets are provenance-covered and derived from existing OMK visual sources or local SVG/Pillow renders using the OMK palette. The npm package ships only the entries marked `yes` through `readmeasset/.npmignore`; the remaining files are repository-local README/design source assets.

| File                            | Packaged  | Purpose                                        | Source                                     | Dimensions  | Format |  Bytes |
| ------------------------------- | --------- | ---------------------------------------------- | ------------------------------------------ | ----------- | ------ | -----: |
| `omk-freedomd-control-plane.webp` | yes | v0.80.2 Freedomd README hero | Codex OAuth gpt-image-2 with `omk-control.webp` style reference | `1983x793` | `WEBP` | 1877984 |
| `omk-freedomd-control-plane.svg` | yes | v0.80.2 Freedomd README fallback | deterministic local SVG fallback retained for provenance | `1600x640` | `SVG` | 4415 |
| `omk-control.webp`              | yes       | Canonical README hero                          | Codex/OpenAI Images reviewed source        | `1536x1024` | `WEBP` | 164502 |
| `omk-social-preview.png`        | yes       | GitHub/NPM social preview                      | local crop from omk-control.webp           | `1200x630`  | `PNG`  | 737974 |
| `social-preview.png`            | repo-only | GitHub social preview upload candidate         | local Pillow render from omk-control.webp  | `1280x640`  | `PNG`  | 441349 |
| `omk-tui-0.78.0.webp`           | yes       | 0.78.0 TUI mockup                              | Codex OAuth gpt-image-2 + local correction | `1536x1024` | `WEBP` | 244008 |
| `omk_tui.png`                   | yes       | GitHub README terminal dashboard screenshot    | existing OMK TUI capture                   | `1712x1129` | `PNG`  | 141653 |
| `omk-runtime-flow-0.78.0.webp`  | yes       | 0.78.0 runtime flow diagram                    | Codex OAuth gpt-image-2 + local correction | `1536x1024` | `WEBP` | 235842 |
| `omk-github-header.webp`        | yes       | GitHub README wide header                      | omk-control.webp                           | `1600x640`  | `WEBP` | 160858 |
| `omk-github-banner.webp`        | yes       | GitHub compact banner                          | omk-control.webp                           | `1600x400`  | `WEBP` | 115026 |
| `omk-logo-512.png`              | yes       | 512px OMK logo mark render                     | local Pillow render from OMK palette       | `512x512`   | `PNG`  |  10772 |
| `omk-logo-128.png`              | repo-only | 128px OMK logo mark render                     | local Pillow render from OMK palette       | `128x128`   | `PNG`  |   2530 |
| `omk-social-square.png`         | repo-only | Square social/avatar preview                   | omk-control.webp                           | `1024x1024` | `PNG`  | 621524 |
| `omk-palette-swatch.png`        | repo-only | Brand color swatch                             | ASSET_PROVENANCE.md palette tokens         | `1200x260`  | `PNG`  |  17413 |
| `omk-install-card.png`          | yes       | Install/quickstart card                        | local Pillow render from OMK palette       | `1200x630`  | `PNG`  |  42754 |
| `omk-cli-quickstart.png`        | repo-only | CLI quickstart card                            | local Pillow render from OMK palette       | `1200x630`  | `PNG`  |  44997 |
| `omk-provider-router-card.png`  | yes       | Provider router explainer card                 | local Pillow render from OMK palette       | `1200x630`  | `PNG`  |  42085 |
| `omk-evidence-gate-card.png`    | yes       | Evidence gate explainer card                   | local Pillow render from OMK palette       | `1200x630`  | `PNG`  |  37453 |
| `omk-mcp-scope-card.png`        | repo-only | MCP scope explainer card                       | local Pillow render from OMK palette       | `1200x630`  | `PNG`  |  43556 |
| `omk-worktree-card.png`         | repo-only | Worktree lane explainer card                   | local Pillow render from OMK palette       | `1200x630`  | `PNG`  |  41800 |
| `omk-core-loop-card.png`        | repo-only | Core loop explainer card                       | local Pillow render from OMK palette       | `1200x630`  | `PNG`  |  36921 |
| `omk-tui-dag-lane.webp`         | repo-only | TUI DAG lane detail crop                       | omk-tui-0.78.0.webp                        | `900x1255`  | `WEBP` |  51952 |
| `omk-tui-status-panel.webp`     | repo-only | TUI status/telemetry detail crop               | omk-tui-0.78.0.webp                        | `900x787`   | `WEBP` |  55376 |
| `omk-tui-route-graph.webp`      | repo-only | TUI live route graph crop                      | omk-tui-0.78.0.webp                        | `900x691`   | `WEBP` |  65446 |
| `omk-runtime-router-crop.webp`  | repo-only | Runtime router and worker crop                 | omk-runtime-flow-0.78.0.webp               | `900x589`   | `WEBP` |  61800 |
| `omk-evidence-loop-0.78.0.webp` | repo-only | Evidence bundle and verify gate crop           | omk-runtime-flow-0.78.0.webp               | `900x774`   | `WEBP` |  60808 |
| `omk-runtime-flow-wide.webp`    | repo-only | Runtime flow wide strip                        | omk-runtime-flow-0.78.0.webp               | `1485x178`  | `WEBP` |  45258 |
| `omk-architecture-strip.webp`   | repo-only | TUI command timeline and evidence ledger strip | omk-tui-0.78.0.webp                        | `1536x273`  | `WEBP` |  71128 |
| `omk-core-loop.svg`             | yes       | OMK Core Loop                                  | local SVG render from OMK palette          | `1200x420`  | `SVG`  |   2731 |
| `omk-control-surfaces.svg`      | yes       | Operator control surfaces                      | local SVG render from OMK palette          | `1200x420`  | `SVG`  |   3325 |
| `omk-release-assertions.svg`    | yes       | Release assertion card                         | local SVG render from OMK palette          | `1200x420`  | `SVG`  |   3052 |
| `omk-init-control-loop.svg`     | yes       | Init to control loop                           | local SVG render from OMK palette          | `1200x520`  | `SVG`  |   7339 |
| `omk-parallel-subagents.svg`    | yes       | Parallel subagent lanes                        | local SVG render from OMK palette          | `1200x520`  | `SVG`  |   6559 |
| `omk-adaptorch-ouroboros-supermemory.svg` | yes | Adaptive memory stack                    | local SVG render from OMK palette          | `1200x520`  | `SVG`  |   6404 |
| `omk-provider-lanes.svg`        | repo-only | Provider Lanes                                 | local SVG render from OMK palette          | `1200x420`  | `SVG`  |   2753 |
| `omk-evidence-ledger.svg`       | repo-only | Evidence Ledger                                | local SVG render from OMK palette          | `1200x420`  | `SVG`  |   2411 |
| `omk-badges.svg`                | repo-only | OMK Badges                                     | local SVG render from OMK palette          | `1200x420`  | `SVG`  |   2405 |
| `omk-logo-mark.svg`             | yes       | Vector OMK logo mark                           | local SVG render from OMK palette          | `512x512`   | `SVG`  |    649 |
