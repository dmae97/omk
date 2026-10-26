# Codex Terra Ultra

`omk codex-ultra` starts a **separate non-interactive Codex CLI session** in the current working directory. It does not transfer OMK's conversation, tools, extensions, credentials, verification status, approval policy or sandbox. Codex uses its own account, approval and sandbox configuration; review those settings before running it.

Install the official [OpenAI Codex CLI](https://github.com/openai/codex) version 0.159.0 or later and sign in to that CLI first. The command is supported on Linux, macOS and WSL; native Windows launch is not yet verified.

Before starting the session, OMK asks the locally installed Codex app-server for its model list. It requires that the current list advertises `gpt-6.1-terra`, `ultra` effort and multi-agent `v2`. If discovery times out, fails, or does not advertise these capabilities, OMK exits without starting a session. A model list may come from a local cache and does not prove that the signed-in account can use the model. The Codex CLI reports its own authentication, access and execution errors.

Ultra is a Codex orchestration mode: Codex may use subagents for suitable work. Selecting it is not a guarantee that a subagent will be used. OMK does not send `ultra` as an OpenAI API effort, and this command does not claim that OMK's normal `--provider openai-codex --thinking ultra` path uses the Codex CLI's orchestration mode.

```sh
printf 'Review this repository' | omk codex-ultra
```

The task is read from stdin (maximum 1 MB) and sent to Codex's stdin; it is not passed on the command line. Codex's JSONL event stream is forwarded to stdout, up to 16 MB. It can contain task content, model output and tool output. The command may incur model charges. It cannot request interactive approval, and follows Codex's configured non-interactive policy; it does not bypass approvals or sandboxing. To configure Codex permissions, model settings or authentication, use the official Codex CLI documentation. The user-selected local `codex` executable on PATH is launched without a shell. A Node supervisor owns its process group and stops the group on cancellation or parent disconnect. If the supervisor dies unexpectedly or group termination cannot be confirmed, the result is unknown. Independently detached descendants are outside this process group. Standalone Bun builds are not supported.
