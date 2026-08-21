#!/usr/bin/env bash
#
# Focused tests for the two macOS tunnel workflow scripts:
#   scripts/setup-tunnel-client-macos.sh
#   scripts/start-project-gateway-macos.sh
#
# Runs entirely in a throwaway temp HOME with fake tunnel-client / pgw shims
# and a local HTTP server for the install path. Never touches the real
# machine, real Keychain, real binaries, or the network (besides loopback).
# No `npm test`.
#
# TEST SEAM MODEL: this file sources the shipped implementation
# (setup-tunnel-client-macos.sh), which loads the production functions and
# defines setup_main() WITHOUT running it (BASH_SOURCE != $0). Scenarios then
# run in a subshell that first replaces the low-level functions AFTER sourcing
# and calls setup_main(). Production functions are always defined
# unconditionally by the shipped code; the production entry
# (`bash setup-tunnel-client-macos.sh`) has no environment or
# inherited-function override surface. These tests also prove an inherited
# exported function is replaced/ignored by the shipped implementation.
#
# Run: bash tests/macos/two-script-workflow.test.sh

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMMON="$REPO/scripts/tunnel-client-common.sh"
SETUP="$REPO/scripts/setup-tunnel-client-macos.sh"
START="$REPO/scripts/start-project-gateway-macos.sh"

PASS=0
FAIL=0
note() { printf 'pass %s\n' "$1"; PASS=$((PASS+1)); }
bad()  { printf 'FAIL %s\n' "$1";  FAIL=$((FAIL+1)); }
check() { if eval "$2"; then note "$1"; else bad "$1"; fi; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# ---- shared fixtures -------------------------------------------------------
VALID_ID="tunnel_0123456789abcdef0123456789abcdef"
OFFICIAL_URL_AMD64="https://github.com/openai/tunnel-client/releases/download/v0.0.10/tunnel-client-v0.0.10-darwin-amd64.zip"
OFFICIAL_SHA_AMD64="1a48616e584484f8bef4c1128d515ac96cf44d0d9609c1462abccc1793f4b847"
OFFICIAL_SHA_ARM64="288accc7fd20cfee1d495adb933773af9e19ebc0cdef3173f7fb544afa5065b2"

make_fake_tc() { # $1 = destination path  (the fake tunnel-client)
  cat > "$1" <<'EOF'
#!/usr/bin/env bash
case "$1" in
  --version) echo "0.0.10+test";;
  init)
    prof= tcid= mcp= addr=
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --profile) prof="$2"; shift 2;;
        --tunnel-id) tcid="$2"; shift 2;;
        --mcp-command) mcp="$2"; shift 2;;
        --health-listen-addr) addr="$2"; shift 2;;
        *) shift;;
      esac
    done
    dir="${HOME}/.config/tunnel-client"; mkdir -p "$dir"
    cat > "$dir/$prof.yaml" <<YAML
config_version: 1
control_plane:
  base_url: "https://api.openai.com"
  tunnel_id: "$tcid"
  api_key: "env:CONTROL_PLANE_API_KEY"
health:
  listen_addr: "$addr"
mcp:
  commands:
    - channel: main
      command: "$mcp"
YAML
    ;;
  run)
    shift
    if [[ "$1" == "--profile" ]]; then echo "FAKE_RUN profile=$2"; fi
    exit 0
    ;;
  *) exit 0;;
esac
EOF
  chmod +x "$1"
}
make_fake_pgw() { printf '#!/usr/bin/env bash\nexit 0\n' > "$1"; chmod +x "$1"; }

# ---- load the shipped implementation (production funcs + setup_main) -------
source "$SETUP"

# ---- 0. pure helper tests (production functions, just loaded) --------------
check "arch map x86_64 -> amd64" '[[ "$(tc_arch_mapped x86_64)" == amd64 ]]'
check "arch map arm64 -> arm64"  '[[ "$(tc_arch_mapped arm64)" == arm64 ]]'
check "arch map aarch64 -> arm64" '[[ "$(tc_arch_mapped aarch64)" == arm64 ]]'
check "unsupported arch rejected" '! tc_arch_mapped i386'
check "macOS Darwin accepted"    'tc_is_macos Darwin'
check "non-macOS rejected"       '! tc_is_macos Linux'
check "valid tunnel id accepted"  'tc_valid_tunnel_id "'"$VALID_ID"'"'
check "invalid tunnel id rejected" '! tc_valid_tunnel_id tunnel_xyz'
check "short tunnel id rejected"  '! tc_valid_tunnel_id tunnel_0123456789abcdef'

