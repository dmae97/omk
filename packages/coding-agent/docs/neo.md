# Neo public skills and computer-use setup

Status: implementation candidate, not a published release. Neo names the public computer-use workflow in this change; it is not a new model or an independent agent runtime.

## What changes

The normal `DefaultResourceLoader` now reads six publicly authored skills from `resources/neo/skills` inside the installed package. No private agent-home content is copied. Explicit, project and user skills retain ownership of matching names; bundled skills fill only missing names. `noSkills` disables automatic bundled loading while preserving explicitly supplied skills, and `OMK_BUNDLED_SKILLS=0` disables just the bundled set. Skill overrides continue to run after resource loading.

Both the npm package allowlist and the two binary asset paths include the same `resources` tree. Files remain inside the installation; startup does not write skills into the user's home. A missing bundle produces a loader diagnostic, and `omk neo list` returns a nonzero exit code if one of its required skill files is missing.

| Default skill | Purpose |
| --- | --- |
| `omk-computeruse` | Neo target/capability routing and observe, act, verify workflow |
| `omk-browser` | DOM/accessibility interaction, bounded retries and side-effect approval |
| `omk-site` | Existing-project site implementation, preview and responsive validation |
| `omk-research` | Version-aware primary documentation and evidence handling |
| `omk-code-review` | Minimal changes, real regression checks and live-call-path review |
| `omk-mcp-setup` | Inventory, configuration preview, explicit setup and health verification |

These instructions are available independently of the selected model family. Tool calling must actually work. Image interpretation additionally requires compatible model and provider input support. Text-only models should use DOM/accessibility observations. This change does not establish Astra-equivalent performance, add a native desktop driver, or turn an incapable model into a computer-use model.

## Skills and MCPs are different products

| Quantity | Meaning |
| --- | --- |
| Packaged skill | Instruction file is present in the installation |
| Loaded skill | Resource loader admitted the file after overrides and disable settings |
| Offered MCP | Public configuration preset is available |
| Configured MCP | User selected a server in a configuration file |
| Connected MCP | The running process completed its connection/handshake |
| Verified tool | A discovered tool succeeded against the intended target |

`omk neo list` reports packaged files and offered presets. It deliberately returns `connected: null` and `connectionStatus: "not_probed"`; it does not manufacture a nonzero MCP connection count. The normal session MCP status remains the connection authority.

## Curated MCP choices

| Preset | Distribution | Activation | Scope |
| --- | --- | --- | --- |
| `playwright` | Pinned stdio recipe for `@playwright/mcp@0.0.81` | Explicit user setup | Browser actions and accessibility snapshots; compatible browser required |
| `context7` | Pinned stdio recipe for `@upstash/context7-mcp@4.1.1` | Explicit user setup | External technical documentation queries |
| Native CUA/desktop driver | Not installed or configured by this change | Separate reviewed setup | Host permissions and host identity must be verified |
| Chrome personal-profile attachment | Not enabled by default | Separate explicit session approval | May expose existing authenticated state |
| Stagehand and Browserbase cloud | Not installed or configured by this change | Separate dependency, credentials and cost approval | Optional local library or cloud browser |
| Account-connected repository/services | Not configured by this change | Per-user authentication and scope approval | No publisher credential is shared |

The recipes pin the direct package version, not an entire third-party transitive dependency graph. They do not bundle executables or browser binaries. Installation and tool behavior still need to be tested on the target platform. No remote HTTP URL is advertised as directly loadable by the current stdio-only OMK loader.

## Commands

```bash
omk neo list
omk neo setup playwright context7
omk neo mcp-config playwright context7
```

All three are local and do not start a process, download a server or connect a browser. `setup` without `--apply` is a dry run. `mcp-config` emits disabled entries only. Existing configuration is never printed.

After approving the exact target and the server execution/network effects:

```bash
# Project-local, in the intended project directory:
omk neo setup playwright context7 --apply

# Alternative: explicitly select the global configuration target:
omk neo setup playwright context7 --global --apply
```

