# OMK v0.90.7

OMK v0.90.7 ships the `ultra` thinking level with the GPT-5.6 model family, opt-in parallel tool batching in the agent loop, TUI skill autocomplete plus Korean/CJK cursor fixes, and command-safety search-pattern false-positive fixes. It is a lockstep patch release for the OMK package set.

## Highlights

| Area | Release note |
| Thinking / models | Added the `ultra` thinking level (maximum reasoning with automatic task delegation; GPT-5.6 Sol/Terra via `openai-codex`) and the GPT-5.6 family (`gpt-5.6`, `-sol`, `-terra`, `-luna`) across OpenAI, Azure, OpenRouter, AI Gateway, and Codex, plus a regenerated model catalog. |
| Agent loop | Added opt-in parallel tool batching: `shouldParallelizeToolBatch` parallelizes a batch only when every tool's execution policy allows it; tools without a policy stay sequential. |
| TUI | Added bare first-token and mid-message `/` skill autocomplete; fixed vertical cursor movement to track display cells so wrapped Korean/CJK lines keep the cursor column; fixed `wordWrapLine` stack overflow on indivisible wide graphemes at width 1. |
| Command safety | Fixed `secret.read_path` false positives: the pattern argument right after `--` in `grep`/`egrep`/`fgrep`/`rg` is not a secret file operand, while real secret-file operands stay confirm-tier. |
| Release infra | Fixed npm trusted-publishing identity after the GitHub repository rename by aligning package metadata with `dmae97/omk`. |

## Packages

- `open-multi-agent-kit@0.90.7`
- `omk-ai@0.90.7`
- `omk-agent-core@0.90.7`
- `omk-tui@0.90.7`

## Install

```bash
npm install -g --ignore-scripts open-multi-agent-kit@0.90.7
omk --version
```

Expected output:

```
0.90.7
```
