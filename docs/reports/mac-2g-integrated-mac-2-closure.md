# MAC-2G — Integrated MAC-2 Closure (Gate Report)

**Verdict: `MAC-2G — READY FOR SENIOR CLOSURE REVIEW`** (historical
implementation verdict — see Durable status below)
**Closure claim: `MAC-2 PRODUCTION INTEGRATION — READY TO CLOSE`**
(historical; superseded by `MAC-2 PRODUCTION INTEGRATION — CLOSED` below)
**Date:** host local time at gate execution
**Host:** macOS 12.6 (Darwin 21.6.0, xnu-8020.240.18.709.2), x86_64
(Intel), Node v22.23.1, Git 2.37.1 (Apple Git-137.1).
**Starting SHA:** `6dc92b70b8475d54f5613ffb720e024f6a64c49a` (verified:
`test: prove real Intel MCP persist` — tracked working tree clean; only
`docs/reports/mac-2-aborted-gate-rollback.md` untracked, preserved).

READ-ONLY closure gate: **zero production/test source changes**.

## Durable status (MAC-2G documentation correction — final closure)

**Senior closure review: `MAC-2G SENIOR CLOSURE REVIEW — CORRECTIONS
REQUIRED`** (historical; two MINOR documentation findings) →
**`MAC-2G SENIOR CLOSURE REVIEW — ACCEPTED AFTER DOCUMENTATION
CORRECTION`** · **`MAC-2 PRODUCTION INTEGRATION — CLOSED`**

Full gate chronology preserved:
1. MAC-2G implementation — `MAC-2G — READY FOR SENIOR CLOSURE REVIEW`;
2. senior closure review — `CORRECTIONS REQUIRED` (FINDING-1 MINOR
documentation: §5 enumeration ownership wording; FINDING-2 MINOR
documentation: §10/§11 durability-failure chronology);
3. documentation correction (this addendum):
   - **FINDING-1 = CLOSED** (documentation-only) — §5 now states
     directory enumeration uses `openat(fd, ".")` to create an
     independent directory descriptor consumed by `fdopendir`/
     `readdir`/`closedir`, caller fd never consumed, plain `dup`
     rejected (shared stream offset); no mention of plain `dup`
     remains;
   - **FINDING-2 = CLOSED** (documentation-only) — §10/§11 now state
     the 82 durability failures are a **pre-existing Darwin fixture
     incompatibility exposed by the accepted descriptor-identity
     contract**: the fixture spelling is pre-existing, the
     `result.write-parent-not-verified` failure mode was introduced by
     the accepted MAC-2C F_GETPATH identity implementation failing
     closed against non-canonical test roots; production roots are
     realpath-canonical; the same mechanism succeeds with canonical
     roots (proven by construction); MAC-2F E2E provides production
     evidence; NOT a production implementation defect. No blanket
     "all 96 pre-existing" assertion remains; classes 2–4 (Linux-only
     Git path, bootstrap-action `/var` fixtures, Pi 0.83.0 vs 0.84.1)
     remain correctly classified as genuinely pre-existing;
4. accepted after documentation correction; final local closure
   commit `docs: close macOS production integration` (parent
   `6dc92b70b8475d54f5613ffb720e024f6a64c49a`).

**FINDING-3 (INFO, carried non-blocking test-infra debt):** WP-7 runner
manifest accounting staleness — reader expected 62 vs actual 68
(MAC-2D added anchors ×5 + fd-stability ×1 without manifest update);
security accounting is Linux-shaped (expects 39 zero-skip; Darwin
executes 40 with 3 documented `/proc` platform-skips). Bounded
test-infrastructure debt; production impact = zero; future smallest
correction is test-only (`scripts/run-wp7-tests.mjs` manifest); does
not block MAC-2 closure. NO correction in this gate.

**Implementation finding ledger: CRITICAL 0 · HIGH 0 · MODERATE 0 ·
MINOR implementation 0.** No production or test source changed in
MAC-2G (documentation-only delta). MAC-3 not started.

---

## 1. MAC-2 ancestry / baseline chain (verified by `git rev-parse`, not report text)

