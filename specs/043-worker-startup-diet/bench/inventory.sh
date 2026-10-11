#!/usr/bin/env bash
# Module inventory of the exact worker argv. Needs a mock on <port> (node mock-server.mjs <port> 0 <log>).
# usage: inventory.sh <repoRoot> <absolute outFile.tsv> <port>; then node analyze-inv.mjs <outFile.tsv> [mockLog]
set -u
[ -d /workspace/tools/node-v22.23.3-linux-x64/bin ] && export PATH=/workspace/tools/node-v22.23.3-linux-x64/bin:$PATH
ROOT=$1; OUT=$2; PORT=$3
HERE=$(cd "$(dirname "$0")" && pwd); E=${INV_ENV_DIR:-$HERE/out/env-inv}; mkdir -p $E/agent $E/home $E/project
cat > $E/agent/models.json <<J
{"providers":{"mockprov":{"api":"openai-completions","baseUrl":"http://127.0.0.1:$PORT/v1","apiKey":"mock-key","compat":{"maxTokensField":"max_tokens","supportsDeveloperRole":false,"supportsStore":false},"models":[{"id":"mock-model","reasoning":false,"contextWindow":128000,"maxTokens":4096}]}}}
J
echo "You are a helper subagent. Answer briefly." > $E/prompt-worker.md
cd $E/project && HOME=$E/home OMK_CODING_AGENT_DIR=$E/agent OMK_FINISH_CHECK=0 OMK_OFFLINE=1 OMK_TELEMETRY=0 NO_COLOR=1 TRACE_OUT=$OUT \
  nice -n 10 node --import $HERE/trace-hook.mjs $ROOT/packages/coding-agent/dist/cli.js --mode json -p --no-session --model mockprov/mock-model --append-system-prompt $E/prompt-worker.md "Task: inv reply with ok" < /dev/null > $OUT.stdout 2> $OUT.stderr
echo "exit $? lines $(wc -l < $OUT)"; grep -c "mock ok" $OUT.stdout
