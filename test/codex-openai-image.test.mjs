import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const OMK_ROOT = process.cwd();
const CODEX_MODULE_URL = pathToFileURL(join(OMK_ROOT, "dist", "commands", "codex.js")).href;
const IMAGE_CLIENT_MODULE_URL = pathToFileURL(join(OMK_ROOT, "dist", "openai", "image-client.js")).href;

test("Codex MCP import skips secret-bearing entries and adds docs-only OpenAI MCP", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "omk-codex-import-project-"));
  const homeRoot = await mkdtemp(join(tmpdir(), "omk-codex-import-home-"));
  try {
    await mkdir(join(homeRoot, ".codex"), { recursive: true });
    await writeFile(join(homeRoot, ".codex", "config.toml"), `
[mcp_servers.safe]
command = "node"
args = ["server.js", "--api-key", "SHOULD_NOT_COPY", "--header", "Authorization: Bearer SHOULD_NOT_COPY", "--header", "Accept: application/json", "--flag=ok"]
env = { API_TOKEN = "SHOULD_NOT_COPY", PLAIN = "ok" }

[mcp_servers.remote]
url = "https://mcp.example.test/${["sk", "SHOULD_NOT_COPY_TOKEN"].join("-")}/sse?api_key=SHOULD_NOT_COPY#access_token=SHOULD_NOT_COPY"
http_headers = { Authorization = "Bearer SHOULD_NOT_COPY" }

[mcp_servers.bearer]
url = "https://mcp.example.test/sse"
bearer_token = "SHOULD_NOT_COPY"

[mcp_servers.shellSecrets]
command = "bash"
args = ["-lc", "source secrets.env && npx secret-server"]
`, "utf-8");

    const { importCodexMcpConfig, OPENAI_DOCS_MCP_URL } = await import(CODEX_MODULE_URL);
    const result = await importCodexMcpConfig({ projectRoot, homeDir: homeRoot, includeOpenAIDocs: true });
    const raw = await readFile(join(projectRoot, ".kimi", "mcp.json"), "utf-8");
    const parsed = JSON.parse(raw);

    assert.deepEqual(result.imported.sort(), ["openaiDeveloperDocs", "remote", "safe"]);
    assert.equal(parsed.mcpServers.openaiDeveloperDocs.url, OPENAI_DOCS_MCP_URL);
    assert.deepEqual(parsed.mcpServers.safe.args, [
      "server.js",
      "--api-key",
      "[REDACTED]",
      "--header",
      "Authorization: Bearer [REDACTED]",
      "--header",
      "Accept: application/json",
      "--flag=ok",
    ]);
    assert.equal(parsed.mcpServers.safe.env.API_TOKEN, "${API_TOKEN}");
    assert.equal(parsed.mcpServers.safe.env.PLAIN, "ok");
    assert.doesNotMatch(parsed.mcpServers.remote.url, /SHOULD_NOT_COPY|sk-SHOULD/);
    assert.equal(parsed.mcpServers.remote.http_headers.Authorization, "[REDACTED]");
    assert.equal(parsed.mcpServers.bearer, undefined);
    assert.equal(parsed.mcpServers.shellSecrets, undefined);
    assert.match(result.skipped.map((entry) => entry.name).join(","), /bearer/);
    assert.match(result.skipped.map((entry) => entry.name).join(","), /shellSecrets/);
    assert.doesNotMatch(raw + JSON.stringify(result), /SHOULD_NOT_COPY|secrets\.env|Bearer SHOULD/);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
    await rm(homeRoot, { recursive: true, force: true });
  }
});

test("Codex auth onboarding never treats plan choice as auth verification", async () => {
  const { codexAuthCommand } = await import(CODEX_MODULE_URL);
  const originalLog = console.log;
  const output = [];
  console.log = (value = "") => output.push(String(value));
  try {
    await codexAuthCommand({ choice: "plus-pro", json: true });
  } finally {
    console.log = originalLog;
  }
  const payload = JSON.parse(output.join("\n"));
  assert.equal(payload.choice, "plus-pro");
  assert.equal(payload.authBypass, false);
  assert.equal(payload.authVerified, false);
  assert.equal(payload.authJsonRead, false);
  assert.match(payload.nextActions.join("\n"), /codex login|official Codex login/i);
  assert.match(payload.nextActions.join("\n"), /Codex\/ChatGPT OAuth tokens are not Images API credentials/);
});

