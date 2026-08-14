# MAC-0 — Fork Baseline and Port Contract (Gate Report)

**Verdict: `MAC-0 — LOCALLY BASELINED`**
**Date:** 2026-08-15 (host local time)
**Host:** macOS 12 (Darwin 21.6.0), x86_64 (Intel), Node v22.23.1,
git 2.37.1 (Apple Git-137.1)

---

## 1. Source baseline

| Fact | Value |
|---|---|
| Source repository | `mfx-labs/project-gateway` (`https://github.com/mfx-labs/project-gateway.git`) |
| Required baseline | `55f764290a4567a20557f1db19d2a6fb97572a97` |
| Verified upstream HEAD | `55f764290a4567a20557f1db19d2a6fb97572a97` — **exact match** |
| Baseline commit | `PS-6I: add darwin-x86_64 (macOS Intel) trusted host lane (ADR-043)` (author `ps6i`) |
| Tracked state at baseline | clean (`git status --short` empty) |
| Package identity at baseline | `@project-gateway/artifact-core`, version `0.1.0`, `private: true`, Node `>=22.0.0`, bin `project-gateway-mcp` |
| Nine-tool MCP surface | `validate-artifact`, `inspect-stored-record`, `inspect-registry`, `inspect-audit-history`, `verify-record`, `enumerate-class`, `draft-artifact`, `persist-artifact`, `inspect-changes` (verified in `src/adapters/mcp/{types,drafting,persist,changes}.ts`) |
| Authority boundaries | Trusted host-lane operand (closed accepted set, `src/trusted/host-lane.ts`); host-supplied inspection context only (`src/adapters/mcp/types.ts`); operator-owned startup config (`src/runtime/mcp/config.ts`); create-only write executors (`src/writing/executor.ts`, `src/completion/writer.ts`); read-only Git lane (WP-7); control-plane bootstrap action |

**Path mapping note:** the task's source path `/home/chef/Documents/
Project_Gateway_MCP` is a Linux host path. On this macOS host the
equivalent local extraction is `/Users/serene/Documents/project-gateway`
(a zip export of upstream commit `28f1d3a`, the direct parent of the
baseline — byte-identical tree verified). The authoritative source
repository (upstream) is exactly at the required baseline. The fork was
built from the upstream repository at the exact baseline, preserving
full history. The stale local extraction was NOT used and was NOT
modified; no unrelated untracked evidence files were carried into the
fork.

## 2. Target repository

| Fact | Value |
|---|---|
| Local fork | `/Users/serene/Documents/Project_Gateway_MacOS` |
| Remote `upstream` | `https://github.com/mfx-labs/project-gateway.git` (original Gateway) |
| Remote `origin` | `https://github.com/mfx-labs/project-gateway-macos.git` (intended public repo — **not created, not pushed**) |
| History | Full inherited upstream history preserved (no technical reason to drop it) |
| Fork HEAD at gate | `55f764290a4567a20557f1db19d2a6fb97572a97` (exact authorized baseline) |
| Local commit (this gate) | `docs: establish macOS Gateway fork baseline` (single local commit; full SHA recorded in the MAC-0 gate summary — a commit cannot contain its own SHA) |

No push, tag, publish, release, install, or deploy was performed. The
original Gateway repository was not modified.

## 3. Scope decision

The macOS fork is an independent product line. Priorities: preserve the
Gateway security/authority contract; complete Gateway runtime on macOS;
support BOTH `darwin-x86_64-posix-utf8-node22` and
`darwin-arm64-posix-utf8-node22`; unsupported platforms fail closed;
separately releasable macOS artifact. Full contract:
`docs/macos-product-contract.md`.

## 4. Preserved external Gateway contract

Artifact schemas; validation semantics; trusted lifecycle semantics
(lane-bound configuration identity, cross-lane replay fail-closed);
registry semantics (fixed-lowercase store layout — APFS-compatible per
ADR-042); workspace containment + point-of-use revalidation; Git
read-only behavior (status/diff/log, empty HOME/TMPDIR); structured
artifact writing semantics (create-only, exact bytes, fixed mode);
completion semantics (`already-exact` adoption, typed conflicts); error
taxonomy; MCP protocol behavior; exactly nine public MCP tools (list in
§1). No shell/exec/Git-mutation/approval/issuance/grant/generic-fs
tools. Details and normative invariant list: `docs/macos-product-contract.md`
§3–§4.

## 5. Controlled-write invariants (frozen)

Recovered from `src/writing/executor.ts`, `src/completion/writer.ts`,
and the accepted WP-11/WP-13B reports; the 16-item normative list is in
`docs/macos-product-contract.md` §4. Highlights: descriptor-anchored
mutation; retained root descriptor (`O_RDONLY|O_DIRECTORY|O_NOFOLLOW`);
descriptor-relative parent traversal; no intermediate symlink
following; descriptor-bound parent identity verification; service-user
ownership verification; exactly one final create component; `O_CREAT|O_EXCL`;
`O_NOFOLLOW`; fixed `0o600` mode; descriptor verification of created
objects; bounded exact write; cleanup of only the created object,
through the same verified parent descriptor; no arbitrary caller
absolute path becoming filesystem authority; typed fail-closed errors.
The macOS fork MUST NOT substitute a weaker path-based model.

