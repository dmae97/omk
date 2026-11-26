import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
test("independent Anthropic cache oracle stays fresh, immutable and boundary-specific",()=>{
 const path="native/omk-providers/tests/fixtures/anthropic-cache.json";
 const digest=()=>createHash("sha256").update(readFileSync(path)).digest("hex"); const before=digest();
 const run=spawnSync(process.execPath,["scripts/record-anthropic-cache-fixtures.mjs","--check"],{encoding:"utf8",timeout:45000,maxBuffer:1024*1024,env:{...process.env,OMK_CACHE_RETENTION:"long",ANTHROPIC_API_KEY:"ambient-must-not-win"}});
 assert.equal(run.error,undefined); assert.equal(run.status,0,run.stderr); assert.match(run.stdout,/32 independent Node cache requests/); assert.equal(digest(),before);
 const data=JSON.parse(readFileSync(path,"utf8")); assert.equal(data.schema,"omk.anthropic-cache.v1");
 const body=id=>JSON.parse(data.cases.find(c=>c.id===id).request.body);
 assert.deepEqual(body("short").system[0].cache_control,{type:"ephemeral"});
 assert.deepEqual(body("long").system[0].cache_control,{type:"ephemeral",ttl:"1h"});
 assert.deepEqual(body("long-unsupported").system[0].cache_control,{type:"ephemeral"});
 assert.equal(body("none").system[0].cache_control,undefined);
 assert.equal(body("tools-short").tools[0].cache_control,undefined);
 assert.deepEqual(body("tools-short").tools[1].cache_control,{type:"ephemeral"});
 assert.equal(body("tools-no-cache-control").tools[1].cache_control,undefined);
 for(const id of ["boundary-zero","boundary-negative","boundary-beyond","boundary-fraction","boundary-string","boundary-null","bypass-valid","bypass-no-boundary"]){
  assert.equal(body(id).system.length,1,id); assert.equal(body(id).system[0].cache_control,undefined,id);
 }
 assert.deepEqual(body("boundary-surrogate").system.map(b=>b.text),["A","B"]);
 assert.deepEqual(body("tool-result").messages.at(-1).content.at(-1).cache_control,{type:"ephemeral"});
 assert.deepEqual(body("history-image").messages.at(-1).content.at(-1).cache_control,{type:"ephemeral"});
 assert.equal(body("last-assistant").messages.at(-1).role,"assistant");
 assert.equal(body("last-assistant").messages.at(-1).content.at(-1).cache_control,undefined);
});
