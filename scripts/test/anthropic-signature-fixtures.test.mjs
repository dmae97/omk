import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
test("independent thinking-signature oracle stays fresh and immutable",()=>{
 const path="native/omk-providers/tests/fixtures/anthropic-signature.json";
 const digest=()=>createHash("sha256").update(readFileSync(path)).digest("hex");const before=digest();
 const run=spawnSync(process.execPath,["scripts/record-anthropic-signature-fixtures.mjs","--check"],{encoding:"utf8",timeout:45000,maxBuffer:1024*1024});
 assert.equal(run.error,undefined);assert.equal(run.status,0,run.stderr);assert.match(run.stdout,/18 independent Node signature requests/);assert.equal(digest(),before);
 const data=JSON.parse(readFileSync(path,"utf8"));assert.equal(data.schema,"omk.anthropic-signature.v1");
 const body=id=>JSON.parse(data.cases.find(c=>c.id===id).request.body);
 for(const s of ["missing","empty","space","BOM"]) {
  assert.deepEqual(body(`true-${s}`).messages[0].content[0],{type:"thinking",thinking:"thought",signature:""});
  assert.deepEqual(body(`false-${s}`).messages[0].content[0],{type:"text",text:"thought"});
 }
 assert.equal(body("true-NEL").messages[0].content[0].signature,"\u0085");
 assert.equal(body("true-empty-text").messages[0].role,"user");
 assert.deepEqual(body("true-redacted-empty").messages[0].content[0],{type:"redacted_thinking",data:""});
});
