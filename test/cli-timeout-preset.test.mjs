import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { pathToFileURL } from "node:url";

const CLI = join(process.cwd(), "dist", "cli.js");
const DESIGN_MODULE_URL = pathToFileURL(join(process.cwd(), "dist", "commands", "design.js")).href;
const OPEN_DESIGN_AGENT_MODULE_URL = pathToFileURL(join(process.cwd(), "dist", "commands", "open-design-agent.js")).href;
const RUN_MODULE_URL = pathToFileURL(join(process.cwd(), "dist", "commands", "run.js")).href;
const PARALLEL_MODULE_URL = pathToFileURL(join(process.cwd(), "dist", "commands", "parallel.js")).href;

function runHelp(command) {
  return spawnSync(process.execPath, [CLI, command, "--help"], {
    cwd: process.cwd(),
    encoding: "utf-8",
    env: {
      ...process.env,
      OMK_STAR_PROMPT: "0",
      OMK_RENDER_LOGO: "0",
    },
  });
}

test("run command exposes --timeout-preset", () => {
  const result = runHelp("run");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--timeout-preset <preset>/);
});

test("parallel command exposes --timeout-preset", () => {
  const result = runHelp("parallel");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--timeout-preset <preset>/);
});

test("init command exposes local-user runtime scope option", () => {
  const result = runHelp("init");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--local-user/);
  assert.match(result.stdout, /--home-dir <path>/);
});

