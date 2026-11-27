import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

test("independent Node catalog and overlay oracle remains fresh without rewriting", () => {
 const files=["native/omk-providers/catalog.json","native/omk-providers/tests/fixtures/catalog.json"];
 const digest=()=>files.map(p=>createHash("sha256").update(readFileSync(p)).digest("hex"));
 const before=digest();
 const run=spawnSync(process.execPath,["scripts/record-catalog-fixtures.mjs","--check"],{encoding:"utf8",timeout:45000,maxBuffer:1024*1024});
 assert.equal(run.error,undefined); assert.equal(run.status,0,run.stderr); assert.match(run.stdout,/2248 catalog models, 16 overlay cases/); assert.deepEqual(digest(),before);
 const catalog=JSON.parse(readFileSync(files[0],"utf8")); const fixture=JSON.parse(readFileSync(files[1],"utf8"));
 assert.equal(catalog.schema,"omk.model-catalog.v1"); assert.equal(fixture.schema,"omk.model-overlay.v1");
 assert.equal(fixture.cases.find(c=>c.id==="invalid-json").expected.invalid,true);
 assert.equal(fixture.cases.find(c=>c.id==="custom-defaults").expected.models.find(m=>m.provider==="synthetic").maxTokens,16384);
});
