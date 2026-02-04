# Extension Loading

This document describes how omp discovers and loads extensions at runtime. It covers two related systems:

- **Extension modules**: TypeScript/JavaScript modules that register tools, hooks, commands, etc.
- **Gemini-style extensions**: `gemini-extension.json` manifests that declare MCP servers, tools, and context.

## Extension Modules (TypeScript/JavaScript)

### Discovery Locations

Extension modules are auto-discovered from native config roots:

- `.omp` (primary)
- `.pi` (legacy alias)

For each root:

- **User-level**: `~/.omp/agent/extensions/`
- **Project-level**: `<cwd>/.omp/extensions/`

### Configured Paths

Additional extension paths can be provided via settings and CLI:

- **Global settings**: `~/.omp/agent/config.yml` (or `$OMP_CODING_AGENT_DIR/config.yml`)
- **Project settings**: `<cwd>/.omp/settings.json`
- **CLI**: `--extension` or `-e`

The settings schema uses the `extensions` array (paths are files or directories):

```yaml
# ~/.omp/agent/config.yml
extensions:
  - ./local-extension.ts
  - ~/extensions/pack
```

```json
// .omp/settings.json
{
  "extensions": ["./project-extension.ts"]
}
```

Path resolution rules:

- `~` expands to the home directory
- Relative paths resolve against the current working directory

To disable all extension loading:

```bash
omp --no-extensions
```

### Entry Point Resolution

Within an `extensions/` directory (auto-discovered or provided as a configured path):

1. **Direct files**: `extensions/*.ts` or `extensions/*.js`
2. **Subdirectory with index**: `extensions/<name>/index.ts` or `index.js`
3. **Subdirectory with package.json**: `extensions/<name>/package.json` containing `omp.extensions` or `pi.extensions`

Example `package.json` manifest:

```json
{
  "name": "my-extension-pack",
  "omp": {
    "extensions": ["./src/safety-gates.ts", "./src/custom-tools.ts"]
  }
}
```

Notes:

- No recursion beyond one directory level. Use `package.json` manifests for nested layouts.
- Extension discovery ignores dotfiles and `node_modules`.
- `.gitignore`, `.ignore`, and `.fdignore` are honored for auto-discovered directories.

### Extension Naming and Disabling

Extension names are derived from the entry point path:

- `extensions/foo.ts` → `foo`
- `extensions/foo/index.ts` → `foo`

To disable an extension module, add its ID to `disabledExtensions`:

```yaml
disabledExtensions:
  - "extension-module:foo"
```

## Gemini-Style Extensions (gemini-extension.json)

`gemini-extension.json` manifests are discovered in config roots under:

```
<root>/extensions/<name>/gemini-extension.json
```

Where `<root>` is one of `.omp`, `.pi`, `.gemini` (at both user and project level).

These manifests describe MCP servers, tools, and context. They are parsed as data (not executed as TypeScript modules). If `name` is missing from the manifest, the directory name is used instead.
