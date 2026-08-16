# MAC-4A — Intel Native and Filesystem Acceptance

**Verdict:** `MAC-4A — READY FOR SENIOR REVIEW`

## Scope and freeze

- **Exact HEAD:** `60bd5597a788e435882c6ce5a9de32fd451a356d`
- **Production changes:** none. This gate adds this evidence report only.
- **Starting tracked state:** clean; the pre-existing untracked `.DS_Store`
  remains outside this gate.
- **Not started:** live MCP acceptance, APFS end-to-end round-trip,
  MAC-4B, MAC-4C, MAC-5, release, tag, push, and publication.

## Physical Intel host and lane

| Probe | Observed value |
|---|---|
| macOS | 12.7.6 (21H1320) |
| Kernel | `Darwin 21.6.0 x86_64` |
| Hardware | MacBookPro13,3; Intel Core i7; 4 cores; 16 GB (`system_profiler SPHardwareDataType`) |
| Node | v22.23.1; `process.platform=darwin`; `process.arch=x64` |
| Native binary | `native/darwin-x64/gateway_fs.node`: Mach-O 64-bit bundle x86_64 |
| Product lane | `darwin-x86_64-posix-utf8-node22` |

The real-host native primitive test asserts `darwin` + `x64`; the product's
shared `trustedHostLaneForPlatformArch(process.platform, process.arch)`
mapping accepts this exact lane. The mapping is intentionally platform/arch
only. The process-local `locale charmap` was `US-ASCII`; it is not an input
to that accepted-host mapping.

Selected compiled test artifacts were newer than each corresponding source,
and the x64 addon binary was newer than `native/src/gateway_fs.c`, before
execution.

## Bounds and accounting discipline

The corrected MAC-3E4 process-group watchdog was inspected before use. Its
two behavioral checks completed as required:

| Check | Observed result |
|---|---|
| `/tmp/watchdog.sh 5 /usr/bin/true` | exit 0 in 0.110 s; no artificial wait |
| `/tmp/watchdog.sh 2 /bin/sleep 30` | exit 124 in 2.986 s; process-group termination |

Each acceptance command below was run once with that watchdog's 90-second
ceiling. The suites' own child-process bounds (15–20 s where applicable)
also kill and reap on expiry. No acceptance command reached its ceiling.

## Native x64 and real filesystem boundary

`/tmp/watchdog.sh 90 npm run test:native` completed on the physical host:

| Suite | PASS | FAIL | CANCELLED | SKIPPED | TIMEOUT |
|---|---:|---:|---:|---:|---:|
| `native/test/*.test.mjs` | 54 | 0 | 0 | 0 | 0 |

The runtime load test opened the real x64 Mach-O addon and verified its closed
six-export surface exactly:

`createExclusiveFileAt`, `getPath`, `openDirectoryAt`,
`openExistingFileAt`, `readDirectoryEntries`, `unlinkAt`.

The same 54-test native run exercised, on temporary real-host filesystem
fixtures: descriptor-relative traversal and retained-fd anchoring across
rename/replacement; no-follow symlink rejection; exact typed failure results;
exclusive creation without overwrite; fixed `0600` creation under different
umasks; descriptor path identity; and reader enumeration re-anchoring,
non-consumption, bounds, and fd stability.

The one necessary production completion test was selected without running its
unrelated APFS/E2E cases:

| Selected test | PASS | FAIL | CANCELLED | SKIPPED | TIMEOUT |
|---|---:|---:|---:|---:|---:|
| `WP-13B: containment/ownership/path revalidation failures are typed` | 1 | 0 | 0 | 0 | 0 |

It uses the real filesystem and verifies a wrong `serviceUid` fails closed as
`result.write-ownership-mismatch`; the native result above independently
verifies fixed `0600` creation. Together these directly cover the required
service-owner and permission checks.

### Observed diagnostic failure, attributed

The first sandboxed diagnostic run was **53 pass / 1 fail / 0 cancelled /
0 skipped / 0 timeout**. Its only failure was the enumeration socket-kind
fixture: Python `AF_UNIX.bind` returned `EPERM`. The same sandbox also denied
direct `sysctl` reads. This was attributed to the execution sandbox, not the
addon: the authorized unsandboxed physical-host rerun above passed the socket
fixture and the complete native suite (54/0/0/0/0). No correction was made.

## MAC-3 physical-host carry-forward

Only the real-filesystem MAC-3 evidence needed for the accepted 42/0/0 matrix
was rerun. MAC-3B harness self-tests were not rerun because they are explicitly
test-infrastructure rather than closure evidence. `mac3e-mcp-two-session` was
not run: MAC-4A prohibits live MCP acceptance.

| Slice and command target | Physical evidence | PASS | FAIL | CANCELLED | SKIPPED | TIMEOUT |
|---|---|---:|---:|---:|---:|---:|
| MAC-3C: `mac3c-executor-hostile`, `mac3c-completion-hostile` | retained descriptor traversal; parent identity; symlink/FIFO rejection; exclusive create and recovery; verified-parent cleanup; exact typed outcomes | 22 | 0 | 0 | 0 | 0 |
| MAC-3D: `mac3d-reader-hostile`, `mac3d-service-hostile` | reader descriptor identity; final symlink rejection; root replacement; re-anchored enumeration; service `ERR-CON-DENIED`, `ERR-NOT-FOUND`, `ERR-FTYPE-UNSUPPORTED` | 15 | 0 | 0 | 0 | 0 |
| MAC-3E1: `mac3e-concurrency` | separate-process same-destination race: exactly one creation, typed losers, no overwrite | 3 | 0 | 0 | 0 | 0 |
| MAC-3E2: `mac3e-fd-pressure` | isolated EMFILE: typed fail-closed result, no partial object, exact post-release recovery | 3 | 0 | 0 | 0 | 0 |
| MAC-3E3 filesystem-only: `mac3e-churn` | concurrent mixed/root/file churn: confined writes and reads; decoys never receive authority | 3 | 0 | 0 | 0 | 0 |
| **MAC-3 carry-forward total** | | **46** | **0** | **0** | **0** | **0** |

These real-Intel results preserve the accepted **42 PROVEN / 0 PARTIAL /
0 UNPROVEN** MAC-3 matrix for the filesystem/native boundary. They are a
focused carry-forward, not a rerun of the unrelated full regression.

No `race-writer`, `pressure-consumer`, `child-actor`, or
`project-gateway-macos-mcp` process remained after the suites.

## Decision

Physical Intel x64 native/filesystem acceptance is green: **101 pass /
0 fail / 0 cancelled / 0 skipped / 0 timeout** across the actual acceptance
runs. Existing durability, Git, bootstrap-path, and Pi-version debt was not
run or changed because it does not prevent this MAC-4A obligation.

This evidence is Intel-only. Apple Silicon physical acceptance remains MAC-5.

MAC-4A — READY FOR SENIOR REVIEW
