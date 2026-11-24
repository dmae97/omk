import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Type } from "typebox";
import { ModelRegistry } from "../../packages/coding-agent/src/core/model-registry.ts";
import { AuthStorage } from "../../packages/coding-agent/src/core/auth-storage.ts";
import { streamAnthropic, type AnthropicOptions } from "../../packages/ai/src/providers/anthropic.ts";
import type { AssistantMessageEvent, Model } from "../../packages/ai/src/types.ts";
import { cases as streams } from "./anthropic-provider-cases.ts";
const scenarios: {id:string; reasoning?:boolean; compat?:Record<string,boolean>; tool?:boolean; options:AnthropicOptions}[] = [
 {id:"default",options:{}},
 {id:"temperature-zero",options:{temperature:0}},
 {id:"temperature-half",options:{temperature:0.5}},
 {id:"temperature-one",options:{temperature:1}},
 {id:"temperature-unsupported",compat:{supportsTemperature:false},options:{temperature:0.5}},
 {id:"temperature-thinking-nonreasoning",options:{temperature:0.5,thinkingEnabled:true}},
 {id:"thinking-nonreasoning",options:{thinkingEnabled:true,thinkingBudgetTokens:256}},
 {id:"thinking-default",reasoning:true,options:{thinkingEnabled:true}},
 {id:"thinking-zero-budget",reasoning:true,options:{thinkingEnabled:true,thinkingBudgetTokens:0}},
 {id:"thinking-budget",reasoning:true,options:{thinkingEnabled:true,thinkingBudgetTokens:256}},
 {id:"thinking-omitted",reasoning:true,options:{thinkingEnabled:true,thinkingDisplay:"omitted"}},
 {id:"thinking-disabled",reasoning:true,options:{thinkingEnabled:false}},
 {id:"disabled-unsupported",reasoning:true,compat:{supportsDisabledThinking:false},options:{thinkingEnabled:false}},
 {id:"disabled-temperature",reasoning:true,options:{thinkingEnabled:false,temperature:0.5}},
 {id:"enabled-temperature",reasoning:true,options:{thinkingEnabled:true,temperature:0.5}},
 {id:"adaptive-default",reasoning:true,compat:{forceAdaptiveThinking:true},options:{thinkingEnabled:true}},
 ...(["low","medium","high","xhigh","max"] as const).map(effort=>({id:`adaptive-${effort}`,reasoning:true,compat:{forceAdaptiveThinking:true},options:{thinkingEnabled:true,effort}})),
 {id:"adaptive-omitted",reasoning:true,compat:{forceAdaptiveThinking:true},options:{thinkingEnabled:true,thinkingDisplay:"omitted",effort:"high"}},
 {id:"adaptive-disabled",reasoning:true,compat:{forceAdaptiveThinking:true},options:{thinkingEnabled:false}},
 {id:"classic-effort-ignored",reasoning:true,options:{thinkingEnabled:true,effort:"high"}},
 {id:"metadata",options:{metadata:{user_id:"synthetic-user"}}},
 {id:"metadata-empty",options:{metadata:{user_id:""}}},
 {id:"metadata-unicode",options:{metadata:{user_id:"한글 🌍"}}},
 {id:"metadata-other-ignored",options:{metadata:{other:"ignored"}}},
 {id:"tool-auto",tool:true,options:{toolChoice:"auto"}},
 {id:"tool-any",tool:true,options:{toolChoice:"any"}},
 {id:"tool-none",tool:true,options:{toolChoice:"none"}},
 {id:"tool-named",tool:true,options:{toolChoice:{type:"tool",name:"read"}}},
];
const home=mkdtempSync(join(tmpdir(),"omk-policy-oracle-")); const original=globalThis.fetch;
try {
 const cases=[];
 for(const s of scenarios) {
  const provider="anthropic"; const runtime="faux-runtime";
  const definition={id:"synthetic-policy",reasoning:s.reasoning??false,input:["text"],compat:s.compat};
  const overlay=JSON.stringify({providers:{anthropic:{api:"anthropic-messages",baseUrl:"https://synthetic.invalid/v1/",apiKey:"faux-config",models:[definition]}}});
  const path=join(home,"models.json"); writeFileSync(path,overlay);
  const auth=AuthStorage.inMemory(); auth.setRuntimeApiKey(provider,runtime);
  const registry=ModelRegistry.createReadOnly(auth,path); const model=registry.find(provider,definition.id) as Model<"anthropic-messages">;
  const resolved=await registry.getApiKeyAndHeaders(model); if(!resolved.ok||!resolved.apiKey) throw new Error("synthetic auth failed");
  let request:unknown;
  globalThis.fetch=async(url,init)=> {
   if(String(url)!=="https://synthetic.invalid/v1/messages"||request) throw new Error("unexpected request/retry");
   const headers=Object.fromEntries([...new Headers(init?.headers)].filter(([k])=>!k.startsWith("x-stainless-")&&k!=="user-agent"));
   request={url:String(url),headers,body:init?.body}; return new Response(streams[0].wire,{headers:{"content-type":"text/event-stream"}});
  };
  const tools=s.tool?[{name:"read",description:"Read synthetic file",parameters:Type.Object({path:Type.String()})}]:undefined;
  const stream=streamAnthropic(model,{systemPrompt:"Synthetic system",messages:[{role:"user",content:"Hello 🌍",timestamp:0}],tools},{...s.options,apiKey:resolved.apiKey,headers:resolved.headers,cacheRetention:"none",maxTokens:64,maxRetries:0});
  const events=[];
  for await(const event of stream) { const {partial:_p,message:_m,error:_e,...projection}=event as Partial<AssistantMessageEvent>&{partial?:unknown;message?:unknown;error?:unknown}; events.push(projection); }
  const {timestamp:_t,usage,...result}=await stream.result(); const {cost:_c,...tokens}=usage;
  const input={model:definition.id,maxTokens:64,system:"Synthetic system",user:"Hello 🌍",tools:s.tool?[{name:"read",description:"Read synthetic file",properties:{path:{type:"string"}},required:["path"]}]:[],options:s.options};
  cases.push({id:s.id,overlay,provider,input,runtime,request,events,result:{...result,usage:tokens},wire:streams[0].wire});
 }
 const source=Object.fromEntries(["scripts/fixtures/anthropic-policy-recorder.ts","scripts/fixtures/anthropic-provider-cases.ts","packages/ai/src/providers/anthropic.ts","packages/ai/src/providers/anthropic-compat.ts","packages/coding-agent/src/core/model-registry.ts"].map(p=>[p,createHash("sha256").update(readFileSync(p)).digest("hex")]));
 console.log(JSON.stringify({schema:"omk.anthropic-policy.v1",source,cases}));
} finally {globalThis.fetch=original;rmSync(home,{recursive:true,force:true});}
