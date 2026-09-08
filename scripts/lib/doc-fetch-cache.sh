#!/usr/bin/env bash
# doc-fetch-cache.sh — TTL + ETag-revalidated body cache for Context7 `query-docs` results.
#
# Used by `.omk/skills/context7-mcp` so a repeated library/query pair within the TTL is served
# from disk instead of spending one of the three permitted Context7 calls per question.
#
# Usage (run from anywhere; the cache lives next to the repository, not the caller's cwd):
#   bash scripts/lib/doc-fetch-cache.sh get   <key>                    # body → stdout; exit 0 hit, 1 miss/stale
#   bash scripts/lib/doc-fetch-cache.sh put   <key> <etag> <body-file>  # store; body-file "-" reads stdin
#   bash scripts/lib/doc-fetch-cache.sh stale <key>                    # exit 0 when missing or past TTL, 1 when fresh
#   bash scripts/lib/doc-fetch-cache.sh etag  <key>                    # stored ETag → stdout, even when stale; exit 1 if none
#   bash scripts/lib/doc-fetch-cache.sh touch <key>                    # ETag matched on refresh: keep body, restart TTL
#   bash scripts/lib/doc-fetch-cache.sh purge                          # delete every entry past TTL
#
# Keys are normalized (trimmed, inner whitespace collapsed, lowercased) so "<libraryId>:<query>"
# hits regardless of how the caller spaced or cased it. `get` echoes "ETAG:<etag>" on stderr when an
# ETag is stored, keeping stdout body-only.
#
# Environment:
#   DOC_CACHE_DIR  cache directory (default: <repo>/.omk/cache/docs, git-ignored)
#   DOC_CACHE_TTL  freshness window in seconds, non-negative integer (default: 300)
#
# Exit codes: 0 success/hit · 1 miss, stale, or no entry · 2 usage or environment error.
#
# On-disk layout, one entry per key hash: <sha256>.body, <sha256>.etag, <sha256>.meta
# (`cached_at=<epoch>` and `key=<normalized key>` lines).
set -euo pipefail
# Command substitutions drop errexit unless inherited; entry_base also checks explicitly for bash < 4.4.
shopt -s inherit_errexit 2>/dev/null || true

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CACHE_DIR="${DOC_CACHE_DIR:-${script_dir}/../../.omk/cache/docs}"
TTL_SEC="${DOC_CACHE_TTL:-300}"

die() {
	echo "doc-fetch-cache: $*" >&2
	exit 2
}

usage() {
	die "usage: doc-fetch-cache.sh get|stale|etag|touch <key> | put <key> <etag> <body-file|-> | purge"
}

[[ "$TTL_SEC" =~ ^[0-9]+$ ]] || die "DOC_CACHE_TTL must be a non-negative integer, got '${TTL_SEC}'"
mkdir -p "$CACHE_DIR" || die "cannot create cache directory '${CACHE_DIR}'"

sha256_of_stdin() {
	if command -v sha256sum >/dev/null 2>&1; then
		sha256sum | cut -d' ' -f1
	elif command -v shasum >/dev/null 2>&1; then
		shasum -a 256 | cut -d' ' -f1
	elif command -v openssl >/dev/null 2>&1; then
		openssl dgst -sha256 | sed 's/^.*= *//'
	else
		return 1
	fi
}

normalize_key() {
	printf '%s' "$1" | tr -s '[:space:]' ' ' | sed -e 's/^ //' -e 's/ $//' | tr '[:upper:]' '[:lower:]'
}

# Runs inside "$(...)": every step checks its own status, and callers append `|| exit 2`.
entry_base() {
	local normalized hash
	normalized="$(normalize_key "$1")"
	[[ -n "$normalized" ]] || die "cache key must not be empty"
	hash="$(printf '%s' "$normalized" | sha256_of_stdin)" || die "no sha256sum, shasum, or openssl available for key hashing"
	[[ "$hash" =~ ^[0-9a-f]{64}$ ]] || die "unexpected sha256 output '${hash}'"
	printf '%s/%s' "$CACHE_DIR" "$hash"
}

