import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
test("independent tool-schema oracle stays fresh and immutable",()=>{
 const path="native/omk-providers/tests/fixtures/anthropic-tool-schema.json";
 const digest=()=>createHash("sha256").update(readFileSync(path)).digest("hex");const before=digest();
 const run=spawnSync(process.execPath,["scripts/record-anthropic-tool-schema-fixtures.mjs","--check"],{encoding:"utf8",timeout:45000,maxBuffer:1024*1024});
 assert.equal(run.error,undefined);assert.equal(run.status,0,run.stderr);assert.match(run.stdout,/5 independent Node tool-schema requests and 25 schema literals/);assert.equal(digest(),before);
 const data=JSON.parse(readFileSync(path,"utf8"));assert.equal(data.schema,"omk.anthropic-tool-schema.v1");assert.equal(data.locale,"en-US");
 const tools=id=>JSON.parse(data.cases.find(c=>c.id===id).request.body).tools;
 assert.deepEqual(tools("collation-names").slice(0,7).map(t=>t.name),["_x","-x","9z","a","A","a_b","a-b"]);
 assert.equal(tools("cache-last-sorted").at(-1).name,"write");assert.ok(tools("cache-last-sorted").at(-1).cache_control);
 const literal=text=>data.schemas.find(s=>s.text===text).properties;
 assert.equal(literal('{"v":1e21}'),'{"v":1e+21}');assert.equal(literal('{"v":-0}'),'{"v":0}');assert.equal(literal("[]"),"{}");
});
