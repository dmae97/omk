# OpenAI Platform keys for image generation

OMK separates Codex login from OpenAI API access.

- **Codex/ChatGPT OAuth**: proves the Codex CLI login state only.
- **OpenAI Platform project API key**: required for `omk image generate` and `omk image edit`, including `gpt-image-2`.

Safe local flow:

1. Complete OpenAI Platform OAuth in a trusted setup surface.
2. Create an encrypted project API key for the target Platform project.
3. Decrypt the key locally only when needed.
4. Run one image command with an ephemeral runtime environment variable.
5. Unset the env var and remove any decrypted temp key.

Example with a placeholder value:

```bash
OPENAI_API_KEY=<platform-project-key> omk image generate "ping-pong test" --model gpt-image-2
unset OPENAI_API_KEY
```

OMK reads the key only from the runtime environment and does not store it in project files, MCP config, image metadata, or run evidence. Use `--api-key-env <name>` if your local encrypted-key helper injects a different one-shot env var.
