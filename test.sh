#!/usr/bin/env bash
set -e

# Run the suite against an isolated agent directory instead of hiding the live
# credential store. Moving ~/.omk/agent/auth.json aside for the whole run made
# every concurrent session read a missing (or empty) store, which can fall back
# to a stale environment credential, and the restore clobbered whatever another
# session had written in the meantime. test/setup-env.ts keeps
# OMK_CODING_AGENT_DIR while scrubbing every other OMK_* variable, so the
# isolation also reaches the CLI processes the tests spawn.
ISOLATED_AGENT_DIR="$(mktemp -d "${TMPDIR:-/tmp}/omk-test-agent.XXXXXX")"
export OMK_CODING_AGENT_DIR="$ISOLATED_AGENT_DIR"
cleanup_isolated_agent_dir() {
	rm -rf "$ISOLATED_AGENT_DIR"
}
trap cleanup_isolated_agent_dir EXIT

echo "Isolated agent dir: $ISOLATED_AGENT_DIR"

# Skip local LLM tests (ollama, lmstudio)
export OMK_NO_LOCAL_LLM=1

# Unset API keys (see packages/ai/src/stream.ts getEnvApiKey)
unset ANTHROPIC_API_KEY
unset ANTHROPIC_OAUTH_TOKEN
unset ANT_LING_API_KEY
unset NVIDIA_API_KEY
unset OPENAI_API_KEY
unset AZURE_OPENAI_API_KEY
unset DEEPSEEK_API_KEY
unset GEMINI_API_KEY
unset GOOGLE_CLOUD_API_KEY
unset GROQ_API_KEY
unset CEREBRAS_API_KEY
unset XAI_API_KEY
unset OPENROUTER_API_KEY
unset ZAI_API_KEY
unset ZAI_CODING_CN_API_KEY
unset MISTRAL_API_KEY
unset MINIMAX_API_KEY
unset MINIMAX_CN_API_KEY
unset MOONSHOT_API_KEY
unset KIMI_API_KEY
unset HF_TOKEN
unset FIREWORKS_API_KEY
unset TOGETHER_API_KEY
unset AI_GATEWAY_API_KEY
unset OPENCODE_API_KEY
unset CLOUDFLARE_API_KEY
unset CLOUDFLARE_ACCOUNT_ID
unset CLOUDFLARE_GATEWAY_ID
unset XIAOMI_API_KEY
unset XIAOMI_TOKEN_PLAN_CN_API_KEY
unset XIAOMI_TOKEN_PLAN_AMS_API_KEY
unset XIAOMI_TOKEN_PLAN_SGP_API_KEY
unset ZYLOO_API_KEY
unset COPILOT_GITHUB_TOKEN
unset GH_TOKEN
unset GITHUB_TOKEN
unset GOOGLE_APPLICATION_CREDENTIALS
unset GOOGLE_CLOUD_PROJECT
unset GCLOUD_PROJECT
unset GOOGLE_CLOUD_LOCATION
unset AWS_PROFILE
unset AWS_ACCESS_KEY_ID
unset AWS_SECRET_ACCESS_KEY
unset AWS_SESSION_TOKEN
unset AWS_REGION
unset AWS_DEFAULT_REGION
unset AWS_BEARER_TOKEN_BEDROCK
unset AWS_CONTAINER_CREDENTIALS_RELATIVE_URI
unset AWS_CONTAINER_CREDENTIALS_FULL_URI
unset AWS_WEB_IDENTITY_TOKEN_FILE
unset BEDROCK_EXTENSIVE_MODEL_TEST

echo "Running tests without API keys..."
npm test
