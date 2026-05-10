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
  return spawnSync(process.execPath, ["--input-type=module"], {
    input: `
      import { mkdir, readFile, writeFile } from "node:fs/promises";
      import { join } from "node:path";
      import { mcpDoctorCommand, mcpInstallCommand, mcpListCommand, mcpTestCommand } from ${JSON.stringify(MCP_MODULE_URL)};
      import { doctorCommand } from ${JSON.stringify(pathToFileURL(join(OMK_ROOT, "dist", "commands", "doctor.js")).href)};
      ${scriptBody}
    `,
    cwd: projectRoot,
    env: {
      ...process.env,
      ...extraEnv,
      HOME: homeRoot,
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
