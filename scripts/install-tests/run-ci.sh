#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."
ROOT_DIR="$(pwd)"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

section() {
	echo ""
	echo "=== $1 ==="
}

smoke_cli() {
	local omp_bin="$1"
	"$omp_bin" --version
	"$omp_bin" --help >/dev/null
	"$omp_bin" stats --summary >/dev/null
}

find_tarball() {
	local pattern="$1"
	local matches=()
	shopt -s nullglob
	matches=("$pattern")
	shopt -u nullglob

	if [ "${#matches[@]}" -ne 1 ]; then
		echo "Expected exactly one tarball matching: $pattern"
		exit 1
	fi

	echo "${matches[0]}"
}

section "Binary install smoke"
bun --cwd=packages/natives run build:native
bun --cwd=packages/coding-agent run build:binary

BINARY_DIR="$WORK_DIR/binary-bin"
mkdir -p "$BINARY_DIR"
cp packages/coding-agent/dist/omp "$BINARY_DIR/omp"
shopt -s nullglob
native_addons=(packages/natives/native/pi_natives.*.node)
shopt -u nullglob
if [ "${#native_addons[@]}" -eq 0 ]; then
	echo "No native addon files found in packages/natives/native"
	exit 1
fi
cp "${native_addons[@]}" "$BINARY_DIR/"

smoke_cli "$BINARY_DIR/omp"

section "Source install smoke"
SOURCE_BUN_HOME="$WORK_DIR/bun-source"
(
	export BUN_INSTALL="$SOURCE_BUN_HOME"
	export PATH="$BUN_INSTALL/bin:$PATH"
	bun --cwd="$ROOT_DIR/packages/coding-agent" link
	smoke_cli "$BUN_INSTALL/bin/omp"
)

section "Tarball install smoke"
TARBALL_DIR="$WORK_DIR/tarballs"
mkdir -p "$TARBALL_DIR"
for pkg in utils natives ai agent tui stats coding-agent; do
	(
		cd "$ROOT_DIR/packages/$pkg"
		bun pm pack --destination "$TARBALL_DIR" --quiet >/dev/null
	)
done

utils_tgz="$(find_tarball "$TARBALL_DIR"/oh-my-pi-pi-utils-*.tgz)"
natives_tgz="$(find_tarball "$TARBALL_DIR"/oh-my-pi-pi-natives-*.tgz)"
ai_tgz="$(find_tarball "$TARBALL_DIR"/oh-my-pi-pi-ai-*.tgz)"
agent_tgz="$(find_tarball "$TARBALL_DIR"/oh-my-pi-pi-agent-core-*.tgz)"
tui_tgz="$(find_tarball "$TARBALL_DIR"/oh-my-pi-pi-tui-*.tgz)"
stats_tgz="$(find_tarball "$TARBALL_DIR"/oh-my-pi-omp-stats-*.tgz)"
coding_agent_tgz="$(find_tarball "$TARBALL_DIR"/oh-my-pi-pi-coding-agent-*.tgz)"

TARBALL_APP_DIR="$WORK_DIR/tarball-install"
mkdir -p "$TARBALL_APP_DIR"
(
	cd "$TARBALL_APP_DIR"
	bun init -y >/dev/null
	bun add "$utils_tgz" "$natives_tgz" "$ai_tgz" "$agent_tgz" "$tui_tgz" "$stats_tgz"
	bun add "$coding_agent_tgz"
	smoke_cli ./node_modules/.bin/omp
)

echo ""
echo "All install method smoke tests passed"
