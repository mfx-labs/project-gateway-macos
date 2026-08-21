#!/usr/bin/env bash
#
# Shared, machine-independent configuration + pure helpers for the two macOS
# tunnel workflow scripts (setup-tunnel-client-macos.sh and
# start-project-gateway-macos.sh).
#
# Everything here resolves through $HOME / $XDG_CONFIG_HOME. No developer
# machine values, no workspace IDs, no hard-coded binaries beyond the pinned
# upstream tunnel-client release.
#
# Sourced by both scripts and by tests/macos/two-script-workflow.test.sh.
# Intentionally not executable on its own.
#
# TRUST MODEL: the pinned upstream release, its download origin, and each
# architecture's expected SHA-256 are PRODUCTION CONSTANTS. They are bound
# here unconditionally and are NOT overridable through the environment, and
# every trust-bearing function is defined unconditionally by the shipped code
# (overwriting any same-named function inherited from the calling process).
# Tests that need a fixture origin/checksum source this implementation and
# replace the lower-level functions (tc_release_url_for_arch,
# tc_expected_sha_for_arch, tc_download, tc_keychain_*) inside their own test
# shell AFTER sourcing; the shipped `pgw tunnel` command has no input that can
# redefine the trusted origin or checksum.
#
# pinned upstream release (per release audit of openai/tunnel-client):
#   https://github.com/openai/tunnel-client/releases/tag/v0.0.10
#   darwin-amd64 sha256 1a48616e584484f8bef4c1128d515ac96cf44d0d9609c1462abccc1793f4b847
#   darwin-arm64 sha256 288accc7fd20cfee1d495adb933773af9e19ebc0cdef3173f7fb544afa5065b2
# v0.0.11-dev is a prerelease and MUST NOT be selected.

TC_VERSION="0.0.10"
TC_PROFILE_NAME="project-gateway"

# Per-user managed binary layout (repository contract; pgw installed by
# scripts/install.mjs into ~/.local/bin/pgw).
TC_BIN="${HOME}/.local/bin/tunnel-client"
PGW_BIN="${HOME}/.local/bin/pgw"

# Keychain identifiers (established by the prior manual-reference workflow).
KEYCHAIN_SERVICE="com.mfx-labs.project-gateway.tunnel"
KEYCHAIN_ACCOUNT="tunnel-runtime-key"
SECURITY_BIN="/usr/bin/security"

# -- pure helpers (testable in isolation) -----------------------------------

# macOS only. Accepts an override (uname -s) for testing.
tc_is_macos() {
  [[ "${1:-$(uname -s)}" == "Darwin" ]]
}

# Map uname -m to the upstream asset arch token (amd64|arm64). Accepts an
# override (uname -m) for testing. Empty/fails on unsupported architecture.
tc_arch_mapped() {
  case "${1:-$(uname -m)}" in
    x86_64|amd64) printf 'amd64' ;;
    aarch64|arm64) printf 'arm64' ;;
    *) return 1 ;;
  esac
}

# tunnel_ + exactly 32 lowercase hex characters.
tc_valid_tunnel_id() {
  [[ "$1" =~ ^tunnel_[0-9a-f]{32}$ ]]
}

# The trust-bearing functions below are defined UNCONDITIONALLY by the shipped
# code. When tunnel-client-common.sh is sourced, its definitions overwrite any
# same-named function inherited from the invoking environment — an exported
# function from a parent process is therefore never a production configuration
# mechanism. Tests that need a fixture origin/checksum/Keychain backend source
# the implementation and replace these functions AFTER sourcing, inside their
# own test shell only; the shipped `pgw tunnel` command runs them exactly as
# defined here with no environment or inherited-function override surface.

# Official pinned release origin for the current requested arch token.
# Production constant; never environment-overridable.
tc_release_url_for_arch() {
  printf '%s' "https://github.com/openai/tunnel-client/releases/download/v${TC_VERSION}/tunnel-client-v${TC_VERSION}-darwin-${1}.zip"
}

# Pinned trusted SHA-256 for the current/requested upstream arch token.
# Production constant; never environment-overridable.
tc_expected_sha_for_arch() {
  case "${1:-}" in
    amd64) printf '%s' '1a48616e584484f8bef4c1128d515ac96cf44d0d9609c1462abccc1793f4b847' ;;
    arm64) printf '%s' '288accc7fd20cfee1d495adb933773af9e19ebc0cdef3173f7fb544afa5065b2' ;;
    *) return 1 ;;
  esac
}

# Download $1 (url) to $2 (outfile). Production uses the pinned origin.
tc_download() {
  curl -fsSL "$1" -o "$2" || tc_fail "download failed: $1"
}

# Verify $1 (file) matches expected SHA-256 $2, else fail closed.
tc_verify() {
  local actual
  actual="$(shasum -a 256 "$1" | awk '{print $1}')"
  [[ "$actual" == "$2" ]] || tc_fail "checksum mismatch (expected $2, got $actual) — refusing to install"
}

# Keychain helpers (trusted /usr/bin/security in production).
tc_keychain_has_credential() {
  "$SECURITY_BIN" find-generic-password -s "$KEYCHAIN_SERVICE" -a "$KEYCHAIN_ACCOUNT" >/dev/null 2>&1
}
tc_keychain_add_credential() {
  "$SECURITY_BIN" add-generic-password -U -s "$KEYCHAIN_SERVICE" -a "$KEYCHAIN_ACCOUNT" -w "$1" >/dev/null 2>&1
}

# Profile directory follows tunnel-client's default resolution
# ($XDG_CONFIG_HOME/tunnel-client or $HOME/.config/tunnel-client).
tc_profile_dir() {
  printf '%s' "${XDG_CONFIG_HOME:-$HOME/.config}/tunnel-client"
}

tc_profile_file() {
  printf '%s/%s.yaml' "$(tc_profile_dir)" "$TC_PROFILE_NAME"
}

# -- shared validators -------------------------------------------------------

tc_fail() {
  echo "error: $*" >&2
  exit 1
}