| Slice | Commit | Parent (verified) |
|---|---|---|
| MAC-2A | `82d742ef18467527f42be32b0bb92e1154073b05` | `235af7f…` (MAC-1) |
| MAC-2B | `47a4ec7dc7bebf540bad7e4385c527f9ee9b02f6` | `82d742e…` |
| MAC-2C | `427616e61706254f985bf4b786599abd9b9ae616` | `47a4ec7…` |
| MAC-2D-NATIVE | `1de9737f7454d4a9e1beb327d7d51c806e734ce7` | `427616e…` |
| MAC-2D | `82096dcde6e3655cd667defbd6dccc6d78fe9c87` | `1de9737…` |
| MAC-2E | `65f1a31f08268b48080a5c1c211d54b3ed2beef2` | `82096dc…` |
| MAC-2F | `6dc92b70b8475d54f5613ffb720e024f6a64c49a` | `65f1a31…` |

Linear, unmodified history; no rewrite; HEAD == MAC-2F commit.

## 2. Slice-by-slice disposition

| Slice | Durable verdict (report) | Findings | MAC-2G disposition |
|---|---|---|---|
| MAC-2A | `INTEGRATION PLAN READY` (audit) | — | Reconciled: plan executed as audited |
| MAC-2B | senior review `ACCEPTED`; `LOCALLY BASELINED` | none | CLOSED |
| MAC-2C | senior review `ACCEPTED`; `LOCALLY BASELINED` | INFO-1 test-count transcription corrected | CLOSED |
| MAC-2D-NATIVE | senior review `ACCEPTED`; `LOCALLY BASELINED` | INFO-1 cap-drift guard; INFO-2 memory-bound wording | CLOSED |
| MAC-2D | F-1 MODERATE fd leak → corrected → focused rereview `ACCEPTED`; `LOCALLY BASELINED` | **F-1 CLOSED** (regression locked in `tests/wp7/reader/fd-stability.test.ts`; reproduced 160-fd growth pre-correction) | CLOSED |
| MAC-2E | FINDING-1 MODERATE (documentation, Node-lane overclaim) → correction → `ACCEPTED`; `LOCALLY BASELINED` | **FINDING-1 CLOSED** (documentation/comment-only; no runtime Node policy added) | CLOSED |
| MAC-2F | senior review `ACCEPTED`; `LOCALLY BASELINED` | zero findings | CLOSED |

**Finding ledger: unresolved CRITICAL/HIGH/MODERATE/MINOR implementation
findings = 0.** (One MINOR test-infrastructure accounting item was newly
surfaced by this closure gate — reported, not fixed; see §9. It is not an
implementation finding.)

## 3. Final native surface

Exactly SIX JS-visible exports (verified in `native/src/gateway_fs.c`
`napi_define_properties(…, 6, …)` and asserted in
`tests/runtime/mac2f-e2e.test.js`):

`openDirectoryAt`, `createExclusiveFileAt`, `openExistingFileAt`,
`unlinkAt`, `getPath`, `readDirectoryEntries`

No seventh primitive exists.

## 4. Filesystem security boundary — final integration state

| Consumer | State (verified) |
|---|---|
| Writing executor | descriptor-relative parent traversal; F_GETPATH identity verification (`verifyParentIdentity`); exclusive create via `createExclusiveFileAt` (fixed 0600); descriptor-relative cleanup via `unlinkAt`; **zero active `/proc`** (static guard green) |
| Completion writer | descriptor-relative create; exact-existing recovery through fixed no-follow/nonblock `openExistingFileAt`; recovery observational only; descriptor-relative cleanup; **zero active `/proc`** (only a doc comment naming the replaced mechanism at `writer.ts:271`) |
| Reader | descriptor-relative file/directory open; raw-fd ownership (sync close sites); S-07 dev/ino verification via `fstat`; descriptor-bound `readDirectoryEntries` enumeration; deterministic JS sorting; truthful maxEntries/truncation composition; **zero active `/proc`** |
| Darwin adapters | `src/internal/darwin-fs/` narrow capability bridges: no `/proc`, `/dev/fd`, no generic fs authority (static guards green) |

