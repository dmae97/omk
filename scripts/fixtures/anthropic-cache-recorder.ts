import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Type } from "typebox";
import { ModelRegistry } from "../../packages/coding-agent/src/core/model-registry.ts";
import { AuthStorage } from "../../packages/coding-agent/src/core/auth-storage.ts";
import { streamAnthropic } from "../../packages/ai/src/providers/anthropic.ts";
import type { AssistantMessage, AssistantMessageEvent, CacheRetention, Context, Message, Model, ToolResultMessage, UserMessage } from "../../packages/ai/src/types.ts";
import { cases as streams } from "./anthropic-provider-cases.ts";

type History = {role:"user";text?:string;content?:UserMessage["content"]} | {role:"assistant";content:AssistantMessage["content"]} | {role:"toolResult";toolCallId:string;isError:boolean;content:ToolResultMessage["content"]};
type Scenario = {id:string;retention?:CacheRetention;provider?:string;compat?:Record<string,boolean>;tools?:boolean;system?:string;user?:string;boundary?:unknown;bypass?:boolean;history?:History[]};
const image = {type:"image" as const,mimeType:"image/png",data:"AAAA"};
const call:History = {role:"assistant",content:[{type:"toolCall",id:"r1",name:"read",arguments:{path:"fixture"}}]};
const result:History = {role:"toolResult",toolCallId:"r1",isError:false,content:[{type:"text",text:"result"}]};
const scenarios:Scenario[] = [
 {id:"none",retention:"none"},
 {id:"short"},
 {id:"long",retention:"long"},
 {id:"long-unsupported",retention:"long",compat:{supportsLongCacheRetention:false}},
 {id:"tools-short",tools:true},
 {id:"tools-long",tools:true,retention:"long"},
 {id:"tools-no-cache-control",tools:true,compat:{supportsCacheControlOnTools:false}},
 {id:"fireworks-long",tools:true,retention:"long",provider:"fireworks"},
 {id:"empty-system",system:""},
 {id:"no-user",user:""},
 {id:"last-assistant",user:"",history:[{role:"assistant",content:[{type:"text",text:"answer"}]}]},
 {id:"boundary-short",boundary:6},
 {id:"boundary-long",boundary:6,retention:"long"},
 {id:"boundary-none",boundary:6,retention:"none"},
 {id:"boundary-end",boundary:16},
 {id:"boundary-surrogate",system:"A🌍B",boundary:2},
 {id:"boundary-zero",boundary:0},
 {id:"boundary-negative",boundary:-1},
 {id:"boundary-beyond",boundary:999},
 {id:"boundary-fraction",boundary:1.5},
 {id:"boundary-string",boundary:"6"},
 {id:"boundary-null",boundary:null},
 {id:"bypass-no-boundary",bypass:true},
 {id:"bypass-valid",bypass:true,boundary:6},
 {id:"bypass-false",bypass:false,boundary:6},
 {id:"history-text",user:"",history:[{role:"user",text:"previous"}]},
 {id:"history-image",user:"",history:[{role:"user",content:[image]}]},
 {id:"history-image-tail",user:"",history:[{role:"user",content:[{type:"text",text:"caption"},image]}]},
 {id:"tool-result",user:"",history:[call,result]},
 {id:"missing-tool-result",user:"",history:[call]},
 {id:"blocks-blank",user:"",history:[{role:"user",content:[{type:"text",text:"one"},{type:"text",text:"  "}]}]},
 {id:"empty-history-block",user:"",history:[{role:"user",content:[]}]},
];
function message(h:History,model:Model<"anthropic-messages">):Message {
 if(h.role==="user") return {role:"user",content:h.content??h.text??"",timestamp:0};
 if(h.role==="toolResult") return {...h,toolName:"read",timestamp:0};
 return {...h,api:model.api,provider:model.provider,model:model.id,stopReason:"stop",timestamp:0,usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}};
}
const home=mkdtempSync(join(tmpdir(),"omk-cache-oracle-")); const original=globalThis.fetch;
try {
 const cases=[];
 for(const s of scenarios) {
  const provider=s.provider??"anthropic"; const runtime="faux-runtime";
  const definition={id:"synthetic-cache",reasoning:false,input:["text","image"],compat:s.compat};
  const overlay=JSON.stringify({providers:{[provider]:{api:"anthropic-messages",baseUrl:"https://synthetic.invalid/v1/",apiKey:"faux-config",models:[definition]}}});
  const path=join(home,"models.json"); writeFileSync(path,overlay);
  const auth=AuthStorage.inMemory(); auth.setRuntimeApiKey(provider,runtime);
  const registry=ModelRegistry.createReadOnly(auth,path); const model=registry.find(provider,definition.id) as Model<"anthropic-messages">;
  const resolved=await registry.getApiKeyAndHeaders(model); if(!resolved.ok||!resolved.apiKey) throw new Error("synthetic auth failed");
  let request:unknown;
  globalThis.fetch=async(url,init)=> {
   if(String(url)!=="https://synthetic.invalid/v1/messages"||request) throw new Error("unexpected request/retry");
   const headers=Object.fromEntries([...new Headers(init?.headers)].filter(([k])=>!k.startsWith("x-stainless-")&&k!=="user-agent"));
   if(headers["x-api-key"]!==runtime||headers.authorization) throw new Error("non-synthetic credentials refused");
   request={url:String(url),headers,body:init?.body}; return new Response(streams[0].wire,{headers:{"content-type":"text/event-stream"}});
  };
  const system=s.system??"Stable: dynamic!"; const user=s.user??"Hello 🌍";
  const history=s.history??[]; const messages=history.map(h=>message(h,model)); messages.push({role:"user",content:user,timestamp:0});
  const tools=s.tools?["read","write"].map(name=>({name,description:`Synthetic ${name}`,parameters:Type.Object({path:Type.String()})})):undefined;
  const boundary=Object.hasOwn(s,"boundary")?{systemPromptCacheBoundary:s.boundary}:{};
  // Invalid boundary values intentionally exercise the runtime contract, beyond its static type.
  const context={systemPrompt:system,messages,tools,...boundary,systemPromptCacheBoundaryBypass:s.bypass} as Context;
  const options={cacheRetention:s.retention??"short"};
  const stream=streamAnthropic(model,context,{...options,apiKey:resolved.apiKey,headers:resolved.headers,maxTokens:64,maxRetries:0});
  const events=[];
  for await(const event of stream) { const {partial:_p,message:_m,error:_e,...projection}=event as Partial<AssistantMessageEvent>&{partial?:unknown;message?:unknown;error?:unknown}; events.push(projection); }
  const {timestamp:_t,usage,...output}=await stream.result(); const {cost:_c,...tokens}=usage;
  if(!request||output.stopReason==="error") throw new Error(`recording failed: ${s.id}`);
  const input={model:definition.id,maxTokens:64,system,user,history,tools:s.tools?["read","write"].map(name=>({name,description:`Synthetic ${name}`,properties:{path:{type:"string"}},required:["path"]})):[],options,...boundary,...(s.bypass===undefined?{}:{systemPromptCacheBoundaryBypass:s.bypass})};
  cases.push({id:s.id,overlay,provider,input,runtime,request,events,result:{...output,usage:tokens},wire:streams[0].wire});
 }
 const source=Object.fromEntries(["scripts/fixtures/anthropic-cache-recorder.ts","scripts/fixtures/anthropic-provider-cases.ts","packages/ai/src/providers/anthropic.ts","packages/ai/src/providers/anthropic-compat.ts","packages/ai/src/providers/prompt-cache.ts","packages/ai/src/providers/tool-schema.ts","packages/ai/src/providers/transform-messages.ts","packages/ai/src/utils/sanitize-unicode.ts","packages/coding-agent/src/core/model-registry.ts","node_modules/@anthropic-ai/sdk/package.json"].map(p=>[p,createHash("sha256").update(readFileSync(p)).digest("hex")]));
 console.log(JSON.stringify({schema:"omk.anthropic-cache.v1",source,cases}));
} finally {globalThis.fetch=original;rmSync(home,{recursive:true,force:true});}
