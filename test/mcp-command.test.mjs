import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { pathToFileURL } from "node:url";

const OMK_ROOT = process.cwd();
const MCP_MODULE_URL = pathToFileURL(join(OMK_ROOT, "dist", "commands", "mcp.js")).href;
const OMK_PROJECT_SERVER = join(OMK_ROOT, "dist", "mcp", "omk-project-server.js");
const OMK_CLI = join(OMK_ROOT, "dist", "cli.js");

function runMcpScript(projectRoot, homeRoot, scriptBody, extraEnv = {}) {
  const evalScript = `
      import { writeSync } from "node:fs";
      console.log = (...args) => writeSync(1, args.join(" ") + "\\n");
      console.error = (...args) => writeSync(2, args.join(" ") + "\\n");
      import { mkdir, readFile, writeFile } from "node:fs/promises";
      import { join } from "node:path";
      import { buildMcpDoctorReport, mcpDoctorCommand, mcpInstallCommand, mcpListCommand, mcpTestCommand } from ${JSON.stringify(MCP_MODULE_URL)};
      import { doctorCommand } from ${JSON.stringify(pathToFileURL(join(OMK_ROOT, "dist", "commands", "doctor.js")).href)};
      import { syncKimiMcpGlobal, writeRuntimeMcpConfig } from ${JSON.stringify(pathToFileURL(join(OMK_ROOT, "dist", "util", "fs.js")).href)};
      ${scriptBody}
    `;
  return spawnSync(process.execPath, ["--input-type=module", "--eval", evalScript], {
    cwd: projectRoot,
    env: {
      ...process.env,
      OMK_MCP_SCOPE: "",
      OMK_SKILLS_SCOPE: "",
      OMK_HOOKS_SCOPE: "",
      ...extraEnv,
      HOME: homeRoot,
      OMK_ORIGINAL_HOME: homeRoot,
      OMK_PROJECT_ROOT: projectRoot,
    },
    encoding: "utf-8",
    timeout: 60000,
  });
}

function buildPrependPathEnv(directory) {
  const currentPath = process.env.PATH ?? process.env.Path ?? process.env.path ?? "";
  const value = `${directory}${delimiter}${currentPath}`;
  return process.platform === "win32" ? { PATH: value, Path: value } : { PATH: value };
}

async function writeEmptyConfigs(projectRoot, homeRoot, omkConfig) {
  await mkdir(join(projectRoot, ".omk"), { recursive: true });
  await mkdir(join(projectRoot, ".kimi"), { recursive: true });
  await mkdir(join(homeRoot, ".kimi"), { recursive: true });
  await writeFile(join(projectRoot, ".omk", "mcp.json"), JSON.stringify({ mcpServers: {} }), "utf-8");
  await writeFile(join(projectRoot, ".kimi", "mcp.json"), JSON.stringify(omkConfig), "utf-8");
  await writeFile(join(homeRoot, ".kimi", "mcp.json"), JSON.stringify({ mcpServers: {} }), "utf-8");
}

test("runtime MCP cleanup does not delete active peer process configs", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "omk-runtime-mcp-peer-"));
  const homeRoot = await mkdtemp(join(tmpdir(), "omk-runtime-mcp-home-"));

  try {
    await writeEmptyConfigs(projectRoot, homeRoot, {
      mcpServers: {
        dummy: {
          command: process.execPath,
          args: ["--version"],
        },
      },
    });

    const result = runMcpScript(projectRoot, homeRoot, `
      const cacheDir = join(process.env.OMK_PROJECT_ROOT, ".omk", "cache");
      await mkdir(cacheDir, { recursive: true });
      const peerPath = join(cacheDir, \`mcp-runtime-merged-\${process.pid}-1000.json\`);
      await writeFile(peerPath, JSON.stringify({ mcpServers: {} }), "utf-8");
      const runtimePath = await writeRuntimeMcpConfig([join(process.env.OMK_PROJECT_ROOT, ".kimi", "mcp.json")]);
      const peerStillThere = await readFile(peerPath, "utf-8").then(() => true, () => false);
      const runtimeExists = runtimePath
        ? await readFile(runtimePath, "utf-8").then(() => true, () => false)
        : false;
      console.log(JSON.stringify({ peerStillThere, runtimeExists, hasRuntimePath: Boolean(runtimePath) }));
    `);

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const parsed = JSON.parse(result.stdout.trim());
    assert.equal(parsed.peerStillThere, true);
    assert.equal(parsed.runtimeExists, true);
    assert.equal(parsed.hasRuntimePath, true);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
    await rm(homeRoot, { recursive: true, force: true });
  }
});

test("mcp install railway writes the remote OAuth preset without local secrets", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "omk-mcp-install-"));
  const homeRoot = await mkdtemp(join(tmpdir(), "omk-mcp-home-"));

  try {
    await writeEmptyConfigs(projectRoot, homeRoot, { mcpServers: {} });

    const result = runMcpScript(projectRoot, homeRoot, `
      await mcpInstallCommand("railway", "railway", [], {});
      const raw = await readFile(join(process.env.OMK_PROJECT_ROOT, ".kimi", "mcp.json"), "utf-8");
      console.log(raw);
    `);
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const raw = await readFile(join(projectRoot, ".kimi", "mcp.json"), "utf-8");
    const parsed = JSON.parse(raw);
    assert.deepEqual(parsed.mcpServers.railway, { url: "https://mcp.railway.com" });
    assert.doesNotMatch(raw + result.stdout, /RAILWAY_TOKEN|API_KEY|Bearer|@railway\/mcp-server|secrets\.env/);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
    await rm(homeRoot, { recursive: true, force: true });
  }
});

test("mcp doctor accepts remote URL MCP servers without requiring command", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "omk-mcp-doctor-"));
  const homeRoot = await mkdtemp(join(tmpdir(), "omk-mcp-home-"));

  try {
    await writeEmptyConfigs(projectRoot, homeRoot, {
      mcpServers: {
        railway: { url: "https://mcp.railway.com" },
      },
    });

    const result = runMcpScript(projectRoot, homeRoot, `
      await mcpDoctorCommand();
      console.log("DOCTOR_OK");
    `);

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /DOCTOR_OK/);
    assert.match(result.stdout, /url:.*https:\/\/mcp\.railway\.com/);
    assert.doesNotMatch(result.stdout, /missing command/);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
    await rm(homeRoot, { recursive: true, force: true });
  }
});

