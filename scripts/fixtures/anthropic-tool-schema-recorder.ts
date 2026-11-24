import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { streamAnthropic } from "../../packages/ai/src/providers/anthropic.ts";
import { stableToolSchema } from "../../packages/ai/src/providers/tool-schema.ts";
import type { AssistantMessageEvent, CacheRetention, Tool } from "../../packages/ai/src/types.ts";
import { cases as streams, model as base } from "./anthropic-provider-cases.ts";
type Spec = {name:string;properties:unknown;required?:string[]};
const locale=new Intl.Collator().resolvedOptions().locale;
if(locale!=="en-US") throw new Error(`unexpected default collation locale: ${locale}`);
const chars=[..."_-0123456789aAbBcCdDeEfFgGhHiIjJkKlLmMnNoOpPqQrRsStTuUvVwWxXyYzZ"].reverse();
const shuffled=[...chars.filter((_,i)=>i%2===1),...chars.filter((_,i)=>i%2===0)];
const names=["readFile","read_file","Read","read","read-file","read10","read2","readfile","a","A","a_b","a-b","a1","ab","aB","Ab","AB","b","_x","-x","9z","Z","Read_","READ"];
const nested=String.raw`{"zeta":{"type":"object","required":null,"properties":{"b":{"type":"integer","maximum":1e21},"a":{"type":"number","minimum":1e-7,"multipleOf":0.000001}}},"10":{"type":"string"},"9":{"type":"string"},"01":{"type":"string"},"4294967295":{"type":"string"},"4294967294":{"type":"string"},"Alpha":{"type":"array","items":[{"required":null,"y":2.5e-8,"x":1e300},null,true,"\u0001\u001f\u007f\u2028/\"\\"],"required":["y","x"]},"é":{"enum":[9007199254740992,0.5,-3]},"😀":{"const":"emoji"},"\uFFFD":{"const":"replacement"},"":{"const":"empty"},"__proto__":{"const":"own"},"required":null,"kept":null}`;
const values=["1.0","1E2","-0","1e400","-1e400","1e-400","5e-324","1.7976931348623157e308","123456789012345678901234567890","0.1","0.30000000000000004","1e21","1e-7","0.000001","1.5e300","9007199254740993",
 String.raw`"\u0001\u001f\u007f\u2028/\"\\"`, String.raw`"\ud800"`, String.raw`[1,"x",true,false,null]`];
const literals=[...values.map(v=>`{"v":${v}}`), String.raw`{ "b" : 1 , "a" : { "d" : null , "required" : null , "c" : [ { "required" : null , "z" : 1 , "y" : 2 } ] } }`,
 String.raw`{"a":1,"a":2}`, "[]", "null", "5", nested];
const tools=(specs:Spec[])=>specs.map(s=>({name:s.name,description:`Synthetic ${s.name}`,properties:s.properties,required:s.required??[]}));
const scenarios:{id:string;specs:Spec[];retention?:CacheRetention}[] = [
 {id:"collation-chars",specs:shuffled.map(name=>({name,properties:{}}))},
 {id:"collation-names",specs:names.map(name=>({name,properties:{path:{type:"string"}},required:["path"]}))},
 {id:"schema-canonical",specs:[{name:"schema",properties:JSON.parse(nested),required:["zeta","Alpha"]}]},
 {id:"properties-coerced",specs:[{name:"p_string",properties:"x"},{name:"p_array",properties:[]},{name:"p_null",properties:null}]},
 {id:"cache-last-sorted",specs:[{name:"write",properties:{path:{type:"string"}}},{name:"read",properties:{path:{type:"string"}}}],retention:"short"},
];
const original=globalThis.fetch;
try {
 const cases=[];
 for(const s of scenarios) {
  const model={...base,id:"synthetic-tool-schema"};
  const nodeTools:Tool[]=s.specs.map(t=>({name:t.name,description:`Synthetic ${t.name}`,parameters:{type:"object",properties:t.properties,required:t.required??[]} as unknown as Tool["parameters"]}));
  let request:unknown;
  globalThis.fetch=async(url,init)=> {
   if(String(url)!=="https://synthetic.invalid/v1/messages"||request) throw new Error("unexpected request/retry");
   const headers=Object.fromEntries([...new Headers(init?.headers)].filter(([k])=>!k.startsWith("x-stainless-")&&k!=="user-agent"));
   if(headers["x-api-key"]!=="faux-runtime"||headers.authorization) throw new Error("non-synthetic credentials refused");
   request={url:String(url),headers,body:init?.body}; return new Response(streams[0].wire,{headers:{"content-type":"text/event-stream"}});
  };
  const stream=streamAnthropic(model,{systemPrompt:"Synthetic system",messages:[{role:"user",content:"Use a tool",timestamp:0}],tools:nodeTools},{apiKey:"faux-runtime",cacheRetention:s.retention??"none",maxTokens:64,maxRetries:0});
  const events=[];
  for await(const event of stream) {const {partial:_p,message:_m,error:_e,...projection}=event as Partial<AssistantMessageEvent>&{partial?:unknown;message?:unknown;error?:unknown};events.push(projection);}
  const {timestamp:_t,usage,...output}=await stream.result();const {cost:_c,...tokens}=usage;
  if(!request||output.stopReason==="error") throw new Error(`recording failed: ${s.id}`);
  const overlay=JSON.stringify({providers:{anthropic:{api:model.api,baseUrl:"https://synthetic.invalid",models:[{id:model.id,input:["text"]}]}}});
  const input={model:model.id,maxTokens:64,system:"Synthetic system",user:"Use a tool",tools:tools(s.specs),...(s.retention?{options:{cacheRetention:s.retention}}:{})};
  cases.push({id:s.id,overlay,provider:model.provider,input,runtime:"faux-runtime",request,events,result:{...output,usage:tokens},wire:streams[0].wire});
 }
 // Literal texts exercise JSON.parse plus the exact Node canonicalizer the request path uses.
 const schemas=literals.map(text=>({text,properties:JSON.stringify(stableToolSchema({type:"object",properties:JSON.parse(text),required:[]} as unknown as Tool["parameters"]).properties)}));
 const source=Object.fromEntries(["scripts/fixtures/anthropic-tool-schema-recorder.ts","scripts/fixtures/anthropic-provider-cases.ts","packages/ai/src/providers/anthropic.ts","packages/ai/src/providers/tool-schema.ts","node_modules/@anthropic-ai/sdk/package.json"].map(p=>[p,createHash("sha256").update(readFileSync(p)).digest("hex")]));
 console.log(JSON.stringify({schema:"omk.anthropic-tool-schema.v1",locale,source,cases,schemas}));
} finally {globalThis.fetch=original;}
