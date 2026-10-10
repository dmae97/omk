#!/bin/sh
# OMK installer: downloads the standalone binary for this OS/CPU from a GitHub release,
# verifies it against the release's SHA256SUMS, and installs it without Node.js.
#
#   curl -fsSL https://github.com/dmae97/omk/releases/latest/download/install.sh | sh
#   curl -fsSL .../install.sh | sh -s -- --version v1.4.0
#
# SHA256SUMS always comes from GitHub over HTTPS, so a download mirror cannot supply both an archive and
# its checksum. Fails closed: a checksum mismatch, a missing entry, or any failure to fetch SHA256SUMS
# other than "this release has none" (HTTP 404) stops the install before anything is replaced. The new
# version is staged under the install root and switched in by renames; the previous version stays on disk.
set -eu

repo="dmae97/omk"
version="${OMK_VERSION:-latest}"
root="${OMK_INSTALL_DIR:-${HOME}/.omk}"
base_url="${OMK_INSTALL_BASE_URL:-}"
# Test hooks; both must be https (a test points curl at its own CA with CURL_CA_BUNDLE).
checksum_base="${OMK_INSTALL_CHECKSUM_BASE_URL:-https://github.com/${repo}/releases/download}"
latest_url="${OMK_INSTALL_LATEST_URL:-https://github.com/${repo}/releases/latest}"
trust_mirror=0
allow_unverified=0

say() { printf '%s\n' "$*"; }
die() {
	printf 'omk install: %s\n' "$*" >&2
	exit 1
}
usage() {
	cat <<'EOF'
Install the OMK standalone binary from a GitHub release.

  sh install.sh [--version <tag>] [--dir <path>] [--base-url <url>] [--trust-mirror] [--allow-unverified]

  --version <tag>     release tag (OMK_VERSION); default: latest, resolved once and pinned
  --dir <path>        install root (OMK_INSTALL_DIR); default: ~/.omk
  --base-url <url>    download mirror laid out as <url>/<tag>/<asset> (OMK_INSTALL_BASE_URL)
  --trust-mirror      take SHA256SUMS from the mirror instead of GitHub (prints a warning)
  --allow-unverified  install a release that publishes no SHA256SUMS (prints a warning)
EOF
}

while [ $# -gt 0 ]; do
	case "$1" in
	--version)
		[ $# -ge 2 ] || die "--version needs a value"
		version="$2"
		shift 2
		;;
	--dir)
		[ $# -ge 2 ] || die "--dir needs a value"
		root="$2"
		shift 2
		;;
	--base-url)
		[ $# -ge 2 ] || die "--base-url needs a value"
		base_url="$2"
		shift 2
		;;
	--trust-mirror)
		trust_mirror=1
		shift
		;;
	--allow-unverified)
		allow_unverified=1
		shift
		;;
	-h | --help)
		usage
		exit 0
		;;
	*) die "unknown option: $1" ;;
	esac
done

case "$(uname -s)" in
Linux) os="linux" ;;
Darwin) os="darwin" ;;
*) die "unsupported OS $(uname -s); on Windows use WSL2" ;;
esac
case "$(uname -m)" in
x86_64 | amd64) arch="x64" ;;
arm64 | aarch64) arch="arm64" ;;
*) die "unsupported CPU $(uname -m)" ;;
esac
asset="omk-${os}-${arch}.tar.gz"

# A source that vouches for the archive must be authenticated, with no exception for "local" hosts: a URL like
# http://localhost:80@host/ names another host.
require_https() {
	case "$1" in
	https://*) ;;
	*) die "$2 must use https: $1" ;;
	esac
}
require_https "$checksum_base" "the checksum source"
# The mirror only serves bytes that SHA256SUMS then checks, so plain HTTP is allowed there.
case "$base_url" in
"" | https://*) mirror_proto="=https" ;;
http://*) mirror_proto="=https,http" ;;
*) die "unsupported --base-url: ${base_url}" ;;
esac

# curl only: it can restrict every request and redirect to https and report the final HTTP status.
command -v curl >/dev/null 2>&1 || die "curl is required"
# fetch URL FILE PROTO -> 0 downloaded, 4 HTTP 404, 1 any other failure
fetch() {
	status="$(curl --silent --show-error --location --proto "$3" --proto-redir "$3" --retry 2 \
		--output "$2" --write-out '%{http_code}' "$1")" || return 1
	case "$status" in
	200) return 0 ;;
	404) return 4 ;;
	*) return 1 ;;
	esac
}
final_url() { curl --fail --silent --show-error --location --proto =https --proto-redir =https --output /dev/null --write-out '%{url_effective}' "$1"; }
if command -v sha256sum >/dev/null 2>&1; then
	digest() { sha256sum "$1" | cut -d ' ' -f 1; }
elif command -v shasum >/dev/null 2>&1; then
	digest() { shasum -a 256 "$1" | cut -d ' ' -f 1; }
else
	die "sha256sum or shasum is required"
