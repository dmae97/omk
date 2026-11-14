# Phase 2: Native extensions and explicit migration - Test pattern map

**Mapped:** 2026-11-05
**Files classified:** 4 proposed test destinations
**Pattern assignments:** 4 / 4 for test conventions only
**Primary analogs:** 5 tracked test files

## Scope

This reference covers test infrastructure, fixture placement, and teardown only.

- Read phase-2 `02-CONTEXT.md` and root `AGENTS.md`. No phase-2 RESEARCH file existed when context was loaded.
- Production implementations and phase-1 implementation tests were excluded from analysis. Compatibility policy, import enforcement, API propagation, and migration syntax remain with the researcher and main planner.
- Context requires explicit-native tests beside unchanged compatibility controls, installed dependencies, relevant transitive imports and subpaths, and separate source, packaged Node, and compiled-binary evidence. These analogs do not already prove those requirements.
- Context names no test files. The following names are placement suggestions, not a finalized inventory or a requirement to create four suites.

## File Classification

| Proposed new file | Role | Data flow | Closest tracked analog | Match quality |
|---|---|---|---|---|
| `packages/coding-agent/test/extensions-native-runtime.test.ts` | test | file-I/O, request-response | `packages/coding-agent/test/extensions-discovery.test.ts` | exact for temporary extension creation and registration assertions; installed sentinels missing |
| `packages/coding-agent/test/sdk-native-extensions.test.ts` | test | request-response, file-I/O | `packages/coding-agent/test/sdk-tool-execution-settings.test.ts` | role-match for real SDK construction, omitted-versus-explicit controls, and disposal |
| `packages/coding-agent/test/extensions-native-process.test.ts` | test | request-response, file-I/O | `packages/coding-agent/test/init-cli.test.ts`; `packages/coding-agent/test/cli-neo-lazy-import.test.ts` | role-match for source Node subprocess isolation; no artifact acceptance driver |
| `packages/coding-agent/test/extension-migration-cli.test.ts` | test | request-response, file-I/O | `packages/coding-agent/test/init-cli.test.ts` | role-match for CLI output, exit status, non-writing previews, and preservation assertions |

The closest extension analog builds fixtures inline. Keep generated extension packages and their local dependencies inside the owning test's temporary root. No shared helper extraction or committed `node_modules` tree is assigned.

## Pattern Assignments

### `packages/coding-agent/test/extensions-native-runtime.test.ts`

**Analog:** `packages/coding-agent/test/extensions-discovery.test.ts`.

**Imports, lines 1-10.** Node built-ins, Vitest hooks, and relative source imports. These are test call sites; the imported production implementation was not opened.

~~~typescript
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	discoverAndLoadExtensions,
	loadExtensionModuleWithVirtualModulesForTests,
	resolveOmkAgentCoreNodeEntryForTests,
} from "../src/core/extensions/loader.ts";
~~~

**Temporary fixture ownership, lines 18-26.** A new extension tree is created and removed for every test.

~~~typescript
	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "omk-ext-test-"));
		extensionsDir = path.join(tempDir, "extensions");
		fs.mkdirSync(extensionsDir);
	});

	afterEach(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
	});
~~~

**Actual fixture source, lines 28-32.** This file-local string registers a real command.

~~~typescript
	const extensionCode = `
		export default function(api) {
			api.registerCommand("test", { handler: async () => {} });
		}
	`;
~~~

**Observable registration, lines 419-427.** The test invokes discovery and initialization, then inspects the registry.

~~~typescript
	it("loads extensions and registers commands", async () => {
		fs.writeFileSync(path.join(extensionsDir, "with-command.ts"), extensionCode);

		const result = await discoverAndLoadExtensions([], tempDir, tempDir);

		expect(result.errors).toHaveLength(0);
		expect(result.extensions).toHaveLength(1);
		expect(result.extensions[0].commands.has("test")).toBe(true);
	});
~~~

Additional exact copy locations in the same analog:

