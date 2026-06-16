# Asset provenance

## `omk-control.webp`

- Purpose: canonical README hero and OMK Control / Night City Ops Console branding reference for TUI palette, startup ASCII, HUD, and local terminal logo experiments.
- Packaged path: `readmeasset/omk-control.webp`.
- README usage: `![open-multi-agent-kit — OMK//CONTROL Night City Ops Console for routing agents, evidence gates, telemetry, MCP scope, and operator control](readmeasset/omk-control.webp)`.
- Dimensions: `1536x1024`.
- Format: WebP (`RGB`).
- Byte size: `164502`.
- SHA-256: `b9a92fe56a71d2aea0571baf8667cf2db7cc3d54c7580366aa86bd15c5135036`.
- Alias: `../오픈멀티에이전트킷.webp` is byte-identical and may be used for local runtime experiments only; packaged docs must link to `readmeasset/omk-control.webp`.
- Theme mapping: dark cockpit background `#070B14`, surface `#101826`, signal cyan `#00D6FF`, telemetry green `#00FFC2`, control magenta `#FF47B2`, orchestration purple `#9D4EDD`, warning amber `#FFB000`, fault red `#FF5874`.
- Research references: public terminal theme palette review used `hyperb1iss/silkcircuit`, `mbadolato/iTerm2-Color-Schemes`, `Murderlon/cyberpunk-iterm`, `djorborn/cyberpunk`, `pedruino/wave-cyberpunk-2077`, and `PandaAkiraNakai/starship-cyberpunk-preset`; no external code/assets were copied into this directory.
- Review date: 2026-06-04.
- OpenAI Images API regeneration workflow: generate or edit only through an OpenAI Platform Images API key provided at runtime (for example `OPENAI_API_KEY=<ephemeral> omk image generate ... --model gpt-image-2 --output-format webp`), then copy the reviewed output to `readmeasset/omk-control.webp` and refresh the SHA-256/byte-size fields above.
- Release note: if this asset is regenerated, record the maintainer review decision, model/tool, prompt hash, byte size, dimensions, and SHA-256 before publishing.

## `omk-social-preview.png`

- Purpose: package-safe GitHub/NPM social preview for the OMK//CONTROL rebrand.
- Packaged path: `readmeasset/omk-social-preview.png`.
- Source: deterministic local crop/resize derived from `readmeasset/omk-control.webp`; no external asset was added.
- Dimensions: `1200x630`.
- Format: PNG (`RGB`).
- Byte size: `737974`.
- SHA-256: `4bce3440113d70949bd69d6fbaceb319f299da2241452bab869a201f199ee605`.
- Review date: 2026-06-07.
- Regeneration workflow: regenerate from the reviewed `omk-control.webp` source with a 1200x630 social-card crop, then refresh the SHA-256/byte-size fields before publishing.

## `omk-tui-0.78.0.webp`

- Purpose: package-safe README TUI mockup for `open-multi-agent-kit@0.78.0` showing Codex App OAuth routing, GPT Image 2 asset lane, DAG lanes, scoped MCP, and evidence gates.
- Packaged path: `readmeasset/omk-tui-0.78.0.webp`.
- README usage: `![OMK//CONTROL TUI for open-multi-agent-kit 0.78.0 showing Codex App OAuth routing, GPT Image 2 asset lane, DAG lanes, scoped MCP, and evidence gates](readmeasset/omk-tui-0.78.0.webp)`.
- Generator: Codex OAuth image workflow using `gpt-image-2` (`codex-gpt-image.py generate`) with `readmeasset/omk-control.webp` as the style reference.
- Prompt artifact: `.omk/runs/readmeasset-0.78.0-assets/tui-prompt.md`.
- Prompt SHA-256: `bfa829e364ad63318a4799dba609b0e337dae57be1daf41d2cb5a72ee6f91a5e`.
- Post-processing: local Pillow overlay corrected the quality-gate panel text; no external asset was added.
- Dimensions: `1536x1024`.
- Format: WebP (`RGB`).
- Byte size: `244008`.
- SHA-256: `a8d2f3e374610a6a00317cc028e630907857547bd3dbd178938949c32328f2bd`.
- Review date: 2026-06-07.

## `omk-runtime-flow-0.78.0.webp`

