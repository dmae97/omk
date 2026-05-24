import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildSafeKimiChildEnv, createKimiTaskRunner, parseKimiLaunchMeta, resolveAgentFileForRole } from "../dist/kimi/runner.js";

test("Kimi child env builder drops inherited secret-like connection env", () => {
  const env = buildSafeKimiChildEnv(
    {
      PATH: "/usr/bin",
      DATABASE_URL: "postgres://secret",
      GITHUB_TOKEN: "token",
      OMK_VISIBLE_RUNTIME: "visible",
      OMK_SECRET_TOKEN: "secret",
      KIMI_AUTH_TOKEN: "secret",
    },
    {}
  );

  assert.equal(env.PATH, "/usr/bin");
  assert.equal(env.OMK_VISIBLE_RUNTIME, "visible");
  assert.equal(env.DATABASE_URL, undefined);
  assert.equal(env.GITHUB_TOKEN, undefined);
  assert.equal(env.OMK_SECRET_TOKEN, undefined);
  assert.equal(env.KIMI_AUTH_TOKEN, undefined);
});

test("Kimi child env builder warns for explicit secret-like env and supports strict opt-in", () => {
  const warnings = [];
  const env = buildSafeKimiChildEnv(
    { PATH: "/usr/bin" },
    {
      EXPLICIT_FAKE_SECRET_REGRESSION_TOKEN: "allowed-explicit",
      KIMI_BIN: "/opt/kimi",
      OMK_RUN_ID: "run-1",
    },
    {},
    {
      warnExplicitSecrets: true,
      explicitEnvContext: "test explicit env",
      onWarning: (message) => warnings.push(message),
    }
  );

  assert.equal(env.EXPLICIT_FAKE_SECRET_REGRESSION_TOKEN, "allowed-explicit");
  assert.equal(env.KIMI_BIN, "/opt/kimi");
  assert.equal(env.OMK_RUN_ID, "run-1");
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /EXPLICIT_FAKE_SECRET_REGRESSION_TOKEN/);
  assert.doesNotMatch(warnings[0], /allowed-explicit/);

  const strictEnv = buildSafeKimiChildEnv(
    { PATH: "/usr/bin", OMK_STRICT_KIMI_EXPLICIT_ENV: "1" },
    {
      EXPLICIT_FAKE_SECRET_REGRESSION_TOKEN: "drop-me",
      KIMI_BIN: "/opt/kimi",
      PATH: "/usr/local/bin:/usr/bin",
      HOME: "/tmp/kimi-home",
      OMK_RUN_ID: "run-1",
    }
  );

  assert.equal(strictEnv.EXPLICIT_FAKE_SECRET_REGRESSION_TOKEN, undefined);
  assert.equal(strictEnv.KIMI_BIN, "/opt/kimi");
  assert.equal(strictEnv.PATH, "/usr/local/bin:/usr/bin");
  assert.equal(strictEnv.HOME, "/tmp/kimi-home");
  assert.equal(strictEnv.OMK_RUN_ID, "run-1");

  const trustedStrictEnv = buildSafeKimiChildEnv(
    { PATH: "/usr/bin", OMK_STRICT_KIMI_EXPLICIT_ENV: "1", OMK_TRUST_KIMI_EXPLICIT_SECRET_ENV: "1" },
    { EXPLICIT_FAKE_SECRET_REGRESSION_TOKEN: "trusted-explicit" }
  );

  assert.equal(trustedStrictEnv.EXPLICIT_FAKE_SECRET_REGRESSION_TOKEN, "trusted-explicit");
});

test("Kimi child env builder treats runtime session ids as non-secret metadata", () => {
  const warnings = [];
  const env = buildSafeKimiChildEnv(
    {
      PATH: "/usr/bin",
      KIMI_SESSION_ID: "kimi-session-1",
      OMK_SESSION_ID: "omk-session-1",
      OMK_RUN_ID: "omk-run-1",
      OMK_ISOLATED_HOME_INHERIT_AUTH: "0",
      KIMI_AUTH_TOKEN: "drop-me",
      OMK_SECRET_TOKEN: "drop-me",
    },
    {
      KIMI_SESSION_ID: "kimi-session-2",
      OMK_SESSION_ID: "omk-session-2",
      OMK_RUN_ID: "omk-run-2",
      OMK_INHERIT_LOCAL_AUTH: "0",
    },
    {},
    {
      warnExplicitSecrets: true,
      explicitEnvContext: "metadata env",
      onWarning: (message) => warnings.push(message),
    }
  );

  assert.equal(env.KIMI_SESSION_ID, "kimi-session-2");
  assert.equal(env.OMK_SESSION_ID, "omk-session-2");
  assert.equal(env.OMK_RUN_ID, "omk-run-2");
  assert.equal(env.OMK_INHERIT_LOCAL_AUTH, "0");
  assert.equal(env.OMK_ISOLATED_HOME_INHERIT_AUTH, "0");
  assert.equal(env.KIMI_AUTH_TOKEN, undefined);
  assert.equal(env.OMK_SECRET_TOKEN, undefined);
  assert.deepEqual(warnings, []);
});

