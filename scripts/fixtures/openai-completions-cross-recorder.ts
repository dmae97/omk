import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { streamOpenAICompletions } from "../../packages/ai/src/providers/openai-completions.ts";
import type { AssistantMessage, Message, Model, ToolCall } from "../../packages/ai/src/types.ts";

const baseUrl = "https://synthetic.invalid/v1";
const compat = {supportsStore:true,supportsDeveloperRole:true,supportsUsageInStreaming:true,maxTokensField:"max_completion_tokens",supportsStrictMode:true,requiresSystemMessageFirst:false} as const;
const usage = {input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}};
const long = "a".repeat(37);
const ids = ["call+|it😀/1", "call+|it😀/2", `${long}|A+/=😀`, `${long}|B+/=😀`, "plain".repeat(10), "raw|", "|", "a|b|c"];
const signatures = ['{"z":1,"a":"synthetic"}', "false", "invalid", "[]", "null", '""', "0", '"detail"'];
const original=globalThis.fetch;
try {
 const cases=[];
 for (const provider of ["synthetic", "openai"]) for (const change of ["none","provider","api","model"]) {
  const model:Model<"openai-completions">={id:"m",name:"Synthetic",api:"openai-completions",provider,baseUrl,reasoning:false,input:["text"],cost:usage.cost,contextWindow:4096,maxTokens:64,compat};
  const source={provider:change==="provider"?"foreign":provider,api:change==="api"?"openai-responses" as const:model.api,model:change==="model"?"other":model.id};
  const calls:ToolCall[]=ids.map((id,i)=>({type:"toolCall",id,name:"f",arguments:{z:i,a:1},thoughtSignature:signatures[i]}));
  const content:AssistantMessage["content"]=[{type:"text",text:"start"},{type:"thinking",thinking:"visible",thinkingSignature:"reasoning_content"},{type:"thinking",thinking:"opaque",thinkingSignature:"synthetic",redacted:true},{type:"thinking",thinking:" \t"},...calls];
  const results=ids.toReversed().map(id=>({role:"toolResult" as const,toolCallId:id,toolName:"f",content:[{type:"text" as const,text:`result-${ids.indexOf(id)}`}],isError:false}));
  const messages:Message[]=[{role:"assistant",...source,content,usage,timestamp:0,stopReason:"toolUse"},...results.map(m=>({...m,timestamp:0}))];
  let request:{url:string;headers:Record<string,string>;body:string}|undefined;
  globalThis.fetch=async(target,init)=>{
   const headers=new Headers(init?.headers);
   if(request||String(target)!==`${baseUrl}/chat/completions`||headers.get("authorization")!=="Bearer faux-key"||typeof init?.body!=="string") throw new Error("unexpected SDK request");
   request={url:String(target),headers:Object.fromEntries([...headers].filter(([k])=>!k.startsWith("x-stainless-")&&k!=="user-agent")),body:init.body};
   return new Response('data: {"choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',{headers:{"content-type":"text/event-stream"}});
  };
  if((await streamOpenAICompletions(model,{messages},{apiKey:"faux-key",maxRetries:0}).result()).stopReason!=="stop"||!request) throw new Error("recording failed");
  cases.push({id:`${provider}-${change}`,input:{baseUrl,provider,model:model.id,system:"",reasoning:false,compat,messages:[{role:"assistant",source,content,stopReason:"toolUse"},...results]},request});
 }
 const files=["scripts/fixtures/openai-completions-cross-recorder.ts","packages/ai/src/providers/openai-completions.ts","packages/ai/src/providers/openai-completions-compat.ts","packages/ai/src/providers/transform-messages.ts","packages/ai/src/utils/hash.ts","packages/ai/src/utils/sanitize-unicode.ts","node_modules/openai/package.json"];
 const source=Object.fromEntries(files.map(p=>[p,createHash("sha256").update(readFileSync(p)).digest("hex")]));
 console.log(JSON.stringify({schema:"omk.openai-completions-cross.v1",source,cases}));
} finally {globalThis.fetch=original;}
