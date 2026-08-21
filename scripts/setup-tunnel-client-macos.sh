#!/usr/bin/env bash
#
# ONE-TIME tunnel-client installation + configuration for Project Gateway on
# macOS. Safe to rerun (idempotent).
#
# Responsibilities:
#   1. verify macOS + supported architecture
#   2. install the pinned upstream tunnel-client v0.0.10 (skip if already valid)
#   3. establish/reuse the user's tunnel identity (upstream profile)
#   4. store the Runtime API Key in macOS Keychain (reuse if present)
#   5. validate the resulting state
#
# It does NOT start Project Gateway. It does NOT install pgw (use the existing
# repository installer: README / scripts/install.mjs).
#
# Foreground interactive workflow only. No autostart mechanism, no background
# supervision, and no detached process are installed or launched.
#
# The Runtime API Key must be created in advance on the OpenAI Platform
# (Tunnels Read + Use permission); this script accepts an existing key but
# does not create one.
#
# STRUCTURE: the orchestration lives in setup_main(). When executed directly
# (`bash setup-tunnel-client-macos.sh`) the BASH_SOURCE/$0 identity guard runs
# setup_main normally with `set -euo pipefail`. When sourced by a test shell
# (BASH_SOURCE != $0), the full production implementation is loaded without
# side effects; the test may then replace low-level functions AFTER sourcing
# and invoke setup_main itself. This distinction is an intrinsic shell
# identity, not an environment-controlled test mode. Production functions are
# always defined unconditionally by the shipped code (common.sh overwrites any
# same-named function inherited from the calling environment).

# Shell tracing is never enabled: the runtime key must never appear in trace
# output. Applied only when executed directly, so sourcing never changes the
# caller's shell options.
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  set -euo pipefail
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=tunnel-client-common.sh
source "${SCRIPT_DIR}/tunnel-client-common.sh"

