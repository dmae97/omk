/**
 * Whether an `api` string names a supported provider API.
 *
 * The engine's own registry is authoritative: `registerBuiltins` registers `devin-agent` and
 * `cursor-agent`, which a hand-written list had missed, so `omk provider doctor devin` failed
 * every run with "Provider API type is unsupported" for a supported provider. The literal stays
 * as the bootstrap fallback for processes where the registry is not populated yet.
 */
import { getApiProviders } from "omk-ai";

const STATIC_KNOWN_APIS: readonly string[] = [
	"openai-completions",
	"mistral-conversations",
	"openai-responses",
	"azure-openai-responses",
	"openai-codex-responses",
	"anthropic-messages",
	"bedrock-converse-stream",
	"google-generative-ai",
	"google-vertex",
	"devin-agent",
	"cursor-agent",
];

export function isKnownApi(api: string): boolean {
	if (STATIC_KNOWN_APIS.includes(api)) return true;
	return getApiProviders().some((provider) => provider.api === api);
}
