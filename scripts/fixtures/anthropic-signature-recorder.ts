import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { streamAnthropic } from "../../packages/ai/src/providers/anthropic.ts";
import type { AssistantMessage, AssistantMessageEvent, ThinkingContent } from "../../packages/ai/src/types.ts";
import { cases as streams, model as base } from "./anthropic-provider-cases.ts";
const variants:[string,Partial<ThinkingContent>][] = [
 ["missing",{}], ["empty",{thinkingSignature:""}], ["space",{thinkingSignature:"  "}],
 ["BOM",{thinkingSignature:"\uFEFF"}], ["NEL",{thinkingSignature:"\u0085"}],
 ["signed",{thinkingSignature:"signed"}], ["empty-text",{thinking:"",thinkingSignature:"signed"}],
 ["redacted",{thinking:"",redacted:true,thinkingSignature:"opaque"}],
 ["redacted-empty",{thinking:"",redacted:true,thinkingSignature:""}],
];
const original=globalThis.fetch;
try {
 const cases=[];
 for(const allowEmptySignature of [false,true]) for(const [label,extra] of variants) {
  const id=`${allowEmptySignature}-${label}`;
  const model={...base,id:"synthetic-signature",compat:{allowEmptySignature}};
  const block:ThinkingContent={type:"thinking",thinking:"thought",...extra};
  const history=[{role:"assistant" as const,content:[block]}];
  const assistant:AssistantMessage={...history[0],api:model.api,provider:model.provider,model:model.id,stopReason:"stop",timestamp:0,usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}};
  let request:unknown;
  globalThis.fetch=async(url,init)=> {
   if(String(url)!=="https://synthetic.invalid/v1/messages"||request) throw new Error("unexpected request/retry");
   const headers=Object.fromEntries([...new Headers(init?.headers)].filter(([k])=>!k.startsWith("x-stainless-")&&k!=="user-agent"));
   if(headers["x-api-key"]!=="faux-runtime"||headers.authorization) throw new Error("non-synthetic credentials refused");
   request={url:String(url),headers,body:init?.body}; return new Response(streams[0].wire,{headers:{"content-type":"text/event-stream"}});
  };
  const stream=streamAnthropic(model,{systemPrompt:"Synthetic system",messages:[assistant,{role:"user",content:"Continue",timestamp:0}]},{apiKey:"faux-runtime",cacheRetention:"none",maxTokens:64,maxRetries:0});
  const events=[];
  for await(const event of stream) {const {partial:_p,message:_m,error:_e,...projection}=event as Partial<AssistantMessageEvent>&{partial?:unknown;message?:unknown;error?:unknown};events.push(projection);}
  const {timestamp:_t,usage,...output}=await stream.result();const {cost:_c,...tokens}=usage;
  if(!request||output.stopReason==="error") throw new Error(`recording failed: ${id}`);
  const overlay=JSON.stringify({providers:{anthropic:{api:model.api,baseUrl:"https://synthetic.invalid",models:[{id:model.id,input:["text"],compat:model.compat}]}}});
  const input={model:model.id,maxTokens:64,system:"Synthetic system",user:"Continue",tools:[],history,...(label==="empty"?{options:{}}:{})};
  cases.push({id,overlay,provider:model.provider,input,runtime:"faux-runtime",request,events,result:{...output,usage:tokens},wire:streams[0].wire});
 }
 const source=Object.fromEntries(["scripts/fixtures/anthropic-signature-recorder.ts","scripts/fixtures/anthropic-provider-cases.ts","packages/ai/src/providers/anthropic.ts","packages/ai/src/providers/anthropic-compat.ts","packages/ai/src/providers/transform-messages.ts","node_modules/@anthropic-ai/sdk/package.json"].map(p=>[p,createHash("sha256").update(readFileSync(p)).digest("hex")]));
 console.log(JSON.stringify({schema:"omk.anthropic-signature.v1",source,cases}));
} finally {globalThis.fetch=original;}