- Lines 34-45 define the existing file-local `extensionCodeWithTool(toolName)` source generator. Lines 429-437 assert `tools.has("my-tool")` after loading it.
- Lines 439-447 assert one error, the offending path, and zero admitted extensions for invalid code.
- Lines 491-504 assert initialization error text and zero admitted extensions when the factory throws.
- Lines 81-112 are an existing legacy-import positive control. Lines 106-111 check zero errors, `commands.has("legacy-pi")`, and a virtual-module factory's type. This is not an installed-package, transitive-import, or native-policy control.

**Local package-directory shape.** Supporting analog `packages/coding-agent/test/config.test.ts:52-62` has an existing file-local helper that creates scoped directories without installing anything.

~~~typescript
function createNpmPrefixInstall(template = "omk-prefix-"): { prefix: string; packageDir: string } {
	const prefix = mkdtempSync(join(tmpdir(), template));
	const root = join(prefix, "lib", "node_modules");
	const scopeDir = join(root, "@earendil-works");
	const packageDir = join(scopeDir, "omk-coding-agent");
	mkdirSync(packageDir, { recursive: true });
	tempDir = prefix;
	process.env.OMK_PACKAGE_DIR = packageDir;
	setExecPath(join(packageDir, "dist", "cli.js"));
	return { prefix, packageDir };
}
~~~

Only its directory-construction convention fits an extension-local dependency fixture. The helper models the host installation, mutates process state, and does not write an importable sentinel package. Do not import it from its test file or copy its host-install overrides into an extension fixture.

**Gap:** `extensions-discovery.test.ts:461-472` tests dependency resolution using a checkout example and asserts `tools.has("parse_duration")`. No reusable builder for isolated temporary extension-local sentinel packages was found in the inspected infrastructure. Sentinel contents and acceptance expectations remain research-dependent work.

### `packages/coding-agent/test/sdk-native-extensions.test.ts`

**Analog:** `packages/coding-agent/test/sdk-tool-execution-settings.test.ts`.

**Imports, lines 1-8.** These tests use the real SDK constructor rather than a fake session.

~~~typescript
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getModel } from "omk-ai";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAgentSession } from "../src/core/sdk.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
~~~

**Existing file-local `createSession`, lines 45-60.** Separate project/agent directories and an in-memory session manager are passed to the constructor.

~~~typescript
	async function createSession(agentSettings?: Record<string, unknown>) {
		if (agentSettings) {
			writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ agent: agentSettings }));
		}
		const model = getModel("anthropic", "claude-sonnet-4-5");
		if (!model) {
			throw new Error("Test model is unavailable");
		}
		return createAgentSession({
			cwd,
			agentDir,
			model,
			sessionManager: SessionManager.inMemory(cwd),
			settingsManager: SettingsManager.create(cwd, agentDir),
		});
	}
~~~

- Lines 62-76 exercise omitted settings. Lines 78-100 exercise explicit overrides through the same constructor. Lines 120-132 exercise rejected values with `await expect(createSession(...)).rejects.toThrow(...)`.
- Successful cases call `session.dispose()` at lines 75, 99, and 117. They never call `session.prompt()`.
- Use the omitted-versus-explicit control structure, not these scheduler settings as a new extension-policy transport. This mapping does not establish a native-policy option on `createAgentSession`. New SDK cases still need real extension registration or diagnostics through researcher-verified wiring.
- Disposal follows assertions in this analog. An exception-safe shared SDK-session ownership fixture was not found among the selected analogs.

### `packages/coding-agent/test/extensions-native-process.test.ts`

**Primary analog:** `packages/coding-agent/test/init-cli.test.ts`. **Secondary analog:** `packages/coding-agent/test/cli-neo-lazy-import.test.ts`.

**Source Node setup, `init-cli.test.ts:8-11`.**

~~~typescript
const packageDir = fileURLToPath(new URL("..", import.meta.url));
const cliPath = join(packageDir, "src", "cli.ts");
const sourceRunner = fileURLToPath(new URL("../../../node_modules/tsx/dist/loader.mjs", import.meta.url));
const sourceConfig = fileURLToPath(new URL("../../../tsconfig.json", import.meta.url));
~~~

