# omk-reverse-skill route map

Canonical skill name: **omk-reverse-skill**.
Implementation: `packages/agent/src/harness/reverse-skill.ts`.
Packs live in `~/.omk/agent/skills/omk-reverse-skill/packs/`.

| Route ID | Primary path | Typical signals |
|---|---|---|
| `api-spec-recover` | `skills/omk-reverse-skill/packs/api-spec-recover/SKILL.md` | mitmproxy, HAR, OpenAPI |
| `api-client-gen` | `skills/omk-reverse-skill/packs/api-client-gen/SKILL.md` | HAR, Playwright, Python client |
| `protocol-re` | `skills/omk-reverse-skill/packs/protocol-re/SKILL.md` | pcap, tshark, scapy |
| `ghidra-ida-re` | `skills/omk-reverse-skill/packs/ghidra-ida-re/SKILL.md` | analyzeHeadless, IDAPython |
| `apk-reverse` | `skills/omk-reverse-skill/packs/android-re/SKILL.md` | APK, jadx, Frida |
| `ida-reverse` | `skills/ida-reverse/SKILL.md` | exe, dll, elf, xref |
| `radare2` | `skills/radare2/SKILL.md` | CLI recon, strings, offsets |
| `js-reverse` | `skills/js-reverse/SKILL.md` | frontend signature, encrypted params |
| `browser-automation` | `skills/browser-automation/SKILL.md` | screenshot, capture network |
| `gitreverse` | `skills/gitreverse/SKILL.md` | github repo → prompt |
| `ctf-sandbox-orchestrator` | CTF orchestrator SKILL | CTF, flag, pwn |
| `api-security` | `skills/api-security/SKILL.md` | REST, GraphQL, IDOR |
| `supply-chain-security` | `skills/supply-chain-security/SKILL.md` | SBOM, CI/CD |
| `docs-generator` | `skills/docs-generator/SKILL.md` | report, writeup |

Scoring: target ×4, intent ×3, toolchain ×2, keywords ×1, triad bonus when all three match.