test("Kimi launch meta parses model args and OMK session metadata", () => {
  assert.deepEqual(
    parseKimiLaunchMeta(["--model=kimi-k2.6"], { OMK_SESSION_ID: "chat-1" }, "/work"),
    { directory: "/work", session: "chat-1", model: "kimi-k2.6" }
  );
  assert.deepEqual(
    parseKimiLaunchMeta(["-m", "kimi-k2"], { OMK_RUN_ID: "run-1" }, "/work"),
    { directory: "/work", session: "run-1", model: "kimi-k2" }
  );
});

test("Kimi DAG runner honors KIMI_BIN when kimi is not on PATH", async () => {
  if (process.platform === "win32") return;
  const projectRoot = await mkdtemp(join(tmpdir(), "omk-kimi-bin-project-"));
  const homeRoot = await mkdtemp(join(tmpdir(), "omk-kimi-bin-home-"));
  const binDir = join(projectRoot, "bin");
  const kimiBin = join(binDir, "custom-kimi");
  const previousProjectRoot = process.env.OMK_PROJECT_ROOT;
  process.env.OMK_PROJECT_ROOT = projectRoot;
  try {
    await mkdir(binDir, { recursive: true });
    await writeFile(kimiBin, "#!/usr/bin/env sh\necho custom-kimi-ran\n", "utf-8");
    await chmod(kimiBin, 0o755);

    const runner = createKimiTaskRunner({
      cwd: projectRoot,
      mcpScope: "none",
      skillsScope: "none",
      hooksScope: "none",
      env: {
        HOME: homeRoot,
        OMK_ORIGINAL_HOME: homeRoot,
        OMK_PROJECT_ROOT: projectRoot,
        KIMI_BIN: kimiBin,
        PATH: "/usr/bin:/bin",
      },
      timeout: 5000,
    });

    const result = await runner.run(
      { id: "n1", name: "node", role: "coder", dependsOn: [], status: "pending", retries: 0, maxRetries: 0 },
      {}
    );

    assert.equal(result.success, true, result.stderr);
    assert.match(result.stdout, /custom-kimi-ran/);
  } finally {
    if (previousProjectRoot === undefined) delete process.env.OMK_PROJECT_ROOT;
    else process.env.OMK_PROJECT_ROOT = previousProjectRoot;
    await rm(projectRoot, { recursive: true, force: true });
    await rm(homeRoot, { recursive: true, force: true });
  }
});

