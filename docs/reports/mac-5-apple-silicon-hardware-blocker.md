# MAC-5 — Apple Silicon Hardware Blocker Record

**Baseline:** `dc5f92b5b24d8866a82ad06530b1807637d1493f` (exact expected HEAD)
**Date:** 2026-08-16
**Known condition:** REAL APPLE SILICON HARDWARE = UNAVAILABLE

This gate is documentation-only. No arm64 physical acceptance was run; no
Apple Silicon runtime evidence is claimed from Intel execution, Rosetta, a
VM, emulation, a simulator, or a cross-build.

## 1. Prerequisite state

| Gate | Status | Local baseline commit |
|---|---|---|
| MAC-1 Darwin native filesystem primitive | CLOSED | `235af7f` |
| MAC-2 production integration | CLOSED | `1685bd7` |
| MAC-3 hostile-race verification | CLOSED | `60bd559` |
| MAC-4 Intel physical acceptance | CLOSED | `dc5f92b` (this HEAD) |

MAC-5 is otherwise prerequisite-satisfied (MAC-1/MAC-2/MAC-3 per the
work-packages contract). The single missing dependency is physical execution
on real Apple Silicon hardware, which is unavailable on this host (macOS
12.7.6, Intel x86_64, MacBookPro13,3). Per the accepted contract, the
blocker is recorded and the contract is NOT weakened.

## 2. Current arm64 preparation state (PREPARATION ONLY)

- `native/darwin-arm64/gateway_fs.node` EXISTS: Mach-O 64-bit bundle arm64,
  newer than `native/src/gateway_fs.c`.
- Build support exists: `npm run build:native:arm64` →
  `scripts/build-native.mjs arm64` (explicitly documented as a
  cross-build candidate).
- Loader support exists: `native/index.mjs` selects exactly
  `native/darwin-arm64/gateway_fs.node` for `darwin-arm64`, fail-closed
  (`unsupported-platform` / `missing-addon` / `invalid-addon`), no fallback.
- Classification: the arm64 binary is a **PREPARATION / CROSS-BUILD
  CANDIDATE**, not physical acceptance evidence — identical to the accepted
  MAC-1 §11 classification ("BUILD ARTIFACT ONLY — not runtime evidence").
  It has never been executed on real Apple Silicon hardware.

## 3. Unavailable acceptance evidence (not claimed)

- real Darwin arm64 host execution;
- native arm64 addon execution;
- real filesystem/security behavior on Apple Silicon;
- live MCP persist on Apple Silicon;
- x64↔arm64 cross-lane replay evidence;
- human arm64 sign-off.

## 4. Preserved invariants

- Native public seam = six exports (`createExclusiveFileAt`, `getPath`,
  `openDirectoryAt`, `openExistingFileAt`, `readDirectoryEntries`,
  `unlinkAt`) — unchanged.
- MCP public surface = nine tools — unchanged.
- No contract weakening: no Rosetta/VM/emulation/cross-build evidence
  substitution, no acceptance criteria relaxed.
- MAC-6 is NOT STARTED.

## Decision

**`MAC-5 — BLOCKED ON REAL APPLE SILICON HARDWARE`**

**`MAC-6 — BLOCKED ON MAC-5`**

Nothing was committed, pushed, tagged, or released by this gate.
