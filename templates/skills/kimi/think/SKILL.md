---
name: think
description: Slash command for OMK reasoning-depth control, thinking variant cycling, and model-variant selection without exposing prompts or secrets.
---

# /think

Control OMK reasoning depth for the current chat/session. Use this when you need a quick toggle (`/think`) or an explicit reasoning level before a difficult planning, coding, or review turn.

## Commands

```bash
/think
/think next
/think medium
/think high
/think xhigh
/think max
/think variant <name>
/thinking <level>
```

Runtime equivalent for scripted checks:

```bash
OMK_THINKING=xhigh omk chat --provider <provider> --model <model>
```

## Behavior

- `/think` and `/think next` cycle to the next supported level for the active provider/model.
- `/think xhigh` pins the session to an explicit high-reasoning variant when supported.
- `/think variant <name>` uses a provider-specific model variant name after OMK normalization.
- `/thinking` is an alias for `/think`.

## Rules

- Do not print hidden chain-of-thought; report concise reasoning summaries and evidence instead.
- Do not expose prompts, API keys, tokens, cookies, or raw provider traces.
- If a provider does not support the requested level, use `/model` or `/help` to inspect available routing and choose the closest supported level.
- Keep the final answer evidence-gated: changed files, commands run, failures, and risks.
