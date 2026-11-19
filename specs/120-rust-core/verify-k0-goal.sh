#!/bin/sh
# Acceptance check for the /goal that drives spec 120 K0 units T004, T010 and the local half of T011.
# Run from the repository root: sh specs/120-rust-core/verify-k0-goal.sh
# npm run check is not repeated here: it takes about 200 s and the /goal check budget is 300 s.
set -eu
cd "$(dirname "$0")/../.."
M=native/omk-contract/Cargo.toml

step() { printf '== %s\n' "$1"; }

step "T004 and earlier: Rust contract crate"
cargo fmt --check --manifest-path "$M"
cargo clippy --offline --locked --manifest-path "$M" --all-targets -- -D warnings
cargo test --offline --locked --manifest-path "$M"

step "T004 and T009: generated TypeScript matches Rust"
node scripts/check-contract-drift.mjs
node scripts/pi-inventory.mjs --check
node --test scripts/test/compat-table.test.mjs scripts/test/check-contract-drift.test.mjs scripts/test/contract-declarations.test.mjs

step "T010: capability matrix"
test -f specs/120-rust-core/capability-matrix.json
node scripts/check-capability-matrix.mjs
node --test scripts/test/check-capability-matrix.test.mjs

step "T011 local half: Rust checks inside npm run check"
node -e 'const s=require("./package.json").scripts; if(!/check-native\.mjs/.test(s["check:native"]??"")||!/npm run check:native/.test(s.check)) process.exit(1)'
node scripts/check-native.mjs

step "PASS: K0 goal units verified locally (CI jobs on macOS and Windows are not covered)"