# ---- F1: former env overrides can NOT redefine trusted origin/SHA ----------
check "F1: trusted origin ignores TUNNEL_CLIENT_URL_BASE"
  '[[ "$(TUNNEL_CLIENT_URL_BASE="http://evil" bash -c '\''source "'"$COMMON"'"; tc_release_url_for_arch amd64'\'')" == "'"$OFFICIAL_URL_AMD64"'" ]]'
check "F1: trusted amd64 SHA ignores TC_SHA_DARWIN_amd64"
  '[[ "$(TC_SHA_DARWIN_amd64="deadbeef" bash -c '\''source "'"$COMMON"'"; tc_expected_sha_for_arch amd64'\'')" == "'"$OFFICIAL_SHA_AMD64"'" ]]'
check "F1: trusted arm64 SHA ignores TC_SHA_DARWIN_arm64"
  '[[ "$(TC_SHA_DARWIN_arm64="deadbeef" bash -c '\''source "'"$COMMON"'"; tc_expected_sha_for_arch arm64'\'')" == "'"$OFFICIAL_SHA_ARM64"'" ]]'
check "F1: production scripts do not reference former env override names"
  '! grep -qE "TUNNEL_CLIENT_URL_BASE|TC_SHA_DARWIN|SECURITY_BIN:?-|\$\{SECURITY_BIN\}" "$COMMON" "$SETUP"'
check "F1: SECURITY_BIN is the trusted system executable constant"
  'grep -q "SECURITY_BIN=\"/usr/bin/security\"" "$COMMON"'

# ---- F1: inherited exported functions are replaced/ignored by production ----
check "F1: inherited exported tc_release_url_for_arch is replaced by production"
  '[[ "$(bash -c '\''tc_release_url_for_arch() { echo EVIL_URL; }; export -f tc_release_url_for_arch; source "'"$COMMON"'"; tc_release_url_for_arch amd64'\'')" == "'"$OFFICIAL_URL_AMD64"'" ]]'
check "F1: inherited exported tc_expected_sha_for_arch is replaced by production"
  '[[ "$(bash -c '\''tc_expected_sha_for_arch() { echo EVIL_SHA; }; export -f tc_expected_sha_for_arch; source "'"$COMMON"'"; tc_expected_sha_for_arch arm64'\'')" == "'"$OFFICIAL_SHA_ARM64"'" ]]'
MALMARK="$TMP/mal-marker"
check "F1: inherited exported function is not executed (marker stays clean)"
  '[[ "$(MALMARK="'"$MALMARK"'" bash -c '\''tc_expected_sha_for_arch() { echo EVIL > "'"$MALMARK"'"; echo EVIL_SHA; }; export -f tc_expected_sha_for_arch; source "'"$COMMON"'"; tc_expected_sha_for_arch arm64'\'')" == "'"$OFFICIAL_SHA_ARM64"'" && ! -e "'"$MALMARK"'" ]]'

# ---- 1. no dev machine / no workspace / isolation --------------------------
check "setup has no developer path" '! grep -q "/Users/serene" "'"$SETUP"'"'
check "start has no developer path" '! grep -q "/Users/serene" "'"$START"'"'
check "setup has no workspace id"   '! grep -q "pgw:w:" "'"$SETUP"'"'
check "start has no workspace id"   '! grep -q "pgw:w:" "'"$START"'"'
check "setup uses per-user HOME"    'grep -qF "\${HOME}" "'"$COMMON"'"'
check "no LaunchAgent/autostart in setup" '! grep -qiE "launchctl|launchd|nohup|disown|daemon(ize)?" "'"$SETUP"'"'
check "no LaunchAgent/autostart in start" '! grep -qiE "launchctl|launchd|nohup|disown|daemon(ize)?" "'"$START"'"'
check "setup never enables shell tracing"  '! grep -q "set -x" "'"$SETUP"'"'
check "start never enables shell tracing"  '! grep -q "set -x" "'"$START"'"'
check "production has no declare -F / export -f / env test-mode gate"
  '! grep -qE "declare -F|export -f|PGW_TEST|ALLOW_[A-Z_]*TEST|BASH_FUNC_|\$\{TC_TEST_|\$\{PGW_TEST" "$COMMON" "$SETUP"'

