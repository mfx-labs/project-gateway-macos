# MAC-4C2 — Human X64 Sign-Off Record + MAC-4 Closure

**Baseline:** `4e84b4cf0f38ba1ebf17ed47420bf80c9ae1390e` (exact expected HEAD)
**Date:** 2026-08-16
**Human decision:** `MAC-4 HUMAN X64 SIGN-OFF — APPROVED`

## Slice status (recorded)

| Slice | Evidence | Verdict | Baseline |
|---|---|---|---|
| MAC-4A — Intel native/filesystem acceptance | 101 pass / 0 fail / 0 timeout (native 54/54, ownership 1/1, MAC-3 carry-forward 46/46) | ACCEPTED (senior review) | CLOSED — `8d317545f188e2ec08958ed628161f8112a20885` |
| MAC-4B — live MCP acceptance | 2/2 pass (real stdio persist flow + negative matrix, addon six-export preservation) | ACCEPTED (senior review) | CLOSED — `4e84b4cf0f38ba1ebf17ed47420bf80c9ae1390e` |
| MAC-4C — corrected physical APFS proposal-persistence acceptance | 36 pass / 0 fail / 0 skipped / 0 timeout (run `RPS-MAC-4C-001`) | ACCEPTED (senior review; `MAC-4C SENIOR REVIEW — ACCEPTED`) | this gate |

MAC-4A and MAC-4B are CLOSED and locally baselined at the recorded commits.
MAC-4C is ACCEPTED; its report (`docs/reports/mac-4c1-apfs-round-trip-acceptance.md`)
is committed together with this closure record. The former `MAC-4C1 —
BLOCKED` verdict remains historical only (acceptance-plan mismatch, not a
product failure).

## Human x64 sign-off

The operator reviewed the accepted MAC-4 evidence bundle (MAC-4A, MAC-4B,
MAC-4C) and approved the physical Intel x86_64 acceptance:

`MAC-4 HUMAN X64 SIGN-OFF — APPROVED`

The approved demonstration set:

- real macOS Intel hardware execution;
- native Darwin x64 addon with exactly six exports;
- real filesystem/containment/security behavior;
- live stdio MCP with exactly nine tools;
- real proposal persistence with canonical bytes, service UID, and mode 0600;
- create-only/no-overwrite behavior;
- unknown-workspace fail-closed behavior;
- inspect-changes proposal observation;
- verified registry/audit non-mutation after proposal persistence;
- clean transport/process lifecycle;
- no trusted lifecycle transition introduced by MAC-4.

## MAC-4 corrected acceptance chain (authoritative)

`bootstrap` → optional public `draft-artifact` → `persist-artifact` →
independent APFS verification → public `inspect-changes` proposal
observation → public `inspect-registry` non-mutation check → create-only
conflict / unknown-workspace denial → continuity / clean exit. The persisted
proposal is an untrusted project-visible file; MAC-4 created no trusted
lifecycle transition.

Trusted-record `verify-record` / `inspect-audit-history` sequencing remains
deferred to MAC-6 or another separately authorized trusted-lifecycle gate.

## Lanes, surfaces, and scope

- Physical lane: `darwin-x86_64-posix-utf8-node22` (macOS 12.7.6, Darwin
  21.6.0, Intel x86_64 — evidence is Intel-only).
- Native surface: exactly six exports (`createExclusiveFileAt`, `getPath`,
  `openDirectoryAt`, `openExistingFileAt`, `readDirectoryEntries`,
  `unlinkAt`).
- MCP surface: exactly nine tools (`validate-artifact`,
  `inspect-stored-record`, `inspect-registry`, `inspect-audit-history`,
  `verify-record`, `enumerate-class`, `draft-artifact`, `persist-artifact`,
  `inspect-changes`).
- MAC-5 (Apple Silicon) remains open and runtime-gated by real Apple
  Silicon hardware.
- MAC-6 remains blocked on MAC-5.
- The known Darwin fixture / Linux-only Git / bootstrap-path / Pi-version
  debt remains unrelated and out of scope.
- No push, tag, or release occurred at any point in the MAC-4 chain.

## Decision

All MAC-4 obligations are evidenced, senior-reviewed, and human-approved.
The remaining MAC-4 action is the local baseline closure commit (report-only;
no code, tests, or infrastructure).

**`MAC-4 — READY FOR LOCAL BASELINE CLOSURE`**