test("OpenAI setup API-key path requires Platform project key runtime flow", async () => {
  const { openAiSetupCommand } = await import(CODEX_MODULE_URL);
  const envName = "OMK_TEST_OPENAI_KEY";
  const originalValue = process.env[envName];
  delete process.env[envName];
  const originalLog = console.log;
  const output = [];
  console.log = (value = "") => output.push(String(value));
  try {
    await openAiSetupCommand({ choice: "api-key", apiKeyEnv: envName, json: true });
  } finally {
    console.log = originalLog;
    if (originalValue === undefined) delete process.env[envName];
    else process.env[envName] = originalValue;
  }
  const payload = JSON.parse(output.join("\n"));
  const nextActions = payload.nextActions.join("\n");
  assert.equal(payload.choice, "api-key");
  assert.equal(payload.authBypass, false);
  assert.equal(payload.authVerified, false);
  assert.equal(payload.authJsonRead, false);
  assert.match(nextActions, /OpenAI Platform project API key/);
  assert.match(nextActions, /Codex\/ChatGPT OAuth credentials/);
  assert.match(nextActions, /one `omk image generate\/edit` process|unset it/);
});

test("OpenAI image API key resolver accepts Platform keys and rejects OAuth-looking tokens", async () => {
  const { OpenAiImageError, isOpenAiPlatformApiKey, resolveOpenAiApiKey } = await import(IMAGE_CLIENT_MODULE_URL);
  const platformCredential = "sk-proj-sample_key_123";

  assert.equal(isOpenAiPlatformApiKey(platformCredential), true);
  assert.equal(resolveOpenAiApiKey({ OPENAI_API_KEY: ` ${platformCredential} ` }), platformCredential);

  assert.throws(
    () => resolveOpenAiApiKey({}, "OPENAI_API_KEY"),
    (error) => {
      assert.ok(error instanceof OpenAiImageError);
      assert.equal(error.kind, "auth");
      assert.match(error.action, /OpenAI Platform project API key/);
      assert.match(error.action, /runtime environment/);
      return true;
    }
  );

  assert.throws(
    () => resolveOpenAiApiKey({ OPENAI_API_KEY: "Bearer fixture-oauth-token" }),
    (error) => {
      assert.ok(error instanceof OpenAiImageError);
      assert.equal(error.kind, "auth");
      assert.match(error.message, /OAuth or session token/);
      assert.match(error.action, /Codex\/ChatGPT OAuth tokens are only for login/);
      return true;
    }
  );
});