**Existing file-local subprocess helper, lines 26-41.** The child gets an explicit environment rather than the developer shell, a controlled working directory, UTF-8 output, and a timeout.

~~~typescript
function runInit(args: string[]) {
	return spawnSync(process.execPath, ["--import", sourceRunner, cliPath, "init", ...args], {
		cwd: workspace,
		env: {
			PATH: process.env.PATH,
			HOME: root,
			USERPROFILE: root,
			OMK_CODING_AGENT_DIR: agentDir,
			OMK_PACKAGE_DIR: packageDir,
			OMK_OFFLINE: "1",
			TSX_TSCONFIG_PATH: sourceConfig,
		},
		encoding: "utf8",
		timeout: 20000,
	});
}
~~~

**Fixture and teardown, lines 43-50.** The agent directory also exercises spaces and non-ASCII characters.

~~~typescript
beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "omk-init-"));
	agentDir = join(root, "설정 with spaces", "agent");
	workspace = join(root, "workspace");
	mkdirSync(workspace);
});

afterEach(() => rmSync(root, { recursive: true, force: true }));
~~~

**Subprocess assertions, lines 91-98.** Spawn failure, stderr, status, stdout, and filesystem effects are distinct assertions.

~~~typescript
		expect(result.error).toBeUndefined();
		expect(result.stderr).toBe("");
		expect(result.status).toBe(0);
		expect(result.stdout).toContain("AGENTS.md");
		expect(result.stdout).toContain("INTERNET.md");
		expect(result.stdout).toContain("CLAUDE.md");
		expect(existsSync(agentDir)).toBe(false);
		expect(readdirSync(workspace)).toEqual([]);
~~~

Other exact subprocess/cleanup locations:

- `cli-neo-lazy-import.test.ts:31-37` uses `spawnSync(process.execPath, ...)`, HOME/agent/offline overrides, UTF-8 output, and a 30-second timeout. Lines 39-49 provide positive and negative stderr controls. Its instrumentation is not proposed as a native import-enforcement algorithm.
- `cli-neo-lazy-import.test.ts:10-27` owns one suite-level temporary directory and removes it with `afterAll`. The directory lifecycle is reusable; use per-test roots when controls have different fixtures.
- `init-cli.test.ts:68-82` registers child error/exit listeners, then kills and awaits the child in `finally`. This is the closest asynchronous child teardown pattern. No child was launched during this mapping.

**Runtime boundaries:** `extensions-discovery.test.ts:58-79,106-111` calls `loadExtensionModuleWithVirtualModulesForTests` and checks a function type. This is a source helper test under Node Vitest, not execution of a compiled binary or proof of factory initialization. `config.test.ts:107-123,141-147` defines `createBunGlobalInstall` and `createFakeBunScript`; the executable is a fake install-location responder, not real Bun or bundling evidence.

### `packages/coding-agent/test/extension-migration-cli.test.ts`

**Analog:** `packages/coding-agent/test/init-cli.test.ts`.

- Lines 26-50 supply the source subprocess fixture above. Substitute only a researcher-established command/entry point.
- Lines 87-99 exercise a preview and assert both output and absence of writes. The output/assertion excerpt above is from this case.
- Lines 142-154 use `it.each` for invalid arguments, assert status, and check usage in combined stdout and stderr. The existing exit code belongs to `init`; it does not set migration policy.
- Lines 123-125 and 128-139 compare user-owned file bytes after a command. This is the preservation pattern for originals; successful output alone is insufficient.

No migration command, automatic rewriting behavior, diagnostic schema, or compatibility approval is established by this analog.

## Shared Patterns

### Package-local Vitest setup

**Source:** `packages/coding-agent/vitest.config.ts:13-22`. All proposed suites belong under this package's `test/` directory.

