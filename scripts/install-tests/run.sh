#!/bin/sh
set -e

cd "$(dirname "$0")/../.."

echo "=== Testing binary build ==="
podman build -f scripts/install-tests/binary.dockerfile -t omp-test-binary .

echo ""
echo "=== Testing source install ==="
podman build -f scripts/install-tests/source.dockerfile -t omp-test-source .

echo ""
echo "=== All tests passed ==="
