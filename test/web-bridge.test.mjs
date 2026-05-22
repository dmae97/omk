import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { handleWebBridgeRequest, digestParams } from "../dist/web-bridge/host.js";
import { buildInstallHostInstructions, getWebBridgeStatus } from "../dist/web-bridge/status.js";
import { handleWebBridgeMcpToolCall } from "../dist/mcp/omk-web-bridge-server.js";
import { webBridgeDoctorCommand, webBridgeStatusCommand } from "../dist/commands/web-bridge.js";

function captureOutput() {
  const stdout = [];
  const stderr = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...args) => stdout.push(args.join(" "));
  console.error = (...args) => stderr.push(args.join(" "));
  return {
    stdout,
    stderr,
    restore() {
      console.log = origLog;
      console.error = origErr;
    },
  };
}

test("web bridge request sanitizes page context and rejects unsafe mutation without approval", async () => {
  const secret = `sk-proj-${"A".repeat(24)}`;
  const response = await handleWebBridgeRequest({
    schemaVersion: 1,
    requestId: "read-1",
    method: "browser.page.read",
    params: {
      snapshot: {
        metadata: {
          url: "https://example.test/?token=SHOULD_NOT_LEAK",
          title: "Example",
          cookie: "sid=SHOULD_NOT_LEAK",
          localStorage: { authToken: "SHOULD_NOT_LEAK" },
        },
        text: `Authorization: Bearer SHOULD_NOT_LEAK\napi_key=${secret}\nlocalStorage = SHOULD_NOT_LEAK`,
        selectedText: secret,
        dom: '<input type="password" value="SHOULD_NOT_LEAK"><main>Hello</main>',
      },
    },
  });

  assert.equal(response.ok, true);
  const serialized = JSON.stringify(response);
  assert.doesNotMatch(serialized, /SHOULD_NOT_LEAK/);
  assert.doesNotMatch(serialized, new RegExp(secret));
  assert.match(serialized, /\[redacted\]|\*\*\*/);

  const denied = await handleWebBridgeRequest({
    schemaVersion: 1,
    requestId: "mutate-1",
    method: "browser.action.request",
    params: { action: "click", target: "#submit" },
  });
  assert.equal(denied.ok, false);
  assert.equal(denied.error?.code, "approval_required");
});

test("web bridge approved mutation remains read-only in v1", async () => {
  const params = { action: "click", target: "#submit" };
  const response = await handleWebBridgeRequest({
    schemaVersion: 1,
    requestId: "mutate-approved",
    method: "browser.action.request",
    params,
    approval: {
      token: "one-shot-token",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      method: "browser.action.request",
      target: "#submit",
      argsDigest: digestParams(params),
    },
  });

  assert.equal(response.ok, false);
  assert.equal(response.error?.code, "unsafe_mutation");
});

test("web bridge status and install instructions are local-first and exact-origin", async () => {
  const root = await mkdtemp(join(tmpdir(), "omk-web-bridge-status-"));
  try {
    await mkdir(join(root, ".omk"), { recursive: true });
    const status = await getWebBridgeStatus({ root, packageRoot: process.cwd(), env: {} });
    assert.equal(status.ok, true);
    assert.equal(status.enabled, false);
    assert.equal(status.mcp.serverName, "omk-web-bridge");
    assert.equal(status.permissions.readOnlyDefault, true);
    assert.ok(status.permissions.forbiddenData.includes("cookies"));

    const install = await buildInstallHostInstructions({
      extensionId: "abcdefghijklmnopabcdefghijklmnop",
      root,
      home: root,
      platform: "linux",
    });
    assert.equal(install.ok, true);
    assert.equal(install.wrote, false);
    assert.deepEqual(install.manifest?.allowed_origins, ["chrome-extension://abcdefghijklmnopabcdefghijklmnop/"]);
    assert.doesNotMatch(JSON.stringify(install), /TOKEN|SECRET|PASSWORD|Bearer/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("web bridge MCP smoke handles mocked tabs/page and rejects unsafe action", async () => {
  const list = await handleWebBridgeMcpToolCall("web_bridge_list_tabs", {
    tabs: [{ id: 1, url: "https://example.test", title: "Example", active: true }],
  });
  assert.deepEqual(list.tabs.map((tab) => tab.title), ["Example"]);

  const page = await handleWebBridgeMcpToolCall("web_bridge_read_page", {
    snapshot: {
      tab: { id: 1, url: "https://example.test", title: "Example", active: true },
      text: "Hello page",
      selectedText: "Hello",
      metadata: { source: "mock" },
    },
  });
  assert.equal(page.text, "Hello page");
  assert.equal(page.selectedText, "Hello");

  const denied = await handleWebBridgeMcpToolCall("web_bridge_request_action", { action: "click", target: "#unsafe" });
  assert.equal(denied.ok, false);
  assert.equal(denied.error.code, "approval_required");
});

test("web bridge CLI doctor/status --json emit stdout-only parseable JSON", async () => {
  for (const command of [webBridgeStatusCommand, webBridgeDoctorCommand]) {
    const cap = captureOutput();
    try {
      await command({ json: true });
    } finally {
      cap.restore();
    }
    assert.equal(cap.stdout.length, 1);
    assert.equal(cap.stderr.length, 0);
    const parsed = JSON.parse(cap.stdout[0]);
    assert.equal(typeof parsed.ok, "boolean");
    assert.doesNotMatch(cap.stdout[0], /TOKEN|SECRET|PASSWORD|Bearer\s+[A-Za-z0-9._-]+/);
  }
});
