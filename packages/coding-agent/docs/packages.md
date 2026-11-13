> omk can help you create omk packages. Ask it to bundle your extensions, skills, prompt templates, or themes.

# OMK Packages

OMK packages bundle extensions, skills, prompt templates, and themes so you can share them through npm or git. A package can declare resources in `package.json` under `omk` or the compatible `pi` key, or use conventional directories.

## Table of Contents

- [Install and Manage](#install-and-manage)
- [Pi Compatibility and Package Doctor](#pi-compatibility-and-package-doctor)
- [First-party Optional Packages](#first-party-optional-packages)
- [Package Sources](#package-sources)
- [Creating a OMK Package](#creating-a-omk-package)
- [Package Structure](#package-structure)
- [Dependencies](#dependencies)
- [Package Filtering](#package-filtering)
- [Enable and Disable Resources](#enable-and-disable-resources)
- [Scope and Deduplication](#scope-and-deduplication)

## Install and Manage

> **Security:** OMK packages run with full system access. Extensions execute arbitrary code, and skills can instruct the model to perform any action including running executables. Review source code before installing third-party packages. Package install scripts are off by default, and a cloned project's packages and extensions load only after you trust the project.

```bash
omk install npm:@foo/bar@1.0.0
omk install git:github.com/user/repo@v1
omk install https://github.com/user/repo  # raw URLs work too
omk install /absolute/path/to/package
omk install ./relative/path/to/package

omk remove npm:@foo/bar
omk list                     # show installed packages from settings
omk package doctor npm:@foo/bar@1.0.0  # static compatibility report as JSON
omk update                   # update omk, update packages, and reconcile pinned git refs
omk update --extensions      # update packages and reconcile pinned git refs only
omk update --self            # update omk only
omk update --self --force    # reinstall omk even if current
omk update npm:@foo/bar      # update one package
omk update --extension npm:@foo/bar
```

These commands manage omk packages, not the omk CLI installation. To uninstall omk itself, see [Quickstart](quickstart.md#uninstall).

By default, `install` and `remove` write to user settings (`~/.omk/agent/settings.json`). Use `-l` to write to project settings (`.omk/settings.json`) instead. Project settings can be shared with your team, and omk installs any missing packages automatically on startup once you trust the project (see [Project trust](#project-trust)).

### Install scripts

Package lifecycle scripts (`preinstall`, `install`, `postinstall`) run arbitrary code with your privileges, so omk installs packages with `--ignore-scripts`. This applies to `omk install`, `omk update`, dependencies of git packages, missing project packages installed at startup, and `-e` packages. A package that builds native code in its install script will then fail to load; when the error looks like a skipped native build, it names the fix. After reviewing the package, rerun the explicit command with `--allow-scripts`:

```bash
omk install --allow-scripts npm:@foo/native-bar
omk update --allow-scripts
```

`--allow-scripts` applies to that one command only. Installs that happen on their own (startup, `-e`) never run scripts.

### Project trust

A cloned repository's `.omk/` can load code: `packages` and `extensions` in `.omk/settings.json`, files in `.omk/extensions/`, and the `npmCommand`, `shellPath` and `shellCommandPrefix` settings. omk loads none of these until you trust the project:

- Interactive `omk` asks once per project before the session starts and stores the answer in `~/.omk/project-trust.json`, tied to a hash of the project's `packages`, `extensions`, `npmCommand`, `shellPath`, `shellCommandPrefix` values, the relative paths of all files under `.omk/extensions/` (`node_modules` and dot entries excluded, symlinked directories followed), and the contents of `.omk/extensions/package.json` and `.omk/extensions/<entry>/package.json`. It asks again when that hash changes. Editing an existing extension source file does not change the hash. Remove the project's entry from that file to be asked again. A project with more than 5000 files under `.omk/extensions/` is never trusted.
- `-p`, `--mode json`, `--mode rpc` and spawned workers never ask. They follow a stored answer for the same path and hash; otherwise they load project code only with `OMK_TRUST_PROJECT=1`, which prints one line to stderr naming the trusted project path.
- `OMK_TRUST_PROJECT=1` applies only to non-interactive runs and only to the directory omk started in. omk reads it once at startup and removes it from its own environment, so commands the `bash` tool runs (including another `omk`) do not inherit it. Interactive `omk` ignores it and asks.
- `OMK_TRUST_PROJECT=0` keeps project code off in every mode, even after you trusted the project (benchmarks use it), and child processes inherit it.
- The subagent extension passes `OMK_TRUST_PROJECT=1` to a worker only when the parent trusted its project and the worker's gated-items hash matches. The worker must be inside that project or in a worktree currently registered by the same repository, with matching Git common directories and a valid registration back-pointer. The trusted project must be the repository's top level; trusting a monorepo package does not trust sibling packages. Later spawns revalidate registration instead of reusing a past grant; concurrent checks share only in-flight Git queries. Aborted spawns receive no grant. `OMK_TRUST_PROJECT=0` passes down unchanged.
- An untrusted project still gets its skills, prompt templates, themes and other settings; omk reports what it did not load.

`omk install`, `omk update`, `omk remove`, `omk list`, `omk config` and `omk package doctor` use the stored answer (or `OMK_TRUST_PROJECT=1`) but never ask. In an untrusted project they ignore its `npmCommand`, `omk update` and `omk config` neither update nor install its `packages`, and a warning on stderr says so. Project MCP servers have their own trust (`OMK_TRUST_PROJECT_MCP`).

To try a package without installing it, use `--extension` or `-e`. This installs to a temporary directory for the current run only:

```bash
omk -e npm:@foo/bar
omk -e git:github.com/user/repo
```

## Pi Compatibility and Package Doctor

OMK reads package manifests in strict priority order: `omk`, then `pi`, then conventional directories. The first present manifest is authoritative. If it is malformed, OMK reports the error instead of silently falling back. When both keys exist, `omk` wins and the doctor reports that `pi` was shadowed.

A Pi extension directory entry such as `"extensions": ["./"]` resolves to its `index.ts`, `index.js`, `index.mjs`, or `index.cjs`. It is not recursively treated as a directory of independent extensions.

Inspect a local, npm, or git source before installing it:

```bash
omk package doctor ./local-package
omk package doctor npm:@scope/package@1.2.3 > package-doctor.json
omk package doctor git:github.com/user/repo@v1
```

The command emits a versioned JSON report and returns `0` when no compatibility error is found, `1` for an incompatible package or inspection failure, and `2` for invalid CLI usage. It checks manifest precedence, declared resources, legacy Pi runtime imports, `.pi` storage paths, lifecycle event names, headless UI guards, and resume signals.

The doctor never imports extension modules. For npm sources it downloads the registry tarball with `npm pack --ignore-scripts` and extracts bounded regular files without installing dependencies. Git inspection clones without running `npm install`. These static checks are advisory and do not make third-party code trusted.

### Explicit native manifest dialect

Since OMK 2.0 the default is native `omk`: omission and `undefined` select `omk`,
and Pi compatibility (`omk+pi`) is an explicit opt-in. A native-mode load failure
that names a legacy Pi package says how to migrate or opt in. Select the dialect
for one CLI process, or independently select the static doctor's diagnostic target,
which also defaults to `omk`:

```bash
omk --package-manifest-dialect omk -e ./my-extension.ts
omk --package-manifest-dialect=omk+pi -e ./legacy-extension.ts
omk package doctor ./local-package --package-manifest-dialect omk
omk package doctor --package-manifest-dialect=omk+pi ./local-package
```

Both space and equals forms accept only `omk` and `omk+pi`. Empty, missing,
invalid or repeated selections fail before extensions are evaluated or doctor
preparation starts. This is not an environment flag or persisted setting, and
it grants no project trust or command authority.

`DefaultPackageManager` and `DefaultResourceLoader` constructor options accept
`packageManifestDialect?: "omk" | "omk+pi"`. The loader captures the chosen value
at construction and retains it on reload. Direct APIs accept the same option in
their final options argument: `loadExtensions(paths, cwd, eventBus?, options?)`
and `discoverAndLoadExtensions(configured, cwd, agentDir?, eventBus?, options?)`.

With an explicit `"omk"` dialect, a Pi-only managed-package manifest is rejected
as a policy error, not treated as missing or invalid JSON. It cannot fall through
to `index.ts`, conventional resource directories, resource filters or nested
extension discovery. Native `omk` manifests remain authoritative, including when
both keys are present. Packages with neither key retain convention discovery.
Existing manifest path validation still applies.

Native automatic discovery expands manifest globs and collects declared extension
directories under the same policy. It detects cycles within each active branch
and bounds nested manifest traversal to 64 levels. Final selection removes
duplicate canonical paths without letting one branch's exclusions affect another.
Compatibility mode retains its
existing literal-entry and index-fallback behavior.

Direct directory discovery remains distinct from managed-package resolution.
It preserves authoritative empty/malformed manifests, the four supported index
suffixes and existing discovery order. Native Pi-only directory selection is
terminal rather than permission to evaluate a conventional fallback.

Native `omk` supplies no implicit Pi aliases in Node/Jiti or Bun virtual modules.
Boundary A still permits ordinary user-installed dependencies, including Pi
packages, subpaths and transitive dependencies, with their own installed identity.
Missing dependencies fail normal resolution. This is not a runtime declaration
check, namespace blacklist, import firewall or sandbox.

The native doctor reports Pi-only manifests and undeclared literal legacy imports
as migration errors. A matching `dependencies`, `peerDependencies` or
`optionalDependencies` declaration produces a warning, not installation or runtime
compatibility certification. Scoped subpaths match their exact package root;
similarly prefixed package names do not count. Doctor preparation deliberately
uses compatibility selection so it can inspect legacy source without loading it.
The existing bounded relative-source walk, redaction and original-byte
preservation remain in place. Bare dependency graphs, computed imports and
transitive dependency behavior remain outside static coverage. Omission retains
the existing `schemaVersion: 1` JSON shape and compatibility results.

### SDK loader injection

Use the existing public loader injection, not a second `createAgentSession` flag:

```typescript
import { createAgentSession, DefaultResourceLoader, getAgentDir, SessionManager } from "open-multi-agent-kit";

const cwd = process.cwd();
const agentDir = getAgentDir();
const resourceLoader = new DefaultResourceLoader({
  cwd,
  agentDir,
  packageManifestDialect: "omk",
  additionalExtensionPaths: ["./my-extension.ts"],
});
await resourceLoader.reload();
const { session } = await createAgentSession({
  cwd,
  agentDir,
  resourceLoader,
  sessionManager: SessionManager.inMemory(cwd),
});
try {
  await session.bindExtensions({ mode: "print" });
} finally {
  await session.close();
}
```

Reload retires previous extension contexts. The default loader also retires
replaced factory APIs; a custom loader that retains its runtime keeps those APIs
active for the new contexts.

Existing custom `ResourceLoader` injection is unchanged. Source CLI/SDK checks
are not installed Node, compiled Bun, complete extension-feature or lifecycle
certification. Default activation, platform acceptance and publication remain
separate gates. See [the staging contract](../../../specs/108-pi-decoupling/spec.md).
The local migration roadmap is `packages/coding-agent/docs/omk-2-migration.md`.

## First-party optional packages

- [Book to Skill](book-to-skill.md) compiles documents into provenance-tracked agent skills without adding Python extractors to OMK core.
- [Speak Like You Eat](#speak-like-you-eat) adds display-only ELI5 and Light companion rewrites with manual and automatic modes. It is not loaded by default.

### Speak Like You Eat

From a source checkout, build the package with `npm run build --workspace packages/speak-like-you-eat`, then install it with `omk install ./packages/speak-like-you-eat`. Run `/reload` in an existing session.

Use `/slye model` to choose an authenticated model, `/slye` to rewrite the latest eligible response manually, and `/slye on` or `/slye off` to control automatic rewriting. Settings live in `~/.omk/agent/slye.json` or `.omk/slye.json` in a trusted project; the trusted project file overrides global settings. Untrusted project settings are ignored.

The companion leaves the original response and later LLM context unchanged. Each rewrite makes two provider requests, one for ELI5 and one for Light, with separate cost and latency. Press `ctrl+\` to switch the cards. SLYE is inactive in print, JSON and RPC modes.

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
- When reconciliation changes the checkout, omk resets and cleans the clone, then runs `npm install` if `package.json` exists.

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

Local paths point to files or directories on disk and are added to settings without copying. Relative paths are resolved against the settings file they appear in. If the path is a file, it loads as a single extension. If it is a directory, omk loads resources using package rules.

## Creating a OMK Package

Add an `omk` manifest to `package.json` or use conventional directories. OMK also reads a Pi-compatible `pi` manifest when `omk` is absent. Include the `omk-package` keyword for discoverability.

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

Paths are relative to the package root. Arrays support glob patterns and `!exclusions`.

### Gallery Metadata

The [package gallery](https://github.com/dmae97/omk) displays packages tagged with `omk-package`. Add `video` or `image` fields to show a preview:

```json
{
  "name": "my-package",
  "keywords": ["omk-package"],
  "omk": {
    "extensions": ["./extensions"],
    "video": "https://example.com/demo.mp4",
    "image": "https://example.com/screenshot.png"
  }
}
```

- **video**: MP4 only. On desktop, autoplays on hover. Clicking opens a fullscreen player.
- **image**: PNG, JPEG, GIF, or WebP. Displayed as a static preview.

If both are set, video takes precedence.

## Package Structure

### Convention Directories

If neither an `omk` nor a `pi` manifest is present, omk auto-discovers resources from these directories:

- `extensions/` loads `.ts` and `.js` files
- `skills/` recursively finds `SKILL.md` folders and loads top-level `.md` files as skills
- `prompts/` loads `.md` files
- `themes/` loads `.json` files

## Dependencies

Third party runtime dependencies belong in `dependencies` in `package.json`. Dependencies that do not register extensions, skills, prompt templates, or themes also belong in `dependencies`. Normal npm and git installation installs runtime dependencies automatically. `omk package doctor` is different: it does not install dependencies or execute lifecycle scripts.

OMK bundles core packages for extensions and skills. If you import any of these, list them in `peerDependencies` with a `"*"` range and do not bundle them: `omk-ai`, `omk-agent-core`, `open-multi-agent-kit`, `omk-tui`, `typebox`.

Other omk packages must be bundled in your tarball. Add them to `dependencies` and `bundledDependencies`, then reference their resources through `node_modules/` paths. OMK loads packages with separate module roots, so separate installs do not collide or share modules.

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