# ---- 2. install path: source-level test seam ------------------------------
# Build a real zip containing a fake tunnel-client and serve it on loopback.
SRV="$TMP/srv"; mkdir -p "$SRV"; make_fake_tc "$SRV/tunnel-client"
(cd "$SRV" && rm -f ./*.tmp && zip -q test.zip tunnel-client 2>/dev/null \
  && mv test.zip "tunnel-client-v0.0.10-darwin-amd64.zip")
ZIP_SHA="$(shasum -a 256 "$SRV/tunnel-client-v0.0.10-darwin-amd64.zip" | awk '{print $1}')"
PORT=$((20000 + RANDOM % 20000))
(cd "$SRV" && python3 -m http.server "$PORT" --bind 127.0.0.1 >/dev/null 2>&1) &
SRV_PID=$!
trap 'kill "$SRV_PID" 2>/dev/null; rm -rf "$TMP"' EXIT
sleep 1

# The source-level seam: replace low-level functions AFTER sourcing, then run
# setup_main in a subshell (so `exit` from tc_fail only exits the subshell).
apply_seam() {
  tc_release_url_for_arch() { printf '%s' "$TC_TEST_URL_BASE/tunnel-client-v0.0.10-darwin-amd64.zip"; }
  tc_download() { curl -fsSL "$1" -o "$2"; }
  tc_expected_sha_for_arch() { printf '%s' "$TC_TEST_SHA"; }
  tc_keychain_has_credential() { [[ -f "$TC_TEST_SECSTORE/key" ]]; }
  tc_keychain_add_credential() { mkdir -p "$TC_TEST_SECSTORE"; printf '%s' "$1" > "$TC_TEST_SECSTORE/key"; }
}
run_scenario() { (
    # Rebind per-user install paths to the scenario HOME (test-harness-only;
    # production binds these from the real $HOME when the setup process starts).
    TC_BIN="${HOME}/.local/bin/tunnel-client"
    PGW_BIN="${HOME}/.local/bin/pgw"
    apply_seam; setup_main
) 2>&1; }

WORK="$TMP/inst"; mkdir -p "$WORK/.local/bin" "$WORK/secstore"
make_fake_pgw "$WORK/.local/bin/pgw"
printf 'sk-testsecret' > "$WORK/secstore/key"   # pre-seed credential backend
OUT="$(HOME="$WORK" XDG_CONFIG_HOME="$WORK/.config" CONTROL_PLANE_TUNNEL_ID="$VALID_ID" \
  TC_TEST_URL_BASE="http://127.0.0.1:$PORT" TC_TEST_SHA="$ZIP_SHA" TC_TEST_SECSTORE="$WORK/secstore" \
  run_scenario)"; RC=$?
check "missing tunnel-client installs pinned v0.0.10 (rc=$RC)" 'echo "$OUT" | grep -q "installing tunnel-client v0.0.10"'
check "install lands in per-user HOME (no sudo)"      '[[ -x "$WORK/.local/bin/tunnel-client" ]]'
check "profile project-gateway created"               '[[ -f "$WORK/.config/tunnel-client/project-gateway.yaml" ]]'
check "profile contains secret reference, not literal" 'grep -q "api_key: \"env:CONTROL_PLANE_API_KEY\"" "$WORK/.config/tunnel-client/project-gateway.yaml"'
check "profile contains no literal runtime secret"     '! grep -q "sk-testsecret" "$WORK/.config/tunnel-client/project-gateway.yaml"'
check "profile stdio command keeps channel main as metadata" 'grep -q "channel: main" "$WORK/.config/tunnel-client/project-gateway.yaml"'
check "profile stdio command is <pgw> start (no ,channel=main)" 'grep -qF "command: \"$WORK/.local/bin/pgw start\"" "$WORK/.config/tunnel-client/project-gateway.yaml"'
check "profile stdio command has no ,channel=main" '! grep -q ",channel=main" "$WORK/.config/tunnel-client/project-gateway.yaml"'
check "setup prints completion + canonical start command" 'echo "$OUT" | grep -q "pgw up"'

# checksum mismatch fails closed (fresh HOME, wrong pinned sha, file seam)
WORK2="$TMP/mismatch"; mkdir -p "$WORK2/.local/bin" "$WORK2/secstore"
make_fake_pgw "$WORK2/.local/bin/pgw"
OUT="$(HOME="$WORK2" CONTROL_PLANE_TUNNEL_ID="$VALID_ID" \
  TC_TEST_URL_BASE="http://127.0.0.1:$PORT" TC_TEST_SHA="0000000000000000000000000000000000000000000000000000000000000000" TC_TEST_SECSTORE="$WORK2/secstore" \
  run_scenario)"; RC=$?
if [[ $RC -eq 0 ]]; then
  bad "checksum mismatch must fail"
else
  if grep -q "checksum mismatch" <<<"$OUT"; then note "checksum mismatch fails closed"; else bad "checksum mismatch error text: $OUT"; fi
  check "mismatch leaves no binary installed" '[[ ! -x "$WORK2/.local/bin/tunnel-client" ]]'
fi

# ---- 3. idempotent rerun (correct tunnel-client already present) -----------
OUT="$(HOME="$WORK" \
  TC_TEST_URL_BASE="unused" TC_TEST_SHA="unused" TC_TEST_SECSTORE="$WORK/secstore" \
  run_scenario)"; RC=$?
check "rerun skips install"                 'echo "$OUT" | grep -q "already installed — skipped"'
check "rerun reuses tunnel identity"        'echo "$OUT" | grep -q "tunnel identity .* already configured"'
check "rerun reuses profile"                'echo "$OUT" | grep -q "profile already configured — reused"'
check "rerun reuses keychain credential"    'echo "$OUT" | grep -q "credential already present in Keychain — reused"'
check "rerun does not re-download"          '! echo "$OUT" | grep -q "installing tunnel-client"'

# invalid tunnel id on first setup rejected
WORK3="$TMP/badid"; mkdir -p "$WORK3/.local/bin" "$WORK3/secstore"; make_fake_pgw "$WORK3/.local/bin/pgw"
OUT="$(HOME="$WORK3" CONTROL_PLANE_TUNNEL_ID="tunnel_NOTVALID" \
  TC_TEST_URL_BASE="http://127.0.0.1:$PORT" TC_TEST_SHA="$ZIP_SHA" TC_TEST_SECSTORE="$WORK3/secstore" \
  run_scenario)"; RC=$?
if [[ $RC -eq 0 ]]; then
  bad "invalid tunnel id must be rejected"
else
  note "invalid tunnel id rejected"
fi

# malformed profile repair: v0.2.0 RC wrote `,channel=main` inside the stdio
# command; setup must detect and recreate its own owned profile, preserving
# the tunnel id, env credential reference, and channel-main metadata.
WORKR="$TMP/repair"; mkdir -p "$WORKR/.local/bin" "$WORKR/secstore" "$WORKR/.config/tunnel-client"
make_fake_pgw "$WORKR/.local/bin/pgw"
make_fake_tc "$WORKR/.local/bin/tunnel-client"
printf 'sk-testsecret' > "$WORKR/secstore/key"
cat > "$WORKR/.config/tunnel-client/project-gateway.yaml" <<YAML
config_version: 1
control_plane:
  base_url: "https://api.openai.com"
  tunnel_id: "$VALID_ID"
  api_key: "env:CONTROL_PLANE_API_KEY"
health:
  listen_addr: "127.0.0.1:0"
mcp:
  commands:
    - channel: main
      command: "$WORKR/.local/bin/pgw start,channel=main"
YAML
OUT="$(HOME="$WORKR" XDG_CONFIG_HOME="$WORKR/.config" CONTROL_PLANE_TUNNEL_ID="$VALID_ID" \
  TC_TEST_URL_BASE="unused" TC_TEST_SHA="unused" TC_TEST_SECSTORE="$WORKR/secstore" \
  run_scenario)"; RC=$?
check "malformed profile repair exits 0 (rc=$RC)" '[[ $RC -eq 0 ]]'
check "malformed profile repaired: no ,channel=main remains" '! grep -q ",channel=main" "$WORKR/.config/tunnel-client/project-gateway.yaml"'
check "malformed profile repaired: command is clean <pgw> start" 'grep -qF "command: \"$WORKR/.local/bin/pgw start\"" "$WORKR/.config/tunnel-client/project-gateway.yaml"'
check "malformed profile repair keeps channel main metadata" 'grep -q "channel: main" "$WORKR/.config/tunnel-client/project-gateway.yaml"'
check "malformed profile repair preserves env reference" 'grep -q "api_key: \"env:CONTROL_PLANE_API_KEY\"" "$WORKR/.config/tunnel-client/project-gateway.yaml"'
check "malformed profile repair preserves tunnel id" 'grep -q "tunnel_id.*$VALID_ID" "$WORKR/.config/tunnel-client/project-gateway.yaml"'

# ---- 3b. cleanup regression: no `tmpdir: unbound variable` under set -u --------
# Direct production execution runs with `set -euo pipefail` (nounset). A past
# defect left a RETURN trap referencing a function-local `tmpdir` that fired on a
# later unrelated function return, tripping nounset AFTER a successful setup. The
# sourced-path scenarios above do not enable nounset, so these run under `set -u`
# to replicate the direct-execution condition and lock the regression.
run_scenario_u() { (
    set -euo pipefail
    TC_BIN="${HOME}/.local/bin/tunnel-client"
    PGW_BIN="${HOME}/.local/bin/pgw"
    apply_seam; setup_main
) 2>&1; }

# A/C/D — fresh install under nounset completes, cleans its temp dir, no unbound.
WORKU="$TMP/inst-u"; mkdir -p "$WORKU/.local/bin" "$WORKU/secstore"
make_fake_pgw "$WORKU/.local/bin/pgw"
printf 'sk-testsecret' > "$WORKU/secstore/key"
TMPDIRU="$TMP/tmp-u"; mkdir -p "$TMPDIRU"
OUT="$(HOME="$WORKU" XDG_CONFIG_HOME="$WORKU/.config" TMPDIR="$TMPDIRU" CONTROL_PLANE_TUNNEL_ID="$VALID_ID" \
  TC_TEST_URL_BASE="http://127.0.0.1:$PORT" TC_TEST_SHA="$ZIP_SHA" TC_TEST_SECSTORE="$WORKU/secstore" \
  run_scenario_u)"; RC=$?
check "nounset fresh install exits 0 (rc=$RC)" '[[ $RC -eq 0 ]]'
check "nounset fresh install: no unbound variable" '! echo "$OUT" | grep -q "unbound variable"'
check "nounset fresh install completes setup" 'echo "$OUT" | grep -q "Setup complete"'
check "nounset fresh install cleans temp dir" '[[ -z "$(find "$TMPDIRU" -mindepth 1 -maxdepth 1 2>/dev/null)" ]]'

# B/E — reuse path under nounset completes, no temp dir, no unbound.
TMPDIRU2="$TMP/tmp-u2"; mkdir -p "$TMPDIRU2"
OUT="$(HOME="$WORK" TMPDIR="$TMPDIRU2" CONTROL_PLANE_TUNNEL_ID="$VALID_ID" \
  TC_TEST_URL_BASE="unused" TC_TEST_SHA="unused" TC_TEST_SECSTORE="$WORK/secstore" \
  run_scenario_u)"; RC=$?
check "nounset reuse path exits 0 (rc=$RC)" '[[ $RC -eq 0 ]]'
check "nounset reuse path: no unbound variable" '! echo "$OUT" | grep -q "unbound variable"'
check "nounset reuse path reuses install" 'echo "$OUT" | grep -q "already installed — skipped"'
check "nounset reuse path creates no temp dir" '[[ -z "$(find "$TMPDIRU2" -mindepth 1 -maxdepth 1 2>/dev/null)" ]]'

# ---- 4. manual-start wrapper (thin; delegates to `pgw up`) ----------------
# 4a. wrapper contains no independent startup implementation
check "wrapper delegates to pgw up (exec)"   'grep -q "exec \"\$PGW\" up" "'"$START"'"'
check "wrapper resolves installed pgw path per HOME" 'grep -q "\$HOME/.local/bin/pgw" "'"$START"'"'
check "wrapper has no independent Keychain logic"    '! grep -qiE "find-generic-password|security" "'"$START"'"'
check "wrapper has no independent tunnel-client logic"  '! grep -qF "$TC_BIN" "$START"'

# 4b. behavior: wrapper calls the canonical `pgw up`
FAKEPGW="$TMP/fakepgw"
cat > "$FAKEPGW" <<'EOF'
#!/usr/bin/env bash
echo "PGW_CALLED $*" > "${FAKE_PGW_LOG}"
exit 0
EOF
chmod +x "$FAKEPGW"
FAKE_PGW_LOG="$TMP/pgw.log"
PGW_UP_PGW="$FAKEPGW" FAKE_PGW_LOG="$FAKE_PGW_LOG" HOME="$WORK" bash "$START"
check "wrapper invokes pgw with up" '[[ "$(cat "$FAKE_PGW_LOG")" == "PGW_CALLED up" ]]'

# ---- summary ---------------------------------------------------------------
echo
echo "passed: $PASS   failed: $FAIL"
if [[ $FAIL -ne 0 ]]; then exit 1; fi
exit 0