test("mcp doctor does not validate scoped npx package names as filesystem paths", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "omk-mcp-doctor-npx-"));
  const homeRoot = await mkdtemp(join(tmpdir(), "omk-mcp-home-"));

  try {
    await mkdir(join(projectRoot, ".kimi"), { recursive: true });
    await mkdir(join(homeRoot, ".kimi"), { recursive: true });
    await writeFile(join(projectRoot, ".kimi", "mcp.json"), JSON.stringify({
      mcpServers: {
        memory: {
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-memory"],
        },
      },
    }), "utf-8");
    await writeFile(join(homeRoot, ".kimi", "mcp.json"), JSON.stringify({ mcpServers: {} }), "utf-8");

    const result = runMcpScript(projectRoot, homeRoot, `
      await mcpDoctorCommand();
      console.log("DOCTOR_OK");
    `);

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /DOCTOR_OK/);
    assert.doesNotMatch(result.stdout, /arg path not found: @modelcontextprotocol\/server-memory/);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
    await rm(homeRoot, { recursive: true, force: true });
  }
});

test("mcp doctor reports omk-project as virtual runtime MCP injection", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "omk-mcp-doctor-virtual-"));
  const homeRoot = await mkdtemp(join(tmpdir(), "omk-mcp-home-"));

  try {
    await writeEmptyConfigs(projectRoot, homeRoot, { mcpServers: {} });

    const result = runMcpScript(projectRoot, homeRoot, `
      const report = await buildMcpDoctorReport();
      console.log(JSON.stringify(report.servers.find((server) => server.name === "omk-project")));
    `);

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const server = JSON.parse(result.stdout.trim().split("\n").at(-1));
    assert.equal(server.status, "ok");
    assert.deepEqual(server.sources, ["runtime:auto-injected"]);
    assert.ok(server.checks.some((check) => check.kind === "virtual-runtime-injected" && /virtual runtime MCP injected/.test(check.message)));
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
    await rm(homeRoot, { recursive: true, force: true });
  }
});

test("mcp doctor flags PDF server command missing --stdio before Kimi JSON-RPC parse fails", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "omk-mcp-doctor-pdf-"));
  const homeRoot = await mkdtemp(join(tmpdir(), "omk-mcp-home-"));

  try {
    await writeEmptyConfigs(projectRoot, homeRoot, {
      mcpServers: {
        pdf: {
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-pdf"],
        },
      },
    });

    const result = runMcpScript(projectRoot, homeRoot, `
      const report = await buildMcpDoctorReport();
      console.log(JSON.stringify({
        ok: report.ok,
        errors: report.errors,
        pdfChecks: report.servers.find((server) => server.name === "pdf")?.checks ?? [],
      }));
    `);

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const parsed = JSON.parse(result.stdout.trim().split("\n").at(-1));
    assert.equal(parsed.ok, false);
    assert.match(parsed.errors.join("\n"), /server-pdf defaults to HTTP/);
    assert.equal(parsed.pdfChecks.some((check) => check.kind === "stdio-protocol-mismatch"), true);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
    await rm(homeRoot, { recursive: true, force: true });
  }
});

test("mcp doctor flags Windows set and missing inline MCP scripts before runtime startup", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "omk-mcp-doctor-runtime-blocker-"));
  const homeRoot = await mkdtemp(join(tmpdir(), "omk-mcp-home-"));

  try {
    await writeEmptyConfigs(projectRoot, homeRoot, {
      mcpServers: {
        broken: {
          command: "bash",
          args: ["-lc", "/mnt/c/WINDOWS/System32/set -a; exec node /tmp/omk-missing-mcp/index.js"],
        },
        stale: {
          command: "npx",
          args: ["-y", "sqlite-mcp", "/home/not-current/.opencode/data.db"],
        },
        pagedesign: {
          command: "page-design-guide",
        },
      },
    });

    const result = runMcpScript(projectRoot, homeRoot, `
      await mcpDoctorCommand();
    `);

    assert.equal(result.status, 1, result.stderr || result.stdout);
    assert.match(result.stdout, /runtime startup blocker: Windows System32 set/);
    assert.match(result.stdout, /runtime startup blocker: inline MCP script references a missing local script/);
    assert.match(result.stdout, /runtime startup blocker: MCP config references a different user home path/);
    assert.match(result.stdout, /runtime startup blocker: stdio MCP config starts an HTTP MCP server/);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
    await rm(homeRoot, { recursive: true, force: true });
  }
});

test("mcp doctor --fix disables project MCP runtime startup blockers", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "omk-mcp-doctor-runtime-fix-"));
  const homeRoot = await mkdtemp(join(tmpdir(), "omk-mcp-home-"));

  try {
    await writeEmptyConfigs(projectRoot, homeRoot, {
      mcpServers: {
        broken: {
          command: "bash",
          args: ["-lc", "/mnt/c/WINDOWS/System32/set -a; exec node /tmp/omk-missing-mcp/index.js"],
        },
        stale: {
          command: "npx",
          args: ["-y", "sqlite-mcp", "/home/not-current/.opencode/data.db"],
        },
        pagedesign: {
          command: "page-design-guide",
        },
      },
    });

    const result = runMcpScript(projectRoot, homeRoot, `
      await mcpDoctorCommand({ fix: true, json: true });
    `);

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const report = JSON.parse(result.stdout);
    assert.equal(report.ok, true);
    assert.ok(report.fixes.actions.some((action) => /disabled MCP "broken"/.test(action)));
    assert.ok(report.fixes.actions.some((action) => /disabled MCP "stale"/.test(action)));
    assert.ok(report.fixes.actions.some((action) => /disabled MCP "pagedesign"/.test(action)));

    const projectConfig = JSON.parse(await readFile(join(projectRoot, ".kimi", "mcp.json"), "utf-8"));
    assert.deepEqual(projectConfig.mcpServers, {});
    assert.ok(projectConfig._omkDisabledMcpServers.broken);
    assert.ok(projectConfig._omkDisabledMcpServers.stale);
    assert.ok(projectConfig._omkDisabledMcpServers.pagedesign);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
    await rm(homeRoot, { recursive: true, force: true });
  }
});

