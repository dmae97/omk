---
name: provider
description: Slash command for safe OMK provider routing, doctor checks, and OAuth/login guidance without exposing secrets.
---

# /provider

Inspect or configure OMK provider routing while keeping Kimi as the final authority and avoiding secret leakage.

## Commands

```bash
omk provider list
omk provider doctor <provider> --soft
omk provider auth <provider> --method api-key-env|oauth|external-cli --api-key-env <ENV_NAME>
omk provider oauth <provider>
omk provider profiles
omk provider set <provider> --model <model> --base-url <url> --api-key-env <ENV_NAME>
omk provider enable <provider>
omk provider disable <provider> "reason"
```

Machine-readable, stdout-only output:

```bash
omk provider list --json
omk provider oauth openrouter --json
omk provider profiles --json
omk provider doctor deepseek --soft --json
```

DeepSeek shortcuts:

```bash
omk deepseek api
omk deepseek enable
omk deepseek doctor --soft
```

## Rules

- Never print, summarize, or store OAuth tokens/API keys in the project repository.
- `omk provider oauth` provides local login instructions/metadata only; browser/device exchanges must be completed in the provider's official CLI.
- OpenRouter uses `OPENROUTER_API_KEY` and `https://openrouter.ai/api/v1`; register only env metadata with `omk provider auth openrouter --method oauth --api-key-env OPENROUTER_API_KEY`.
- Register only API-key environment variable names with `omk provider set`; do not pass secret values.
- Treat non-Kimi providers as advisory or low-risk workers unless explicit project policy says otherwise.
- Run provider doctor checks with `--soft` when you want fallback diagnostics without failing the whole task.