- Purpose: package-safe README operation diagram for `open-multi-agent-kit@0.78.0`, showing the goal-to-DAG-to-evidence verification loop and provider/asset lanes.
- Packaged path: `readmeasset/omk-runtime-flow-0.78.0.webp`.
- README usage: `![OMK 0.78.0 runtime flow diagram: user goal, intent classifier, DAG compiler, runtime router, parallel workers, evidence bundle, verify gate, and merge replay inspect loop](readmeasset/omk-runtime-flow-0.78.0.webp)`.
- Generator: Codex OAuth image workflow using `gpt-image-2` (`codex-gpt-image.py generate`) with `readmeasset/omk-control.webp` as the style reference.
- Prompt artifact: `.omk/runs/readmeasset-0.78.0-assets/operation-diagram-prompt.md`.
- Prompt SHA-256: `85bd56137d9a96ef8d2c656e04e78187205c6392859fba502fa545c9662a0fc8`.
- Post-processing: local Pillow overlay corrected the Codex App OAuth lane copy; no external asset was added.
- Dimensions: `1536x1024`.
- Format: WebP (`RGB`).
- Byte size: `235842`.
- SHA-256: `17551138978e113aa5fb67e0ceb84965a2b20ddb56213a9a317cd2482ec7a18b`.
- Review date: 2026-06-07.

## Curated derivative asset pack (2026-06-07)

- Purpose: expanded GitHub/README asset gallery for OMK//CONTROL documentation, social cards, feature callouts, and diagrams.
- Generation: deterministic local Pillow crops/resizes/renders and hand-authored SVGs from existing provenance-covered OMK sources; no external assets were added.
- Review date: 2026-06-07.
- Regeneration workflow: run `.omk/runs/readmeasset-gallery/generate-readme-gallery.py`, inspect outputs, then refresh this table before publishing.

