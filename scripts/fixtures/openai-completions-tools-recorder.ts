import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { streamOpenAICompletions } from "../../packages/ai/src/providers/openai-completions.ts";
import type { AssistantMessage, ImageContent, Message, Model, TextContent, ToolCall, ToolResultMessage } from "../../packages/ai/src/types.ts";

const baseUrl = "https://synthetic.invalid/v1";
const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: {input:0,output:0,cacheRead:0,cacheWrite:0,total:0} };
const text = (text: string): TextContent => ({type:"text", text});
const image: ImageContent = {type:"image", mimeType:"image/png", data:"eA=="};
const call = (id: string): ToolCall => ({type:"toolCall", id, name:`fn_${id}`, arguments: {z: ["\n한글", {b:1e-7,a:false}], a: null, 10: 4, 2: 3, required:null}});
const assistant = (content: AssistantMessage["content"], stopReason: AssistantMessage["stopReason"] = "toolUse") => ({ role:"assistant" as const, content, stopReason });
const result = (toolCallId:string, content: ToolResultMessage["content"], toolName="result_name") => ({role:"toolResult" as const, toolCallId, toolName, content, isError:true});
const user = { role:"user" as const, content:"next" };
const suite = [
 ["pair", [assistant([call("a")]), result("a",[text("first"),text(""),text("second")])]],
 ["parallel", [assistant([text("before"),call("a"),text(" "),call("b"),text("after")]),result("\ufeffb ", []),result("a",[text("")],""),user]],
 ["missing", [assistant([call("a"),call("b")]),result("b",[text("ok")]),user,assistant([call("c")])]],
 ["dropped", [result("orphan",[]),assistant([call("a")],"error"),result("a",[]),assistant([call("b")],"aborted"),result("b",[])]],
 ["late", [assistant([call("a")]),assistant([text("next")]),result("a",[text("late")]),result("a",[text("again")])]],
 ["images", [assistant([call("a"),call("b")]),result("b",[image,image]),result("a",[text("mixed"),image]),user]],
] as const;
const original=globalThis.fetch;
try {
 const cases=[];
 for(const flags of [false,true]) for(const [id,history] of suite) {
  const compat={supportsStore:true,supportsDeveloperRole:true,supportsUsageInStreaming:true,maxTokensField:"max_completion_tokens",supportsStrictMode:true,requiresSystemMessageFirst:false,requiresToolResultName:flags,requiresAssistantAfterToolResult:flags} as const;
  const model:Model<"openai-completions">={id:"synthetic",name:"Synthetic",api:"openai-completions",provider:"synthetic",baseUrl,compat,input:flags?["text","image"]:["text"],reasoning:false,cost:usage.cost,contextWindow:4096,maxTokens:64};
  const messages:Message[]=history.map(m=>m.role==="assistant"?{...m,timestamp:0,api:model.api,model:model.id,provider:model.provider,usage}:{...m,timestamp:0});
  let request: {url:string; headers: Record<string,string>; body:string} | undefined;
  globalThis.fetch=async(target,init)=>{
   const headers=new Headers(init?.headers);
   if(request || String(target)!==`${baseUrl}/chat/completions` || headers.get("authorization")!=="Bearer faux-key" || typeof init?.body!=="string") throw new Error("unexpected SDK request");
   request={url:String(target),headers:Object.fromEntries([...headers].filter(([k])=>!k.startsWith("x-stainless-")&&k!=="user-agent")),body:init.body};
   return new Response('data: {"choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',{headers:{"content-type":"text/event-stream"}});
  };
  const stream=streamOpenAICompletions(model,{messages},{apiKey:"faux-key",maxRetries:0});
  if((await stream.result()).stopReason!=="stop" || !request) throw new Error(`recording failed: ${id}`);
  cases.push({id:`${id}-${flags}`,input:{baseUrl,model:model.id,reasoning:false,system:"",vision:flags,compat,messages:history},request});
 }
 const files=["scripts/fixtures/openai-completions-tools-recorder.ts","packages/ai/src/providers/openai-completions.ts","packages/ai/src/providers/openai-completions-compat.ts","packages/ai/src/providers/transform-messages.ts","packages/ai/src/utils/sanitize-unicode.ts","node_modules/openai/package.json"];
 const source=Object.fromEntries(files.map(p=>[p,createHash("sha256").update(readFileSync(p)).digest("hex")]));
 console.log(JSON.stringify({schema:"omk.openai-completions-tools.v1",source,cases}));
} finally {globalThis.fetch=original;}