test("graph view command exposes ontology viewer options", () => {
  const result = spawnSync(process.execPath, [CLI, "graph", "view", "--help"], {
    cwd: process.cwd(),
    encoding: "utf-8",
    env: {
      ...process.env,
      OMK_STAR_PROMPT: "0",
      OMK_RENDER_LOGO: "0",
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--limit <n>/);
  assert.match(result.stdout, /--type <types>/);
  assert.match(result.stdout, /--open/);
});

test("design open-design command exposes localhost launcher options", () => {
  const result = spawnSync(process.execPath, [CLI, "design", "open-design", "--help"], {
    cwd: process.cwd(),
    encoding: "utf-8",
    env: {
      ...process.env,
      OMK_STAR_PROMPT: "0",
      OMK_RENDER_LOGO: "0",
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--web-port <port>/);
  assert.match(result.stdout, /--daemon-port <port>/);
  assert.match(result.stdout, /--open/);
  assert.match(result.stdout, /--print-only/);
});

test("design open-design print-only shows localhost tools-dev launch plan", () => {
  const result = spawnSync(process.execPath, [
    CLI,
    "design",
    "open-design",
    "--print-only",
    "--dir",
    ".omk/open-design-test",
  ], {
    cwd: process.cwd(),
    encoding: "utf-8",
    env: {
      ...process.env,
      OMK_STAR_PROMPT: "0",
      OMK_RENDER_LOGO: "0",
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /http:\/\/localhost:5175/);
  assert.match(result.stdout, /Agent: OMK CLI/);
  assert.match(result.stdout, /git clone --depth 1 --branch main https:\/\/github\.com\/nexu-io\/open-design\.git/);
  assert.match(result.stdout, /corepack pnpm tools-dev start web --daemon-port 7457 --web-port 5175/);
});

test("design open-design bridge installs awesome-design-md prompt template", async () => {
  const { ensureOpenDesignOmkBridge } = await import(DESIGN_MODULE_URL);
  const root = mkdtempSync(join(tmpdir(), "omk-open-design-bridge-"));
  try {
    const result = await ensureOpenDesignOmkBridge(root);
    const templatePath = join(root, "prompt-templates", "image", "awesome-design-md-web-ui.json");
    const template = JSON.parse(readFileSync(templatePath, "utf-8"));

    assert.equal(template.id, "awesome-design-md-web-ui");
    assert.equal(template.source.repo, "VoltAgent/awesome-design-md");
    assert.match(template.prompt, /omk design search <name>/);
    assert.match(template.prompt, /DESIGN\.md/);
    assert.equal(result.changedFiles.includes("prompt-templates/image/awesome-design-md-web-ui.json"), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("open-design-agent smoke exits through OMK without launching Kimi ACP", () => {
  const result = spawnSync(process.execPath, [CLI, "open-design-agent", "--smoke"], {
    cwd: process.cwd(),
    input: "Reply with only: ok",
    encoding: "utf-8",
    timeout: 5000,
    env: {
      ...process.env,
      OMK_STAR_PROMPT: "0",
      OMK_RENDER_LOGO: "0",
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "ok");
});

test("open-design-agent sanitizes Kimi control-only bridge output", async () => {
  const mod = await import(OPEN_DESIGN_AGENT_MODULE_URL);
  assert.equal(
    mod.sanitizeOpenDesignAgentOutput("<choice>STOP</choice>\n\nTo resume this session: kimi -r 819d1bcc-4192-4134-b241-21265e77227f\n"),
    "",
  );
  assert.equal(
    mod.sanitizeOpenDesignAgentOutput("Created artifact\n<choice>STOP</choice>\n"),
    "Created artifact",
  );
});

test("open-design-agent treats generated Open Design artifacts as success after Kimi timeout", () => {
  const root = mkdtempSync(join(tmpdir(), "omk-open-design-agent-"));
  try {
    const binDir = join(root, "bin");
    const workspace = join(root, "workspace");
    mkdirSync(binDir);
    mkdirSync(workspace);

    const fakeKimi = join(binDir, "fake-kimi.mjs");
    writeFileSync(
      fakeKimi,
      [
        "import { writeFileSync } from 'node:fs';",
        "if (process.argv.includes('--help')) { console.log('kimi --model --thinking'); process.exit(0); }",
        "if (process.argv.includes('--version')) { console.log('kimi, version 1.1.0'); process.exit(0); }",
        "writeFileSync('index.html', '<html>ok</html>');",
        "setTimeout(() => {}, 5000);",
      ].join("\n"),
    );

    if (process.platform === "win32") {
      writeFileSync(
        join(binDir, "kimi.cmd"),
        `@echo off\r\n"${process.execPath}" "${fakeKimi}" %*\r\n`,
      );
    } else {
      writeFileSync(
        join(binDir, "kimi"),
        `#!${process.execPath}\n${readFileSync(fakeKimi, "utf8")}\n`,
      );
      chmodSync(join(binDir, "kimi"), 0o755);
    }

    const result = spawnSync(process.execPath, [
      CLI,
      "open-design-agent",
      "--cwd",
      workspace,
      "--timeout-ms",
      "1000",
    ], {
      cwd: process.cwd(),
      input: "Generate an index.html artifact",
      encoding: "utf-8",
      timeout: 10000,
      env: {
        ...process.env,
        PATH: `${binDir}${delimiter}${process.env.PATH || ""}`,
        OMK_OPEN_DESIGN_ARTIFACT_SETTLE_MS: "0",
        OMK_STAR_PROMPT: "0",
        OMK_RENDER_LOGO: "0",
      },
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Generated Open Design artifact: index\.html/);
    assert.equal(readFileSync(join(workspace, "index.html"), "utf8"), "<html>ok</html>");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("open-design-agent does not mask fatal Kimi errors as artifact success", async () => {
  const mod = await import(OPEN_DESIGN_AGENT_MODULE_URL);
  assert.equal(
    mod.shouldTreatOpenDesignBridgeAsSuccess({
      failed: true,
      exitCode: 1,
      cleanStdout: "",
      cleanStderr: "HTTP 401: Invalid Authentication",
      generatedArtifacts: [{ path: "index.html", size: 12, modifiedAt: Date.now() }],
    }),
    false,
  );
});

test("design open-design opener uses the Windows browser bridge under WSL", async () => {
  const { resolveOpenDesignBrowserOpener } = await import(DESIGN_MODULE_URL);
  const opener = await resolveOpenDesignBrowserOpener("http://localhost:5175", {
    platform: "linux",
    env: { WSL_DISTRO_NAME: "Ubuntu-24.04" },
    commandExists: async (command) => command === "cmd.exe",
  });

  assert.deepEqual(opener, {
    command: "cmd.exe",
    args: ["/c", "start", "", "http://localhost:5175"],
  });
});

test("design open-design opener prefers wslview when available", async () => {
  const { resolveOpenDesignBrowserOpener } = await import(DESIGN_MODULE_URL);
  const opener = await resolveOpenDesignBrowserOpener("http://localhost:5175", {
    platform: "linux",
    env: { WSL_INTEROP: "/run/WSL/123_interop" },
    commandExists: async (command) => command === "wslview" || command === "cmd.exe",
  });

  assert.deepEqual(opener, {
    command: "wslview",
    args: ["http://localhost:5175"],
  });
});

test("design open-design opener falls back to xdg-open on regular Linux", async () => {
  const { resolveOpenDesignBrowserOpener } = await import(DESIGN_MODULE_URL);
  const opener = await resolveOpenDesignBrowserOpener("http://localhost:5175", {
    platform: "linux",
    env: {},
    procVersionText: "Linux version 6.1.0 generic",
    commandExists: async () => false,
  });

  assert.deepEqual(opener, {
    command: "xdg-open",
    args: ["http://localhost:5175"],
  });
});

test("provider deepseek commands expose enable disable and set helpers", () => {
  const result = spawnSync(process.execPath, [CLI, "provider", "deepseek", "--help"], {
    cwd: process.cwd(),
    encoding: "utf-8",
    env: {
      ...process.env,
      OMK_STAR_PROMPT: "0",
      OMK_RENDER_LOGO: "0",
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /enable/);
  assert.match(result.stdout, /disable/);
  assert.match(result.stdout, /set/);
});

test("top-level deepseek commands expose official api enable disable helpers", () => {
  const result = spawnSync(process.execPath, [CLI, "deepseek", "--help"], {
    cwd: process.cwd(),
    encoding: "utf-8",
    env: {
      ...process.env,
      OMK_STAR_PROMPT: "0",
      OMK_RENDER_LOGO: "0",
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /api/);
  assert.match(result.stdout, /enable/);
  assert.match(result.stdout, /disable/);
  assert.match(result.stdout, /doctor/);
});

test("official deepseek api command exposes safe input options without --api-key", () => {
  const result = spawnSync(process.execPath, [CLI, "deepseek", "api", "--help"], {
    cwd: process.cwd(),
    encoding: "utf-8",
    env: {
      ...process.env,
      OMK_STAR_PROMPT: "0",
      OMK_RENDER_LOGO: "0",
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--from-env <name>/);
  assert.doesNotMatch(result.stdout, /--api-key/);
});

test("legacy DeepSeek key commands do not expose direct API key arguments", () => {
  for (const args of [
    ["provider", "deepseek", "set", "--help"],
    ["deepseekset", "--help"],
  ]) {
    const result = spawnSync(process.execPath, [CLI, ...args], {
      cwd: process.cwd(),
      encoding: "utf-8",
      env: {
        ...process.env,
        OMK_STAR_PROMPT: "0",
        OMK_RENDER_LOGO: "0",
      },
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /--from-env <name>/);
    assert.doesNotMatch(result.stdout, /--api-key/);
    assert.doesNotMatch(result.stdout, /apiKey/i);
  }
});

test("legacy deepseekset positional input does not echo supplied key", () => {
  const fakeKey = `sk-${"d".repeat(32)}`;
  const result = spawnSync(process.execPath, [CLI, "deepseekset", fakeKey, "--json"], {
    cwd: process.cwd(),
    encoding: "utf-8",
    env: {
      ...process.env,
      OMK_STAR_PROMPT: "0",
      OMK_RENDER_LOGO: "0",
      DEEPSEEK_API_KEY: "",
    },
  });

  assert.notEqual(result.status, 0);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, new RegExp(fakeKey));
});

test("slash command templates are packaged", () => {
  const root = join(process.cwd(), "templates", "skills", "kimi");
  const openDesign = readFileSync(join(root, "open-design", "SKILL.md"), "utf-8");
  const awesomeDesignMd = readFileSync(join(root, "awesome-design-md", "SKILL.md"), "utf-8");
  const api = readFileSync(join(root, "deepseek-api", "SKILL.md"), "utf-8");
  const enable = readFileSync(join(root, "deepseek-enable", "SKILL.md"), "utf-8");
  const disable = readFileSync(join(root, "deepseek-disable", "SKILL.md"), "utf-8");
  const set = readFileSync(join(root, "deepseekset", "SKILL.md"), "utf-8");
  assert.equal(openDesign.includes("# /open-design"), true);
  assert.match(openDesign, /omk design open-design --open/);
  assert.equal(awesomeDesignMd.includes("# /awesome-design-md"), true);
  assert.match(awesomeDesignMd, /omk design search <keyword>/);
  assert.equal(api.includes("# /deepseek-api"), true);
  assert.match(api, /omk deepseek api/);
  assert.equal(enable.includes("# /deepseek-enable"), true);
  assert.match(enable, /omk deepseek enable/);
  assert.equal(disable.includes("# /deepseek-disable"), true);
  assert.match(disable, /omk deepseek disable/);
  assert.equal(set.includes("# /deepseekset"), true);
  assert.match(set, /omk deepseek api/);
});

test("chat command leaves mode unset for persisted mode and advertises kimicat brand", () => {
  const result = runHelp("chat");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--brand <kimicat\|minimal\|plain>/);
  assert.match(result.stdout, /--mode <agent\|plan\|chat\|debugging\|review>/);
  assert.doesNotMatch(result.stdout, /default: agent/);
  assert.doesNotMatch(result.stdout, /kimichan/);
});

test("parallel keeps the historical ten-minute node timeout when no preset is requested", () => {
  const source = readFileSync(join(process.cwd(), "src", "commands", "parallel.ts"), "utf-8");
  assert.match(source, /nodeTimeoutMs:\s*options\.timeoutPreset\s*\?\s*undefined\s*:\s*600_000/);
});


test("worker count parsing rejects malformed values and shares OMK_WORKERS fallback", async () => {
  const runMod = await import(RUN_MODULE_URL);
  const parallelMod = await import(PARALLEL_MODULE_URL);
  const previousWorkers = process.env.OMK_WORKERS;
  try {
    delete process.env.OMK_WORKERS;
    for (const normalize of [runMod.normalizeWorkerCount, parallelMod.normalizeWorkerCount]) {
      assert.equal(normalize("1.5", 4), 4);
      assert.equal(normalize("2abc", 4), 4);
      assert.equal(normalize("0", 4), 4);
      assert.equal(normalize("9", 4), 6);
      assert.equal(normalize(" 3 ", 4), 3);
      assert.equal(normalize("auto", 4), 4);
    }

    process.env.OMK_WORKERS = "3";
    assert.equal(runMod.normalizeWorkerCount(undefined, 1), 3);
    assert.equal(parallelMod.normalizeWorkerCount(undefined, 1), 3);

    process.env.OMK_WORKERS = "2abc";
    assert.equal(runMod.normalizeWorkerCount(undefined, 5), 5);
    assert.equal(parallelMod.normalizeWorkerCount(undefined, 5), 5);
  } finally {
    if (previousWorkers === undefined) {
      delete process.env.OMK_WORKERS;
    } else {
      process.env.OMK_WORKERS = previousWorkers;
    }
  }
});
