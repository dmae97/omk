import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildSafeKimiChildEnv, createKimiTaskRunner } from "../dist/kimi/runner.js";

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
    assert.doesNotMatch(result.stdout, /secret-leaked|explicit-env-missing|omk-runtime-missing/);
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
