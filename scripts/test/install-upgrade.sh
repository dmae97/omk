#!/bin/sh
# Exercise the final launcher switch in a disposable installation, without provider credentials.
set -eu
installer=$(cd "$(dirname "$0")/.." && pwd)/install.sh
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
root=$work/install
export HOME=$work/home
mkdir -p "$HOME" "$work/archive/omk" "$work/tools"
cd "$work"
unset OMK_PACKAGE_DIR
mkdir "$work/other-install"
printf '{"version":"0.0.9"}\n' > "$work/other-install/package.json"
case $(uname -m) in x86_64|amd64) arch=x64 ;; aarch64|arm64) arch=arm64 ;; *) exit 77 ;; esac
asset=omk-$(uname -s | tr '[:upper:]' '[:lower:]')-$arch.tar.gz
# Set OMK_TEST_PREVIOUS_RELEASE to also exercise a checksummed, published starting binary.
if [ -n "${OMK_TEST_PREVIOUS_RELEASE:-}" ]; then
	OMK_PACKAGE_DIR="$work/other-install" sh "$installer" --dir "$root" --version "$OMK_TEST_PREVIOUS_RELEASE"
fi
export FIXTURE=$work ASSET=$asset REAL_MV
REAL_MV=$(command -v mv)
cat >"$work/tools/curl" <<'SH'
#!/bin/sh
set -eu
while [ "$1" != --output ]; do shift; done
case "$4" in '') exit 1 ;; esac
case "$5" in */SHA256SUMS) cp "$FIXTURE/SHA256SUMS" "$2" ;; */"$ASSET") cp "$FIXTURE/$ASSET" "$2" ;; *) exit 1 ;; esac
printf 200
SH
cat >"$work/tools/mv" <<'SH'
#!/bin/sh
if [ "${FAIL_SWITCH:-0}" = 1 ] && [ "${2##*/}" = .omk.next ]; then exit 71; fi
exec "$REAL_MV" "$@"
SH
chmod +x "$work/tools/curl" "$work/tools/mv"
PATH=$work/tools:$PATH
export PATH
hash() { if command -v sha256sum >/dev/null; then sha256sum "$1"; else shasum -a 256 "$1"; fi; }
pack() {
	printf '#!/bin/sh\nif [ -n "${OMK_PACKAGE_DIR:-}" ]; then echo 0.0.9; else echo %s; fi\n' "$1" >"$work/archive/omk/omk"
	chmod +x "$work/archive/omk/omk"
	tar -czf "$work/$asset" -C "$work/archive" omk
	(cd "$work" && hash "$asset" > SHA256SUMS)
}
install_fixture() { OMK_PACKAGE_DIR="$work/other-install" sh "$installer" --dir "$root" --version fixture; }
if [ ! -x "$root/bin/omk" ]; then pack 2.0.1; install_fixture; fi
previous=$("$root/bin/omk" --version)
expected=${OMK_TEST_PREVIOUS_RELEASE:-2.0.1}
[ "$previous" = "${expected#v}" ] && [ -x "$root/versions/$previous/omk" ] || {
	printf 'Wrong installed version or directory; expected %s\n' "${expected#v}" >&2
	exit 1
}
before=$(hash "$root/bin/omk")
pack 2.0.2-test
if FAIL_SWITCH=1 install_fixture; then exit 1; fi
# A failed download would preserve the old version too: require evidence we reached the switch.
[ -L "$root/bin/.omk.next" ]
[ "$("$root/bin/.omk.next" --version)" = 2.0.2-test ]
[ "$(hash "$root/bin/omk")" = "$before" ]
[ "$("$root/bin/omk" --version)" = "$previous" ]
install_fixture
[ "$("$root/bin/omk" --version)" = 2.0.2-test ]
printf 'PASS: %s preserved on failed switch (%s); retry activated fixture\n' "$previous" "${before%% *}"
