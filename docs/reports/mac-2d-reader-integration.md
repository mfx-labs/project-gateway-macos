# MAC-2D — Reader Integration (Gate Report)

**Verdict: `MAC-2D — ACCEPTED`** (final durable status, MAC-2D closure gate)
**Closure state: `MAC-2D — LOCALLY BASELINED`**

Closure record (gate chain, 2026-08-15): implementation completed →
`MAC-2D SENIOR REVIEW — CORRECTIONS REQUIRED` (one actionable finding:
**F-1 — MODERATE — fd leak on descent failure paths** in
`descentAndOpen`; INFO-1 platform-skip wording) → `MAC-2D F-1 — READY
FOR FOCUSED REREVIEW` (correction above) → `MAC-2D F-1 FOCUSED
REREVIEW — ACCEPTED` (independent repro: 160 failure iterations, zero
fd growth, inherited codes unchanged, process usable; collateral
behavior verified unchanged) → this local baseline commit.

- **F-1 status: CLOSED.** `closeOpened(opened)` runs before both
  formerly-leaking failure returns; regression test
  (`tests/wp7/reader/fd-stability.test.ts`) verified to fail
  pre-correction (160 leaked fds) and pass post-correction.
- **Platform-skip clarification (INFO-1):** the three `/proc`
  process-table tests are Linux-only evidence; on Darwin they are
  skipped with reason and NO Darwin process-table evidence is claimed.
- **Cumulative MAC-2D focused evidence: 249 pass / 0 fail /
  3 platform-skipped.** Correction-gate rerun (reader 29 + anchors 5 +
  fd-stability 1 + FFF 26 + WP7 security 37): **98 pass / 0 fail /
  3 platform-skipped**.
- MAC-2D is **locally baselined** in this repository only. No
  push/tag/publish/release/deploy occurred.
- **MAC-2E (Darwin-only scope + product identity) has NOT started.**
- `persist-artifact` is NOT claimed product-E2E fixed (MAC-2F/MAC-2G).

**Original gate record (pre-closure) — historical, not superseded:**
**Date:** 2026-08-15 (host local time)
**Host:** macOS 12 (Darwin 21.6.0), x86_64 (Intel), Node v22.23.1.
**Starting SHA:** `1de9737f7454d4a9e1beb327d7d51c806e734ce7` (verified;
tracked working tree clean; rollback report preserved untracked; native
suite green; JS-visible native surface exactly six functions;
`src/reader/**` unchanged at baseline).

NOT committed. Nothing pushed/tagged/published. The native C addon and
its export surface are UNCHANGED (no seventh primitive); writing
executor, completion writer, host lanes, runtime composition, package/
product identity, schemas, protocol ids, and MCP registration are
untouched. `src/fff/provider.ts` is unchanged (verified: FFF consumes
only the reader service). MAC-2E has not begun; `persist-artifact` is
still not claimed product-E2E fixed.

---

## 1. R1–R8 mapping (as executed)

| # | Operation | Inherited Linux mechanism (removed) | Darwin implementation (now) |
|---|---|---|---|
| R1 | Root bind | Node `fsOpen(root, O_RDONLY\|O_DIRECTORY)` FileHandle | **unchanged, stays Node** (only `.fd` + `.close()` are used) |
| R2 | openForRead | `fsOpen('/proc/self/fd/<rootFd>/<relative>', O_RDONLY\|O_NONBLOCK)` | descriptor-relative single-component descent + final `openExistingFileAt` (fixed `O_RDONLY\|O_NOFOLLOW\|O_NONBLOCK`); fstat regular-file gate unchanged |
| R3 | openForListDirectory | `fsOpen('/proc/self/fd/…', O_RDONLY\|O_DIRECTORY)` | descent + final `openDirectoryAt`; fstat directory gate unchanged |
| R4 | inspectLogicalEntry | lexical `lstatSync(join(rootPath, relative))` | **unchanged** (logical-entry semantics; reports the symlink itself) |
| R5 | statResolvedTarget | `statSync(resolvedAbsolutePath)` | **unchanged** (S-07 accepted-target evidence) |
| R6 | Descriptor identity | `fstatSync` dev/ino + `verifyDescriptorIdentity` | **unchanged** (`bindDescriptor` now reads `target.fd`) |
| R7 | readFileBytes | `FileHandle.read(buf, 0, maxBytes, 0)` | raw-fd `readSync(target.fd, buf, 0, maxBytes, 0)` — identical single bounded read at offset 0, same truncation semantics |
| R8 | listDirectoryEntries | `opendirSync('/proc/self/fd/<fd>')` + JS sort + JS maxEntries | native `readDirectoryEntries(target.fd)` + JS sort + JS maxEntries (see §6) |

