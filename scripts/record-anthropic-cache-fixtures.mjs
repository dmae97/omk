#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const check=process.argv[2]==="--check";
if(process.argv.length>(check?3:2)) throw new Error("usage: record-anthropic-cache-fixtures.mjs [--check]");
const home=mkdtempSync(join(tmpdir(),"omk-cache-"));
try {
 const env={PATH:process.env.PATH,HOME:home,USERPROFILE:home,XDG_CONFIG_HOME:home,OMK_CODING_AGENT_DIR:join(home,"agent")};
 const run=spawnSync(process.execPath,["--import","tsx","scripts/fixtures/anthropic-cache-recorder.ts"],{env,encoding:"utf8",timeout:30000,maxBuffer:8*1024*1024});
 if(run.error||run.status!==0) throw new Error(`cache recorder failed: ${run.error?.message??run.stderr}`);
 const data=JSON.parse(run.stdout); if(data.schema!=="omk.anthropic-cache.v1"||data.cases.length!==32) throw new Error("incomplete cache oracle");
 const text=`${JSON.stringify(data,null,2)}\n`;
 if(/\/home\/|\/mnt\/|sk-ant-/.test(text)) throw new Error("fixture privacy scan failed");
 const target="native/omk-providers/tests/fixtures/anthropic-cache.json";
 if(check) {if(readFileSync(target,"utf8")!==text) throw new Error("Node cache drift");}
 else writeFileSync(target,text,{flag:"wx"});
 console.log(`PASS: ${data.cases.length} independent Node cache requests`);
} finally {rmSync(home,{recursive:true,force:true});}