No pathname-authority fallback exists in any active macOS production path
(§13 audit).

## 5. Descriptor ownership state

Accepted lifetime semantics verified present and guarded by committed
tests: executor fd ownership (root/parent/create fds closed on all
paths, single `cleanupCreatedTarget`); completion writer fd ownership
(descent chain, recovery fd inner-finally); reader raw-fd ownership with
every `OpenedTarget` close site sync-closed; borrowed root fd semantics;
directory-enumeration private descriptor ownership: `openat(fd, ".")`
creates an independent directory descriptor; `fdopendir`/`readdir`/
`closedir` consume and close only that private descriptor; the caller
fd is never consumed; plain `dup` was rejected because it shares the
directory stream offset); MAC-2D F-1 failure-path cleanup
(`closeOpened(opened)` before both formerly-leaking returns — regression
locked in `tests/wp7/reader/fd-stability.test.ts`, green in this gate).
No new lifetime policy invented.

## 6. Product-vs-protocol identity (final)

**PRODUCT:** package `@project-gateway/macos-core`; bin
`project-gateway-macos-mcp`; MCP server `@project-gateway/macos-core`
/ `0.1.0`; in-process bootstrap provenance
`project-gateway-macos-mcp-bootstrap`; product-supported current-host
lanes exactly `darwin-x86_64-posix-utf8-node22` and
`darwin-arm64-posix-utf8-node22`.

**PROTOCOL (unchanged):** lane literals
`darwin-x86_64-posix-utf8-node22`, `darwin-arm64-posix-utf8-node22`,
`linux-x86_64-posix-utf8-node22`; `project-gateway-operator-bootstrap`;
schemas; `pgw:` identities; digest domain separator
`PGAP-TRUSTED-CONFIG-v1\0`; store identity; error vocabulary.

`node22` is the inherited frozen opaque protocol label (PS-6R); MAC-2
introduces **no** exact runtime Node-version enforcement (FINDING-1
corrected; identity tests assert the derivation consumes
`process.platform` + `process.arch` only).

## 7. Platform evidence

### Intel/x86_64 (real runtime evidence)
Native addon (Mach-O x86_64), native tests 54/54, executor, completion
writer, reader, stdio MCP, operator bootstrap, trusted composition,
`persist-artifact` real APFS persistence — all exercised on this host in
MAC-2F and re-confirmed in MAC-2G (integrated run + fresh E2E).

### Apple Silicon/arm64 (limited, build-only)
`native/darwin-arm64/gateway_fs.node` exists: **Mach-O 64-bit bundle
arm64** (architecture verification only). Loader selection contract
(`SUPPORTED_ADDON_LANES = ['darwin-x64','darwin-arm64']`) and wrong-arch
fail-closed (`invalid-addon`) are covered by `native/test/loader.test.mjs`.
**Real Apple Silicon runtime acceptance is NOT part of MAC-2** — MAC-5
owns it. No dual-lane runtime acceptance is claimed.

## 8. Public MCP surface

Exactly NINE tools over the real session (asserted in MAC-2F E2E and the
runtime static guard, both green in this gate):

`validate-artifact`, `inspect-stored-record`, `inspect-registry`,
`inspect-audit-history`, `verify-record`, `enumerate-class`,
`draft-artifact`, `persist-artifact`, `inspect-changes`

No macOS-specific tenth tool; no debug/native/bootstrap tool exposed;
schemas and authorization behavior unchanged (zero server.ts diff across
MAC-2).

## 9. Finding ledger — full reconciliation

| ID | Slice | Severity | Status |
|---|---|---|---|
| F-1 (fd leak, descent failure paths) | MAC-2D | MODERATE | CLOSED (correction + rereview + locked regression) |
| FINDING-1 (Node-lane enforcement overclaim) | MAC-2E | MODERATE (documentation) | CLOSED (doc/comment-only) |
| INFO-1 (test-count transcription) | MAC-2C | INFO | corrected at closure |
| INFO-1 (cap-drift guard), INFO-2 (memory-bound wording) | MAC-2D-NATIVE | INFO | corrected at closure |
| INFO-1 (/proc process-table platform skips) | MAC-2D | INFO | documented; Darwin skips intentional |