test("OpenAI image client saves generated image and secret-free metadata", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "omk-openai-image-"));
  try {
    const { OpenAiImageClient, saveOpenAiImageResult } = await import(IMAGE_CLIENT_MODULE_URL);
    const imageBytes = Buffer.from("fake-png-bytes");
    const apiKey = "fixture-openai-key";
    const client = new OpenAiImageClient({
      apiKey,
      fetch: async (url, init) => {
        assert.equal(String(url), "https://api.openai.com/v1/images/generations");
        assert.equal(init.method, "POST");
        assert.doesNotMatch(String(init.body), new RegExp(apiKey));
        return new Response(JSON.stringify({
          created: 123,
          output_format: "png",
          data: [{ b64_json: imageBytes.toString("base64") }],
          usage: { total_tokens: 7 },
        }), { status: 200, headers: { "content-type": "application/json" } });
      },
    });

    const result = await client.generate({ prompt: "secret prompt text", size: "1024x1024" });
    const saved = await saveOpenAiImageResult(
      projectRoot,
      result,
      { size: "1024x1024", outputFormat: "png" },
      new Date("2026-05-21T00:00:00.000Z")
    );

    assert.equal(saved.relativeImagePath, ".omk/images/2026-05-21T00-00-00-000Z.png");
    const savedImage = await readFile(saved.imagePath);
    assert.deepEqual(savedImage, imageBytes);
    const metadataRaw = await readFile(saved.metadataPath, "utf-8");
    assert.match(metadataRaw, /"model": "gpt-image-2"/);
    assert.match(metadataRaw, /"promptSha256"/);
    assert.doesNotMatch(metadataRaw, new RegExp(`secret prompt text|${apiKey}`));
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("OpenAI image client maps permission, billing, and rate-limit errors", async () => {
  const { OpenAiImageClient, OpenAiImageError } = await import(IMAGE_CLIENT_MODULE_URL);
  async function assertKind(statusCode, message, expectedKind) {
    const client = new OpenAiImageClient({
      apiKey: "sk-test",
      fetch: async () => new Response(JSON.stringify({ error: { message } }), { status: statusCode }),
    });
    await assert.rejects(
      () => client.generate({ prompt: "x" }),
      (error) => error instanceof OpenAiImageError && error.kind === expectedKind
    );
  }

  await assertKind(403, "permission denied for model", "permission");
  await assertKind(429, "rate limit reached", "rate_limit");
  await assertKind(429, "insufficient_quota billing required", "billing");
});

test("OpenAI image client redacts API and OAuth-looking tokens from errors", async () => {
  const { OpenAiImageClient, OpenAiImageError } = await import(IMAGE_CLIENT_MODULE_URL);
  const client = new OpenAiImageClient({
    apiKey: "sk-test",
    fetch: async () => new Response(JSON.stringify({
      error: {
        message: [
          `bad ${["sk", "proj", "fixture_key_123"].join("-")}`,
          "Bearer fixture/with+chars==",
          "eyJabc.def.ghi",
          "oauth:abc",
          "sess-abc/+=",
          "access_token=abc++",
        ].join(" "),
      },
    }), { status: 401 }),
  });

  await assert.rejects(
    () => client.generate({ prompt: "x" }),
    (error) => {
      assert.ok(error instanceof OpenAiImageError);
      assert.equal(error.kind, "auth");
      assert.doesNotMatch(error.message, /sk-proj-fixture|fixture\/with|with\+chars|eyJabc|oauth:abc|sess-abc|access_token=abc/);
      assert.match(error.action, /OpenAI Platform project API key/);
      return true;
    }
  );
});

test("Codex MCP import dry-run does not write project config", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "omk-codex-import-dry-"));
  const homeRoot = await mkdtemp(join(tmpdir(), "omk-codex-import-home-"));
  try {
    await mkdir(join(homeRoot, ".codex"), { recursive: true });
    await writeFile(join(homeRoot, ".codex", "config.toml"), `
[mcp_servers.safe]
url = "https://mcp.example.test/sse"
`, "utf-8");
    const { importCodexMcpConfig } = await import(CODEX_MODULE_URL);
    const result = await importCodexMcpConfig({ projectRoot, homeDir: homeRoot, dryRun: true });
    assert.deepEqual(result.imported, ["safe"]);
    await assert.rejects(() => stat(join(projectRoot, ".kimi", "mcp.json")));
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
    await rm(homeRoot, { recursive: true, force: true });
  }
});

test("Codex MCP import fails safely when target MCP JSON is invalid", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "omk-codex-import-invalid-target-"));
  const homeRoot = await mkdtemp(join(tmpdir(), "omk-codex-import-home-"));
  try {
    await mkdir(join(projectRoot, ".kimi"), { recursive: true });
    await mkdir(join(homeRoot, ".codex"), { recursive: true });
    await writeFile(join(projectRoot, ".kimi", "mcp.json"), "{not-json", "utf-8");
    await writeFile(join(homeRoot, ".codex", "config.toml"), `
[mcp_servers.safe]
url = "https://mcp.example.test/sse"
`, "utf-8");
    const { importCodexMcpConfig } = await import(CODEX_MODULE_URL);
    await assert.rejects(
      () => importCodexMcpConfig({ projectRoot, homeDir: homeRoot }),
      /Invalid Kimi MCP config JSON/
    );
    assert.equal(await readFile(join(projectRoot, ".kimi", "mcp.json"), "utf-8"), "{not-json");
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
    await rm(homeRoot, { recursive: true, force: true });
  }
});