test("mcp doctor --fix migrates stale package references in active project config only", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "omk-mcp-doctor-fix-"));
  const homeRoot = await mkdtemp(join(tmpdir(), "omk-mcp-home-"));

  try {
    await mkdir(join(projectRoot, ".kimi"), { recursive: true });
    await mkdir(join(homeRoot, ".kimi"), { recursive: true });
    await writeFile(join(projectRoot, ".kimi", "mcp.json"), JSON.stringify({
      mcpServers: {
        supabase: {
          command: "npx",
          args: ["-y", "@supabase/mcp-server@latest"],
        },
      },
    }), "utf-8");
    await writeFile(join(homeRoot, ".kimi", "mcp.json"), JSON.stringify({
      mcpServers: {
        globalSupabase: {
          command: "npx",
          args: ["-y", "@supabase/mcp-server@latest"],
        },
      },
    }), "utf-8");

    const result = runMcpScript(projectRoot, homeRoot, `
      await mcpDoctorCommand({ fix: true });
      const projectRaw = await readFile(join(process.env.OMK_PROJECT_ROOT, ".kimi", "mcp.json"), "utf-8");
      const homeRaw = await readFile(join(process.env.OMK_ORIGINAL_HOME, ".kimi", "mcp.json"), "utf-8");
      console.log(JSON.stringify({ project: JSON.parse(projectRaw), home: JSON.parse(homeRaw) }));
    `);

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const parsed = JSON.parse(result.stdout.trim().split("\n").at(-1));
    assert.deepEqual(parsed.project.mcpServers.supabase.args, ["-y", "@supabase/mcp-server-supabase@latest"]);
    assert.deepEqual(parsed.home.mcpServers.globalSupabase.args, ["-y", "@supabase/mcp-server@latest"]);
    assert.doesNotMatch(result.stdout + result.stderr, /API_KEY|TOKEN|PASSWORD|SECRET|Bearer/);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
    await rm(homeRoot, { recursive: true, force: true });
  }
});

test("mcp doctor --fix migrates legacy .omk MCP servers before creating .kimi fallback", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "omk-mcp-legacy-fix-"));
  const homeRoot = await mkdtemp(join(tmpdir(), "omk-mcp-home-"));

  try {
    await mkdir(join(projectRoot, ".omk"), { recursive: true });
    await mkdir(join(homeRoot, ".kimi"), { recursive: true });
    await writeFile(join(projectRoot, ".omk", "mcp.json"), JSON.stringify({
      mcpServers: {
        legacy: {
          command: "npx",
          args: ["-y", "firecrawl-mcp"],
        },
      },
    }), "utf-8");
    await writeFile(join(homeRoot, ".kimi", "mcp.json"), JSON.stringify({ mcpServers: {} }), "utf-8");

    const result = runMcpScript(projectRoot, homeRoot, `
      await mcpDoctorCommand({ fix: true, json: true });
      const raw = await readFile(join(process.env.OMK_PROJECT_ROOT, ".kimi", "mcp.json"), "utf-8");
      console.error("PROJECT_KIMI_MCP=" + raw);
    `);

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const raw = await readFile(join(projectRoot, ".kimi", "mcp.json"), "utf-8");
    const parsed = JSON.parse(raw);
    assert.deepEqual(parsed.mcpServers.legacy.args, ["-y", "firecrawl-mcp"]);
    assert.match(result.stdout, /migrated legacy MCP servers/);
    assert.doesNotMatch(raw, /"mcpServers":\\s*\\{\\s*\\}/);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
    await rm(homeRoot, { recursive: true, force: true });
  }
});

test("mcp doctor --fix keeps project duplicate overrides instead of deleting them", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "omk-mcp-dupe-override-"));
  const homeRoot = await mkdtemp(join(tmpdir(), "omk-mcp-home-"));

  try {
    await mkdir(join(projectRoot, ".kimi"), { recursive: true });
    await mkdir(join(homeRoot, ".kimi"), { recursive: true });
    await writeFile(join(projectRoot, ".kimi", "mcp.json"), JSON.stringify({
      mcpServers: {
        memory: { command: "bash", args: ["-lc", "true"] },
      },
    }), "utf-8");
    await writeFile(join(homeRoot, ".kimi", "mcp.json"), JSON.stringify({
      mcpServers: {
        memory: { command: "bash", args: ["-lc", "echo global"] },
      },
    }), "utf-8");

    const result = runMcpScript(projectRoot, homeRoot, `
      process.env.OMK_MCP_SCOPE = "all";
      await mcpDoctorCommand({ fix: true, json: true });
    `);

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const report = JSON.parse(result.stdout);
    assert.equal(report.ok, true);
    assert.equal(report.issueCount, 0);
    assert.ok(report.fixes.skipped.some((item) => /kept project override/.test(item)));
    assert.ok(report.servers[0].checks.some((check) => check.kind === "project-overrides-global" && check.severity === "info"));
    const projectConfig = JSON.parse(await readFile(join(projectRoot, ".kimi", "mcp.json"), "utf-8"));
    assert.deepEqual(projectConfig.mcpServers.memory.args, ["-lc", "true"]);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
    await rm(homeRoot, { recursive: true, force: true });
  }
});