fi

# Resolve "latest" once, so the archive and SHA256SUMS come from the same release.
if [ "$version" = "latest" ]; then
	require_https "$latest_url" "the latest-release URL"
	resolved="$(final_url "$latest_url")" || resolved=""
	version="${resolved##*/}"
	case "$version" in "" | latest) die "could not resolve the latest release from ${latest_url}; pass --version" ;; esac
fi
case "$version" in
"" | .* | *[!0-9A-Za-z._+-]*) die "invalid release tag: '${version}'" ;;
esac

release_url="${base_url:-https://github.com/${repo}/releases/download}"
release_url="${release_url%/}/${version}"
if [ "$trust_mirror" -eq 1 ] && [ -n "$base_url" ]; then
	sums_url="${release_url}/SHA256SUMS"
	sums_proto="$mirror_proto"
	say "WARNING: --trust-mirror: SHA256SUMS comes from ${base_url}; that checks the download, not who published it."
	[ "$mirror_proto" = "=https" ] || say "WARNING: the mirror is plain HTTP; anyone on the network path can replace both files."
else
	sums_url="${checksum_base%/}/${version}/SHA256SUMS"
	sums_proto="=https"
fi

work="$(mktemp -d "${TMPDIR:-/tmp}/omk-install.XXXXXX")"
stage=""
cleanup() {
	rm -rf "$work"
	[ -z "$stage" ] || rm -rf "$stage"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

say "Downloading ${asset} (${version})..."
fetch "${release_url}/${asset}" "${work}/${asset}" "$mirror_proto" || die "download failed: ${release_url}/${asset}"
actual="$(digest "${work}/${asset}")"

sums=0
fetch "$sums_url" "${work}/SHA256SUMS" "$sums_proto" || sums=$?
case "$sums" in
0)
	expected="$(awk -v name="$asset" '$2 == name || $2 == "*" name { print $1 }' "${work}/SHA256SUMS")"
	[ -n "$expected" ] || die "SHA256SUMS has no entry for ${asset}"
	[ "$expected" = "$actual" ] || die "checksum mismatch for ${asset}: expected ${expected}, got ${actual}"
	say "Checksum verified (sha256 ${actual})."
	;;
4)
	[ "$allow_unverified" -eq 1 ] ||
		die "${version} publishes no SHA256SUMS; refusing to install unverified (pass --allow-unverified to override)"
	say "WARNING: ${version} publishes no SHA256SUMS; installing UNVERIFIED because --allow-unverified was given."
	;;
*) die "could not download ${sums_url}; not installing unverified" ;;
esac

mkdir -p "${work}/unpacked"
tar -xzf "${work}/${asset}" -C "${work}/unpacked"
[ -f "${work}/unpacked/omk/omk" ] && [ -x "${work}/unpacked/omk/omk" ] || die "archive does not contain an executable omk/omk"

# Stage and probe under the install root: a noexec /tmp must not look like a binary that cannot run here.
mkdir -p "${root}/versions" "${root}/bin"
stage="${root}/versions/.incoming.$$"
rm -rf "$stage"
mv "${work}/unpacked/omk" "$stage"
installed_version="$("${stage}/omk" --version 2>/dev/null)" || die "the downloaded binary does not run on this machine"
case "$installed_version" in
[0-9]*.[0-9]*.[0-9]*) ;;
*) die "unexpected version string from the binary: '${installed_version}'" ;;
esac
case "$installed_version" in *[!0-9A-Za-z.+-]*) die "unexpected version string from the binary: '${installed_version}'" ;; esac

# An installed tree is never replaced or deleted, so an interrupted install cannot break bin/omk: the same
# archive is already in place, and a different build of an installed version gets its own directory.
dest="${root}/versions/${installed_version}"
if [ -e "$dest" ] && [ "$(cat "${dest}/.archive-sha256" 2>/dev/null || true)" = "$actual" ]; then
	say "omk ${installed_version} from this archive is already installed."
else
	[ ! -e "$dest" ] || dest="${dest}+$(date +%Y%m%d%H%M%S).$$"
	printf '%s\n' "$actual" >"${stage}/.archive-sha256"
	mv "$stage" "$dest"
fi
ln -sfn "${dest}/omk" "${root}/bin/.omk.next"
mv -f "${root}/bin/.omk.next" "${root}/bin/omk"
say "Installed omk ${installed_version} to ${root}/bin/omk"

case ":${PATH}:" in
*":${root}/bin:"*) ;;
*) say "Add it to PATH:  export PATH=\"${root}/bin:\$PATH\"   (append that line to ~/.bashrc or ~/.zshrc)" ;;
esac
if [ "$os" = "linux" ] && ! command -v bwrap >/dev/null 2>&1; then
	say "Note: OMK's bash tool runs inside bubblewrap. Install it first (Debian/Ubuntu: sudo apt install bubblewrap)."
fi
say "Next: cd your-project && omk    (run 'omk doctor' if anything looks wrong)"
