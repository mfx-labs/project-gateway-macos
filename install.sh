#!/usr/bin/env bash
#
# Project Gateway for macOS — one-command STABLE-CHANNEL bootstrap installer.
#
#   curl -fsSL \
#     https://raw.githubusercontent.com/mfx-labs/project-gateway-macos/main/install.sh \
#     | bash
#
# main/install.sh is the stable-channel resolver. At runtime it:
#   -> validates host/prerequisites
#   -> detects architecture
#   -> resolves the repository's current latest STABLE GitHub release (via the
#      official releases/latest API, parsed with Node — no jq)
#   -> strictly validates the canonical SemVer tag, then FREEZES it for the run
#   -> downloads the exact-tag install.mjs, release tarball, and SHA-256
#      sidecar (all from fixed official origins)
#   -> invokes scripts/install.mjs (normative checksum validation + install)
#   -> cleans up all temporary files
#
# The release identity is never hard-coded and is treated as untrusted data
# until validated. A new release requires NO script edit and the public
# command never changes. There is NO privilege escalation, tunnel setup,
# Keychain access, or shell-startup modification.

set -euo pipefail
umask 077

# Fixed official origins. Hard-coded; never overridden by the environment.
REPO="mfx-labs/project-gateway-macos"
API_URL="https://api.github.com/repos/${REPO}/releases/latest"
REPO_URL="https://github.com/${REPO}"
RAW_ROOT="https://raw.githubusercontent.com/${REPO}"

fail() {
  echo "install: $*" >&2
  exit 1
}

# ---- host validation & prerequisites (fail closed, before any download) -----
OS="$(uname -s)"
case "$OS" in
  Darwin) ;;
  *) fail "unsupported OS '${OS}' — Project Gateway requires macOS (Darwin)." ;;
esac

MACH="$(uname -m)"
case "$MACH" in
  x86_64) PLATFORM="x64" ;;
  arm64)  PLATFORM="arm64" ;;
  *) fail "unsupported architecture '${MACH}' — Project Gateway supports x86_64 (x64) and arm64." ;;
esac

for cmd in curl node; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    fail "required command not found: ${cmd}"
  fi
done

node_version="$(node -p 'process.versions.node')"
node_major="$(printf '%s' "$node_version" | cut -d. -f1)"
# Fail closed: node_major must be digits only before the numeric comparison.
# An empty or non-numeric value (broken/malicious node) must not silently pass.
case "$node_major" in
  ''|*[!0-9]*) fail "Project Gateway requires Node.js 22 or newer (found ${node_version})." ;;
esac
if [ "$node_major" -lt 22 ]; then
  fail "Project Gateway requires Node.js 22 or newer (found ${node_version})."
fi

# ---- private temporary directory (single EXIT cleanup) -----------------------
base_tmp="${TMPDIR:-/tmp}"
INSTALL_TMP="$(mktemp -d "${base_tmp}/project-gateway-install.XXXXXX")"
cleanup() {
  rm -rf -- "${INSTALL_TMP:?}"
}
trap cleanup EXIT

echo "Project Gateway macOS installer"
echo
echo "Stable release:"
echo "  (resolving...)"

# ---- stable-release parser (Node — no jq prerequisite) ----------------------
cat >"${INSTALL_TMP}/resolve.mjs" <<'EOF'
import { readFileSync } from 'node:fs';
const file = process.argv[2];
let data;
try {
  data = JSON.parse(readFileSync(file, 'utf8'));
} catch (err) {
  console.error('install: could not parse GitHub release metadata: ' + err.message);
  process.exit(1);
}
const tag = data && typeof data.tag_name === 'string' ? data.tag_name : null;
if (tag === null) {
  console.error('install: GitHub release metadata has no tag_name');
  process.exit(1);
}
if (data.draft !== false) {
  console.error(`install: release ${tag} is a draft; refusing`);
  process.exit(1);
}
if (data.prerelease !== false) {
  console.error(`install: release ${tag} is a prerelease; refusing`);
  process.exit(1);
}
const stable = /^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
if (!stable.test(tag)) {
  console.error(`install: release tag '${tag}' is not canonical stable SemVer vMAJOR.MINOR.PATCH`);
  process.exit(1);
}
process.stdout.write(`${tag}\n`);
EOF

# ---- resolve latest stable release (ONE lookup, then frozen) ----------------
curl -fsSL -o "${INSTALL_TMP}/release.json" "${API_URL}"

TAG="$(node "${INSTALL_TMP}/resolve.mjs" "${INSTALL_TMP}/release.json")"
VERSION="${TAG#v}"

# Coarse shell re-validation (Node is authoritative). The release identity is
# data, never executable shell content — this net blocks any injection even if
# the parser had a flaw, before TLS values are interpolated into URLs.
case "$TAG" in
  v[0-9]*.[0-9]*.[0-9]*) ;;
  *) fail "resolved tag '${TAG}' failed stable validation" ;;
esac
case "$VERSION" in
  [0-9]*.[0-9]*.[0-9]*) ;;
  *) fail "resolved version '${VERSION}' failed stable validation" ;;
esac

# ---- everything below derives from the SAME frozen TAG -----------------------
RELEASE_BASE="${REPO_URL}/releases/download/${TAG}"
INSTALLER_URL="${RAW_ROOT}/${TAG}/scripts/install.mjs"
TARBALL_NAME="project-gateway-macos-${VERSION}-darwin-${PLATFORM}.tar.gz"
SIDECAR_NAME="${TARBALL_NAME}.sha256"
TARBALL_PATH="${INSTALL_TMP}/${TARBALL_NAME}"
SIDECAR_PATH="${INSTALL_TMP}/${SIDECAR_NAME}"
INSTALLER_PATH="${INSTALL_TMP}/install.mjs"

echo "  ${TAG}"
echo
echo "Architecture:"
echo "  ${PLATFORM}"
echo
echo "  downloading release assets..."

curl -fsSL -o "${INSTALLER_PATH}" "${INSTALLER_URL}"
curl -fsSL -o "${TARBALL_PATH}"  "${RELEASE_BASE}/${TARBALL_NAME}"
curl -fsSL -o "${SIDECAR_PATH}"  "${RELEASE_BASE}/${SIDECAR_NAME}"

# The installer performs the normative release checksum validation.
node "${INSTALLER_PATH}" "${TARBALL_PATH}" "${SIDECAR_PATH}"

# ---- result (EXIT trap removes INSTALL_TMP) ----------------------------------
BIN_DIR="${HOME}/.local/bin"

cat <<EOF

Project Gateway macOS installed successfully.

Installed:
  pgw ${VERSION} (darwin ${PLATFORM})

Next:

  pgw tunnel
  pgw project add /path/to/project
  pgw up
EOF

if ! printf '%s' "${PATH}" | tr ':' '\n' | grep -Fqx "${BIN_DIR}"; then
  cat <<EOF

${BIN_DIR} is not on your PATH yet. Either:

  export PATH="${BIN_DIR}:\$PATH"

or add that line to your shell profile (e.g. ~/.zshrc) to make it permanent.
EOF
fi
