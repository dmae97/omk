import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  parseServarrConfig,
  redactServarrInstance,
} from "../dist/integrations/servarr/schema.js";
import {
  loadServarrConfig,
  requestServarr,
  selectServarrInstance,
  serviceEndpoint,
} from "../dist/integrations/servarr/adapter.js";
import {
  servarrHealthCommand,
  servarrInstancesCommand,
} from "../dist/integrations/servarr/commands.js";

async function withTempDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), "omk-servarr-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function captureConsole(fn) {
  const originalLog = console.log;
  const originalError = console.error;
  const originalExitCode = process.exitCode;
  let stdout = "";
  let stderr = "";
  process.exitCode = undefined;
  console.log = (value = "") => { stdout += `${value}\n`; };
  console.error = (value = "") => { stderr += `${value}\n`; };
  try {
    await fn();
    return { stdout, stderr, exitCode: process.exitCode };
  } finally {
    console.log = originalLog;
    console.error = originalError;
    process.exitCode = originalExitCode;
  }
}

test("Servarr config parser supports multi-instance env/file token sources without exposing tokens", () => {
  const parsed = parseServarrConfig({
    radarr: [
      {
        name: "local",
        uri: "http://localhost:7878/",
        api_token_env: "RADARR_API_KEY",
      },
    ],
    instances: [
      {
        type: "sonarr",
        name: "anime",
        host: "sonarr.local",
        port: "8989",
        apiTokenFile: "./sonarr-token",
      },
    ],
  });

  assert.equal(parsed.instances.length, 2);
  assert.deepEqual(parsed.instances.map((instance) => instance.type), ["sonarr", "radarr"]);
  assert.equal(parsed.instances[0].baseUrl, "http://sonarr.local:8989");
  assert.equal(parsed.instances[1].baseUrl, "http://localhost:7878");
  assert.equal(redactServarrInstance(parsed.instances[0]).tokenSource, "file");
  assert.equal(redactServarrInstance(parsed.instances[1]).tokenSource, "env");
  assert.doesNotMatch(JSON.stringify(parsed.instances.map(redactServarrInstance)), /token-value|someApiToken/i);
});

test("Servarr config parser rejects unsupported services and credential-bearing URLs", () => {
  assert.throws(() => parseServarrConfig({ instances: [{ type: "readarr" }] }), /Invalid enum value|Unsupported/u);
  assert.throws(
    () => parseServarrConfig({ radarr: [{ uri: "http://user:pass@localhost:7878" }] }),
    /embedded credentials/u
  );
  assert.throws(
    () => parseServarrConfig({ radarr: [{ uri: "file:///tmp/radarr" }] }),
    /Unsupported Servarr URL scheme/u
  );
});

test("Servarr adapter reads API token from file and calls read-only API endpoints", async () => {
  await withTempDir(async (dir) => {
    const tokenPath = join(dir, "radarr-token");
    await writeFile(tokenPath, "synthetic-token-from-file\n", "utf-8");
    const loaded = parseServarrConfig({
      radarr: [{ name: "local", uri: "http://servarr.local/radarr", apiTokenFile: tokenPath }],
    });
    const instance = selectServarrInstance(loaded, "radarr", "local");
    const originalFetch = globalThis.fetch;
    const seen = {};
    globalThis.fetch = async (url, init) => {
      seen.url = String(url);
      seen.apiKey = init.headers["x-api-key"];
      seen.method = init.method;
      return new Response(JSON.stringify([]), { status: 200, headers: { "content-type": "application/json" } });
    };
    try {
      const response = await requestServarr(instance, "health", dir, { timeoutMs: 1000 });
      assert.equal(response.url, "http://servarr.local/radarr/api/v3/health");
      assert.equal(seen.url, "http://servarr.local/radarr/api/v3/health");
      assert.equal(seen.method, "GET");
      assert.equal(seen.apiKey, "synthetic-token-from-file");
      assert.deepEqual(response.data, []);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("Servarr adapter sanitizes failed response details", async () => {
  await withTempDir(async (dir) => {
    const loaded = parseServarrConfig({
      sonarr: [{ uri: "http://sonarr.local", apiTokenEnv: "SONARR_API_KEY" }],
    });
    const instance = selectServarrInstance(loaded, "sonarr");
    const originalFetch = globalThis.fetch;
    const originalEnv = process.env.SONARR_API_KEY;
    process.env.SONARR_API_KEY = "synthetic-sonarr-token";
    globalThis.fetch = async () => new Response(
      JSON.stringify({ apiToken: "synthetic-sonarr-token", message: "denied" }),
      { status: 401, statusText: "Unauthorized", headers: { "content-type": "application/json" } }
    );
    try {
      await assert.rejects(
        () => requestServarr(instance, "health", dir, { timeoutMs: 1000 }),
        (err) => {
          assert.match(err.message, /401 Unauthorized/u);
          assert.doesNotMatch(err.message, /synthetic-sonarr-token/u);
          assert.match(err.message, /\[REDACTED\]/u);
          return true;
        }
      );
    } finally {
      globalThis.fetch = originalFetch;
      if (originalEnv === undefined) delete process.env.SONARR_API_KEY;
      else process.env.SONARR_API_KEY = originalEnv;
    }
  });
});

test("Servarr commands emit stdout-pure JSON and do not call network for instance listing", async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, ".omk"));
    const configFile = join(dir, ".omk", "servarr.yml");
    await writeFile(configFile, "radarr:\n  - name: local\n    uri: http://localhost:7878\n    api_token_env: RADARR_API_KEY\n", "utf-8");
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new Error("network should not be called");
    };
    try {
      const result = await captureConsole(() => servarrInstancesCommand({ configFile, json: true }));
      assert.equal(result.stderr, "");
      assert.equal(result.exitCode, undefined);
      const parsed = JSON.parse(result.stdout);
      assert.equal(parsed.ok, true);
      assert.equal(parsed.instances[0].tokenSource, "env");
      assert.doesNotMatch(result.stdout, /synthetic|x-api-key/i);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("Servarr health command resolves env tokens only for explicit network commands", async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, ".omk"));
    const configFile = join(dir, ".omk", "servarr.yml");
    await writeFile(configFile, "sonarr:\n  - uri: http://localhost:8989\n    api_token_env: SONARR_API_KEY\n", "utf-8");
    const originalFetch = globalThis.fetch;
    const originalEnv = process.env.SONARR_API_KEY;
    process.env.SONARR_API_KEY = "synthetic-health-token";
    globalThis.fetch = async () => new Response(JSON.stringify([]), { status: 200 });
    try {
      const result = await captureConsole(() => servarrHealthCommand("sonarr", { configFile, json: true, timeoutMs: "1000" }));
      assert.equal(result.stderr, "");
      const parsed = JSON.parse(result.stdout);
      assert.equal(parsed.ok, true);
      assert.equal(parsed.command, "servarr health");
      assert.equal(parsed.endpoint, "health");
      assert.equal(parsed.instance.tokenSource, "env");
      assert.doesNotMatch(result.stdout, /synthetic-health-token/u);
    } finally {
      globalThis.fetch = originalFetch;
      if (originalEnv === undefined) delete process.env.SONARR_API_KEY;
      else process.env.SONARR_API_KEY = originalEnv;
    }
  });
});

test("Servarr service endpoint taxonomy stays read-only", () => {
  assert.equal(serviceEndpoint("radarr", "library"), "movie");
  assert.equal(serviceEndpoint("radarr", "search"), "movie/lookup");
  assert.equal(serviceEndpoint("sonarr", "library"), "series");
  assert.equal(serviceEndpoint("lidarr", "search"), "artist/lookup");
});