~~~typescript
export default defineConfig({
	test: {
		// Bundled pstack keeps upstream Bun/Node test suites for opt-in upstream use.
		exclude: [...configDefaults.exclude, "resources/pstack/**"],
		globals: true,
		environment: "node",
		testTimeout: 30000,
		globalSetup: ["./test/global-setup-home.ts"],
		setupFiles: ["./test/setup-env.ts"],
		server: {
~~~

Lines 28-44 configure source aliases for in-process tests. A source-suite pass does not establish installed Node resolution or compiled-binary behavior. No production alias code was reviewed.

### HOME isolation and restoration

**Source:** `packages/coding-agent/test/global-setup-home.ts:17-35`. Vitest already invokes this setup. Lines 19-24 preserve toolchain/cache locations separately from the test HOME.

**Core lifecycle excerpt, lines 25-34:**

~~~typescript
	const isolatedHome = mkdtempSync(join(tmpdir(), "omk-test-home-"));
	process.env.HOME = isolatedHome;
	if (process.platform === "win32") process.env.USERPROFILE = isolatedHome;
	return () => {
		for (const [key, value] of Object.entries(previous)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		rmSync(isolatedHome, { recursive: true, force: true });
	};
~~~

### Provider/environment scrubbing

**Source:** `packages/coding-agent/test/setup-env.ts:37-38,69-83`. `LIVE_E2E === "1"` preserves provider credentials; otherwise the configured provider prefixes are removed. `OMK_CODING_AGENT_DIR` is deliberately preserved. Other `OMK_*` variables are scrubbed.

**Loop, lines 72-83:**

~~~typescript
for (const key of Object.keys(process.env)) {
	if (PRESERVED_ENV_KEYS.has(key)) {
		continue;
	}
	if (key.startsWith("OMK_")) {
		delete process.env[key];
		continue;
	}
	if (!LIVE && PROVIDER_PREFIX.test(key)) {
		delete process.env[key];
	}
}
~~~

Lines 40-67 stabilize the test clock. Lines 85-89 install and reset a no-process headroom probe. Subprocess fixtures still need explicit environments, as in `runInit`.

### Restore unset versus set values

**Source:** `packages/coding-agent/test/sdk-tool-execution-settings.test.ts:32-43`. Lines 32-33 capture/delete the original scheduler override; lines 36-43 restore it without turning an absent value into a string.

~~~typescript
	afterEach(() => {
		if (originalSchedulerEnv === undefined) {
			delete process.env.OMK_TOOL_SCHEDULER;
		} else {
			process.env.OMK_TOOL_SCHEDULER = originalSchedulerEnv;
		}
		rmSync(tempDir, { recursive: true, force: true });
	});
~~~

`config.test.ts:13-50` also saves/restores the original `process.execPath` descriptor, PATH, package-directory override, and argv entry. Its lines 45-49 restore permissions before deleting the fixture. Prefer an explicit child executable over mutating parent process identity for an artifact probe.

### Actual helpers and limits

| Existing helper | Exact location | Availability and suitability |
|---|---|---|
| `extensionCodeWithTool` | `packages/coding-agent/test/extensions-discovery.test.ts:34-45` | File-local source generator; real tool registration asserted at 429-437 |
| `createSession` | `packages/coding-agent/test/sdk-tool-execution-settings.test.ts:45-60` | File-local real SDK constructor; not an extension-policy fixture |
| `runInit` | `packages/coding-agent/test/init-cli.test.ts:26-41` | File-local source CLI subprocess; not an installed-artifact driver |
| `createNpmPrefixInstall` | `packages/coding-agent/test/config.test.ts:52-62` | File-local fake host installation; not an importable sentinel builder |
| `createBunGlobalInstall` / `createFakeBunScript` | `packages/coding-agent/test/config.test.ts:107-123,141-147` | File-local fake Bun layout/query fixtures, not runtime acceptance |
| `createAssistantMessage` / `createRuntimeHost` | `packages/coding-agent/test/print-mode-fixtures.ts:31-54,56-86` | Exported helpers, but sessions and lifecycle functions are mocked; unsuitable for proving real extension loading or SDK propagation |

No new helper abstraction is proposed. The existing `*ForTests` loader entry points appear in the discovery test imports; their implementations were not reviewed and they are not shared fixture builders.

## Focused Vitest invocation conventions

**Authority:** root `AGENTS.md:43-60` documents the one-file invocation. Working directory must be `/home/dmae97/Project/omk/packages/coding-agent` so the package's configuration/setup files load.

Existing analog, focused registration cases only:

~~~bash
LIVE_E2E=0 TMPDIR=/mnt/omkdata/tmp/opencode node ../../node_modules/vitest/dist/cli.js --run test/extensions-discovery.test.ts -t 'loads extensions and registers (commands|tools)'
~~~

Proposed commands after the corresponding files exist:

~~~bash
LIVE_E2E=0 TMPDIR=/mnt/omkdata/tmp/opencode node ../../node_modules/vitest/dist/cli.js --run test/extensions-native-runtime.test.ts
LIVE_E2E=0 TMPDIR=/mnt/omkdata/tmp/opencode node ../../node_modules/vitest/dist/cli.js --run test/sdk-native-extensions.test.ts
LIVE_E2E=0 TMPDIR=/mnt/omkdata/tmp/opencode node ../../node_modules/vitest/dist/cli.js --run test/extensions-native-process.test.ts
LIVE_E2E=0 TMPDIR=/mnt/omkdata/tmp/opencode node ../../node_modules/vitest/dist/cli.js --run test/extension-migration-cli.test.ts
~~~

These are conventions, not executed checks or claims that the proposed files exist. Do not run a full Vitest suite, enable live providers, install dependencies, or build artifacts for this mapping. Artifact commands remain pending the actual artifact interface and authorization.

## No Analog Found

These are gaps in complete harness coverage, despite the partial conventions above.

| Needed evidence | Closest partial reference | Gap |
|---|---|---|
| Temporary extension package with importable local `node_modules` sentinels | `extensions-discovery.test.ts:461-472`; `config.test.ts:52-62` | Example dependency test and host-layout helper do not build isolated extension dependencies |
| Installed transitive-import and subpath controls for native versus compatibility behavior | `extensions-discovery.test.ts:58-112` | Source controls exist, but no matching isolated installed-sentinel matrix was found in the inspected infrastructure |
| Native-versus-compatibility SDK extension controls | `sdk-tool-execution-settings.test.ts:45-132` | Omitted/explicit controls exist for another setting; no native-policy propagation is established here |
| Packaged Node extension registration in a clean installation | `init-cli.test.ts:8-41` | Existing child runs source through tsx, not an installed artifact |
| Real Bun or compiled-binary extension registration | `extensions-discovery.test.ts:58-79`; `config.test.ts:107-147` | Factory type and fake Bun location tests do not execute a compiled artifact; no matching driver was found |
| Native migration diagnostics | `init-cli.test.ts:87-154` | Output/preservation patterns exist, but no migration entry point or diagnostic schema was established by this lookup |
| Exception-safe shared SDK-session teardown | `sdk-tool-execution-settings.test.ts:62-118` | Disposal follows assertions; no reusable session-ownership fixture was found among the selected analogs |

## Metadata

- **Search scope:** tracked tests under `packages/coding-agent/test`, fixture/helper names, package-local Vitest configuration, and root rules. Production modules were not opened. Phase-1 package-manager/manifest-policy tests were excluded from extraction.
- **Extraction reads:** 9 test/infrastructure files, comprising 5 primary test analogs and 4 supporting configuration/helper files.
- **Tracked-source gate:** `git ls-files -- <path>` returned all 9 full analog/support paths and root `AGENTS.md`. No ignored install/runtime mirror is assigned.
- **Reference snapshot:** HEAD `0d6e74b0d21cdb810c88c42381457eff944b935f`. Line numbers describe the working-tree reads, not a claim that all references match HEAD.
- **Pre-existing modifications:** `packages/coding-agent/test/init-cli.test.ts` and `packages/coding-agent/test/setup-env.ts` were already modified. They were only read and their existing changes were preserved.
- **Execution:** read/search, tracked-path, status, and metadata checks only. No application tests, providers, installs, builds, staging, or commits ran. Only this PATTERNS file was written.
