> OMK can help you create OMK packages. Ask it to bundle your extensions, skills, prompt templates, or themes.

# OMK Packages

OMK packages bundle extensions, skills, prompt templates, and themes so you can share them through npm or git. A package can declare resources in `package.json` under the `omk` key, or use conventional directories.

## Table of Contents

- [Install and Manage](#install-and-manage)
- [Package Sources](#package-sources)
- [Creating an OMK Package](#creating-an-omk-package)
- [Package Structure](#package-structure)
- [Dependencies](#dependencies)
- [Package Filtering](#package-filtering)
- [Enable and Disable Resources](#enable-and-disable-resources)
- [Scope and Deduplication](#scope-and-deduplication)

## Install and Manage

> **Security:** OMK packages run with full system access. Extensions execute arbitrary code, and skills can instruct the model to perform any action including running executables. Review source code before installing third-party packages.

```bash
omk install npm:@foo/bar@1.0.0
omk install git:github.com/user/repo@v1
omk install https://github.com/user/repo  # raw URLs work too
omk install /absolute/path/to/package
omk install ./relative/path/to/package

omk remove npm:@foo/bar
omk list                      # show installed packages from settings
omk update                    # update OMK packages and reconcile pinned git refs
omk update --extensions       # update packages and reconcile pinned git refs only
omk update --self             # update the published coding-agent installation only
omk update --self --force     # reinstall the current OMK installation even if current
omk update npm:@foo/bar       # update one package
omk update --extension npm:@foo/bar
```

These commands manage OMK packages, not the published coding-agent package installation. To uninstall OMK itself, see [Quickstart](quickstart.md#uninstall).

By default, `install` and `remove` write to user settings (`~/.omk/agent/settings.json`). Use `-l` to write to project settings (`.omk/settings.json`) instead. Project settings can be shared with your team, and OMK installs any missing packages automatically on startup.

To try a package without installing it, use `--extension` or `-e`. This installs to a temporary directory for the current run only:

```bash
omk -e npm:@foo/bar
omk -e git:github.com/user/repo
```

## Package Sources

OMK accepts three source types in settings and `omk install`.

### npm

```
npm:@scope/pkg@1.2.3
npm:pkg
```

- Versioned specs are pinned and skipped by package updates (`omk update`, `omk update --extensions`).
- User installs go under `~/.omk/agent/npm/`.
- Project installs go under `.omk/npm/`.
- Set `npmCommand` in `settings.json` to pin npm package lookup and install operations to a specific wrapper command such as `mise` or `asdf`.

Example:

```json
{
  "npmCommand": ["mise", "exec", "node@20", "--", "npm"]
}
```

### git

```
git:github.com/user/repo@v1
git:git@github.com:user/repo@v1
https://github.com/user/repo@v1
ssh://git@github.com/user/repo@v1
```

- Without `git:` prefix, only protocol URLs are accepted (`https://`, `http://`, `ssh://`, `git://`).
- With `git:` prefix, shorthand formats are accepted, including `github.com/user/repo` and `git@github.com:user/repo`.
- HTTPS and SSH URLs are both supported.
- SSH URLs use your configured SSH keys automatically (respects `~/.ssh/config`).
- For non-interactive runs (for example CI), you can set `GIT_TERMINAL_PROMPT=0` to disable credential prompts and set `GIT_SSH_COMMAND` (for example `ssh -o BatchMode=yes -o ConnectTimeout=5`) to fail fast.
- Refs are pinned tags or commits. `omk update` and `omk update --extensions` do not move them to newer refs, but they do reconcile an existing clone to the configured ref.
- Use `omk install git:host/user/repo@new-ref` to update settings and move an existing package to a new pinned ref.
- Cloned to `~/.omk/agent/git/<host>/<path>` (global) or `.omk/git/<host>/<path>` (project).
- When reconciliation changes the checkout, OMK resets and cleans the clone, then runs `npm install` if `package.json` exists.

**SSH examples:**
```bash
# git@host:path shorthand (requires git: prefix)
omk install git:git@github.com:user/repo

# ssh:// protocol format
omk install ssh://git@github.com/user/repo

# With version ref
omk install git:git@github.com:user/repo@v1.0.0
```

### Local Paths

```
/absolute/path/to/package
./relative/path/to/package
```

Local paths point to files or directories on disk and are added to settings without copying. Relative paths are resolved against the settings file they appear in. If the path is a file, it loads as a single extension. If it is a directory, OMK loads resources using package rules.

## Creating an OMK Package

Add an `omk` manifest to `package.json` or use conventional directories. Include the `omk-package` keyword for discoverability.

```json
{
  "name": "my-package",
  "keywords": ["omk-package"],
  "omk": {
    "extensions": ["./extensions"],
    "skills": ["./skills"],
    "prompts": ["./prompts"],
    "themes": ["./themes"]
  }
}
```

Paths are relative to the package root. Arrays support glob patterns and `!` exclusions.

### Gallery Metadata

Use your own package site or registry listing metadata as needed. If you publish public previews, place them in your package README or project site.

## Package Structure

### Convention Directories

If no `omk` manifest is present, OMK auto-discovers resources from these directories:

- `extensions/` loads `.ts` and `.js` files
- `skills/` recursively finds `SKILL.md` folders and loads top-level `.md` files as skills
- `prompts/` loads `.md` files
- `themes/` loads `.json` files

## Dependencies

Third-party runtime dependencies belong in `dependencies` in `package.json`. Dependencies that do not register extensions, skills, prompt templates, or themes also belong in `dependencies`. When OMK installs a package from npm or git, it runs `npm install`, so those dependencies are installed automatically.

OMK bundles core packages for extensions and skills. If you import any of these, list them in `peerDependencies` with a `"*"` range and do not bundle them: `@earendil-works/omk-ai`, `@earendil-works/omk-agent-core`, `@earendil-works/omk-coding-agent`, `@earendil-works/omk-tui`, `typebox`.

Other OMK packages must be bundled in your tarball. Add them to `dependencies` and `bundledDependencies`, then reference their resources through `node_modules/` paths. OMK loads packages with separate module roots, so separate installs do not collide or share modules.

Example:

```json
{
  "dependencies": {
    "shitty-extensions": "^1.0.1"
  },
  "bundledDependencies": ["shitty-extensions"],
  "omk": {
    "extensions": ["extensions", "node_modules/shitty-extensions/extensions"],
    "skills": ["skills", "node_modules/shitty-extensions/skills"]
  }
}
```

## Package Filtering

Filter what a package loads using the object form in settings:

```json
{
  "packages": [
    "npm:simple-pkg",
    {
      "source": "npm:my-package",
      "extensions": ["extensions/*.ts", "!extensions/legacy.ts"],
      "skills": [],
      "prompts": ["prompts/review.md"],
      "themes": ["+themes/legacy.json"]
    }
  ]
}
```

`+path` and `-path` are exact paths relative to the package root.

- Omit a key to load all of that type.
- Use `[]` to load none of that type.
- `!pattern` excludes matches.
- `+path` force-includes an exact path.
- `-path` force-excludes an exact path.
- Filters layer on top of the manifest. They narrow down what is already allowed.

## Enable and Disable Resources

Use `omk config` to enable or disable extensions, skills, prompt templates, and themes from installed packages and local directories. Works for both global (`~/.omk/agent`) and project (`.omk/`) scopes.

## Scope and Deduplication

Packages can appear in both global and project settings. If the same package appears in both, the project entry wins. Identity is determined by:
- npm: package name
- git: repository URL without ref
- local: resolved absolute path