**FINDING-3 (INFO — carried non-blocking test-infrastructure debt;
NO correction in this gate):** the WP-7 runner manifest
  `scripts/run-wp7-tests.mjs` `EXPECTED_COUNTS` is stale for the reader
  suite: it expects 62, but MAC-2D added exactly 6 tests
  (`anchors.test.ts` ×5 + `fd-stability.test.ts` ×1) without updating
  the manifest; the suite itself executes 68/68 PASS on this host. The
  same manifest is Linux-shaped for security (expects 39 zero-skip;
  Darwin executes 40 with the 3 documented `/proc` platform-skips, 37
  pass / 0 fail). Owning slice: **MAC-2D**. Smallest correction gate:
  a test-only manifest update (MAC-2D adjunct or MAC-3 preparation).
  Zero production impact; not an implementation defect; the wp7 suites
  themselves are green (reader 68/68, fff 26/26, security 37 pass/0
  fail/3 documented skips). Reported here for senior disposition rather
  than silently fixed.

## 10. Integrated regression — authoritative default workflow

`npm test` (clean:generated → build → tsc tests → wp7 discovery guard →
full node --test inventory) + `npm run test:native` + `scripts/run-wp7-tests.mjs`:

| Component | Result |
|---|---|
| Default node --test inventory (unit, integration, security, pi-adapter, mcp, runtime, drafting, writing, trusted, pointofuse-v2) | **2398 tests: 2302 pass / 96 fail** — all 96 classified (§11): 82 = pre-existing Darwin fixture incompatibility EXPOSED by the accepted descriptor-identity contract (class 1); 14 = genuinely pre-existing (classes 2–4) |
| Conformance corpus (3 lanes) | **648/648 × 3** (linux default, darwin-arm64, darwin-x86_64) + all digest/oracle recomputation green |
| MAC-2F real E2E (in integrated run) | 3/3 pass |
| wp14b E2E | 4/4 pass |
| runtime stdio / server / static guards (incl. nine-tool guard) | green |
| host-lane / identity suites | green (14 + 7) |
| F-1 fd-stability regression | green |
| Native suite | **54/54 pass** |
| WP-7 runner: reader / fff / security / git | 68/68 / 26/26 / 37 pass + 3 documented skips / 26 pass + 3 fail + 12 cancelled (git = Linux-only `GIT_BIN` class, §11) |
| Build + test typecheck | green |
| `git diff --check` | clean |

## 11. Known baseline/environment issues (explicit, separated)

The 96 failures fall into four classes with **distinct chronologies**. Classes 2–4 are genuinely pre-existing (affected files byte-identical across the entire MAC-2 chain). Class 1 is a **pre-existing Darwin fixture incompatibility exposed by the accepted descriptor-identity contract** — its failure mode did not exist before MAC-2C:

1. **82 durability-suite failures** (`tests/unit/wp13-durability-s3-outcome-production` ×37, `wp13-durability-s3-wp13c-precondition` ×22, `wp13c-publication` ×19, `wp15-phase1a-outcome-resultless` ×3, `wp13-durability-s4-retrospective-derivation` ×1) — all with the identical code `result.write-parent-not-verified`. Chronology: the fixture incompatibility is pre-existing (non-canonical Darwin `/var/folders/…` spelling, `/var` being a symlink on macOS); the specific `result.write-parent-not-verified` failure mode was **exposed by the accepted MAC-2C descriptor-identity implementation** (F_GETPATH root-identity verification), which fails closed against a non-canonical test fixture exactly as the **accepted MAC-2A W2 semantic** requires ("MAC-2C must verify this on real hosts and fail closed otherwise"). Production trusted roots are realpath-canonical, so this is expected fail-closed behavior against a non-canonical TEST fixture — **not a production implementation defect**. **Proven by construction:** the same production completion/write identity mechanism with a realpath-canonical root → `SUCCESS (created)`; non-canonical → `parent-not-verified`. MAC-2F's real persist E2E provides production-path evidence using canonical roots. NOT fixed in MAC-2G.
2. **11 changes-suite failures** (`tests/mcp/unit/changes.test.js`) — `spawnSync /home/chef/.local/git-2.45.4/bin/git ENOENT`: Linux-only hard-coded Git path (byte-identical across MAC-2). Same class in `tests/wp7/git/git.test.ts` (3 fail + 12 cancelled: ENOENT + pinned 2.45.4 expectation). NOT fixed.
3. **2 bootstrap-action failures** — the documented `/var` vs `/private/var` baseline issue (19/21). NOT fixed.
4. **1 Pi compatibility failure** — `F8: real Pi 0.83.0 path supplied explicitly is accepted`: installed environment is Pi 0.84.1 (expected `@earendil-works/pi-coding-agent` at the pinned 0.83.0 layout). Byte-identical at the MAC-2E baseline; pure environment mismatch. NOT fixed; test not modified.

