import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { streamOpenAICompletions } from "../../packages/ai/src/providers/openai-completions.ts";
import type { AssistantMessage, Model, TextContent, ThinkingContent, ToolCall } from "../../packages/ai/src/types.ts";

const baseUrl = "https://synthetic.invalid/v1";
const source = { provider: "synthetic", model: "m", api: "openai-completions" } as const;
const cost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
const usage = { ...cost, totalTokens: 0, cost: { ...cost, total: 0 } };
const text = (text: string): TextContent => ({ type: "text", text });
const thought = (thinking: string, thinkingSignature?: string): ThinkingContent => ({ type: "thinking", thinking, thinkingSignature });
const call: ToolCall = { type: "toolCall", id: "a", name: "f", arguments: {}, thoughtSignature: '{"z":1,"a":2}' };
const turns: AssistantMessage["content"][] = [
 [thought("first", "reasoning"), text("one "), thought(" \t"), thought("second"), text(" "), text("two"), call],
 [thought("kept", "reasoning_content"), text("answer"), call], [thought("only")],
 [thought("\uFEFF"), text("alone")], [call], [],
];
const original = globalThis.fetch;
try {
 const cases = [];
 for (const reasoning of [false,true]) for (const asText of [false,true]) for (const required of [false,true]) {
  const compat = { supportsStore:true, supportsDeveloperRole:true, supportsUsageInStreaming:true, maxTokensField:"max_completion_tokens", supportsStrictMode:true, requiresSystemMessageFirst:false, requiresThinkingAsText:asText, requiresReasoningContentOnAssistantMessages:required } as const;
  const model: Model<"openai-completions"> = { id:source.model, api:source.api, provider:source.provider, name:"Synthetic", baseUrl, reasoning, compat, input:["text"], cost, contextWindow:4096, maxTokens:64 };
  const messages: AssistantMessage[] = turns.map(content => ({role:"assistant", ...source, content, usage, timestamp:0, stopReason:"stop"}));
  let request: { url:string; headers:Record<string,string>; body:string } | undefined;
  globalThis.fetch = async (url, init) => {
   const headers = new Headers(init?.headers);
   if (request || String(url) !== `${baseUrl}/chat/completions` || headers.get("authorization") !== "Bearer faux-key" || typeof init?.body !== "string") throw new Error("unexpected SDK request");
   request = { url:String(url), headers:Object.fromEntries([...headers].filter(([k]) => !k.startsWith("x-stainless-") && k !== "user-agent")), body:init.body };
   return new Response('data: {"choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', {headers:{"content-type":"text/event-stream"}});
  };
  if ((await streamOpenAICompletions(model,{messages},{apiKey:"faux-key",maxRetries:0}).result()).stopReason !== "stop" || !request) throw new Error("recording failed");
  cases.push({ id:`reasoning-${reasoning}-as-text-${asText}-required-${required}`, input:{ provider:model.provider, model:model.id, baseUrl, reasoning, system:"", compat, messages:turns.map(content=>({role:"assistant", source, content})) }, request });
 }
 const paths = ["scripts/fixtures/openai-completions-reasoning-recorder.ts","packages/ai/src/providers/openai-completions.ts","packages/ai/src/providers/openai-completions-compat.ts","packages/ai/src/providers/transform-messages.ts","packages/ai/src/utils/sanitize-unicode.ts","node_modules/openai/package.json"];
 console.log(JSON.stringify({schema:"omk.openai-completions-reasoning.v1",source:Object.fromEntries(paths.map(p=>[p,createHash("sha256").update(readFileSync(p)).digest("hex")])),cases}));
} finally { globalThis.fetch = original; }
