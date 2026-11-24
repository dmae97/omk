import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
test("independent openai-completions request oracle stays fresh and immutable",()=>{
 const path="native/omk-providers/tests/fixtures/openai-completions.json";
 const digest=()=>createHash("sha256").update(readFileSync(path)).digest("hex");const before=digest();
 const run=spawnSync(process.execPath,["scripts/record-openai-completions-fixtures.mjs","--check"],{encoding:"utf8",timeout:45000,maxBuffer:1024*1024});
 assert.equal(run.error,undefined);assert.equal(run.status,0,run.stderr);assert.match(run.stdout,/21 independent Node openai-completions requests/);assert.equal(digest(),before);
 const data=JSON.parse(readFileSync(path,"utf8"));assert.equal(data.schema,"omk.openai-completions-request.v1");
 const body=id=>JSON.parse(data.cases.find(c=>c.id===id).request.body);
 assert.equal(body("reasoning-developer").messages[0].role,"developer");
 assert.equal(body("legacy-fields").max_tokens,64);assert.equal(body("legacy-fields").store,undefined);
 assert.deepEqual(body("tools-sorted").tools.map(t=>t.function.name),["read","Read","write"]);
 assert.deepEqual(body("history").messages.map(m=>m.role),["system","user","assistant","user","assistant","user"]);
 assert.equal(data.cases.find(c=>c.id==="base-root").request.url,"https://synthetic.invalid/chat/completions");
});

for (const mode of ["images", "tools", "cross", "reasoning", "affinity"]) {
 test(`${mode} history oracle is fresh without rewriting the fixture`, () => {
  const path = `native/omk-providers/tests/fixtures/openai-completions-${mode}.json`;
  const before = readFileSync(path, "utf8");
  const run = spawnSync(process.execPath, ["scripts/record-openai-completions-fixtures.mjs", `--${mode}`, "--check"], { encoding: "utf8", timeout: 45000 });
  assert.equal(run.error, undefined);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(readFileSync(path, "utf8"), before);
 });
}
