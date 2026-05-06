import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const OMK_ROOT = process.cwd();
const MCP_MODULE_URL = pathToFileURL(join(OMK_ROOT, "dist", "commands", "mcp.js")).href;

function runMcpScript(projectRoot, homeRoot, scriptBody) {
  return spawnSync(process.execPath, ["--input-type=module"], {
    input: `
      import { mkdir, readFile, writeFile } from "node:fs/promises";
      import { join } from "node:path";
      import { mcpDoctorCommand, mcpInstallCommand } from ${JSON.stringify(MCP_MODULE_URL)};
      ${scriptBody}
    `,
    cwd: projectRoot,
    env: {
      ...process.env,
      HOME: homeRoot,
      OMK_PROJECT_ROOT: projectRoot,
    },
    encoding: "utf-8",
    timeout: 30000,
  });
}

async function writeEmptyConfigs(projectRoot, homeRoot, omkConfig) {
  await mkdir(join(projectRoot, ".omk"), { recursive: true });
  await mkdir(join(projectRoot, ".kimi"), { recursive: true });
  await mkdir(join(homeRoot, ".kimi"), { recursive: true });
  await writeFile(join(projectRoot, ".omk", "mcp.json"), JSON.stringify(omkConfig), "utf-8");
  await writeFile(join(projectRoot, ".kimi", "mcp.json"), JSON.stringify({ mcpServers: {} }), "utf-8");
  await writeFile(join(homeRoot, ".kimi", "mcp.json"), JSON.stringify({ mcpServers: {} }), "utf-8");
}

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
