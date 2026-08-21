#!/usr/bin/env bash
#
# Focused tests for the one-command STABLE-CHANNEL bootstrap installer.
#
# Run:  bash tests/bootstrap-install.sh
#
# The harness runs install.sh in an isolated environment:
#   - a clean, throwaway HOME (never the real one)
#   - a controlled TMPDIR (observes temp cleanup)
#   - stub `uname` / `curl` / `sudo` prepended to PATH
#   - a `node` stub that delegates the RELEASE-resolution step to the REAL
#     node + the REAL resolve.mjs parser (so parser logic is genuinely tested
#     against isolated metadata fixtures), while keeping the version gate and
#     the installer step controllable.
#
# All trust boundaries (repo/API/raw/download origins) stay hard-coded in
# install.sh; tests inject behavior via PATH stubs and fixtures only.

set -euo pipefail

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SELF_DIR")"
INSTALL_SH="$ROOT_DIR/install.sh"
REAL_NODE="$(command -v node)"

HARNESS="$(mktemp -d "${TMPDIR:-/tmp}/pgw-bootstrap-test.XXXXXX")"
trap 'rm -rf -- "${HARNESS:?}"' EXIT
mkdir -p "$HARNESS/bin" "$HARNESS/home" "$HARNESS/tmp" "$HARNESS/fixtures"

CURL_LOG="$HARNESS/curl.log"
NODE_LOG="$HARNESS/node.log"
SUDO_LOG="$HARNESS/sudo.log"

# ---- release metadata fixtures (isolated, never the real API) ---------------
printf '%s\n' '{"tag_name":"v0.2.0","draft":false,"prerelease":false}' > "$HARNESS/fixtures/v020.json"
printf '%s\n' '{"tag_name":"v0.3.0","draft":false,"prerelease":false}' > "$HARNESS/fixtures/v030.json"
printf '%s\n' '{"tag_name":"v1.0.0","draft":false,"prerelease":false}' > "$HARNESS/fixtures/v100.json"
printf '%s\n' '{not valid json'                                          > "$HARNESS/fixtures/malformed.json"
printf '%s\n' '{"draft":false,"prerelease":false}'                       > "$HARNESS/fixtures/notag.json"
printf '%s\n' '{"tag_name":"v0.9.0","draft":true,"prerelease":false}'    > "$HARNESS/fixtures/draft.json"
printf '%s\n' '{"tag_name":"v0.4.0","draft":false,"prerelease":true}'    > "$HARNESS/fixtures/prerelease.json"
printf '%s\n' '{"tag_name":"v0.4.0-rc.1","draft":false,"prerelease":false}' > "$HARNESS/fixtures/rc.json"
printf '%s\n' '{"tag_name":"0.2.0","draft":false,"prerelease":false}'    > "$HARNESS/fixtures/nov.json"
printf '%s\n' '{"tag_name":"v01.2.3","draft":false,"prerelease":false}'  > "$HARNESS/fixtures/leadzero.json"
printf '%s\n' '{"tag_name":"v1.2","draft":false,"prerelease":false}'     > "$HARNESS/fixtures/short.json"
printf '%s\n' '{"tag_name":"v1.2.3+build","draft":false,"prerelease":false}' > "$HARNESS/fixtures/build.json"
printf '{"tag_name":"%s","draft":false,"prerelease":false}\n' "v1.2.3;touch $HARNESS/pwned" > "$HARNESS/fixtures/metachar.json"

DEFAULT_FIXTURE="$HARNESS/fixtures/v020.json"

# ---- stubs ---------------------------------------------------------------

cat >"$HARNESS/bin/uname" <<'EOF'
#!/usr/bin/env bash
case "$1" in
  -m) printf '%s\n' "${STUB_UNAME_M:-x86_64}" ;;
  -s) printf '%s\n' "${STUB_UNAME_S:-Darwin}" ;;
  *)  exit 1 ;;
esac
EOF

cat >"$HARNESS/bin/curl" <<'EOF'
#!/usr/bin/env bash
out=""
prev=""
for a in "$@"; do
  [ "$prev" = "-o" ] && out="$a"
  prev="$a"