test("global MCP sync preserves scoped and bare npm package args while rewriting explicit paths", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "omk-mcp-sync-package-"));
  const homeRoot = await mkdtemp(join(tmpdir(), "omk-mcp-home-"));

  try {
    await writeEmptyConfigs(projectRoot, homeRoot, {
      mcpServers: {
        scoped: { command: "npx", args: ["-y", "@scope/package"] },
        bare: { command: "npx", args: ["-y", "firecrawl-mcp"] },
        pathy: { command: "node", args: ["./server.js"] },
      },
    });

    const result = runMcpScript(projectRoot, homeRoot, `
      await syncKimiMcpGlobal({ quiet: true });
      const raw = await readFile(join(process.env.OMK_ORIGINAL_HOME, ".kimi", "mcp.json"), "utf-8");
      console.log(raw);
    `, { OMK_MCP_ALLOW_WRITE_CONFIG: "1" });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const parsed = JSON.parse(await readFile(join(homeRoot, ".kimi", "mcp.json"), "utf-8"));
    assert.deepEqual(parsed.mcpServers.scoped.args, ["-y", "@scope/package"]);
    assert.deepEqual(parsed.mcpServers.bare.args, ["-y", "firecrawl-mcp"]);
    assert.equal(parsed.mcpServers.pathy.args[0], join(projectRoot, "./server.js"));
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
    await rm(homeRoot, { recursive: true, force: true });
  }
});

test("doctor --fix --json skips global sync by default without stderr or success action", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "omk-doctor-json-fix-"));
  const homeRoot = await mkdtemp(join(tmpdir(), "omk-mcp-home-"));

  try {
    await mkdir(join(projectRoot, ".omk"), { recursive: true });
    await mkdir(join(projectRoot, ".kimi", "skills", "demo"), { recursive: true });
    await mkdir(join(homeRoot, ".kimi"), { recursive: true });
    await writeFile(join(projectRoot, ".omk", "kimi.config.toml"), [
      "[[hooks]]",
      "event = \"SubagentStop\"",
      "command = \".omk/hooks/subagent-stop-audit.sh\"",
      "",
    ].join("\n"), "utf-8");
    await writeFile(join(projectRoot, ".omk", "mcp.json"), JSON.stringify({
      mcpServers: { local: { command: "bash", args: ["-lc", "true"] } },
    }), "utf-8");
    await writeFile(join(homeRoot, ".kimi", "mcp.json"), JSON.stringify({ mcpServers: {} }), "utf-8");

    const result = runMcpScript(projectRoot, homeRoot, `
      await doctorCommand({ fix: true, json: true, soft: true });
    `);

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(result.stderr, "");
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.fixes.globalSync.blocked, false);
    assert.equal(parsed.fixes.globalSync.changed, false);
    assert.equal(parsed.fixes.actions.some((action) => /synced global Kimi hooks/.test(action)), false);
    assert.ok(parsed.fixes.skipped.some((item) => /global sync skipped/.test(item)));
    assert.equal(parsed.fixes.skipped.some((item) => /\.kimi[\\/]+skills[\\/]+demo/.test(item)), false);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
    await rm(homeRoot, { recursive: true, force: true });
  }
});

test("doctor --fix explicit global mode reports blocked global sync when write guard is unset", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "omk-doctor-json-global-fix-"));
  const homeRoot = await mkdtemp(join(tmpdir(), "omk-mcp-home-"));

  try {
    await mkdir(join(projectRoot, ".omk"), { recursive: true });
    await mkdir(join(projectRoot, ".kimi", "skills", "demo"), { recursive: true });
    await mkdir(join(homeRoot, ".kimi"), { recursive: true });
    await writeFile(join(projectRoot, ".omk", "kimi.config.toml"), [
      "[[hooks]]",
      "event = \"SubagentStop\"",
      "command = \".omk/hooks/subagent-stop-audit.sh\"",
      "",
    ].join("\n"), "utf-8");
    await writeFile(join(projectRoot, ".omk", "mcp.json"), JSON.stringify({
      mcpServers: { local: { command: "bash", args: ["-lc", "true"] } },
    }), "utf-8");
    await writeFile(join(homeRoot, ".kimi", "mcp.json"), JSON.stringify({ mcpServers: {} }), "utf-8");

    const result = runMcpScript(projectRoot, homeRoot, `
      await doctorCommand({ fix: true, json: true, soft: true });
    `, { OMK_DOCTOR_FIX_GLOBAL: "1" });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(result.stderr, "");
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.fixes.globalSync.blocked, true);
    assert.ok(parsed.fixes.skipped.some((item) => /global sync: .*blocked/.test(item)));
    assert.equal(parsed.fixes.actions.some((action) => /synced global/.test(action)), false);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
    await rm(homeRoot, { recursive: true, force: true });
  }
});

test("doctor follows root.yaml extend chain for inherited agent tools", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "omk-doctor-agent-tools-"));
  const homeRoot = await mkdtemp(join(tmpdir(), "omk-mcp-home-"));

  try {
    await mkdir(join(projectRoot, ".omk", "agents"), { recursive: true });
    await mkdir(join(homeRoot, ".kimi"), { recursive: true });
    await writeFile(join(homeRoot, ".kimi", "mcp.json"), JSON.stringify({ mcpServers: {} }), "utf-8");
    await writeFile(join(projectRoot, ".omk", "agents", "okabe.yaml"), [
      "version: 1",
      "agent:",
      "  name: omk-okabe-base",
      "  tools:",
      "    - Agent",
      "    - SearchWeb",
      "    - FetchURL",
      "",
    ].join("\n"), "utf-8");
    await writeFile(join(projectRoot, ".omk", "agents", "root.yaml"), [
      "version: 1",
      "agent:",
      "  extend: ./okabe.yaml",
      "  name: omk-root",
      "",
    ].join("\n"), "utf-8");

    const result = runMcpScript(projectRoot, homeRoot, `
      await doctorCommand({ soft: true });
    `);

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /Agent YAML Tools/);
    assert.match(result.stdout, /agent inheritance includes Agent, SearchWeb, FetchURL/);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
    await rm(homeRoot, { recursive: true, force: true });
  }
});