test("Kimi DAG runner sends node prompt through stdin instead of argv", async () => {
  if (process.platform === "win32") return;
  const projectRoot = await mkdtemp(join(tmpdir(), "omk-kimi-stdin-prompt-project-"));
  const homeRoot = await mkdtemp(join(tmpdir(), "omk-kimi-stdin-prompt-home-"));
  const binDir = join(projectRoot, "bin");
  const kimiBin = join(binDir, "fake-kimi-stdin");
  const fakeScript = join(projectRoot, "fake-kimi-stdin.js");
  const marker = "kimi private prompt marker 92dd";
  const previousProjectRoot = process.env.OMK_PROJECT_ROOT;
  process.env.OMK_PROJECT_ROOT = projectRoot;
  try {
    await mkdir(binDir, { recursive: true });
    await writeFile(fakeScript, `
      const marker = ${JSON.stringify(marker)};
      const argv = process.argv.slice(2);
      let stdin = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (chunk) => { stdin += chunk; });
      process.stdin.on("end", () => {
        if (argv.some((arg) => arg.includes(marker))) {
          console.error("prompt leaked through argv");
          process.exit(31);
        }
        if (argv.includes("--prompt")) {
          console.error("legacy prompt argv transport used");
          process.exit(32);
        }
        if (!argv.includes("--input-format")) {
          console.error("stdin input format missing");
          process.exit(33);
        }
        if (argv[argv.indexOf("--input-format") + 1] !== "text") {
          console.error("stdin input format value mismatch");
          process.exit(35);
        }
        if (!stdin.includes(marker)) {
          console.error("prompt missing from stdin");
          process.exit(34);
        }
        console.log("stdin-prompt-ok");
      });
    `, "utf-8");
    await writeFile(kimiBin, `#!/usr/bin/env sh\nexec "${process.execPath}" "${fakeScript}" "$@"\n`, "utf-8");
    await chmod(kimiBin, 0o755);

    const runner = createKimiTaskRunner({
      cwd: projectRoot,
      mcpScope: "none",
      skillsScope: "none",
      hooksScope: "none",
      env: {
        HOME: homeRoot,
        OMK_ORIGINAL_HOME: homeRoot,
        OMK_PROJECT_ROOT: projectRoot,
        KIMI_BIN: kimiBin,
        PATH: "/usr/bin:/bin",
      },
      timeout: 5000,
    });

    const result = await runner.run(
      { id: "n1", name: `node ${marker}`, role: "coder", dependsOn: [], status: "pending", retries: 0, maxRetries: 0 },
      {}
    );

    assert.equal(result.success, true, result.stderr || result.stdout);
    assert.match(result.stdout, /stdin-prompt-ok/);
  } finally {
    if (previousProjectRoot === undefined) delete process.env.OMK_PROJECT_ROOT;
    else process.env.OMK_PROJECT_ROOT = previousProjectRoot;
    await rm(projectRoot, { recursive: true, force: true });
    await rm(homeRoot, { recursive: true, force: true });
  }
});

test("Kimi DAG runner auto-sends ENTER when fake Kimi CLI outputs continue prompt", async () => {
  if (process.platform === "win32") return;
  const projectRoot = await mkdtemp(join(tmpdir(), "omk-kimi-continue-prompt-project-"));
  const homeRoot = await mkdtemp(join(tmpdir(), "omk-kimi-continue-prompt-home-"));
  const binDir = join(projectRoot, "bin");
  const kimiBin = join(binDir, "fake-kimi");
  const previousProjectRoot = process.env.OMK_PROJECT_ROOT;
  process.env.OMK_PROJECT_ROOT = projectRoot;
  try {
    await mkdir(binDir, { recursive: true });
    const fakeScript = join(projectRoot, "fake-kimi.js");
    await writeFile(fakeScript, `process.stdout.write("Press ENTER to continue...");\nprocess.stdin.once("data", () => { process.stdout.write("\\ncontinued\\n"); process.exit(0); });\nsetInterval(() => {}, 5000);\n`, "utf-8");
    await writeFile(kimiBin, `#!/usr/bin/env sh\nexec "${process.execPath}" "${fakeScript}" "$@"\n`, "utf-8");
    await chmod(kimiBin, 0o755);

    const runner = createKimiTaskRunner({
      cwd: projectRoot,
      mcpScope: "none",
      skillsScope: "none",
      hooksScope: "none",
      env: {
        HOME: homeRoot,
        OMK_ORIGINAL_HOME: homeRoot,
        OMK_PROJECT_ROOT: projectRoot,
        KIMI_BIN: kimiBin,
        PATH: "/usr/bin:/bin",
      },
      timeout: 5000,
    });

    const result = await runner.run(
      { id: "n1", name: "node", role: "coder", dependsOn: [], status: "pending", retries: 0, maxRetries: 0 },
      {}
    );

    assert.equal(result.success, true, result.stderr || result.stdout);
    assert.match(result.stdout, /continued/);
  } finally {
    if (previousProjectRoot === undefined) delete process.env.OMK_PROJECT_ROOT;
    else process.env.OMK_PROJECT_ROOT = previousProjectRoot;
    await rm(projectRoot, { recursive: true, force: true });
    await rm(homeRoot, { recursive: true, force: true });
  }
});

