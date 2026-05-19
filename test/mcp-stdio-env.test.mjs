import test from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { join } from "node:path";

const OMK_ROOT = process.cwd();
const STDIO_MODULE_URL = pathToFileURL(join(OMK_ROOT, "dist", "mcp", "transports", "stdio.js")).href;

async function readSingleMessage(transport) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("timed out waiting for MCP stdio message")), 5000);
    transport.onMessage((raw) => {
      clearTimeout(timeout);
      resolve(JSON.parse(raw));
    });
    transport.onError((err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

test("StdioTransport inherits only safe environment variables plus explicit server env", async () => {
  const { StdioTransport } = await import(STDIO_MODULE_URL);
  const previousSecret = process.env.OMK_STDIO_TEST_SECRET_TOKEN;
  const previousLocale = process.env.LC_TEST_SAFE;
  const previousPath = process.env.PATH;
  process.env.OMK_STDIO_TEST_SECRET_TOKEN = "ambient-secret-value";
  process.env.LC_TEST_SAFE = "C";
  process.env.PATH = previousPath || "/usr/bin";

  const script = `
    const env = process.env;
    process.stdout.write(JSON.stringify({
      id: 1,
      result: {
        hasAmbientSecret: Object.prototype.hasOwnProperty.call(env, "OMK_STDIO_TEST_SECRET_TOKEN"),
        hasExplicitSecret: env.EXPLICIT_SERVER_TOKEN === "explicit-server-value",
        hasPath: typeof env.PATH === "string" || typeof env.Path === "string",
        locale: env.LC_TEST_SAFE || null
      }
    }) + "\\n");
  `;
  const transport = new StdioTransport(process.execPath, ["--eval", script], {
    EXPLICIT_SERVER_TOKEN: "explicit-server-value",
  });

  try {
    const messagePromise = readSingleMessage(transport);
    await transport.connect();
    const message = await messagePromise;
    assert.equal(message.result.hasAmbientSecret, false);
    assert.equal(message.result.hasExplicitSecret, true);
    assert.equal(message.result.hasPath, true);
    assert.equal(message.result.locale, "C");
  } finally {
    await transport.close();
    if (previousSecret === undefined) delete process.env.OMK_STDIO_TEST_SECRET_TOKEN;
    else process.env.OMK_STDIO_TEST_SECRET_TOKEN = previousSecret;
    if (previousLocale === undefined) delete process.env.LC_TEST_SAFE;
    else process.env.LC_TEST_SAFE = previousLocale;
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
  }
});
