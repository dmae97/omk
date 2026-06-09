npm run build:clean
node --test test/regression-proof-matrix.test.mjs
node scripts/regression-proof-matrix.mjs --json
node scripts/proof-check.mjs proof/verified-runs/011-regression-proof-matrix/proof-bundle.json --json