done
url="${@: -1}"
printf '%s\n' "$url" >> "${STUB_CURL_LOG}"
fail() { printf 'curl: simulated failure: %s\n' "$url" >&2; exit 22; }
case "${STUB_CURL_FAIL:-}" in
  api)     [[ "$url" == */releases/latest ]] && fail ;;
  tarball) [[ "$url" == *.tar.gz && "$url" != *'.sha256' ]] && fail ;;
  sidecar) [[ "$url" == *.sha256 ]] && fail ;;
  all)     fail ;;
esac
: > "$out"
case "$url" in
  */releases/latest) cp "${STUB_RELEASE_JSON:?}" "$out" ;;
  *.sha256)          printf 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa  %s\n' "$(basename "$out")" > "$out" ;;
  *install.mjs)      printf 'console.log("stub installer")\n' > "$out" ;;
  *.tar.gz)          printf 'stub tarball payload\n' > "$out" ;;
esac
exit 0
EOF

cat >"$HARNESS/bin/node" <<'EOF'
#!/usr/bin/env bash
if [ "${1:-}" = "-p" ]; then           # version gate
  printf '%s\n' "${STUB_NODE_VERSION-22.23.1}"
  exit 0
fi
case "${2:-}" in
  *.json)                              # release resolution: real parser + fixture
    exec "$STUB_REAL_NODE" "$@"
    ;;
esac
printf 'NODE_INV: %s\n' "$*" >> "${STUB_NODE_LOG}"   # installer step
case "${STUB_NODE_FAIL:-}" in
  1) printf 'node: simulated installer failure\n' >&2; exit 3 ;;
esac
exit 0
EOF

cat >"$HARNESS/bin/sudo" <<'EOF'
#!/usr/bin/env bash
printf 'SUDO CALLED: %s\n' "$*" >> "${STUB_SUDO_LOG}"
exit 1
EOF