Project target: `<cwd>/.omk/mcp.json`. Global target: `~/.omk/mcp.json`, not `~/.omk/agent/mcp.json`. On the next ordinary OMK startup `npx` may download and execute the selected pinned servers. The command itself only creates configuration and reports `configured_not_connected`. A project entry can override a global entry with the same server name.

Setup is intentionally no-overwrite. It validates all presets before filesystem changes, writes a complete temporary file with mode `0600` and publishes it through an atomic no-replace hard link. An existing target, including malformed data or a symlink, is preserved. A symlinked `.omk` directory is rejected. Filesystems that do not support hard links fail closed. This is not a defense against a hostile process concurrently replacing an ancestor directory; use a trusted user-owned configuration location. Windows ACL and power-loss durability guarantees are outside this implementation.

For an existing configuration, generate disabled entries with `mcp-config`, then review a manual merge without exposing secrets. Do not replace the file to work around the refusal. This change does not alter legacy MCP config precedence or overwrite any account settings.

## Browser safety and capability

The Playwright recipe requests `--headless --isolated --sandbox` and bounded action/navigation timeouts. It does not attach to a personal browser, disable TLS checks or request unrestricted file access. The upstream Linux bundled-browser default can disable its sandbox; the explicit positive flag is therefore intentional. A sandbox launch failure must be diagnosed rather than bypassed.

Profile isolation is not OS or network isolation. Origin allowlists are not complete redirect or SSRF boundaries. Operator-managed process/network isolation is required for stronger threat models. The workflow rejects instruction authority from pages, tool output and server descriptions. Skills guide the model; they do not independently enforce every permission boundary in the runtime.

After configuration, restart the intended OMK process, inspect the actual connection status and tool roster, and perform a read-only health check. Then use an observation before each action and verify the final requested state. A timeout is not permission to repeat a non-idempotent operation. Native desktop, paid cloud and private-account actions remain separate opt-ins.

## Verification and release gates

Harness impact: `advance` for distributable capability discovery; `preserve` for existing skill precedence, disable behavior and configuration ownership. Baseline is `739bc6f3b6fe1c89bfe058aad7ec17ad252fb10e` (`0.99.0`).

Acceptance: six valid files in the npm and each platform bundle; six default skills in an empty agent/project environment; zero writes on list/dry run; byte-identical preservation of existing MCP config; no false connected count. No performance superiority claim is made.

```bash
node --experimental-strip-types --test scripts/test/neo-distribution.test.mjs
cd packages/coding-agent
node ../../node_modules/vitest/dist/cli.js --run test/neo-distribution.test.ts
cd ../..
npm run check
npm run build
```

The Node test covers actual catalog/CLI/setup functions, file preservation, symlinks and asset inclusion declarations. The Vitest test additionally exercises the real skill loader and `DefaultResourceLoader`; it requires the repository dependencies and a buildable base. Source inspection of binary copy commands is not a built-binary smoke test. Each final archive must be extracted and `omk neo list` checked before release.

Before publishing, run the targeted tests and complete repository gates, verify a clean npm install and real MCP/browser smoke tests, then follow the existing lockstep release procedure. A green test for a leaf module cannot override a failed monorepo build. Do not tag/publish this candidate until all release surfaces agree and blockers are resolved.

## Primary source check, 2026-09-16

- Playwright MCP release `v0.0.81`: https://github.com/microsoft/playwright-mcp/releases/tag/v0.0.81
- Exact documented flags: https://github.com/microsoft/playwright-mcp/blob/v0.0.81/README.md
- Context7 release `@upstash/context7-mcp@4.1.1`: https://github.com/upstash/context7/releases/tag/%40upstash/context7-mcp%404.1.1
- Context7 stdio CLI: https://github.com/upstash/context7/blob/master/packages/mcp/src/index.ts

Upstream source/release inspection is not an installed-server integration test. Credentials, provider quality and target-host permissions are not verified by this document.
