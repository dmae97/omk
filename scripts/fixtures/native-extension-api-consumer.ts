import { Type } from "omk-ai";
import { systemHash } from "omk-ai/prompt-hash";
import * as oauth from "omk-ai/oauth";
import * as agentNode from "omk-agent-core/node";
import { createAgentSession, DefaultResourceLoader, defineTool, type ExtensionAPI, type ExtensionFactory, getAgentDir, type ProviderConfig, type ToolDefinition } from "open-multi-agent-kit";

type LoaderOptions = ConstructorParameters<typeof DefaultResourceLoader>[0];
const options: LoaderOptions = { cwd: process.cwd(), agentDir: getAgentDir(), packageManifestDialect: "omk", noSkills: true, noThemes: true, noContextFiles: true };
const loader = new DefaultResourceLoader(options);
const result: ReturnType<typeof createAgentSession> = createAgentSession({ resourceLoader: loader });
const parameters = Type.Object({ value: Type.Number() });
const tool: ToolDefinition<typeof parameters> = defineTool({ name: "typed_artifact", label: "Typed artifact", description: "Public installed contract", parameters,
  execute: async (_id, args) => ({ content: [{ type: "text", text: String(args.value + 1) }], details: { value: args.value + 1 } }) });
const provider: ProviderConfig = { api: "typed-artifact", baseUrl: "https://example.invalid", apiKey: "offline-fixture", models: [] };
const extension: ExtensionFactory = (api: ExtensionAPI) => { api.registerTool(tool); api.registerProvider("typed-artifact", provider); };
void [result, extension, systemHash({ systemPrompt: "" }), oauth, agentNode];