test("doctor --fix merges missing root subagent aliases without replacing existing aliases", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "omk-doctor-root-alias-"));
  const homeRoot = await mkdtemp(join(tmpdir(), "omk-mcp-home-"));

  try {
    await mkdir(join(projectRoot, ".omk", "agents"), { recursive: true });
    await mkdir(join(homeRoot, ".kimi"), { recursive: true });
    await writeFile(join(homeRoot, ".kimi", "mcp.json"), JSON.stringify({ mcpServers: {} }), "utf-8");
    await writeFile(join(projectRoot, ".omk", "agents", "root.yaml"), [
      "version: 1",
      "agent:",
      "  extend: ./okabe.yaml",
      "  name: omk-root",
      "  subagents:",
      "    coder:",
      "      path: ./roles/custom-coder.yaml",
      "",
    ].join("\n"), "utf-8");

    const result = runMcpScript(projectRoot, homeRoot, `
      await doctorCommand({ fix: true, json: true, soft: true });
    `);

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const parsed = JSON.parse(result.stdout);
    assert.ok(parsed.fixes.actions.some((item) => /missing root subagent alias/.test(item)));
    const rootYaml = await readFile(join(projectRoot, ".omk", "agents", "root.yaml"), "utf-8");
    assert.match(rootYaml, /security:/);
    assert.match(rootYaml, /tester:/);
    assert.match(rootYaml, /aggregator:/);
    assert.match(rootYaml, /custom-coder\.yaml/);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
    await rm(homeRoot, { recursive: true, force: true });
  }
});

test("mcp doctor ignores inactive global JSON and server errors in project scope", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "omk-mcp-inactive-global-"));
  const homeRoot = await mkdtemp(join(tmpdir(), "omk-mcp-home-"));

  try {
    await mkdir(join(projectRoot, ".kimi"), { recursive: true });
    await mkdir(join(homeRoot, ".kimi"), { recursive: true });
    await writeFile(join(projectRoot, ".kimi", "mcp.json"), JSON.stringify({
      mcpServers: {
        local: { url: "https://mcp.example.test" },
      },
    }), "utf-8");
    await writeFile(join(homeRoot, ".kimi", "mcp.json"), "{not-json", "utf-8");

    const result = runMcpScript(projectRoot, homeRoot, `
      await mcpDoctorCommand({ json: true });
    `);

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.issueCount, 0);
    const homeSource = parsed.sources.find((source) => source.path.includes(homeRoot));
    assert.ok(homeSource, "expected home source to be present in sources");
    assert.equal(homeSource.active, false);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
    await rm(homeRoot, { recursive: true, force: true });
  }
});

test("mcp doctor --json emits structured status without leaking secrets", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "omk-mcp-doctor-json-"));
  const homeRoot = await mkdtemp(join(tmpdir(), "omk-mcp-home-"));

  try {
    await writeEmptyConfigs(projectRoot, homeRoot, {
      mcpServers: {
        railway: {
          url: "https://mcp.railway.com",
          env: { RAILWAY_TOKEN: "${RAILWAY_TOKEN}" },
        },
      },
    });

    const result = runMcpScript(projectRoot, homeRoot, `
      await mcpDoctorCommand({ json: true });
    `);

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.activeScope, "project");
    assert.equal(parsed.issueCount, 0);
    assert.equal(parsed.servers[0].name, "railway");
    assert.equal(parsed.servers[0].transport, "remote");
    assert.equal(parsed.servers[0].url, "https://mcp.railway.com");
    assert.ok(parsed.servers[0].checks.some((check) => check.kind === "url" && check.severity === "ok"));
    assert.doesNotMatch(result.stdout + result.stderr, /super-secret|Bearer|RAILWAY_TOKEN=/);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
    await rm(homeRoot, { recursive: true, force: true });
  }
});


test("MCP diagnostics report invalid JSON without leaking config contents", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "omk-mcp-invalid-json-"));
  const homeRoot = await mkdtemp(join(tmpdir(), "omk-mcp-home-"));

  try {
    await mkdir(join(projectRoot, ".omk"), { recursive: true });
    await mkdir(join(projectRoot, ".kimi"), { recursive: true });
    await mkdir(join(homeRoot, ".kimi"), { recursive: true });
    await writeFile(join(projectRoot, ".omk", "mcp.json"), JSON.stringify({ mcpServers: {} }), "utf-8");
    await writeFile(join(projectRoot, ".kimi", "mcp.json"), `{ "mcpServers": { "bad": { "env": { "API_TOKEN": "super-secret-value" } } }`, "utf-8");
    await writeFile(join(homeRoot, ".kimi", "mcp.json"), `{ "mcpServers": { "global": { "env": { "PASSWORD": "global-secret" } } }`, "utf-8");

    const result = runMcpScript(projectRoot, homeRoot, `
      await mcpListCommand();
      await mcpDoctorCommand();
      await doctorCommand({ soft: true });
      console.log("INVALID_JSON_DIAGNOSTICS_OK");
    `);

    assert.equal(result.status, 1, result.stderr || result.stdout);
    assert.match(result.stdout, /Invalid JSON/);
    assert.match(result.stdout, /MCP JSON/);
    assert.match(result.stdout, /INVALID_JSON_DIAGNOSTICS_OK/);
    assert.doesNotMatch(result.stdout + result.stderr, /super-secret-value|global-secret/);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
    await rm(homeRoot, { recursive: true, force: true });
  }
});

test("omk-project MCP returns tool-level errors instead of JSON-RPC internal errors", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "omk-mcp-tool-error-"));
  const homeRoot = await mkdtemp(join(tmpdir(), "omk-mcp-home-"));

  try {
    const input = [
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "omk-mcp-test", version: "0.0.0" },
        },
      },
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
      },
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "omk_goal_show",
          arguments: { goalId: "missing-goal" },
        },
      },
      {
        jsonrpc: "2.0",
        id: 4,
        method: "resources/read",
        params: {
          uri: "omk://goal/missing-goal",
        },
      },
    ].map((message) => JSON.stringify(message)).join("\n") + "\n";

    const result = spawnSync(process.execPath, [OMK_PROJECT_SERVER], {
      cwd: projectRoot,
      env: {
        ...process.env,
        HOME: homeRoot,
        OMK_PROJECT_ROOT: projectRoot,
      },
      input,
      encoding: "utf-8",
      timeout: 10000,
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);

    const responses = result.stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    const toolResponse = responses.find((response) => response.id === 3);
    const resourceResponse = responses.find((response) => response.id === 4);

    assert.ok(toolResponse, "expected response for tools/call id 3");
    assert.equal(toolResponse.error, undefined);
    assert.equal(toolResponse.result.isError, true);
    assert.match(toolResponse.result.content[0].text, /OMK tool-level failure/);
    assert.match(toolResponse.result.content[0].text, /Goal not found: missing-goal/);
    assert.doesNotMatch(toolResponse.result.content[0].text, /Internal error/);
    assert.ok(resourceResponse, "expected response for resources/read id 4");
    assert.equal(resourceResponse.error.code, -32000);
    assert.doesNotMatch(resourceResponse.error.message, /Internal error/);
    assert.match(result.stderr, /tool_call_failed/);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
    await rm(homeRoot, { recursive: true, force: true });
  }
});