setup_main() {
  # --- 1. platform + architecture -------------------------------------------
  tc_is_macos || tc_fail "macOS required (uname=$(uname -s))"
  local ARCH
  ARCH="$(tc_arch_mapped || true)"
  [[ -n "$ARCH" ]] || tc_fail "unsupported architecture: $(uname -m)"

  # --- 2. pgw must already be installed (this script does not install it) ----
  [[ -x "$PGW_BIN" ]] || tc_fail "pgw not found at $PGW_BIN — install/configure Project Gateway pgw first (see README)"

  # --- 3. install tunnel-client (skip when exact version already present) ----
  install_tunnel_client() {
    if [[ -x "$TC_BIN" ]]; then
      local v
      v="$("$TC_BIN" --version 2>/dev/null || true)"
      if [[ "$v" == "${TC_VERSION}"* ]]; then
        echo "tunnel-client v${TC_VERSION} already installed — skipped"
        return
      fi
      echo "tunnel-client present but version ${v:-unknown} != ${TC_VERSION}; reinstalling pinned version"
    fi

    echo "installing tunnel-client v${TC_VERSION} (${ARCH}) into ${TC_BIN} ..."
    local zip url expected extracted tmpbin
    url="$(tc_release_url_for_arch "$ARCH")"
    expected="$(tc_expected_sha_for_arch "$ARCH")"
    local tmpdir
    tmpdir="$(mktemp -d)"
    trap 'rm -rf "$tmpdir"' RETURN
    zip="${tmpdir}/tunnel-client.zip"

    tc_download "$url" "$zip"
    tc_verify "$zip" "$expected"

    ( cd "$tmpdir" && unzip -oq "$zip" ) || tc_fail "extraction failed"
    extracted="${tmpdir}/tunnel-client"
    [[ -f "$extracted" ]] || tc_fail "archive did not contain tunnel-client binary"

    mkdir -p "$(dirname "$TC_BIN")"
    tmpbin="${TC_BIN}.tmp.$$"
    mv "$extracted" "$tmpbin"
    chmod +x "$tmpbin"
    mv -f "$tmpbin" "$TC_BIN"
    echo "installed ${TC_BIN}"
  }
  install_tunnel_client

  # --- 4. tunnel identity (upstream profile) ---------------------------------
  local PROFILE_FILE TUNNEL_ID
  PROFILE_FILE="$(tc_profile_file)"

  # Reuse an already-configured valid profile's tunnel id on rerun.
  local existing_id=""
  if [[ -f "$PROFILE_FILE" ]] && grep -q '^\s*tunnel_id:' "$PROFILE_FILE" 2>/dev/null; then
    existing_id="$(grep -m1 '^\s*tunnel_id:' "$PROFILE_FILE" | sed -E 's/.*tunnel_id:[[:space:]]*"?([^"]*)"?.*/\1/' | tr -d ' ')"
  fi
  if [[ -n "$existing_id" ]] && tc_valid_tunnel_id "$existing_id"; then
    TUNNEL_ID="$existing_id"
    echo "tunnel identity ${TUNNEL_ID} already configured — reused"
  else
    # Accept an interactive prompt OR the CONTROL_PLANE_TUNNEL_ID env input.
    if [[ -n "${CONTROL_PLANE_TUNNEL_ID:-}" ]]; then
      TUNNEL_ID="$CONTROL_PLANE_TUNNEL_ID"
    else
      printf '%s' "Control-plane tunnel ID (from OpenAI Platform > Tunnels): "
      read -r TUNNEL_ID
    fi
    TUNNEL_ID="${TUNNEL_ID// /}"
    tc_valid_tunnel_id "$TUNNEL_ID" || tc_fail "invalid tunnel ID (expected tunnel_<32 lowercase hex>): $TUNNEL_ID"
  fi

  # --- 5. create/reuse the upstream profile ----------------------------------
  ensure_profile() {
    if [[ -f "$PROFILE_FILE" ]] \
      && grep -q "tunnel_id.*${TUNNEL_ID}" "$PROFILE_FILE" \
      && grep -q 'api_key: "env:CONTROL_PLANE_API_KEY"' "$PROFILE_FILE" \
      && grep -qF "$PGW_BIN" "$PROFILE_FILE"; then
      echo "project-gateway profile already configured — reused"
      return
    fi

    $TC_BIN init \
      --profile "$TC_PROFILE_NAME" \
      --tunnel-id "$TUNNEL_ID" \
      --mcp-command "$PGW_BIN start,channel=main" \
      --health-listen-addr 127.0.0.1:0 >/dev/null \
      || tc_fail "tunnel-client init failed (profile $TC_PROFILE_NAME)"
    echo "created profile ${PROFILE_FILE}"
  }
  ensure_profile

  # --- 6. Runtime API Key -> macOS Keychain (reuse, never rotate; never print) ---
  if tc_keychain_has_credential; then
    echo "runtime credential already present in Keychain — reused"
  else
    cat >&2 <<'EOM'
A Runtime API Key with "Tunnels Read + Use" permission is required.
Create one at https://platform.openai.com/settings/organization/api-keys
then paste it below (input is hidden and never printed).
EOM
    printf '%s' "Runtime API Key: " >&2
    read -rs KEY
    printf '\n' >&2
    [[ -n "$KEY" ]] || tc_fail "empty Runtime API Key"
    tc_keychain_add_credential "$KEY" || tc_fail "could not store Runtime API Key in Keychain"
    unset KEY
    echo "stored runtime credential in macOS Keychain (service=$KEYCHAIN_SERVICE account=$KEYCHAIN_ACCOUNT)"
  fi

  # --- 7. validate resulting state -------------------------------------------
  [[ -x "$TC_BIN" ]] || tc_fail "tunnel-client missing after setup"
  [[ -x "$PGW_BIN" ]] || tc_fail "pgw missing after setup"
  [[ -f "$PROFILE_FILE" ]] || tc_fail "profile missing after setup"
  tc_valid_tunnel_id "$TUNNEL_ID" || tc_fail "configured tunnel ID invalid"
  grep -q 'api_key: "env:CONTROL_PLANE_API_KEY"' "$PROFILE_FILE" \
    || tc_fail "profile does not use a secret reference (env:CONTROL_PLANE_API_KEY)"
  # Fail closed if a literal Runtime API Key (sk-...) leaked into the profile.
  grep -qE 'sk-[A-Za-z0-9_-]+' "$PROFILE_FILE" \
    && tc_fail "profile contains a literal runtime secret — refusing"
  tc_keychain_has_credential \
    || tc_fail "Keychain credential missing after setup"
  echo
  printf 'Setup complete.\n\nNormal use:\n  pgw up\n'
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  setup_main "$@"
fi