| File | Source | Purpose | Dimensions | Format | Byte size | SHA-256 |
| --- | --- | --- | --- | --- | ---: | --- |
| `omk-github-header.webp` | omk-control.webp | GitHub README wide header | `1600x640` | `WEBP` | 160858 | `259b9f2572ab2917b62f2235a991053abdca59f3e0629bfd4f21fadd0c32a202` |
| `omk-github-banner.webp` | omk-control.webp | GitHub compact banner | `1600x400` | `WEBP` | 115026 | `ab050b4b24f28bd211920b66e592ddbf2dc44be4c76968b4d9e6b0cd7c7e81b2` |
| `omk-logo-512.png` | local Pillow render from OMK palette | 512px OMK logo mark render | `512x512` | `PNG` | 10772 | `4e8f9723a57944cebaa4e7de631fd5761f2549d217d970c10926d3b4c5591f70` |
| `omk-logo-128.png` | local Pillow render from OMK palette | 128px OMK logo mark render | `128x128` | `PNG` | 2530 | `849d89c20b50610ddf2e41f9b31c844a583b2cb3a8bea6535c51ae775908184d` |
| `omk-social-square.png` | omk-control.webp | Square social/avatar preview | `1024x1024` | `PNG` | 621524 | `3dce6ee453e154c9f3eec2d5127640ad0b78a0eee18a44ede3b4dcc99c7e3834` |
| `omk-palette-swatch.png` | ASSET_PROVENANCE.md palette tokens | Brand color swatch | `1200x260` | `PNG` | 17413 | `5f80adcf3230704a453b28d7bed207b95c8a10c10c247e100caf551d72e2069a` |
| `omk-install-card.png` | local Pillow render from OMK palette | Install/quickstart card | `1200x630` | `PNG` | 42754 | `606c3a25768592c5f2782e50391ba67b96447c50ff0da8cf4e63fd24a33e0de4` |
| `omk-cli-quickstart.png` | local Pillow render from OMK palette | CLI quickstart card | `1200x630` | `PNG` | 44997 | `2f7f8016c8b7ce28eeb13e070c462aa62380463389604c23a0c0fb9047c7a77f` |
| `omk-provider-router-card.png` | local Pillow render from OMK palette | Provider router explainer card | `1200x630` | `PNG` | 42085 | `2d5331b9a42da6a85a647ce8993bb91caf79f98e146eef2af06eec823e4de852` |
| `omk-evidence-gate-card.png` | local Pillow render from OMK palette | Evidence gate explainer card | `1200x630` | `PNG` | 37453 | `2cdb8dbc4ed41e3c467c3905659daa4b30dd62054aa7c46f80e00695c27d2623` |
| `omk-mcp-scope-card.png` | local Pillow render from OMK palette | MCP scope explainer card | `1200x630` | `PNG` | 43556 | `17eb8f97770eb6c24f578f5d639d5a9d49a2a219cedc17bd29f02ea6510a8824` |
| `omk-worktree-card.png` | local Pillow render from OMK palette | Worktree lane explainer card | `1200x630` | `PNG` | 41800 | `ddd3eff0c285a21ced8c482cf1745a428ceba1bd45b51b21c001784450f4195a` |
| `omk-core-loop-card.png` | local Pillow render from OMK palette | Core loop explainer card | `1200x630` | `PNG` | 36921 | `3d45e7d1994958c07ead9006772d26db90839ab89de4172d8c1f012154c0570a` |
| `omk-tui-dag-lane.webp` | omk-tui-0.78.0.webp | TUI DAG lane detail crop | `900x1255` | `WEBP` | 51952 | `714c840de3986982ca250d4c8378ba46605a158bfb331fed0aeaf35a5d1b3068` |
| `omk-tui-status-panel.webp` | omk-tui-0.78.0.webp | TUI status/telemetry detail crop | `900x787` | `WEBP` | 55376 | `861575f83f06ec73009ac0fb8604374359dc2559a907b0c5d2a2e7bdb553d1da` |
| `omk-tui-route-graph.webp` | omk-tui-0.78.0.webp | TUI live route graph crop | `900x691` | `WEBP` | 65446 | `4b6105683f0942b2e2588db56ea6373422ca54131874883c6bc42f115d8b774c` |
| `omk-runtime-router-crop.webp` | omk-runtime-flow-0.78.0.webp | Runtime router and worker crop | `900x589` | `WEBP` | 61800 | `baa0c350aea9d1cb110b9a262532ed491d2847de478aa06823e2c5dce54d417d` |
| `omk-evidence-loop-0.78.0.webp` | omk-runtime-flow-0.78.0.webp | Evidence bundle and verify gate crop | `900x774` | `WEBP` | 60808 | `2c4bf27d738710461b9979144759e06a99729ffcc97f53d1bd985b503b0f99da` |
| `omk-runtime-flow-wide.webp` | omk-runtime-flow-0.78.0.webp | Runtime flow wide strip | `1485x178` | `WEBP` | 45258 | `9edac732cd8de0533e345337392f3dca464a9d8a2f08d8b7a464b685a8da45ce` |
| `omk-architecture-strip.webp` | omk-tui-0.78.0.webp | TUI command timeline and evidence ledger strip | `1536x273` | `WEBP` | 71128 | `c76b825863260ecff832e31d986b91d341903f929faa62727511a594cb714cfe` |
| `omk-core-loop.svg` | themes/night-city.theme.json via scripts/assets-build.mjs | OMK Core Loop | `1200x420` | `SVG` | 2731 | `a9d171c6ac9690c7894e559e4ab449a268b4ebb9675f7871048cf7c5a685b059` |
| `omk-control-surfaces.svg` | themes/night-city.theme.json via scripts/assets-build.mjs | Operator control surfaces | `1200x420` | `SVG` | 3325 | `c3d7c774a5870a3984dc257d48dbab7cf7dce241145a65b10c173f39a4cee1f4` |
| `omk-release-assertions.svg` | themes/night-city.theme.json via scripts/assets-build.mjs | Release assertion card | `1200x420` | `SVG` | 3052 | `1b331c112da07f1e34189542728f197aed2a5fa0b9996d16b3d3f38cb76fa579` |
| `omk-init-control-loop.svg` | themes/night-city.theme.json via scripts/assets-build.mjs | Init to control loop | `1200x520` | `SVG` | 7339 | `73c7a53cfd2b67a9acf5b0fffc4c4d6c354878948234af6aa106c411413335e3` |
| `omk-parallel-subagents.svg` | themes/night-city.theme.json via scripts/assets-build.mjs | Parallel subagent lanes | `1200x520` | `SVG` | 6559 | `3b4db7ab36f1ad345834a8cdcbcea1bfe1bf843049c947c1b3fd18e970d96fda` |
| `omk-adaptorch-ouroboros-supermemory.svg` | themes/night-city.theme.json via scripts/assets-build.mjs | Adaptive memory stack | `1200x520` | `SVG` | 6404 | `e5e39cff9f9317e78c945c149c7bdd85f87e243a94d7065216cb7b05d6ec49ad` |
| `omk-provider-lanes.svg` | themes/night-city.theme.json via scripts/assets-build.mjs | Provider Lanes | `1200x420` | `SVG` | 2753 | `0bf47c27b2f01b0b25833dcb57f3ebae051d8495571dafb5b6c19e1bb0df64a3` |
| `omk-evidence-ledger.svg` | themes/night-city.theme.json via scripts/assets-build.mjs | Evidence Ledger | `1200x420` | `SVG` | 2411 | `de0ea9a31c55dc95facd54c688dd5299646b17123c6b9795e6c30a6176d9942e` |
| `omk-badges.svg` | themes/night-city.theme.json via scripts/assets-build.mjs | OMK Badges | `1200x420` | `SVG` | 2405 | `3a656f743e7961780f86b750c07ca9cd9b4d3bcc79e08912279286da7673b6e0` |
| `omk-logo-mark.svg` | themes/night-city.theme.json via scripts/assets-build.mjs | Vector OMK logo mark | `512x512` | `SVG` | 649 | `0774a7e64b24efc363df759107b1d215fe21a3186aaf74552492228f980f3fa7` |