test("omk-project MCP hides and denies write-capable tools by default", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "omk-mcp-permission-"));
  const homeRoot = await mkdtemp(join(tmpdir(), "omk-mcp-home-"));

  try {
    const input = [
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "omk-mcp-test", version: "0.0.0" },
        },
      },
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "omk_memory_write",
          arguments: { path: "project.md", content: "blocked" },
        },
      },
    ].map((message) => JSON.stringify(message)).join("\n") + "\n";

    const result = spawnSync(process.execPath, [OMK_PROJECT_SERVER], {
      cwd: projectRoot,
      env: {
        ...process.env,
        HOME: homeRoot,
        OMK_PROJECT_ROOT: projectRoot,
        OMK_MCP_PERMISSION_PROFILE: "",
      },
      input,
      encoding: "utf-8",
      timeout: 10000,
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const responses = result.stdout.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
    const listResponse = responses.find((response) => response.id === 2);
    const writeResponse = responses.find((response) => response.id === 3);
    const toolNames = listResponse.result.tools.map((tool) => tool.name);
    assert.equal(toolNames.includes("omk_memory_read"), true);
    assert.equal(toolNames.includes("omk_memory_write"), false);
    assert.equal(writeResponse.result.isError, true);
    assert.match(writeResponse.result.content[0].text, /permission profile 'default'/);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
    await rm(homeRoot, { recursive: true, force: true });
  }
});

test("filesystem-readonly MCP exposes read tools and denies write tool calls", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "omk-mcp-readonly-"));
  const homeRoot = await mkdtemp(join(tmpdir(), "omk-mcp-home-"));

  try {
    await mkdir(join(projectRoot, ".kimi"), { recursive: true });
    await mkdir(join(projectRoot, ".omk", "cache"), { recursive: true });
    await writeFile(join(projectRoot, "README.md"), "readonly ok", "utf-8");
    await writeFile(join(projectRoot, ".kimi", "mcp.json"), JSON.stringify({ token: "SECRET" }), "utf-8");
    await writeFile(join(projectRoot, ".omk", "cache", "mcp-runtime.json"), JSON.stringify({ token: "SECRET" }), "utf-8");
    const input = [
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "omk-mcp-test", version: "0.0.0" },
        },
      },
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "read_file", arguments: { path: "README.md" } },
      },
      {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "write_file", arguments: { path: "README.md", content: "mutate" } },
      },
      {
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: { name: "read_file", arguments: { path: ".kimi/mcp.json" } },
      },
      {
        jsonrpc: "2.0",
        id: 6,
        method: "tools/call",
        params: { name: "get_file_info", arguments: { path: ".omk/cache/mcp-runtime.json" } },
      },
      {
        jsonrpc: "2.0",
        id: 7,
        method: "tools/call",
        params: { name: "list_directory", arguments: { path: "." } },
      },
      {
        jsonrpc: "2.0",
        id: 8,
        method: "tools/call",
        params: { name: "list_directory", arguments: { path: ".omk" } },
      },
      {
        jsonrpc: "2.0",
        id: 9,
        method: "tools/call",
        params: { name: "search_files", arguments: { pattern: "mcp" } },
      },
    ].map((message) => JSON.stringify(message)).join("\n") + "\n";

    const result = spawnSync(process.execPath, [OMK_CLI, "mcp", "serve", "filesystem-readonly"], {
      cwd: projectRoot,
      env: {
        ...process.env,
        HOME: homeRoot,
        OMK_PROJECT_ROOT: projectRoot,
      },
      input,
      encoding: "utf-8",
      timeout: 10000,
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const responses = result.stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    const listResponse = responses.find((response) => response.id === 2);
    const readResponse = responses.find((response) => response.id === 3);
    const writeResponse = responses.find((response) => response.id === 4);
    const secretReadResponse = responses.find((response) => response.id === 5);
    const secretInfoResponse = responses.find((response) => response.id === 6);
    const rootListResponse = responses.find((response) => response.id === 7);
    const omkListResponse = responses.find((response) => response.id === 8);
    const searchResponse = responses.find((response) => response.id === 9);
    const toolNames = listResponse.result.tools.map((tool) => tool.name);

    assert.deepEqual(toolNames.sort(), [
      "get_file_info",
      "list_allowed_directories",
      "list_directory",
      "read_file",
      "search_files",
    ].sort());
    assert.equal(toolNames.includes("write_file"), false);
    assert.match(readResponse.result.content[0].text, /readonly ok/);
    assert.equal(writeResponse.result.isError, true);
    assert.match(writeResponse.result.content[0].text, /not read-only/);
    assert.equal(secretReadResponse.result.isError, true);
    assert.match(secretReadResponse.result.content[0].text, /secret-bearing file pattern/);
    assert.doesNotMatch(secretReadResponse.result.content[0].text, /SECRET/);
    assert.equal(secretInfoResponse.result.isError, true);
    assert.match(secretInfoResponse.result.content[0].text, /secret-bearing file pattern/);
    assert.doesNotMatch(rootListResponse.result.content[0].text, /\.kimi/);
    assert.doesNotMatch(omkListResponse.result.content[0].text, /cache/);
    assert.doesNotMatch(searchResponse.result.content[0].text, /\.kimi|\.omk\/cache/);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
    await rm(homeRoot, { recursive: true, force: true });
  }
});