test("Kimi DAG runner resolves router role agent without fallback warning", async () => {
  if (process.platform === "win32") return;
  const projectRoot = await mkdtemp(join(tmpdir(), "omk-kimi-router-role-project-"));
  const homeRoot = await mkdtemp(join(tmpdir(), "omk-kimi-router-role-home-"));
  const binDir = join(projectRoot, "bin");
  const kimiBin = join(binDir, "custom-kimi-router");
  const previousProjectRoot = process.env.OMK_PROJECT_ROOT;
  const previousWarn = console.warn;
  const warnings = [];
  process.env.OMK_PROJECT_ROOT = projectRoot;
  console.warn = (...args) => warnings.push(args.join(" "));
  try {
    await mkdir(binDir, { recursive: true });
    await mkdir(join(projectRoot, ".omk", "agents", "roles"), { recursive: true });
    await writeFile(kimiBin, "#!/usr/bin/env sh\necho custom-kimi-router-ran\n", "utf-8");
    await chmod(kimiBin, 0o755);
    await writeFile(join(projectRoot, ".omk", "agents", "root.yaml"), [
      "version: 1",
      "agent:",
      "  extend: ./okabe.yaml",
      "  name: omk-root",
      "",
    ].join("\n"), "utf-8");
    await writeFile(join(projectRoot, ".omk", "agents", "okabe.yaml"), [
      "version: 1",
      "agent:",
      "  extend: default",
      "  name: okabe",
      "",
    ].join("\n"), "utf-8");
    await writeFile(join(projectRoot, ".omk", "agents", "roles", "router.yaml"), [
      "version: 1",
      "agent:",
      "  extend: ../okabe.yaml",
      "  name: omk-router",
      "  system_prompt_args:",
      "    OMK_ROLE: \"router\"",
      "  exclude_tools:",
      "    - \"kimi_cli.tools.file:WriteFile\"",
      "    - \"kimi_cli.tools.file:StrReplaceFile\"",
      "    - \"kimi_cli.tools.shell:Shell\"",
      "",
    ].join("\n"), "utf-8");

    const runner = createKimiTaskRunner({
      cwd: projectRoot,
      mcpScope: "none",
      skillsScope: "none",
      hooksScope: "none",
      roleAgentFiles: true,
      agentFile: join(projectRoot, ".omk", "agents", "root.yaml"),
      env: {
        HOME: homeRoot,
        OMK_ORIGINAL_HOME: homeRoot,
        OMK_PROJECT_ROOT: projectRoot,
        KIMI_BIN: kimiBin,
        PATH: "/usr/bin:/bin",
      },
      timeout: 5000,
    });

    const result = await runner.run(
      { id: "router-1", name: "router", role: "router", dependsOn: [], status: "pending", retries: 0, maxRetries: 0 },
      {}
    );

    assert.equal(result.success, true, result.stderr || result.stdout);
    assert.match(result.stdout, /custom-kimi-router-ran/);
    assert.deepEqual(warnings, []);
  } finally {
    console.warn = previousWarn;
    if (previousProjectRoot === undefined) delete process.env.OMK_PROJECT_ROOT;
    else process.env.OMK_PROJECT_ROOT = previousProjectRoot;
    await rm(projectRoot, { recursive: true, force: true });
    await rm(homeRoot, { recursive: true, force: true });
  }
});

test("agent role resolver labels fallback source and suggests doctor fix", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "omk-kimi-role-fallback-project-"));
  const previousProjectRoot = process.env.OMK_PROJECT_ROOT;
  const previousWarn = console.warn;
  const warnings = [];
  process.env.OMK_PROJECT_ROOT = projectRoot;
  console.warn = (...args) => warnings.push(args.join(" "));
  try {
    await mkdir(join(projectRoot, ".omk", "agents"), { recursive: true });
    const fallback = join(projectRoot, ".omk", "agents", "root.yaml");
    await writeFile(fallback, "version: 1\nagent:\n  name: omk-root\n", "utf-8");

    const resolved = await resolveAgentFileForRole("router", fallback);

    assert.equal(resolved, fallback);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /No agent file found for role "router"/);
    assert.match(warnings[0], /project fallback \.omk\/agents\/root\.yaml/);
    assert.match(warnings[0], /\.omk\/agents\/roles\/router\.yaml/);
    assert.match(warnings[0], /omk doctor --fix/);
  } finally {
    console.warn = previousWarn;
    if (previousProjectRoot === undefined) delete process.env.OMK_PROJECT_ROOT;
    else process.env.OMK_PROJECT_ROOT = previousProjectRoot;
    await rm(projectRoot, { recursive: true, force: true });
  }
});