## omk-freedomd-control-plane.webp

- Packaged path: `readmeasset/omk-freedomd-control-plane.webp`.
- README usage: GitHub hero for OMK v0.80.1 Freedomd provider-sovereignty control plane.
- Generator: Codex OAuth image workflow using `gpt-image-2` (`.agents/skills/codex-gpt-image/scripts/codex_gpt_image.py generate`) with `readmeasset/omk-control.webp` as the style reference.
- Prompt artifact: `.omk/runs/freedomd-release-2026-06-16/codex-oauth-gpt-image-2-prompt.txt`.
- Prompt SHA-256: `88fcb293216d544ef2794bfd7d64c0e8d13df2dfc0f715bd8933596709fb3f20`.
- Auth handling: local Codex OAuth availability was checked with `auth-status`; no OAuth token or session secret is stored in this repository or provenance file.
- Dimensions: `1983x793`; format: `WEBP`; bytes: 1877984; sha256: `ba07098f255b0b8f097485a97f02bba0f52ed44801fb1c4fc707a04a9242bbca`.
- Review date: 2026-06-16.

## omk-freedomd-control-plane.svg

- Packaged path: `readmeasset/omk-freedomd-control-plane.svg`.
- README usage: deterministic fallback for OMK v0.80.1 Freedomd provider-sovereignty control plane.
- Source: deterministic local SVG fallback generated from `DESIGN.md` tokens and current Freedomd runtime features.
- Original OpenAI Platform prompt artifact: `.omk/runs/freedomd-release-2026-06-16/gpt-image-2-prompt.md`.
- Dimensions: `1600x640`; format: `SVG`; bytes: 4415; sha256: `00afea70a2cb826bb804d2cad9a2e452a033e6b90672a9d19f15a421a305ee26`.

## Theme-derived SVG assets (2026-06-10)

- Source of truth: `themes/night-city.theme.json` (`omk.theme.v1` contract, contrast-gated by `npm run theme:check`).
- Generator: `scripts/assets-build.mjs` resolves every `fill`/`stroke`/`stop-color` value from theme primitives and embeds a provenance comment; geometry, layout, and text are preserved.
- Regeneration command: `npm run assets:build` (re-run after any theme token change; the `@<hash>` suffix is the first 12 hex of the theme file's SHA-256).
- Light variant: not built — dark-only by ADR, see `docs/decisions/ADR-theme-dark-only-assets.md`. Non-dark themes are refused unless every used pair passes the 4.5/3.0 WCAG gates inline.
- derived-from: omk.theme.v1/night-city@a0a6a1b0712f — `omk-badges.svg`
- derived-from: omk.theme.v1/night-city@a0a6a1b0712f — `omk-control-surfaces.svg`
- derived-from: omk.theme.v1/night-city@a0a6a1b0712f — `omk-core-loop.svg`
- derived-from: omk.theme.v1/night-city@a0a6a1b0712f — `omk-evidence-ledger.svg`
- derived-from: omk.theme.v1/night-city@a0a6a1b0712f — `omk-logo-mark.svg`
- derived-from: omk.theme.v1/night-city@a0a6a1b0712f — `omk-parallel-subagents.svg`
- derived-from: omk.theme.v1/night-city@a0a6a1b0712f — `omk-provider-lanes.svg`
- derived-from: omk.theme.v1/night-city@a0a6a1b0712f — `omk-release-assertions.svg`
- derived-from: omk.theme.v1/night-city@a0a6a1b0712f — `omk-adaptorch-ouroboros-supermemory.svg`
- derived-from: omk.theme.v1/night-city@a0a6a1b0712f — `omk-init-control-loop.svg`