No failure outside these classes exists. No failure was hidden or skipped.

## 12. Fresh real Intel MCP persist E2E (integrated closure evidence)

One fresh cycle of `tests/runtime/mac2f-e2e.test.js` at closure:
**3/3 PASS** — real operator bootstrap (derived sha-256 config identity),
real stdio MCP child, server identity `@project-gateway/macos-core`
/ `0.1.0`, exactly nine tools, `persist-artifact` success through the
public schema, descriptor-bound Darwin writer reached (x64 addon,
six-export assertion), resulting file regular / inside workspace /
mode 0600 / uid 501 / canonical bytes, conflict `write-denied` with no
overwrite, unknown workspace `write-denied`, server healthy after
rejections, clean EOF exit, zero stderr, fixture removed.

## 13. Static `/proc` / fallback audit

Across active production macOS paths (writing executor, completion
writer, reader, Darwin adapters, runtime persist path): **zero** active
`/proc/self/fd`, `/dev/fd`, fd-relative lexical pathname reconstruction,
readlink-based fd authority, pathname reopen from F_GETPATH, or pure-JS
native fallback. The only remaining `/proc` text in production is one
doc comment in `src/completion/writer.ts:271` naming the replaced
mechanism. Committed static guards assert the executor and adapters
contain no `/proc`/`/dev/fd`/generic-fs vocabulary (green in this gate).

## 14. Repository hygiene

- `git status`: only the MAC-2G report untracked (this file) + the
  preserved `docs/reports/mac-2-aborted-gate-rollback.md` (intentionally
  untracked; not staged).
- No dist artifacts or `.node` binaries tracked beyond the three
  pre-existing pi-adapter fixture packages (intentional fixtures).
- No test tmp directories, no lingering MCP child processes, no stray
  store/workspace fixtures, no unexpected modified files.
- WP-7 runner preserved-output dirs (OS tmp) removed after inspection.

## 15. Exact closure claims and non-claims

**MAC-2G concludes:** `MAC-2 PRODUCTION INTEGRATION — READY TO CLOSE` —
the accepted Darwin native seam is integrated into all required
production consumers (executor, completion writer, reader); macOS
product scope/identity established; real physical Intel stdio MCP
persist flow works; all correction-worthy MAC-2 findings closed; no
unresolved MAC-2 implementation finding exists (one MINOR test-infra
accounting item reported for senior disposition, §9).

**This does NOT mean:** MAC-3 hostile security/race verification
complete; Intel final physical acceptance complete; Apple Silicon
runtime acceptance complete; dual-lane acceptance complete;
distribution/release readiness complete; macOS Gateway release complete.

**Explicit:** no native surface change (six exports); no MCP tool-surface
change (nine tools); no production or test source change in MAC-2G;
MAC-3/MAC-4/MAC-5 not started; nothing committed, pushed, tagged, or
released.

**Verdict: `MAC-2G — READY FOR SENIOR CLOSURE REVIEW`** (historical)
**`MAC-2 PRODUCTION INTEGRATION — READY TO CLOSE`** (historical)
**Final: `MAC-2G SENIOR CLOSURE REVIEW — ACCEPTED AFTER DOCUMENTATION
CORRECTION` · `MAC-2 PRODUCTION INTEGRATION — CLOSED`** (see Durable
status above).