test("mcp test exercises an omk CLI connection through tools/call id 3", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "omk-mcp-cli-connection-"));
  const homeRoot = await mkdtemp(join(tmpdir(), "omk-mcp-home-"));
  const binRoot = await mkdtemp(join(tmpdir(), "omk-mcp-bin-"));

  try {
    await writeEmptyConfigs(projectRoot, homeRoot, {
      mcpServers: {
        "omk-cli": {
          command: "omk",
          args: ["mcp", "serve", "omk-project"],
          env: { OMK_PROJECT_ROOT: projectRoot },
        },
      },
    });
    if (process.platform === "win32") {
      await writeFile(
        join(binRoot, "omk.cmd"),
        `@echo off\r\n"${process.execPath}" "${OMK_CLI}" %*\r\n`,
        "utf-8"
      );
    } else {
      const omkWrapper = join(binRoot, "omk");
      await writeFile(
        omkWrapper,
        `#!/usr/bin/env bash\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(OMK_CLI)} "$@"\n`,
        "utf-8"
      );
      await chmod(omkWrapper, 0o755);
    }

    const result = runMcpScript(projectRoot, homeRoot, `
      await mcpTestCommand("omk-cli");
      console.log("MCP_TEST_OK");
    `, buildPrependPathEnv(binRoot));

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /MCP Test: omk-cli/);
    assert.match(result.stdout, /JSON-RPC initialize succeeded/);
    assert.match(result.stdout, /tools\/call id 3 returned OMK tool-level error without -32603/);
    assert.match(result.stdout, /MCP_TEST_OK/);
    assert.doesNotMatch(result.stdout + result.stderr, /Internal error/);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
    await rm(homeRoot, { recursive: true, force: true });
    await rm(binRoot, { recursive: true, force: true });
  }
});

test("mcp doctor does not fail on inactive omk-project mirror duplicates", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "omk-mcp-doctor-dupe-"));
  const homeRoot = await mkdtemp(join(tmpdir(), "omk-mcp-home-"));

  try {
    await mkdir(join(projectRoot, ".omk"), { recursive: true });
    await mkdir(join(projectRoot, ".kimi"), { recursive: true });
    await mkdir(join(homeRoot, ".kimi"), { recursive: true });
    const projectServer = { command: "bash", args: ["-lc", "true"] };
    await writeFile(join(projectRoot, ".omk", "mcp.json"), JSON.stringify({
      mcpServers: { "omk-project": projectServer },
    }), "utf-8");
    await writeFile(join(projectRoot, ".kimi", "mcp.json"), JSON.stringify({
      mcpServers: { "omk-project": projectServer },
    }), "utf-8");
    await writeFile(join(homeRoot, ".kimi", "mcp.json"), JSON.stringify({
      mcpServers: { "omk-project": { command: "bash", args: ["-lc", "echo stale-global"] } },
    }), "utf-8");

    const result = runMcpScript(projectRoot, homeRoot, `
      await mcpDoctorCommand();
      console.log("DOCTOR_OK");
    `);

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /Active MCP scope: project/);
    assert.match(result.stdout, /duplicate mirror outside active scope/);
    assert.match(result.stdout, /DOCTOR_OK/);
    assert.doesNotMatch(result.stdout, /issue\\(s\\) found/);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
    await rm(homeRoot, { recursive: true, force: true });
  }
});

test("mcp doctor validates the effective project MCP definition over stale .omk fallback", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "omk-mcp-effective-"));
  const homeRoot = await mkdtemp(join(tmpdir(), "omk-mcp-home-"));

  try {
    await mkdir(join(projectRoot, ".omk"), { recursive: true });
    await mkdir(join(projectRoot, ".kimi"), { recursive: true });
    await mkdir(join(homeRoot, ".kimi"), { recursive: true });
    await writeFile(join(projectRoot, ".omk", "mcp.json"), JSON.stringify({
      mcpServers: { memory: { command: "definitely-missing-omk-cmd" } },
    }), "utf-8");
    await writeFile(join(projectRoot, ".kimi", "mcp.json"), JSON.stringify({
      mcpServers: { memory: { command: "bash", args: ["-lc", "true"] } },
    }), "utf-8");
    await writeFile(join(homeRoot, ".kimi", "mcp.json"), JSON.stringify({ mcpServers: {} }), "utf-8");

    const result = runMcpScript(projectRoot, homeRoot, `
      await mcpDoctorCommand();
      console.log("DOCTOR_OK");
    `);

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /duplicate mirror outside active scope/);
    assert.match(result.stdout, /DOCTOR_OK/);
    assert.doesNotMatch(result.stdout + result.stderr, /definitely-missing-omk-cmd/);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
    await rm(homeRoot, { recursive: true, force: true });
  }
});

test("mcp list displays the effective active server over stale .omk fallback", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "omk-mcp-list-effective-"));
  const homeRoot = await mkdtemp(join(tmpdir(), "omk-mcp-home-"));

  try {
    await mkdir(join(projectRoot, ".omk"), { recursive: true });
    await mkdir(join(projectRoot, ".kimi"), { recursive: true });
    await mkdir(join(homeRoot, ".kimi"), { recursive: true });
    await writeFile(join(projectRoot, ".omk", "mcp.json"), JSON.stringify({
      mcpServers: { memory: { command: "stale-omk-command" } },
    }), "utf-8");
    await writeFile(join(projectRoot, ".kimi", "mcp.json"), JSON.stringify({
      mcpServers: { memory: { command: "bash", args: ["-lc", "true"] } },
    }), "utf-8");
    await writeFile(join(homeRoot, ".kimi", "mcp.json"), JSON.stringify({ mcpServers: {} }), "utf-8");

    const result = runMcpScript(projectRoot, homeRoot, `
      await mcpListCommand();
    `);

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /command:\s+bash/);
    assert.doesNotMatch(result.stdout, /command:\s+stale-omk-command/);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
    await rm(homeRoot, { recursive: true, force: true });
  }
});