test("Kimi DAG runner filters inherited secret-like env vars but keeps explicit env", async () => {
  if (process.platform === "win32") return;
  const projectRoot = await mkdtemp(join(tmpdir(), "omk-kimi-safe-env-project-"));
  const homeRoot = await mkdtemp(join(tmpdir(), "omk-kimi-safe-env-home-"));
  const binDir = join(projectRoot, "bin");
  const kimiBin = join(binDir, "custom-kimi-safe-env");
  const previousProjectRoot = process.env.OMK_PROJECT_ROOT;
  const previousFakeSecret = process.env.FAKE_SECRET_REGRESSION_TOKEN;
  const previousKimiSecret = process.env.KIMI_AUTH_TOKEN;
  const previousVisibleRuntime = process.env.OMK_VISIBLE_RUNTIME;
  process.env.OMK_PROJECT_ROOT = projectRoot;
  process.env.FAKE_SECRET_REGRESSION_TOKEN = "fake-secret-regression-value";
  process.env.KIMI_AUTH_TOKEN = "fake-kimi-auth-token";
  process.env.OMK_VISIBLE_RUNTIME = "visible";
  try {
    await mkdir(binDir, { recursive: true });
    await writeFile(kimiBin, [
      "#!/usr/bin/env sh",
      "if env | grep -q '^FAKE_SECRET_REGRESSION_TOKEN='; then echo inherited-secret-leaked; exit 23; fi",
      "if env | grep -q '^KIMI_AUTH_TOKEN='; then echo kimi-secret-leaked; exit 24; fi",
      `if [ "$EXPLICIT_FAKE_SECRET_REGRESSION_TOKEN" != "allowed-explicit" ]; then echo explicit-env-missing; exit 25; fi`,
      `if [ "$OMK_VISIBLE_RUNTIME" != "visible" ]; then echo omk-runtime-missing; exit 26; fi`,
      `if [ "$CODEX_HOME" != "$HOME/.codex" ]; then echo codex-home-not-isolated; exit 27; fi`,
      `if [ "$CODEX_HOME" = "$OMK_ORIGINAL_HOME/.codex" ]; then echo codex-home-leaked; exit 28; fi`,
      "echo safe-env-ran",
      "",
    ].join("\n"), "utf-8");
    await chmod(kimiBin, 0o755);

    const runner = createKimiTaskRunner({
      cwd: projectRoot,
      mcpScope: "none",
      skillsScope: "none",
      hooksScope: "none",
      env: {
        HOME: homeRoot,
        OMK_ORIGINAL_HOME: homeRoot,
        OMK_PROJECT_ROOT: projectRoot,
        KIMI_BIN: kimiBin,
        PATH: "/usr/bin:/bin",
        OMK_ISOLATED_HOME_INHERIT_AUTH: "0",
        EXPLICIT_FAKE_SECRET_REGRESSION_TOKEN: "allowed-explicit",
      },
      timeout: 5000,
    });

    const result = await runner.run(
      { id: "n1", name: "node", role: "coder", dependsOn: [], status: "pending", retries: 0, maxRetries: 0 },
      {}
    );

    assert.equal(result.success, true, result.stderr || result.stdout);
    assert.match(result.stdout, /safe-env-ran/);
    assert.doesNotMatch(result.stdout, /secret-leaked|explicit-env-missing|omk-runtime-missing|codex-home/);
  } finally {
    if (previousProjectRoot === undefined) delete process.env.OMK_PROJECT_ROOT;
    else process.env.OMK_PROJECT_ROOT = previousProjectRoot;
    if (previousFakeSecret === undefined) delete process.env.FAKE_SECRET_REGRESSION_TOKEN;
    else process.env.FAKE_SECRET_REGRESSION_TOKEN = previousFakeSecret;
    if (previousKimiSecret === undefined) delete process.env.KIMI_AUTH_TOKEN;
    else process.env.KIMI_AUTH_TOKEN = previousKimiSecret;
    if (previousVisibleRuntime === undefined) delete process.env.OMK_VISIBLE_RUNTIME;
    else process.env.OMK_VISIBLE_RUNTIME = previousVisibleRuntime;
    await rm(projectRoot, { recursive: true, force: true });
    await rm(homeRoot, { recursive: true, force: true });
  }
});
