# Physical Reboot Acceptance — Summary

Product: **Project Gateway for macOS (standalone `pgw` operator)**

## Accepted baseline
- Code HEAD: `ddb49b31de205e37a467f32e8f64f00ea74a789d`
- Product version: `0.1.0`
- Physical host: macOS Intel x86_64 (2026-08-20)

## Project identity
- Pre/post reboot project ID: `pgw:w:5b57bf91f6203408c79c087c2c2595d6`
- Canonical project path: `/Users/serene/.pgw-reboot-acceptance/workspace/reboot-project` (isolated acceptance HOME)
- Acceptance HOME: `/Users/serene/.pgw-reboot-acceptance` (isolated via `HOME`; real user Gateway locations remained absent/untouched)

## Persistence evidence (Phase A vs Phase B)
- Registry/store/config metadata SHA-256 remained **byte-identical** across reboot and across all post-reboot Gateway commands (`doctor`, `start`).
- dev/ino values **remained unchanged** on this reboot (device `16777224`, all inodes identical).

## Device-drift classification
- `NO PHYSICAL st_dev DRIFT OBSERVED ON THIS REBOOT`
- S1 synthetic/regression coverage remains the evidence for deliberate device drift; physical reboot persistence still passed.

## Post-reboot Gateway verification
- `pgw doctor`: **passed** (exit 0) against the persisted pre-reboot store, read-only — did not rewrite metadata.
- `pgw --version`: `pgw 0.1.0 (darwin x64)`.
- `pgw list`: same single project ID/path, no re-add.
- MCP initialize: **passed**; server identity `@project-gateway/macos-core` v0.1.0.
- Exactly **9 tools** exposed:
  `draft-artifact, enumerate-class, inspect-audit-history, inspect-changes, inspect-registry, inspect-stored-record, persist-artifact, validate-artifact, verify-record`.
- `pgw start`: accepted the same persisted store; **did not rewrite/recreate metadata** (no replacement namespace).

## Uninstall
- `pgw uninstall` removed the installed runtime and acceptance `pgw` link, and **preserved** registry, state, initialized store, project, artifacts, and evidence files.

## Verdict
`PHYSICAL REBOOT ACCEPTANCE PASSED — STANDALONE PGW PRODUCT ACCEPTED`
