import test from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_LSP_CONFIG, defaultLspConfigJson } from "../dist/lsp/default-config.js";
import { resolveBundledLspBinary } from "../dist/commands/lsp.js";

test("default LSP config exposes bundled TypeScript and Python servers through omk", () => {
  assert.equal(DEFAULT_LSP_CONFIG.enabled, true);
  assert.equal(DEFAULT_LSP_CONFIG.defaultServer, "typescript");
  assert.deepEqual(DEFAULT_LSP_CONFIG.servers.typescript.args, ["lsp", "typescript"]);
  assert.equal(DEFAULT_LSP_CONFIG.servers.typescript.bundled, true);
  assert.deepEqual(DEFAULT_LSP_CONFIG.servers.python.args, ["lsp", "python"]);
  assert.equal(DEFAULT_LSP_CONFIG.servers.python.bundled, true);
});

test("default LSP config is stable JSON with no secrets", () => {
  const parsed = JSON.parse(defaultLspConfigJson());

  assert.equal(parsed.servers.typescript.command, "omk");
  assert.equal(parsed.servers.python.command, "omk");
  assert.doesNotMatch(defaultLspConfigJson(), /token|password|secret|api[_-]?key/i);
});

test("bundled TypeScript and Python LSP binaries resolve to package-local installs when available", () => {
  const tsResolved = resolveBundledLspBinary("typescript");
  const pyResolved = resolveBundledLspBinary("python");

  assert.match(tsResolved, /typescript-language-server/);
  assert.match(pyResolved, /pyright-langserver|pyright/);
});
