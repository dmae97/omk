# No-Kimi mode

## Short answer

OMK is not a Kimi wrapper. It runs as the `open-multi-agent-kit` package with the `omk` binary, and Kimi-compatible lanes are optional adapters.

## Can OMK run without Kimi?

Yes. OMK is provider-neutral. You can run it with Codex, OpenCode, DeepSeek, Qwen, OpenRouter, MiMo, or local models and never select a Kimi-compatible adapter.

## How is no-Kimi verified?

```bash
npm ci
npm run build
npm run verify:no-kimi
```

`verify:no-kimi` exercises doctor, chat, codex, default-surface, and runtime-routing paths with provider pinning, smoke mode, and `--mcp-scope none` so the legacy Kimi fallback is not used. The source-controlled `009-no-kimi-smoke` proof bundle additionally pins `KIMI_BIN=/nonexistent/kimi`.

## Quick start without Kimi

```bash
npm install -g open-multi-agent-kit
omk init
omk doctor
omk do "explain this repo" --dry-run --json
```

## What this does not claim

A no-Kimi run still depends on at least one configured provider; OMK does not ship a bundled model.

## Related

- [What is OMK?](../what-is-omk.md)
- [Provider routing for AI coding](provider-routing-for-ai-coding.md)
- [Provider maturity](../provider-maturity.md)
