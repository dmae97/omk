import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
test("independent Anthropic request-policy oracle stays fresh and immutable",()=>{
 const path="native/omk-providers/tests/fixtures/anthropic-policy.json";
 const digest=()=>createHash("sha256").update(readFileSync(path)).digest("hex"); const before=digest();
 const run=spawnSync(process.execPath,["scripts/record-anthropic-policy-fixtures.mjs","--check"],{encoding:"utf8",timeout:45000,maxBuffer:1024*1024});
 assert.equal(run.error,undefined); assert.equal(run.status,0,run.stderr); assert.match(run.stdout,/32 independent Node policy requests/); assert.equal(digest(),before);
 const data=JSON.parse(readFileSync(path,"utf8")); assert.equal(data.schema,"omk.anthropic-policy.v1");
 const body=id=>JSON.parse(data.cases.find(c=>c.id===id).request.body);
 assert.deepEqual(body("thinking-zero-budget").thinking,{type:"enabled",budget_tokens:1024,display:"summarized"});
 assert.deepEqual(body("adaptive-xhigh").output_config,{effort:"xhigh"});
 assert.equal(body("temperature-thinking-nonreasoning").temperature,undefined);
 assert.equal(body("temperature-thinking-nonreasoning").thinking,undefined);
 assert.deepEqual(body("tool-named").tool_choice,{type:"tool",name:"read"});
});