## 6. Darwin native boundary decision (recorded; NOT implemented in MAC-0)

Approved direction: narrow Darwin native Node-API boundary using
`openat`, `unlinkat`, `fstat`, `fcntl(F_GETPATH)` as required.
Recorded: Node's public fs API is insufficient for the accepted Darwin
contract (no descriptor-relative open, no `F_GETPATH`); `/dev/fd` is
not a replacement for Linux `/proc/self/fd` (Darwin `/dev/fd/N` is a
symlink to the original path — opens re-resolve lexically, reintroducing
the TOCTOU the model eliminates; never use it for security-critical
resolution). The native helper stays narrow and private to the
security-critical boundary. Implementation is MAC-1.

## 7. Distribution direction (frozen)

Prebuilt native binaries: `native/darwin-x64/<addon>.node`,
`native/darwin-arm64/<addon>.node` (conceptual layout; names not
finalized). Runtime selects only the exact matching
platform/architecture; missing/wrong-arch binaries fail closed. No
Xcode/clang/node-gyp/Python/compile-at-install for end users.
Finalization is MAC-7.

## 8. Linux-specific audit (production source)

Classification: **A** = must rewrite for macOS, **B** = already
Darwin-compatible, **C** = unused/test-only, **D** = documentation-only.
Not fixed in MAC-0 (per gate scope).

| # | Location | Finding | Class |
|---|---|---|---|
| 1 | `src/writing/executor.ts` (fdRelativePath, step 2/3, cleanup, `readlinkSync('/proc/self/fd/<fd>')`) | `/proc/self/fd` descriptor-relative opens and resolution-path verification — the entire anchored-write mechanism is Linux-only | **A** |
| 2 | `src/completion/writer.ts` (fdRelativePath, openVerifiedDirectory, `readlinkSync` root + parent verification) | Same `/proc/self/fd` dependency in the completion write path (including EEXIST recovery read) | **A** |
| 3 | `src/reader/fs.ts` (fdPath, listDirectoryEntries `opendirSync('/proc/self/fd/<fd>')`) | Descriptor-relative opens + descriptor-bound directory enumeration — production runtime read path | **A** |
| 4 | `src/trusted/host-lane.ts` | Closed accepted set includes `linux-x86_64-posix-utf8-node22`; mapping accepts linux+x64. Darwin lanes (arm64, x64) already present. Product scope (darwin-only) is MAC-2 | **A** (scope mutation) |
| 5 | `src/runtime/mcp/cli.ts` (host-lane mapping, exit 2) | Accepts linux+x64 today; must fail closed for Linux/Windows under macOS product scope (MAC-2) | **A** (scope mutation) |
| 6 | `process.getuid?.() ?? 0` (`src/writing/executor.ts`, `src/runtime/mcp/config.ts`, `src/storage/root/resolve.ts`, `src/git/host-lane.ts`) | POSIX; present and correct on macOS. `?? 0` fallback is an inherited defensive default | B |
| 7 | `O_NOFOLLOW`/`O_DIRECTORY`/`O_NONBLOCK`/`O_CREAT|O_EXCL` flag usage (executor, writer, reader, probe) | All supported by Node on macOS with the same semantics | B |
| 8 | fstat/fchmod/fsync descriptor verification incl. probe (`src/storage/probe/probe.ts` maps EINVAL directory-fsync → `ERR-STO-FS-UNSUPPORTED`) | POSIX; APFS-compatible; probe already records case-insensitivity as evidence (ADR-042 decisions 3, 10, 11) | B |
| 9 | dev/ino identity (`src/reader/fs.ts` statIdentity, `src/storage/metadata/*`) | Works on APFS; note: APFS inode numbers are 64-bit — `Number(st.ino)` precision beyond 2^53 is a documented caveat to re-examine in MAC-3 verification (identity comparisons stay consistent within one process) | B (caveat) |
| 10 | Git child lane (`src/git/wrapper.ts`, `src/git/host-lane.ts`, `src/runtime/mcp/lanes.ts`, `compose.ts`) | Git is POSIX; empty operator-owned HOME/TMPDIR preprovisioned (no `/tmp` or `os.tmpdir()` assumptions in production code); binary path/version is operator-configured and fingerprint-validated — Darwin-compatible; macOS ships `/usr/bin/git` (Apple build, 2.39.x) — MAC-4/5 evidence must use the real binary | B |
| 11 | Path handling (`path.join`/`resolve`, canonical roots, realpath-style resolution, fixed-lowercase store layout) | POSIX semantics; case-insensitive APFS already accepted (ADR-042 decisions 3–6); no lowercase/case-fold normalization introduced | B |
| 12 | `src/reader/fs.ts` inspectLogicalEntry (`lstatSync` on joined lexical path) | Logical lstat of final component (symlink chains resolved earlier by containment SYM-001..006) — same semantics on macOS | B |
| 13 | Tests referencing `/proc` (`tests/writing/`, `tests/security/`, static guards) | Test-only; they exercise the production boundaries listed in #1–#3 and will port with them in MAC-2/MAC-3 | C |
| 14 | Comments referencing the `/proc/self/fd` lane pattern (`src/writing/types.ts`, `src/writing/controlled-write.ts`, module headers) | Documentation; must be updated when #1–#3 land (MAC-2) | D |
| 15 | ADR-042/043, runbook, WP reports documenting lane set | Documentation; superseded/amended by the macOS product contract (docs only, no protocol change) | D |

