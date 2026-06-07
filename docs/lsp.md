# Built-in LSP

open-multi-agent-kit ships bundled TypeScript and Python LSP launchers for open-source projects.

## Commands

```bash
omk lsp --print-config   # print the default .omk/lsp.json payload
omk lsp --check          # show the resolved bundled language-server binary for the default server
omk lsp typescript       # start typescript-language-server over stdio
omk lsp python           # start pyright-langserver over stdio
```

## Default project config

`omk init` writes `.omk/lsp.json` with bundled TypeScript and Python server entries:

```json
{
  "version": 1,
  "enabled": true,
  "defaultServer": "typescript",
  "servers": {
    "typescript": {
      "command": "omk",
      "args": ["lsp", "typescript"],
      "languages": ["typescript", "typescriptreact", "javascript", "javascriptreact"],
      "rootPatterns": ["tsconfig.json", "jsconfig.json", "package.json"],
      "bundled": true
    },
    "python": {
      "command": "omk",
      "args": ["lsp", "python"],
      "languages": ["python"],
      "rootPatterns": ["pyproject.toml", "requirements.txt", "uv.lock", "setup.py"],
      "bundled": true
    }
  }
}
```

The launcher uses the package-local `typescript-language-server` and `pyright` dependencies, so consumers do not need maintainer-local paths or API keys.

## Security notes

- The LSP config contains no credentials.
- It ships bundled TypeScript and Python LSP launchers by default.
- Additional language servers should be added explicitly per project.