cached_at_of() {
	# Prints the entry's cached_at epoch, or nothing when the meta file is missing or malformed.
	local meta_file="$1" value
	[[ -f "$meta_file" ]] || return 0
	value="$(sed -n 's/^cached_at=//p' "$meta_file" | head -n 1)"
	[[ "$value" =~ ^[0-9]+$ ]] && printf '%s' "$value"
	return 0
}

is_fresh() {
	# exit 0 when the entry exists and (now - cached_at) <= TTL
	local base="$1" cached_at now
	cached_at="$(cached_at_of "${base}.meta")"
	[[ -n "$cached_at" && -f "${base}.body" ]] || return 1
	now="$(date +%s)"
	[[ $((now - cached_at)) -le "$TTL_SEC" ]]
}

write_meta() {
	local base="$1" key="$2" tmp
	tmp="$(mktemp "${CACHE_DIR}/.meta.XXXXXX")"
	printf 'cached_at=%s\nkey=%s\n' "$(date +%s)" "$key" >"$tmp"
	mv -f "$tmp" "${base}.meta"
}

cmd_get() {
	local base
	base="$(entry_base "$1")" || exit 2
	is_fresh "$base" || exit 1
	cat "${base}.body"
	if [[ -s "${base}.etag" ]]; then
		printf 'ETAG:%s\n' "$(cat "${base}.etag")" >&2
	fi
}

cmd_put() {
	local key="$1" etag="$2" body_source="$3" base normalized tmp_body tmp_etag
	base="$(entry_base "$key")" || exit 2
	normalized="$(normalize_key "$key")"
	tmp_body="$(mktemp "${CACHE_DIR}/.body.XXXXXX")"
	if [[ "$body_source" == "-" ]]; then
		cat >"$tmp_body"
	elif [[ -f "$body_source" ]]; then
		cp "$body_source" "$tmp_body"
	else
		rm -f "$tmp_body"
		die "body file '${body_source}' does not exist"
	fi
	tmp_etag="$(mktemp "${CACHE_DIR}/.etag.XXXXXX")"
	printf '%s' "$etag" >"$tmp_etag"
	mv -f "$tmp_body" "${base}.body"
	mv -f "$tmp_etag" "${base}.etag"
	write_meta "$base" "$normalized"
}

cmd_stale() {
	local base
	base="$(entry_base "$1")" || exit 2
	if is_fresh "$base"; then
		exit 1
	fi
	exit 0
}

cmd_etag() {
	local base
	base="$(entry_base "$1")" || exit 2
	[[ -f "${base}.etag" && -f "${base}.meta" ]] || exit 1
	cat "${base}.etag"
	printf '\n'
}

cmd_touch() {
	local base key
	base="$(entry_base "$1")" || exit 2
	[[ -f "${base}.body" && -f "${base}.meta" ]] || exit 1
	key="$(sed -n 's/^key=//p' "${base}.meta" | head -n 1)"
	write_meta "$base" "${key:-$(normalize_key "$1")}"
}

cmd_purge() {
	local meta base removed=0
	shopt -s nullglob
	for meta in "$CACHE_DIR"/*.meta; do
		base="${meta%.meta}"
		if ! is_fresh "$base"; then
			rm -f "${base}.body" "${base}.etag" "$meta"
			removed=$((removed + 1))
		fi
	done
	echo "purged ${removed} stale entries"
}

case "${1:-}" in
get)
	[[ $# -eq 2 ]] || usage
	cmd_get "$2"
	;;
put)
	[[ $# -eq 4 ]] || usage
	cmd_put "$2" "$3" "$4"
	;;
stale)
	[[ $# -eq 2 ]] || usage
	cmd_stale "$2"
	;;
etag)
	[[ $# -eq 2 ]] || usage
	cmd_etag "$2"
	;;
touch)
	[[ $# -eq 2 ]] || usage
	cmd_touch "$2"
	;;
purge)
	[[ $# -eq 1 ]] || usage
	cmd_purge
	;;
*) usage ;;
esac