test("mcp doctor does not fail on active omk-project mirror duplicates in all scope", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "omk-mcp-doctor-all-dupe-"));
  const homeRoot = await mkdtemp(join(tmpdir(), "omk-mcp-home-"));

  try {
    await mkdir(join(projectRoot, ".omk"), { recursive: true });
    await mkdir(join(projectRoot, ".kimi"), { recursive: true });
    await mkdir(join(homeRoot, ".kimi"), { recursive: true });
    const projectServer = { command: "bash", args: ["-lc", "true"] };
    await writeFile(join(projectRoot, ".omk", "mcp.json"), JSON.stringify({
      mcpServers: { "omk-project": projectServer },
    }), "utf-8");
    await writeFile(join(projectRoot, ".kimi", "mcp.json"), JSON.stringify({
      mcpServers: { "omk-project": projectServer },
    }), "utf-8");
    await writeFile(join(homeRoot, ".kimi", "mcp.json"), JSON.stringify({
      mcpServers: { "omk-project": { command: "bash", args: ["-lc", "echo stale-global"] } },
    }), "utf-8");

    const result = runMcpScript(projectRoot, homeRoot, `
      process.env.OMK_MCP_SCOPE = "all";
      await mcpDoctorCommand();
      console.log("DOCTOR_OK");
    `);

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /Active MCP scope: all/);
    assert.match(result.stdout, /managed omk-project mirror duplicate/);
    assert.match(result.stdout, /DOCTOR_OK/);
    assert.doesNotMatch(result.stdout, /issue\\(s\\) found/);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
    await rm(homeRoot, { recursive: true, force: true });
  }
});

test("mcp test fails fast when a stdio server writes non-JSON startup logs to stdout", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "omk-mcp-noisy-stdout-"));
  const homeRoot = await mkdtemp(join(tmpdir(), "omk-mcp-home-"));
  const binDir = await mkdtemp(join(tmpdir(), "omk-mcp-bin-"));
  const serverPath = join(binDir, "noisy-mcp");

  try {
    await writeEmptyConfigs(projectRoot, homeRoot, {
      mcpServers: {
        noisy: { command: serverPath },
      },
    });
    await writeFile(serverPath, `#!/usr/bin/env node
const { writeSync } = require('node:fs');
writeSync(1, 'MCP server listening on http://localhost:3001/mcp\\n');
setTimeout(() => process.exit(0), 20);
`, "utf-8");
    await chmod(serverPath, 0o755);

    const result = runMcpScript(projectRoot, homeRoot, `
      await mcpTestCommand("noisy");
    `, buildPrependPathEnv(binDir));

    assert.equal(result.status, 1, result.stderr || result.stdout);
    assert.match(result.stderr, /non-JSON text to stdout/);
    assert.match(result.stderr, /MCP stdio servers must write only JSON-RPC frames to stdout/);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
    await rm(homeRoot, { recursive: true, force: true });
    await rm(binDir, { recursive: true, force: true });
  }
});

test("mcp test fails fast when stdout starts with invalid JSON", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "omk-mcp-invalid-json-"));
  const homeRoot = await mkdtemp(join(tmpdir(), "omk-mcp-home-"));
  const binDir = await mkdtemp(join(tmpdir(), "omk-mcp-bin-"));
  const serverPath = join(binDir, "invalid-json-mcp");

  try {
    await mkdir(join(projectRoot, ".kimi"), { recursive: true });
    await mkdir(join(homeRoot, ".kimi"), { recursive: true });
    await writeFile(join(projectRoot, ".kimi", "mcp.json"), JSON.stringify({
      mcpServers: {
        badjson: { command: serverPath },
      },
    }), "utf-8");
    await writeFile(join(homeRoot, ".kimi", "mcp.json"), JSON.stringify({ mcpServers: {} }), "utf-8");
    await writeFile(serverPath, `#!/usr/bin/env node
const { writeSync } = require('node:fs');
writeSync(1, '{not-json}\\\\n');
setTimeout(() => process.exit(0), 20);
`, "utf-8");
    await chmod(serverPath, 0o755);

    const result = runMcpScript(projectRoot, homeRoot, `
      await mcpTestCommand("badjson");
    `, buildPrependPathEnv(binDir));

    assert.equal(result.status, 1, result.stderr || result.stdout);
    assert.match(result.stderr, /non-JSON text to stdout/);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
    await rm(homeRoot, { recursive: true, force: true });
    await rm(binDir, { recursive: true, force: true });
  }
});

test("mcp test fails fast on JSON-shaped stdout logs that are not JSON-RPC frames", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "omk-mcp-json-log-"));
  const homeRoot = await mkdtemp(join(tmpdir(), "omk-mcp-home-"));
  const binDir = await mkdtemp(join(tmpdir(), "omk-mcp-bin-"));
  const serverPath = join(binDir, "json-log-mcp");

  try {
    await mkdir(join(projectRoot, ".kimi"), { recursive: true });
    await mkdir(join(homeRoot, ".kimi"), { recursive: true });
    await writeFile(join(projectRoot, ".kimi", "mcp.json"), JSON.stringify({
      mcpServers: {
        jsonlog: { command: serverPath },
      },
    }), "utf-8");
    await writeFile(join(homeRoot, ".kimi", "mcp.json"), JSON.stringify({ mcpServers: {} }), "utf-8");
    await writeFile(serverPath, `#!/usr/bin/env node
const { writeSync } = require('node:fs');
writeSync(1, JSON.stringify({ level: 'info', message: 'starting' }) + '\\n');
setTimeout(() => process.exit(0), 20);
`, "utf-8");
    await chmod(serverPath, 0o755);

    const result = runMcpScript(projectRoot, homeRoot, `
      await mcpTestCommand("jsonlog");
    `, buildPrependPathEnv(binDir));

    assert.equal(result.status, 1, result.stderr || result.stdout);
    assert.match(result.stderr, /non-JSON text to stdout/);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
    await rm(homeRoot, { recursive: true, force: true });
    await rm(binDir, { recursive: true, force: true });
  }
});