**Production paths requiring MAC-1/MAC-2 work (A-class):**
`src/writing/executor.ts`, `src/completion/writer.ts`, `src/reader/fs.ts`,
plus product-scope mutations in `src/trusted/host-lane.ts` and
`src/runtime/mcp/cli.ts`.

No Linux-only syscall flags (`O_TMPFILE`, `O_NOATIME`, `O_DIRECT`,
`RENAME_NOREPLACE`, `fallocate`, `fdatasync`) are used anywhere in
production source. No production `/tmp` or `os.tmpdir()` assumptions.

## 9. Verification (MAC-0 scope only)

| Check | Result |
|---|---|
| Fork tracked state | clean at baseline SHA |
| Remotes | `upstream` → original repo; `origin` → future macOS repo (uncreated) |
| Package identity/config | name/version/bin/engines recorded (§1); unchanged (renames deferred to MAC-2) |
| Nine-tool MCP surface | verified in source (§1) |
| Static source audit | 15 findings classified (§8); no fixes in MAC-0 |
| `git diff --check` | clean (no whitespace errors) |
| Source baseline | upstream HEAD == required SHA, clean tracked state |
| Original repository | not modified |

## 10. Commit

One local commit in the macOS fork (not pushed):

```
`docs: establish macOS Gateway fork baseline` (SHA recorded in the MAC-0 gate summary)

- docs/macos-product-contract.md — frozen product contract
- docs/macos-port-work-packages.md — MAC-0..MAC-7 plan
- docs/reports/mac-0-fork-baseline-and-port-contract.md — this report
```

## 11. Product identity proposal

See `docs/macos-product-contract.md` §7: package
`@project-gateway/macos-core`; bin `project-gateway-macos-mcp`; MCP
server identity derived from package name/version; bootstrap action
`project-gateway-macos-mcp-bootstrap` (after coupling check); product
name "Project Gateway for macOS"; version 0.1.0 until first macOS
release (MAC-7). Protocol identities (schemas, `pgw:` ids, store
layout, lane identifiers, error vocabularies) are NOT renamed.

## 12. Work-package dependency order

`MAC-0 → MAC-1 → MAC-2 → MAC-3 → MAC-4 ─┐  (MAC-5 parallel after MAC-3)
                        └─ MAC-5 ───────┴─→ MAC-6 → MAC-7`

Full definitions (objective, allowed mutations, prerequisites,
acceptance, focused tests, gates): `docs/macos-port-work-packages.md`.

## 13. Apple Silicon availability / blocker status

- **MAC-X64 lane:** host available today (this machine: real macOS
  x86_64, Intel). No blocker.
- **MAC-ARM64 lane:** **Apple Silicon hardware is NOT available on this
  host today.** Recorded as an execution dependency for MAC-5. The
  contract is not weakened: mocked `process.arch` is never sufficient
  evidence; cross-compilation alone is not release verification. MAC-5
  must either run on real arm64 hardware or record the blocker with the
  evidence gap.

## 14. Final verdict

**`MAC-0 — LOCALLY BASELINED`**

- Source baseline: `55f764290a4567a20557f1db19d2a6fb97572a97` (exact).
- New local commit: single docs commit `docs: establish macOS Gateway fork baseline` at fork HEAD (SHA recorded in the MAC-0 gate summary).
- Proposed identity: `@project-gateway/macos-core` /
  `project-gateway-macos-mcp` / "Project Gateway for macOS".
- Supported host lanes: `darwin-x86_64-posix-utf8-node22`,
  `darwin-arm64-posix-utf8-node22`; all else fail closed.
- Linux-specific production paths requiring MAC-1/MAC-2:
  `src/writing/executor.ts`, `src/completion/writer.ts`,
  `src/reader/fs.ts` (native seam); `src/trusted/host-lane.ts`,
  `src/runtime/mcp/cli.ts` (scope enforcement).
- Apple Silicon verification dependency: real arm64 hardware (execution
  dependency for MAC-5; unavailable today).
- Next eligible work package: **MAC-1 — Darwin native filesystem
  primitive**.
