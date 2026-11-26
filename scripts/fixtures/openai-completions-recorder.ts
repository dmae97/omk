import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { streamOpenAICompletions, type OpenAICompletionsOptions } from "../../packages/ai/src/providers/openai-completions.ts";
import type { AssistantMessage, Message, Model, OpenAICompletionsCompat, Tool, UserMessage } from "../../packages/ai/src/types.ts";

type Text = {type:"text";text:string};
type History = {role:"user";content:string|Text[]} | {role:"assistant";content:Text[]};
type Spec = {name:string;properties:unknown;required?:string[]};
type Scenario = {id:string;baseUrl?:string;reasoning?:boolean;compat?:Partial<Compat>;system?:string;messages?:History[];tools?:Spec[];maxTokens?:number;temperature?:number;toolChoice?:OpenAICompletionsOptions["toolChoice"]};
type Compat = Required<Pick<OpenAICompletionsCompat,"supportsStore"|"supportsDeveloperRole"|"supportsUsageInStreaming"|"maxTokensField"|"supportsStrictMode"|"requiresSystemMessageFirst">>;
const standard:Compat = {supportsStore:true,supportsDeveloperRole:true,supportsUsageInStreaming:true,maxTokensField:"max_completion_tokens",supportsStrictMode:true,requiresSystemMessageFirst:false};
const t=(text:string):Text=>({type:"text",text});
const read:Spec={name:"read",properties:{path:{type:"string"}},required:["path"]};
const scenarios:Scenario[] = [
 {id:"basic"},
 {id:"reasoning-developer",reasoning:true},
 {id:"reasoning-system",reasoning:true,compat:{supportsDeveloperRole:false}},
 {id:"empty-system",system:""},
 {id:"empty-system-first",system:"",compat:{requiresSystemMessageFirst:true}},
 {id:"legacy-fields",compat:{maxTokensField:"max_tokens",supportsStore:false,supportsUsageInStreaming:false}},
 {id:"no-max-tokens",maxTokens:undefined},
 {id:"zero-max-tokens",maxTokens:0},
 {id:"temperature",temperature:0.7},
 {id:"temperature-zero",temperature:0},
 {id:"temperature-small",temperature:1e-7},
 {id:"tools-sorted",tools:[{name:"write",properties:{path:{type:"string"},content:{type:"string"}},required:["path","content"]},read,{name:"Read",properties:"x"}]},
 {id:"tools-no-strict",tools:[read],compat:{supportsStrictMode:false}},
 {id:"choice-auto",tools:[read],toolChoice:"auto"},
 {id:"choice-none",tools:[read],toolChoice:"none"},
 {id:"choice-required",tools:[read],toolChoice:"required"},
 {id:"choice-function",tools:[read],toolChoice:{type:"function",function:{name:"read"}}},
 {id:"history",messages:[
  {role:"user",content:"first"},
  {role:"assistant",content:[t("one "),t("  "),t("two")]},
  {role:"user",content:[t("block a"),t("block b")]},
  {role:"user",content:[]},
  {role:"assistant",content:[t(" \t")]},
  {role:"assistant",content:[t("\uFEFF")]},
  {role:"assistant",content:[t("\u0085")]},
  {role:"assistant",content:[]},
  {role:"user",content:""},
 ]},
 {id:"base-trailing-slash",baseUrl:"https://synthetic.invalid/v1/"},
 {id:"base-root",baseUrl:"https://synthetic.invalid"},
 {id:"base-loopback-port",baseUrl:"http://127.0.0.1:8080/openai/v1"},
];
const wire='data: {"id":"c","object":"chat.completion.chunk","created":0,"model":"m","choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';
const zero={input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}};
const original=globalThis.fetch;
try {
 const cases=[];
 for(const s of scenarios) {
  const baseUrl=s.baseUrl??"https://synthetic.invalid/v1";
  const compat={...standard,...s.compat};
  const model:Model<"openai-completions">={id:"synthetic-completions",name:"Synthetic",api:"openai-completions",provider:"synthetic",baseUrl,reasoning:s.reasoning??false,input:["text"],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:4096,maxTokens:64,compat};
  const history=s.messages??[{role:"user",content:"Hello 🌍"}];
  const messages:Message[]=history.map(h=>h.role==="user"?{role:"user",content:h.content,timestamp:0} satisfies UserMessage:{role:"assistant",content:h.content,api:model.api,provider:model.provider,model:model.id,stopReason:"stop",timestamp:0,usage:zero} satisfies AssistantMessage);
  const tools:Tool[]|undefined=s.tools?.map(x=>({name:x.name,description:`Synthetic ${x.name}`,parameters:{type:"object",properties:x.properties,required:x.required??[]} as unknown as Tool["parameters"]}));
  let request:{url:string;headers:Record<string,string>;body:unknown}|undefined;
  globalThis.fetch=async(url,init)=> {
   if(request) throw new Error("unexpected retry");
   const headers=Object.fromEntries([...new Headers(init?.headers)].filter(([k])=>!k.startsWith("x-stainless-")&&k!=="user-agent"));
   if(headers.authorization!=="Bearer faux-key") throw new Error("non-synthetic credentials refused");
   request={url:String(url),headers,body:init?.body}; return new Response(wire,{headers:{"content-type":"text/event-stream"}});
  };
  const maxTokens=Object.hasOwn(s,"maxTokens")?s.maxTokens:64;
  const stream=streamOpenAICompletions(model,{systemPrompt:s.system??"Synthetic system 한글",messages,tools},{apiKey:"faux-key",maxTokens,temperature:s.temperature,toolChoice:s.toolChoice,maxRetries:0});
  for await(const _ of stream) {}
  const result=await stream.result();
  if(!request||result.stopReason==="error"||!/^https:\/\/synthetic\.invalid\/|^http:\/\/127\.0\.0\.1:8080\//.test(request.url)) throw new Error(`recording failed: ${s.id}`);
  const input={baseUrl,model:model.id,reasoning:model.reasoning,compat,system:s.system??"Synthetic system 한글",messages:history,
   tools:(s.tools??[]).map(x=>({name:x.name,description:`Synthetic ${x.name}`,properties:x.properties,required:x.required??[]})),
   ...(maxTokens===undefined?{}:{maxTokens}),...(s.temperature===undefined?{}:{temperature:s.temperature}),...(s.toolChoice===undefined?{}:{toolChoice:s.toolChoice})};
  cases.push({id:s.id,input,request});
 }
 const source=Object.fromEntries(["scripts/fixtures/openai-completions-recorder.ts","packages/ai/src/providers/openai-completions.ts","packages/ai/src/providers/openai-completions-compat.ts","packages/ai/src/providers/tool-schema.ts","packages/ai/src/providers/transform-messages.ts","packages/ai/src/utils/sanitize-unicode.ts","node_modules/openai/package.json"].map(p=>[p,createHash("sha256").update(readFileSync(p)).digest("hex")]));
 console.log(JSON.stringify({schema:"omk.openai-completions-request.v1",source,cases}));
} finally {globalThis.fetch=original;}
