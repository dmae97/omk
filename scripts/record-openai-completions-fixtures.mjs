#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const args=process.argv.slice(2);
const check=args.includes("--check");
const modes={"--reasoning":["openai-completions-reasoning","omk.openai-completions-reasoning.v1",8],"--cross":["openai-completions-cross","omk.openai-completions-cross.v1",8],"--images":["openai-completions-images","omk.openai-completions-images.v1",8],"--tools":["openai-completions-tools","omk.openai-completions-tools.v1",12],"--effort":["openai-completions-effort","omk.openai-completions-effort.v1",45],"--cache":["openai-completions-cache","omk.openai-completions-cache.v1",35],"--affinity":["openai-completions-affinity","omk.openai-completions-affinity.v1",12]};
const selectors=args.filter(arg=>arg!=="--check");
if(args.length!==selectors.length+Number(check)||selectors.length>1||(selectors.length&&!Object.hasOwn(modes,selectors[0]))) throw new Error("usage: record-openai-completions-fixtures.mjs [--images|--tools|--cross|--reasoning|--effort|--cache|--affinity] [--check]");
const [name,schema,count]=modes[selectors[0]]??["openai-completions","omk.openai-completions-request.v1",21];
const home=mkdtempSync(join(tmpdir(),"omk-oai-completions-"));
try {
 const env={PATH:process.env.PATH,HOME:home,USERPROFILE:home,XDG_CONFIG_HOME:home,OMK_CODING_AGENT_DIR:join(home,"agent")};
 const run=spawnSync(process.execPath,["--import","tsx",`scripts/fixtures/${name}-recorder.ts`],{env,encoding:"utf8",timeout:30000,maxBuffer:8*1024*1024});
 if(run.error||run.status!==0) throw new Error(`openai-completions recorder failed: ${run.error?.message??run.stderr}`);
 const data=JSON.parse(run.stdout); if(data.schema!==schema||data.cases.length!==count) throw new Error("incomplete openai-completions oracle");
 const text=`${JSON.stringify(data,null,2)}\n`;
 if(/\/home\/|\/mnt\/|sk-[A-Za-z0-9]/.test(text)) throw new Error("fixture privacy scan failed");
 const target=`native/omk-providers/tests/fixtures/${name}.json`;
 if(check) {if(readFileSync(target,"utf8")!==text) throw new Error("Node openai-completions drift");}
 else writeFileSync(target,text,{flag:"wx"});
 console.log(`PASS: ${data.cases.length} independent Node openai-completions requests`);
} finally {rmSync(home,{recursive:true,force:true});}
