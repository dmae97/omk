# OMK v0.90.6

OMK v0.90.6 ships operator loadout docs and the omkgirl hero asset, lands the B2C Correctness Wall extension and Grok OAuth harness wiring already staged under Unreleased, and continues the v4 reasoning-router generalization track. It is a lockstep patch release for the OMK package set.

## Highlights

| Area | Release note |
|------|--------------|
| Docs / operator loadout | Documented the pinned pi.dev package install set, slash-command map, and skills.sh flow in the root README; added `readmeasset/omkgirl.png`. |
| Correctness Wall | Added the experimental B2C Correctness Wall extension with soft/hard/shadow modes and evidence-gated advisory evaluation (not formal proof). |
| Grok harness | Added Grok OAuth harness domain profile, playbook auto-apply for `grok-oauth-proxy`, compaction preference for `grok-4.5`, and Imagine chat-model rejection on completion paths. |
| Extension host | Added `callMcpTool` bind path so extensions can capture live MCP call capability at load time. |
| Reasoning router | Evolved v4 intent classification with normalize/lexeme clusters and a governed generalization gate over a synthetic held-out corpus. |

## Packages

- `open-multi-agent-kit@0.90.6`
- `omk-ai@0.90.6`
- `omk-agent-core@0.90.6`
- `omk-tui@0.90.6`

## Install

```bash
npm install -g --ignore-scripts open-multi-agent-kit@0.90.6
omk --version
```

Expected output:

```text
0.90.6
```

## Verification Surface

- `npm run check`
- `npm run release:local -- --out /tmp/omk-local-release --force`
- Node package smoke: help, version, model listing, prompt, and interactive startup
- Bun binary smoke: help, version, model listing, prompt, and interactive startup
