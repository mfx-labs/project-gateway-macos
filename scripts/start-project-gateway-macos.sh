#!/usr/bin/env bash
#
# Manual foreground startup of the configured macOS Project Gateway tunnel.
#
# Thin compatibility/fallback wrapper ONLY. The canonical implementation is the
# `pgw up` operator command. This script does NOT independently resolve
# tunnel-client, inspect the tunnel profile, read the Keychain, or reconstruct
# tunnel arguments — it just delegates to `pgw up`, which performs the full
# foreground launch:
#
#   interactive Terminal -> pgw up -> tunnel-client run --profile project-gateway -> pgw start
#
# Foreground only (Ctrl+C stops). No autostart, no background supervision.
set -euo pipefail

PGW="${PGW_UP_PGW:-$HOME/.local/bin/pgw}"
if [[ ! -x "$PGW" ]]; then
  echo "error: pgw not found at $PGW — install/configure Project Gateway pgw first" >&2
  exit 1
fi

exec "$PGW" up
