#!/bin/sh
# Full local K0 gate. Historical native CI evidence is reviewed separately.
# Unlike verify-k0-goal.sh, this includes fresh G0/RPC comparison and npm checks.
set -eu
cd "$(dirname "$0")/../.."

sh specs/120-rust-core/verify-k0-goal.sh
(
  cd packages/coding-agent
  node ../../node_modules/vitest/dist/cli.js --run \
    test/suite/skill-admission-turn.test.ts \
    test/suite/session-equivalence.test.ts
)
npm run check
printf 'PASS: full local K0 gate; native platform CI and K5 acceptance remain separate\n'