chmod +x "$HARNESS/bin"/*

# ---- runner --------------------------------------------------------------

run() {
  : > "$CURL_LOG"; : > "$NODE_LOG"; : > "$SUDO_LOG"
  local rc=0
  env -i \
    PATH="$HARNESS/bin:/usr/bin:/bin:/usr/sbin:/sbin" \
    HOME="$HARNESS/home" \
    TMPDIR="$HARNESS/tmp" \
    STUB_CURL_LOG="$CURL_LOG" \
    STUB_NODE_LOG="$NODE_LOG" \
    STUB_SUDO_LOG="$SUDO_LOG" \
    STUB_REAL_NODE="$REAL_NODE" \
    STUB_RELEASE_JSON="$DEFAULT_FIXTURE" \
    "$@" \
    bash "$INSTALL_SH" >"$HARNESS/stdout" 2>"$HARNESS/stderr" || rc=$?
  echo "$rc"
}

leftovers() {
  find "$HARNESS/tmp" -maxdepth 1 -name 'project-gateway-install.*' 2>/dev/null
}

pass=0; fail=0
check() {
  local desc="$1"; shift
  if "$@" >/dev/null 2>&1; then
    pass=$((pass+1)); printf '  ok: %s\n' "$desc"
  else
    fail=$((fail+1)); printf '  FAIL: %s\n' "$desc"
    sed 's/^/      | /' "$HARNESS/stderr" >&2
  fi
}

success_resolution() { # fixture  tag  version
  local fixture="$1" tag="$2" ver="$3"
  local rc
  rc=$(run STUB_UNAME_S=Darwin STUB_UNAME_M=x86_64 STUB_RELEASE_JSON="$fixture")
  check "RES ${tag}: bootstrap succeeds" test "$rc" = 0
  check "RES ${tag}: installer fetched from same tag" grep -q "/${tag}/scripts/install.mjs$" "$CURL_LOG"
  check "RES ${tag}: tarball from same tag" grep -q "/download/${tag}/project-gateway-macos-${ver}-darwin-x64.tar.gz$" "$CURL_LOG"
  check "RES ${tag}: sidecar from same tag" grep -q "/download/${tag}/project-gateway-macos-${ver}-darwin-x64.tar.gz.sha256$" "$CURL_LOG"
  check "RES ${tag}: installer invoked with tarball+sidecar" grep -Eq "NODE_INV: .*${ver}-darwin-x64\.tar\.gz .*${ver}-darwin-x64\.tar\.gz\.sha256" "$NODE_LOG"
  check "RES ${tag}: temp dir cleaned" test -z "$(leftovers)"
  check "RES ${tag}: single release lookup" test "$(grep -c '/releases/latest' "$CURL_LOG")" = 1
}

reject_resolution() { # desc  fixture
  local desc="$1" fixture="$2"
  local rc
  rc=$(run STUB_UNAME_S=Darwin STUB_UNAME_M=x86_64 STUB_RELEASE_JSON="$fixture")
  check "REJ $desc: fails closed" test "$rc" != 0
  check "REJ $desc: no payload download" bash -c "! grep -Eq 'install\.mjs|\.tar\.gz' '$CURL_LOG'"
  check "REJ $desc: no installer run" test ! -s "$NODE_LOG"
  check "REJ $desc: temp dir cleaned" test -z "$(leftovers)"
}

# ===== release-resolution tests (spec A–N) ==================================

printf 'A. latest stable metadata v0.2.0 -> installer/artifact 0.2.0\n'
success_resolution "$HARNESS/fixtures/v020.json" v0.2.0 0.2.0

printf 'B. latest stable metadata v0.3.0 -> installer/artifact 0.3.0\n'
success_resolution "$HARNESS/fixtures/v030.json" v0.3.0 0.3.0

printf 'C. future v1.0.0 works with NO install.sh edit\n'
success_resolution "$HARNESS/fixtures/v100.json" v1.0.0 1.0.0

printf 'D. release API HTTP failure fails closed\n'
rc=$(run STUB_UNAME_S=Darwin STUB_UNAME_M=x86_64 STUB_CURL_FAIL=api)
check "D api failure fails closed" test "$rc" != 0
check "D no payload download" bash -c "! grep -Eq 'install\.mjs|\.tar\.gz' '$CURL_LOG'"

printf 'E. malformed JSON fails closed\n'
reject_resolution "malformed JSON" "$HARNESS/fixtures/malformed.json"

printf 'F. missing tag_name fails closed\n'
reject_resolution "missing tag_name" "$HARNESS/fixtures/notag.json"

printf 'G. draft=true rejected\n'
reject_resolution "draft" "$HARNESS/fixtures/draft.json"

printf 'H. prerelease=true rejected\n'
reject_resolution "prerelease" "$HARNESS/fixtures/prerelease.json"

printf 'I. v0.4.0-rc.1 rejected by stable-tag validation\n'
reject_resolution "rc.1 suffix" "$HARNESS/fixtures/rc.json"

printf 'J. malformed/noncanonical tags rejected\n'
reject_resolution "no leading v"  "$HARNESS/fixtures/nov.json"
reject_resolution "leading zero v01.2.3" "$HARNESS/fixtures/leadzero.json"
reject_resolution "short v1.2"   "$HARNESS/fixtures/short.json"
reject_resolution "build suffix v1.2.3+build" "$HARNESS/fixtures/build.json"

printf 'K. shell-metacharacter tag cannot affect command execution\n'
rc=$(run STUB_UNAME_S=Darwin STUB_UNAME_M=x86_64 STUB_RELEASE_JSON="$HARNESS/fixtures/metachar.json")
check "K metachar tag fails closed" test "$rc" != 0
check "K no marker file created" test ! -e "$HARNESS/pwned"
rm -f "$HARNESS/pwned"

printf 'L. installer URL and artifact URL always share the exact resolved tag\n'
rc=$(run STUB_UNAME_S=Darwin STUB_UNAME_M=x86_64 STUB_RELEASE_JSON="$HARNESS/fixtures/v030.json")
check "L installer tag == artifact tag (v0.3.0)" \
  bash -c "grep -q '/v0.3.0/scripts/install.mjs$' '$CURL_LOG' && grep -q '/download/v0.3.0/project-gateway-macos-0.3.0' '$CURL_LOG'"

printf 'M. release lookup occurs exactly once per bootstrap invocation\n'
check "M single releases/latest fetch" test "$(grep -c '/releases/latest' "$CURL_LOG")" = 1

printf 'N. no hard-coded release-selection VERSION remains\n'
check "N VERSION derived from resolved TAG" grep -q 'VERSION="${TAG#v}"' "$INSTALL_SH"
check "N no hard-coded numeric VERSION assignment" bash -c "! grep -Eq 'VERSION=\"[0-9]' '$INSTALL_SH'"
check "N no hard-coded TAG pin" bash -c "! grep -Eq 'TAG=\"v[0-9]' '$INSTALL_SH'"

# ===== previously accepted tests retained ===================================

printf 'ARCH. Darwin x86_64 -> x64 asset selection\n'
rc=$(run STUB_UNAME_S=Darwin STUB_UNAME_M=x86_64)
check "ARCH x64 succeeds" test "$rc" = 0
check "ARCH requests x64 tarball URL" grep -q 'darwin-x64.tar.gz' "$CURL_LOG"
check "ARCH never requests arm64 URL" bash -c "! grep -q 'darwin-arm64' '$CURL_LOG'"

printf 'ARCH. Darwin arm64 -> arm64 asset selection\n'
rc=$(run STUB_UNAME_S=Darwin STUB_UNAME_M=arm64)
check "ARCH arm64 succeeds" test "$rc" = 0
check "ARCH requests arm64 tarball URL" grep -q 'darwin-arm64.tar.gz' "$CURL_LOG"
check "ARCH never requests x64 URL" bash -c "! grep -q 'darwin-x64' '$CURL_LOG'"

printf 'OS. unsupported OS fails\n'
rc=$(run STUB_UNAME_S=Linux STUB_UNAME_M=x86_64)
check "OS linux fails closed" test "$rc" != 0
check "OS no downloads attempted" test ! -s "$CURL_LOG"

printf 'ARCH. unsupported architecture fails\n'
rc=$(run STUB_UNAME_S=Darwin STUB_UNAME_M=m68k)
check "ARCH unsupported fails closed" test "$rc" != 0
check "ARCH no downloads attempted" test ! -s "$CURL_LOG"

printf 'DL. failed tarball download fails closed\n'
rc=$(run STUB_UNAME_S=Darwin STUB_UNAME_M=x86_64 STUB_CURL_FAIL=tarball)
check "DL tarball failure aborts" test "$rc" != 0
check "DL no installer run" test ! -s "$NODE_LOG"
check "DL temp dir cleaned on failure" test -z "$(leftovers)"

printf 'DL. failed sidecar download fails closed\n'
rc=$(run STUB_UNAME_S=Darwin STUB_UNAME_M=x86_64 STUB_CURL_FAIL=sidecar)
check "DL sidecar failure aborts" test "$rc" != 0
check "DL no installer run" test ! -s "$NODE_LOG"

printf 'DL. installer failure propagates nonzero\n'
rc=$(run STUB_UNAME_S=Darwin STUB_UNAME_M=x86_64 STUB_NODE_FAIL=1)
check "DL installer failure propagates" test "$rc" != 0
check "DL temp dir cleaned on installer failure" test -z "$(leftovers)"

printf 'SEC. no privilege / no tunnel side effects\n'
check "SEC sudo never invoked" test ! -s "$SUDO_LOG"
check "SEC no sudo in install.sh" bash -c "! grep -Eq '(^|[^a-z])sudo([^a-z]|\$)' '$INSTALL_SH'"
pgw_outside_heredoc() {
  awk '/<<EOF/{h=1; next} h==1 && $0=="EOF"{h=0; next} h==0 && /pgw/{print}' "$1"
}
check "SEC no pgw command execution (outside help text)" test -z "$(pgw_outside_heredoc "$INSTALL_SH")"

printf 'VER. node version gate\n'
rc=$(run STUB_UNAME_S=Darwin STUB_UNAME_M=x86_64 STUB_NODE_VERSION=18.0.0)
check "VER node <22 rejected" test "$rc" != 0
check "VER node <22 no downloads" test ! -s "$CURL_LOG"

printf 'H. temp dir cleaned on success\n'
rc=$(run STUB_UNAME_S=Darwin STUB_UNAME_M=x86_64)
check "H temp dir cleaned on success" test -z "$(leftovers)"

printf 'F1. corrected one-command download-then-execute (outer pipeline)\n'
F1BIN="$HARNESS/f1bin"
mkdir -p "$F1BIN" "$HARNESS/f1home"
cat >"$F1BIN/curl" <<'EOF'
#!/usr/bin/env bash
out=""
prev=""
for a in "$@"; do
  [ "$prev" = "-o" ] && out="$a"
  prev="$a"
done
if [ "${F1_FAIL:-0}" = 1 ]; then
  # simulate a download that wrote a partial prefix and then failed
  [ -n "$out" ] && printf '%s\n' 'echo "F1-PREFIX-RAN"' > "$out"
  printf 'curl: simulated download failure\n' >&2
  exit 22
fi
case "${F1_MODE:-content}" in
  empty) : > "$out" ;;
  *)     cat "${F1_CONTENT:?}" > "$out" ;;
esac
exit 0
EOF
chmod +x "$F1BIN/curl"

printf '%s\n' 'printf "F1-MARKER\n"' > "$HARNESS/f1_marker.sh"
printf '%s\n' 'exit 7'                > "$HARNESS/f1_fail7.sh"

f1_outer() { # run the exact corrected README command shape with a controllable curl
  local content="$1" rc=0
  env -i PATH="$F1BIN:/usr/bin:/bin:/usr/sbin:/sbin" \
    HOME="$HARNESS/f1home" TMPDIR="$HARNESS/tmp" \
    F1_MODE=content F1_CONTENT="$content" \
    bash -c '
      tmp="$(mktemp "${TMPDIR:-/tmp}/pgw-f1.XXXXXX")" &&
      trap "rm -f \"\$tmp\"" EXIT &&
      curl -fsSL "https://example.invalid/install.sh" -o "$tmp" &&
      [ -s "$tmp" ] &&
      bash "$tmp"
    ' >"$HARNESS/f1out" 2>"$HARNESS/f1err" || rc=$?
  echo "$rc"
}
f1_outer_fail() { # download fails after writing a partial prefix
  local content="$1" rc=0
  env -i PATH="$F1BIN:/usr/bin:/bin:/usr/sbin:/sbin" \
    HOME="$HARNESS/f1home" TMPDIR="$HARNESS/tmp" F1_FAIL=1 \
    F1_MODE=content F1_CONTENT="$content" \
    bash -c '
      tmp="$(mktemp "${TMPDIR:-/tmp}/pgw-f1.XXXXXX")" &&
      trap "rm -f \"\$tmp\"" EXIT &&
      curl -fsSL "https://example.invalid/install.sh" -o "$tmp" &&
      [ -s "$tmp" ] &&
      bash "$tmp"
    ' >"$HARNESS/f1out" 2>"$HARNESS/f1err" || rc=$?
  echo "$rc"
}
f1_outer_zero() { # HTTP-success zero-byte body: curl succeeds, file is empty
  local rc=0
  env -i PATH="$F1BIN:/usr/bin:/bin:/usr/sbin:/sbin" \
    HOME="$HARNESS/f1home" TMPDIR="$HARNESS/tmp" F1_MODE=empty \
    bash -c '
      tmp="$(mktemp "${TMPDIR:-/tmp}/pgw-f1.XXXXXX")" &&
      trap "rm -f \"\$tmp\"" EXIT &&
      curl -fsSL "https://example.invalid/install.sh" -o "$tmp" &&
      [ -s "$tmp" ] &&
      bash "$tmp"
    ' >"$HARNESS/f1out" 2>"$HARNESS/f1err" || rc=$?
  echo "$rc"
}
f1_leftovers() { find "$HARNESS/tmp" -maxdepth 1 -name 'pgw-f1.*' 2>/dev/null | wc -l | tr -d ' '; }

printf 'A. successful bootstrap download -> bash executes\n'
rc=$(f1_outer "$HARNESS/f1_marker.sh")
check "F1 A: success download executes bootstrap (rc 0)" test "$rc" = 0
check "F1 A: downloaded body executed" grep -q 'F1-MARKER' "$HARNESS/f1out"

printf 'B. bootstrap download failure -> nonzero, bash not executed\n'
rc=$(f1_outer_fail "$HARNESS/f1_marker.sh")
check "F1 B: download failure is nonzero" test "$rc" != 0
check "F1 B: bash not executed on failure" bash -c "! grep -q 'F1-PREFIX-RAN' '$HARNESS/f1out'"

printf 'C. empty/failed download not falsely reported as success\n'
check "F1 C: failed download not reported as success" test "$rc" != 0

printf 'D. partial prefix from a failed download is NOT executed\n'
check "F1 D: truncated prefix not executed" bash -c "! grep -q 'F1-PREFIX-RAN' '$HARNESS/f1out'"

printf 'E. bootstrap script exits nonzero -> overall propagates nonzero\n'
rc=$(f1_outer "$HARNESS/f1_fail7.sh")
check "F1 E: bootstrap nonzero propagates (7)" test "$rc" -eq 7

printf 'F/G/H. temporary bootstrap file cleaned\n'
rc=$(f1_outer "$HARNESS/f1_marker.sh")
check "F1 F: temp cleaned on success" test "$(f1_leftovers)" = 0
rc=$(f1_outer_fail "$HARNESS/f1_marker.sh")
check "F1 G: temp cleaned on curl failure" test "$(f1_leftovers)" = 0
rc=$(f1_outer "$HARNESS/f1_fail7.sh")
check "F1 H: temp cleaned on bootstrap failure" test "$(f1_leftovers)" = 0

printf 'I. no persistent EXIT trap left in the parent shell\n'
check "F1 I: no EXIT trap leaks out of the subshell" \
  bash -c '(
    tmp="$(mktemp "${TMPDIR:-/tmp}/pgw-f1i.XXXXXX")" &&
    trap "rm -f \"\$tmp\"" EXIT &&
    : > "$tmp"
  ); test -z "$(trap -p EXIT)"'

printf 'Z. zero-byte HTTP-success bootstrap body fails closed\n'
rc=$(f1_outer_zero)
check "F1 Z: zero-byte body is nonzero overall" test "$rc" != 0
check "F1 Z: bash/bootstrap not executed (empty body)" bash -c "! grep -q 'F1-MARKER' '$HARNESS/f1out'"
check "F1 Z: temp cleaned on zero-byte body" test "$(f1_leftovers)" = 0
check "F1 Z: zero-byte body not reported as success" bash -c "! grep -Eq 'installed successfully|F1-MARKER' '$HARNESS/f1out'"

printf 'F2. node major-version gate fail-closed\n'
rc=$(run STUB_UNAME_S=Darwin STUB_UNAME_M=x86_64 STUB_NODE_VERSION=22.0.0)
check "F2 J: node 22 passes" test "$rc" = 0
rc=$(run STUB_UNAME_S=Darwin STUB_UNAME_M=x86_64 STUB_NODE_VERSION=24.3.0)
check "F2 K: node 24 (>22) passes" test "$rc" = 0
rc=$(run STUB_UNAME_S=Darwin STUB_UNAME_M=x86_64 STUB_NODE_VERSION=21.7.2)
check "F2 L: node 21 fails" test "$rc" != 0
rc=$(run STUB_UNAME_S=Darwin STUB_UNAME_M=x86_64 STUB_NODE_VERSION="")
check "F2 M: empty node version fails" test "$rc" != 0
rc=$(run STUB_UNAME_S=Darwin STUB_UNAME_M=x86_64 STUB_NODE_VERSION=abc)
check "F2 N: non-numeric node version fails" test "$rc" != 0
rc=$(run STUB_UNAME_S=Darwin STUB_UNAME_M=x86_64 STUB_NODE_VERSION=22x)
check "F2 O: mixed numeric/text fails" test "$rc" != 0

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
