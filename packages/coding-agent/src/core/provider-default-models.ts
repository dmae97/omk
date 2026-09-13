import type { KnownProvider } from "omk-ai";

/** Default model IDs for every built-in provider. */
const builtInDefaultModelPerProvider = {
	"amazon-bedrock": "us.anthropic.claude-opus-4-6-v1",
	"ant-ling": "Ring-2.6-1T",
	anthropic: "claude-opus-4-8",
	openai: "gpt-5.4",
	"azure-openai-responses": "gpt-5.4",
	"openai-codex": "gpt-5.5",
	nvidia: "nvidia/nemotron-3-super-120b-a12b",
	deepseek: "deepseek-v4-pro",
	devin: "swe-2",
	meta: "muse-spark-1.3",
	google: "gemini-3.1-pro-preview",
	"google-vertex": "gemini-3.1-pro-preview",
	"github-copilot": "gpt-5.4",
	openrouter: "moonshotai/kimi-k2.6",
	"vercel-ai-gateway": "zai/glm-5.1",
	xai: "grok-4.20-0309-reasoning",
	groq: "openai/gpt-oss-120b",
	cerebras: "zai-glm-4.7",
	zai: "glm-5.1",
	"zai-coding-cn": "glm-5.1",
	mistral: "devstral-medium-latest",
	minimax: "MiniMax-M2.7",
	"minimax-cn": "MiniMax-M2.7",
	moonshotai: "kimi-k2.6",
	"moonshotai-cn": "kimi-k2.6",
	huggingface: "moonshotai/Kimi-K2.6",
	fireworks: "accounts/fireworks/models/kimi-k2p6",
	together: "moonshotai/Kimi-K2.6",
	opencode: "kimi-k2.6",
	"opencode-go": "kimi-k2.6",
	"kimi-coding": "k3",
	"cloudflare-workers-ai": "@cf/moonshotai/kimi-k2.6",
	"cloudflare-ai-gateway": "workers-ai/@cf/moonshotai/kimi-k2.6",
	xiaomi: "mimo-v2.5-pro",
	"xiaomi-token-plan-cn": "mimo-v2.5-pro",
	"xiaomi-token-plan-ams": "mimo-v2.5-pro",
	"xiaomi-token-plan-sgp": "mimo-v2.5-pro",
	zyloo: "claude-opus-4-7",
} satisfies Record<KnownProvider, string>;

/** Recommended defaults for providers supplied through models.json or extensions. */
const customDefaultModelPerProvider = {
	"modelstudio-maas": "qwen3.8-max",
} as const satisfies Readonly<Record<string, string>>;

export const defaultModelPerProvider = {
	...builtInDefaultModelPerProvider,
	...customDefaultModelPerProvider,
} as const;