**Mapping clarification (recorded, MAC-2A history not rewritten):** the
MAC-2A R2/R3 table assumed the containment canonical relative is
symlink-free. It is not: `canonicalWorkspaceRelativePath` is the LEXICAL
relative (`combined.relative`), and the reader's inherited contract
(SYM-006, WP-7 contract §5.1; reader test "follows a symlink inside the
workspace") opens final/intermediate in-workspace symlinks, with S-07
dev/ino verification as the backstop. The seam's fixed O_NOFOLLOW cannot
express that. **The descent base is therefore the containment-RESOLVED
canonical relative** — derived from the decision's realpath-canonical
`resolvedAbsolutePath` (symlink-free by construction; prefix-exact
against the canonical root; `''` for the root itself) — while the
lexical relative remains the correlation path. This preserves the
reader's EXTERNAL contract exactly (in-workspace symlink reads succeed
with the target's content — proven by the green symlink test) and makes
every seam O_NOFOLLOW flag the strict post-revalidation guard (a swapped
symlink now fails at open with the inherited `not-found` mapping —
earlier fail-closed timing, identical taxonomy, exactly what MAC-2D §5/§16
describe). No native change was required; the six-function surface is
sufficient.

## 2. Reader adapter (`src/internal/darwin-fs/reader.ts`)

Read-only, reader-position-aware, no node:fs surface:

- `openDirectoryAtReader(parentFd, component, notDirectory)` — single
  openat step; the `notDirectory` code carries the inherited ENOTDIR
  mapping per operation (read → `not-found`, list →
  `unsupported-type`; inherited openForRead vs openForListDirectory
  errno tables differ — MAC-2A §14's "do not reuse mappings blindly").
- `openExistingFileAtReader(parentFd, component)` — final file open
  (fixed flags); `not-directory` → `not-found` (inherited read table).
- `readDirectoryEntriesReader(fd)` — bounded enumeration; native
  failures → `error`/`permission-denied` (unreachable in the integrated
  flow; surfaced via the inherited throw-shaped path).
- `isRootTarget(relative)` — root-target detection (`relative === ''`).
- `mapReaderOpen` — closed native→reader mapping; unknown → `error`.

No absolute paths, no arbitrary flags/modes, no mutation, no generic
open/unlink, no F_GETPATH-as-authority (the reader never calls getPath),
no `/proc`, no `/dev/fd`, no fallback pathname reopening.

## 3. Raw-fd ownership model (§7, §8, §22)

`OpenedTarget` is now `{ fd, ownsFd, relative, kind, flags…, close() }`:

- **`ownsFd: true`** (native-opened targets): `close()` closes the raw
  fd exactly once (once-guard); every service close site is the single
  method `openResult.target.close()` (6 sites: list ×2, read-text ×2,
  read-bytes ×2 — binding-failure and finally paths).
- **`ownsFd: false`** (the root-target case, `relative === ''` — reachable
  via the FFF provider's `.` root listing): the target BORROWS the cached
  root fd; `close()` is a no-op; the root fd remains owned by the
  workspace-root cache. The inherited Linux open of `/proc/self/fd/N/`
  produced a fresh descriptor; on Darwin no fresh root descriptor is
  obtainable without a seventh primitive, and borrowing is behaviorally
  identical (list of the root succeeds; a read of the root still fails
  closed as `unsupported-type` on the non-regular fstat).
- `bindDescriptor` reads `fstatSync(target.fd)`; `readFileBytes` reads
  `readSync(target.fd, …)`; the root FileHandle (`bindWorkspaceRoot`)
  keeps its own `handle.close()` and is never passed to `closeSync`.

Close-site disposition (every `.handle.close().catch()` replaced):
service binding-failure paths (3), service operation-finally paths (3),
fs.ts fstat/classification failure paths (now `closeFd` before typed
returns).

**F-1 correction (senior review — MAC-2D FOCUSED CORRECTION):** the
original MAC-2D report claimed "descent failure paths (intermediates
closed on every path)". That claim was FALSE as reviewed: the two
failure returns of `descentAndOpen` (intermediate descent failure and
final-open failure) returned typed codes WITHOUT closing the
successfully opened intermediate fds recorded in `opened` — one leaked
fd per failed open. Root cause: cleanup existed on the success path and
the defensive catch path only. Correction: a single `closeOpened(opened)`
helper now runs before BOTH failure returns (and replaces the success/
catch-path loops); each intermediate fd closes exactly once; the root fd
is never closed; the final fd is never closed on the final-open failure
path (no final fd exists); success-path ownership and the returned error
codes are byte-for-byte unchanged. Regression evidence: a new focused
fd-stability test (`tests/wp7/reader/fd-stability.test.ts`) repeats both
failure shapes (80 iterations each: `a/b/file.txt` with `b` missing;
`a/nope.txt` with the final target missing), asserts no fd-count growth
and the inherited `not-found` codes, and proves the process remains
usable afterwards. Verified to FAIL against the pre-correction code
(160 leaked fds) and PASS post-correction.
New wp7 security guard: forbids `/proc/self/fd`, `/dev/fd`,
`opendirSync`, `target.handle`, `handle.read`, `readlinkSync` in
reader fs/service code (comment-stripped scan; the root FileHandle
`handle.close` remains legitimate and is asserted out of the forbidden
set); requires `closeSync`, `readSync`, `readDirectoryEntries`,
`ownsFd`; asserts the service has no `.handle` surface.

## 4. Native → reader error mapping (§14)

| Native code | read descent/intermediate | read final | list descent/final | enumeration |
|---|---|---|---|---|
| `not-found` | `not-found` | `not-found` | `not-found` | `error` (unreachable) |
| `not-directory` | `not-found` | `not-found` | `unsupported-type` | `error` |
| `symlink-refused` | `not-found` | `not-found` | `not-found` | n/a |
| `permission-denied` | `permission-denied` | `permission-denied` | `permission-denied` | `permission-denied` |
| `invalid-fd`/`invalid-input`/`unsupported`/`io-failure`/unknown | `error` | `error` | `error` | `error` |

The inherited reader vocabulary (`not-found`, `permission-denied`,
`unsupported-type`, `error` → contract errors) is preserved exactly;
native internal codes never escape public results.

## 5. S-07 preservation (§15)

Unchanged: `statResolvedTarget(resolvedAbsolutePath)` + `statIdentity(fstatSync(target.fd))` +
`verifyDescriptorIdentity` (dev/ino/type) immediately after open, before
any read/list; mismatch → `ERR-CON-DENIED` with the target closed.
Proven by the inherited reader suite (identity-binding failures green)
and the new pre-open symlink-swap test (fails closed at the open with
`not-found`, decoy never read — the S-07 check remains as defense for
post-open swaps).

## 6. Sorting, maxEntries, and native-truncation combination (§11, §12, §13)

`listDirectoryEntries`: native raw entries → **unchanged deterministic
UTF-8 byte-order JS sort** (identical comparator) → JS `maxEntries`
slice → `truncated = raw.truncated || sorted.length > maxEntries`.

Truth-table (native cap 10_000 ≥ maxEntries ≤ 10_000 always):

| Case | raw.truncated | sorted.length vs maxEntries | reported truncated |
|---|---|---|---|
| A. dir < maxEntries | false | ≤ | false |
| B. maxEntries < dir < 10_000 | false | > | true |
| C. exactly maxEntries | false | = | false |
| D. exactly 10_000 (maxEntries < 10k / = 10k) | false | > / = | true / false |
| E. > 10_000 | true | ≥ (10_000) | true |

The reader never reports `truncated:false` when unseen entries exist.
kindHint passes through the native four-kind vocabulary untouched
(`file`/`directory`/`symlink`/`other`; no stat-per-entry, no fifth
category). The native-truncated integration is covered by the reader
suite's FFF budget test (10k-entry tree) and by the native 10_000/10_001
boundary tests (MAC-2D-NATIVE); a real >10k enumeration through the
reader service is exercised by the FFF budget-exhaustion test.

## 7. Anchor evidence (§17, §18) — real Intel, integrated path

New `tests/wp7/reader/anchors.test.ts` (5 tests, all through
openForRead/openForListDirectory/readFileBytes/listDirectoryEntries on
the real seam):

- file-read: rename + decoy-directory replacement AFTER open → bytes
  come from the retained original (`ORIGINAL-BYTES`), decoy bytes never
  returned;
- file-read: symlink-to-decoy replacement after open → read stays bound
  to the retained original;
- directory-list: rename + decoy replacement after open → entries from
  the retained original (4 originals), no decoy entry;
- directory-list: symlink-to-decoy replacement after open → enumeration
  stays in the retained original;
- pre-open symlink swap → fails closed at the descriptor-relative open
  (`not-found`), decoy never read (earlier-fail-closed vs Linux's
  post-open S-07 rejection).

## 8. FFF impact (§20)

`src/fff/provider.ts` — **zero production changes** (verified: FFF
consumes only the reader service). Its discovery suite
(`tests/wp7/fff/fff.test.js`, 26 tests) passes unchanged on the
integrated reader. The root-listing path (`relative === ''`) used by FFF
is covered by the reader suite's "lists the workspace root via . token".

## 9. `/proc` audit (§21)

`src/reader/**` and compiled `dist/reader/*.js`: **ZERO active** `/proc/self/fd`,
`/dev/fd`, `opendirSync`, `readlinkSync`, fd-relative lexical path
builders, F_GETPATH-feed-reopen, arbitrary native flags, or path-based
fallback. Remaining mentions are accurate history comments only
("opendirSync previously threw here too"). Verified in source and
compiled output.

## 10. Files changed (exact)

| File | Change |
|---|---|
| `src/reader/fs.ts` | R2/R3/R7/R8 migration; OpenedTarget raw-fd ownership model; descentAndOpen; root-borrow case |
| `src/reader/service.ts` | resolved-relative computation at 3 open sites; 6 target close sites → `target.close()`; bindDescriptor → `target.fd` |
| `src/internal/darwin-fs/reader.ts` | NEW — reader adapter (see §2) |
| `tests/wp7/reader/anchors.test.ts` | NEW — 5 integrated anchor tests (§7) |
| `tests/wp7/reader/fd-stability.test.ts` | NEW (F-1 gate) — focused descent failure-path fd-stability regression (§3) |
| `tests/wp7/helpers.ts` | fixture roots realpath-canonical (pre-existing Darwin fixture bug class, same as MAC-2B/C); git binary path now host-resolvable (`WP7_GIT_BINARY ?? /usr/bin/git` — the hardcoded Linux `/home/chef/...` path could never run on this host) |
| `tests/wp7/security/security.test.ts` | new raw-fd ownership guard (§3); 3 Linux-only `/proc` process-table tests skipped on non-Linux (INFO-1 toned down: on Darwin these tests are skipped and NO Darwin process-table evidence is claimed — the no-lingering-git-children property is verified by the `/proc`-based tests on the Linux lane only) |

## 11. Focused verification — exact totals (real Intel)

```
tests/wp7/reader/reader.test.js        29 pass / 0 fail   (R1–R8 integration,
                                                           symlink contract green)
tests/wp7/reader/anchors.test.js        5 pass / 0 fail   (anchor sanity)
tests/wp7/reader/fd-stability.test.js   1 pass / 0 fail   (F-1 regression, §3)
tests/wp7/fff/fff.test.js              26 pass / 0 fail   (FFF unchanged)
tests/wp7/security/security.test.js    37 pass / 0 fail / 3 skipped
                                    (Linux-only /proc child-process tests;
                                     raw-fd ownership guard green)
tests/writing/*                        63 pass / 0 fail   (shared-dir guard walk)
tests/unit/wp13b-*                     34 pass / 0 fail
npm run test:native                    54 pass / 0 fail   (seam unchanged)
git diff --check                       clean
```

Total: **249 pass / 0 fail / 3 platform-skipped** (F-1 gate: +1 fd-stability regression). No host-lane work, no
MAC-2E, no runtime MCP E2E, no full historical regression.

## 12. Security review highlights

- shared adapter/exclusion: the writing static guard walks
  `src/internal/darwin-fs/` and covers the new reader adapter
  (I/O-free, no generic authority) — green;
- raw-fd ownership: single `close()` method with once-guard; borrowed
  root target explicitly marked `ownsFd: false`; no FileHandle/raw-fd
  mixing (type shape + guard);
- enumeration failure path throws through the inherited shape (never
  exposes native codes; unreachable in practice);
- resolved-relative derivation is prefix-exact against the canonical
  root (containment guarantees containment; a mismatch would produce a
  wrong relative and fail closed at open — no path escape is possible
  because the derivation never escapes the root prefix).

## 13. Explicit non-claims

- native seam unchanged; no seventh primitive;
- MAC-2E not started;
- `persist-artifact` still not claimed product-E2E fixed;
- remaining slices: MAC-2E (darwin-only scope + product identity),
  MAC-2F (runtime composition + real Intel MCP persist),
  MAC-2G (integrated closure).

**Verdict: `MAC-2D — READY FOR SENIOR REVIEW`** — R1–R8 implemented;
zero active `/proc` dependency; raw-fd ownership complete and leak-free;
file reads and directory listings descriptor-bound (anchors green);
`readDirectoryEntries(fd)` integrated with deterministic JS sorting and
truthful truncation combination; S-07 identity checks intact; reader/
FFF/security focused suites pass on real Intel (249 pass / 0 fail); the
native seam is byte-identical to the MAC-2D-NATIVE baseline; no scope
drift.
