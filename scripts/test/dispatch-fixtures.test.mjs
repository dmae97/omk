import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

test("independent authenticated Node dispatch recording remains fresh and immutable", () => {
 const path="native/omk-providers/tests/fixtures/dispatch.json";
 const digest=()=>createHash("sha256").update(readFileSync(path)).digest("hex");
 const before=digest();
 const run=spawnSync(process.execPath,["scripts/record-dispatch-fixtures.mjs","--check"],{encoding:"utf8",timeout:45000,maxBuffer:1024*1024});
 assert.equal(run.error,undefined); assert.equal(run.status,0,run.stderr); assert.match(run.stdout,/10 independent authenticated SDK dispatch cases/); assert.equal(digest(),before);
 const fixture=JSON.parse(readFileSync(path,"utf8"));
 assert.equal(fixture.schema,"omk.authenticated-dispatch.v1"); assert.equal(fixture.cases.length,10);
 for(const c of fixture.cases) { assert.match(c.request.url,/^https:\/\/synthetic\.invalid\//); assert.equal(c.result.stopReason,"stop"); }
});
