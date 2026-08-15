# MAC-2D-NATIVE — Reader Descriptor-Bound Directory Enumeration (Gate Report)

**Verdict: `MAC-2D-NATIVE — ACCEPTED`** (final durable status, MAC-2D-NATIVE closure gate)
**Closure state: `MAC-2D-NATIVE — LOCALLY BASELINED`**

Closure record (gate chain, 2026-08-15): implementation completed →
`MAC-2D-NATIVE SENIOR REVIEW — ACCEPTED` (independent review; offset
isolation and same-directory anchoring independently proven, bounded
10_000 cap, exact truncation boundaries, fd/DIR ownership exact, five
primitives byte-identical, 175/175 focused tests reproduced on real
Intel) → this local baseline commit. Closure-time handling:

- **INFO-1 (cap drift guard):** one static test added to
  `native/test/enumeration.test.mjs` mechanically asserting
  `WP7_LIMITS.MAX_DIRECTORY_ENTRIES == READ_DIR_ENTRY_CAP == 10_000`
  by recovering both constants from source (no runtime coupling, no
  generated headers). Native test total: 53 → **54** (+1).
- **INFO-2 (memory-bound description):** corrected to
  `sizeof(readdir_entry) == 257 bytes`, `10_000 × 257 ≈ 2.57 MB`,
  bounded at approximately 2.6 MB worst case — conclusion unchanged;
  no implementation change.

- MAC-2D-NATIVE is **locally baselined** in this repository only. No
  push/tag/publish/release/deploy occurred.
- **Reader integration (MAC-2D) has NOT started.**
  `src/reader/fs.ts` and `src/reader/service.ts` are untouched.
- `persist-artifact` is NOT claimed product-E2E fixed (MAC-2F/MAC-2G).

**Original gate record (pre-closure) — historical, not superseded:**
**Date:** 2026-08-15 (host local time)
**Host:** macOS 12 (Darwin 21.6.0, xnu-8020.240.18), x86_64 (Intel),
Node v22.23.1, Apple clang 14.0.0, macOS 12 SDK.
**Starting SHA:** `427616e61706254f985bf4b786599abd9b9ae616` (verified;
tracked working tree clean; rollback report preserved untracked; native
baseline **42 pass / 0 fail**; export surface exactly five functions).

NOT committed. Nothing pushed/tagged/published. `src/reader/**`,
`src/writing/**`, `src/completion/**`, host lanes, runtime composition,
package/product identity, schemas, protocol ids, and the MCP surface are
untouched. Reader integration remains **MAC-2D** (not this gate).
MAC-2A's conclusion stands: exactly ONE reader extension was required —
this is it.

---

## 1. Recovered reader enumeration requirement (from `src/reader/fs.ts`, NOT modified)

`listDirectoryEntries(target, maxEntries)` contract:

- **entry names:** JS strings, Node `Dirent.name` semantics (UTF-8
  decoding with replacement for invalid bytes; no normalization of
  Unicode/case/separators/dot segments — a filename remains a
  filename);
- **kind categories:** exactly four `DirectoryEntry['kindHint']`
  values from `d_type` — `file`, `directory`, `symlink`, `other`;
- **sorting:** JS-side, deterministic UTF-8 byte order (Buffer
  comparison) — NOT a native responsibility;
- **truncation:** JS-side `maxEntries` ceiling; entries beyond it are
  drained (not collected) and `truncated: true` is reported;
- **ceiling:** `WP7_LIMITS.MAX_DIRECTORY_ENTRIES` (see §2);
- **empty directory:** `{ entries: [], truncated: false }`;
- **`.`/`..`:** excluded (Node's `opendirSync` iteration never yields
  them);
- **unknown type:** `other`.

## 2. Authoritative native hard cap — derived, not invented (§3)

`src/reader/types.ts:129` — `WP7_LIMITS.MAX_DIRECTORY_ENTRIES = 10_000`
(the committed WP-7 reader ceiling; the reader service bounds every
`maxEntries` request by it). **The native internal cap is
`READ_DIR_ENTRY_CAP = 10_000`**, derived directly from that already
authorized bound with a source citation in the C code. Because JS
`maxEntries` ≤ 10_000 always, the native cap can never change JS-side
truncation behavior. No bound escalation required; no invented value.

## 3. The sixth primitive — final surface (§4)

`readDirectoryEntries(fd)` — exactly ONE argument: a directory fd.
Result:

```
{ ok: true, entries: [{ name: string, kindHint: 'file'|'directory'|'symlink'|'other' }], truncated: boolean }
{ ok: false, code: NativeFsErrorCode }   // existing closed vocabulary
```

No caller-controlled path/flags/recursion/sort/glob/filter/buffer-size/
mutation option. No generic readdir API.

## 4. Descriptor-offset correction — why plain `dup` was rejected (§5)

`dup(fd)` shares the underlying **open-file description**, including the
directory stream offset. `dup → fdopendir → readdir` twice on one caller
fd would make the second enumeration continue from the first's final
position — consuming caller-visible stream state and returning a partial
second result.

**Chosen mechanism:** `openat(fd, ".", O_RDONLY|O_DIRECTORY|O_NOFOLLOW|
O_CLOEXEC)` — the dot is resolved by the kernel WITHIN the caller's
directory description (same directory object, no pathname, no cwd, no
F_GETPATH/realpath, no `/dev/fd`, no `/proc`), and it produces a NEW
open-file description with independent offset state. Then
`fdopendir(priv)` + bounded `readdir` + `closedir`.

**Real-Intel probe evidence** (scratch probe, not shipped — output
recorded verbatim):

```
A1 dup(fdopendir): 6 entries
A2 dup(fdopendir): 0 entries        <- shared offset consumed
B1 openat(fd,"."): 6 entries
B2 openat(fd,"."): 6 entries        <- independent, complete
after rename+decoy: 6 entries       <- bound to the retained original
                                       (decoy had 2); caller fd still usable
```

The probe exposes exactly the difference the gate requires: with `dup`,
the second enumeration is empty (shared open-file description); with the
chosen private-open mechanism, repeated enumerations are independently
complete. This is also asserted as a REQUIRED acceptance property in the
shipped test suite (§23: repeated calls deep-equal).

## 5. Authority requirements (§6, §20)

No F_GETPATH→opendir, no realpath→opendir, no cwd/chdir, no `/dev/fd`,
no `/proc`, no caller absolute path. Renaming the directory or replacing
its old lexical pathname cannot redirect enumeration (proven: §8).
Pathnames are not authority — the only path-ish input is the kernel
dot, resolved against the fd.

## 6. Directory-stream ownership and cleanup (§7, §12)

- caller fd: never closed, never duplicated, never consumed, never
  passed into a stream;
- private descriptor: created by the primitive; **ownership transfers
  to the `DIR` stream at `fdopendir` success**;
- `fdopendir` failure: the primitive still owns the private fd and
  closes it exactly once;
- after stream acquisition, `closedir` is the ONLY closer and runs
  exactly once on EVERY path: success, `readdir` error, `calloc`
  failure, and every N-API construction failure (`internal_fail` label
  closes the stream and frees the array BEFORE surfacing the
  established internal-failure mechanism — `napi_throw_error` last
  resort, matching MAC-1 discipline);
- no double-close: `close(priv)` never runs after `fdopendir`
  succeeded.

## 7. Native memory bound (§13)

Fixed single allocation: `calloc(READ_DIR_ENTRY_CAP, sizeof(readdir_entry))`
with `readdir_entry { char name[256]; uint8_t kind; }` — `sizeof(readdir_entry)`
is 257 bytes (no padding; alignment 1), so the worst case is
`10_000 × 257 ≈ 2.57 MB` — bounded at approximately **2.6 MB** (INFO-2
correction, closure gate; conclusion unchanged). Derived mechanically from
`cap × bounded_name_size` — no second product-level ceiling invented.
Freed on every path; no linked list, no realloc loop; `count` is
`size_t` with no arithmetic that can overflow (cap is a constant).

## 8. Entry-name handling and kind mapping (§9, §10)

- `d_name` bounds: `d_namlen` (uint16, Darwin) clamped to
  `NAME_BUF-1` (255); NUL-terminated at the clamped length; an embedded
  NUL within `d_namlen` (unreachable from the kernel; defensive) skips
  the entry — no NUL injection into JS;
- names are returned raw (readdir order), byte-exact; conversion is
  `napi_create_string_utf8` — the same UTF-8-with-replacement semantics
  Node's `opendirSync` produces (compatibility with the inherited
  observable name behavior; no normalization);
- `d_type` → kind: `DT_REG→file`, `DT_DIR→directory`, `DT_LNK→symlink`,
  everything else (FIFO/socket/device/unknown) → `other`; symlinks are
  returned as entries and never followed; no stat-per-entry authority
  is gained to classify unknowns.

## 9. Error mapping (§14)

`openat(fd, ".")`/`fdopendir`/`readdir` failures reuse the closed
vocabulary via the existing `map_errno`: `EBADF→invalid-fd`,
`ENOTDIR→not-directory`, `EACCES/EPERM→permission-denied`,
`ENOENT→not-found`, `ELOOP→symlink-refused`, and every other condition
(EMFILE/ENFILE/ENOMEM/EIO/unsupported) → generic `io-failure`. No raw
errno, paths, native strings, or stacks; no Gateway taxonomy expansion.
`errno` is cleared before each `readdir` (no stale-errno false failure).

## 10. Truncation and ordering (§8, §18, §19)

- single bounded pass; `.`/`..` skipped before the cap check;
- off-by-one made explicit: at most `cap` entries collected;
  `truncated: true` iff the directory has MORE than cap entries (the
  (cap+1)-th real entry is observed, then collection stops);
- exactly `cap` → `truncated: false`; `cap-1` → `truncated: false`;
  `cap+1` → exactly `cap` entries + `truncated: true`;
- native does NOT sort, does NOT apply JS `maxEntries`, does NOT
  recurse — raw bounded collection only; the reader's JS keeps its
  deterministic UTF-8 byte-order sort and its own truncation/output
  semantics (MAC-2D).

## 11. Files changed (exact)

| File | Change |
|---|---|
| `native/src/gateway_fs.c` | +172/−2: new `read_directory_entries` primitive (includes, cap derivation, kind mapping, export). The five existing primitives are byte-identical (diff shows only the export-count line and a section-header comment removed) |
| `native/index.d.mts` | +`NativeDirKindHint`, `NativeDirEntry`, `NativeDirectoryEntriesResult`, `readDirectoryEntries` on the addon interface (declaration-only) |
| `native/test/enumeration.test.mjs` | NEW — 11 tests (§23 coverage) |
| `native/test/surface.test.mjs` | six-export set; C-token scan updated: path-based `opendir(` forbidden (word-boundary), `fdopendir/readdir/closedir` required, no `stat(` |
| `native/test/loader.test.mjs` | six-primitive load assertion (unchanged fail-closed behavior: missing/invalid/wrong-arch/unsupported-lane) |

## 12. Real-Intel evidence and test totals (§23, §24)

```
npm run test:native              53 pass / 0 fail   (42 previous + 11 new;
                             54 pass / 0 fail after the closure-gate
                             INFO-1 drift-guard test, +1 — see closure
                             record above)
  - enumeration suite: valid/empty enumeration; kind hints incl. FIFO
    ('other') and a real UNIX socket ('other', never followed); names
    with spaces/punctuation/250-char NAME_MAX-adjacent; dot/dot-dot
    exclusion; repeated-call independence (deep-equal x3); caller fd
    remains valid (getPath after enumeration); rename+decoy-directory
    anchor (6 originals, never the 2 decoy entries); rename+decoy-
    symlink anchor (symlink never followed); closed fd -> invalid-fd;
    regular-file fd -> not-directory; malformed JS matrix + wrong
    arity -> invalid-input, process survives; truncation boundaries
    (10_000 exact -> not truncated; 10_001 -> exactly 10_000 entries +
    truncated:true); fd-leak stability (300 enumerations, no growth);
    memory-bound sanity (500 x 200-char names, byte bound asserted).
git diff --check                  clean
```

All security-significant tests exercise the REAL native x64 addon on
this physical Intel Mac. No mocked enumeration/fd-ownership/rename/
truncation/d_type semantics anywhere.

## 13. Build records (§25, §26)

| Artifact | Architecture | SHA-256 (one-off) |
|---|---|---|
| `native/darwin-x64/gateway_fs.node` | Mach-O 64-bit bundle x86_64 | `4b109a8566a223baf5946d432a984d64994124c2b5c4da929da61ad1dc8ca8d8` |
| `native/darwin-arm64/gateway_fs.node` | Mach-O 64-bit bundle arm64 | `2f68e0113961330ead3ef82ebc8b475ff6036a6a8d0460927580c6320b778642` |

Both: linked dylibs `libSystem.B` + `libc++` only; exported native
symbols exactly `_napi_register_module_v1` and
`_node_api_module_get_api_version_v1`; JS-visible API exactly six
functions (asserted). The arm64 binary is BUILD evidence only: `dlopen`
on this Intel host refuses it (incompatible architecture), and the
loader/wrong-arch test exercises the REAL arm64 binary in the x64 slot
and fails closed. MAC-5 owns real Apple Silicon execution. SHA
non-reproducibility (F-2) remains a known non-blocking issue; no
byte-for-byte equality claimed.

## 14. Security review (§27)

- **shared-directory-offset bugs:** none — private open-file
  description via `openat(fd,".")`; probe + repeated-call tests prove
  independence;
- **caller fd consumption:** impossible — the caller fd is only the
  `openat` dirfd argument; never closed/duped/streamed;
- **fdopendir ownership:** private fd transfers to the stream at
  success; `close(priv)` only in the fdopendir-failure path;
- **double-close:** `closedir` exactly once per path; no `close(priv)`
  after stream acquisition;
- **private fd leak:** every path closes the stream or the private fd;
  fd-leak stability test (300 calls) green;
- **readdir errno:** cleared before each call; NULL+errno → typed
  failure; NULL+0 → EOF;
- **unbounded allocation:** fixed `cap × 257` ≈ 2.57 MB, freed on every
  path; no realloc/list;
- **integer overflow:** cap constant; `size_t` counts; `namlen` clamped
  to 255; `(uint32_t)i` index ≤ 10_000;
- **malformed d_name:** clamped length, embedded-NUL skip, explicit
  NUL termination, no read past `dirent` name storage;
- **N-API partial-result leaks:** every status checked; failure closes
  stream + frees array before surfacing the internal mechanism;
- **path reconstruction:** none — no F_GETPATH/realpath/cwd; the only
  input is the kernel dot;
- **symlink following / stat authority:** none — `d_type` only, no
  `stat(` in the source (asserted);
- **surface expansion:** exactly one new export; mutation primitives
  unchanged (diff-reviewed).

## 15. MAC-2A clarification (implementation-level correction, not a
history rewrite)

MAC-2A's §4 sketch mentioned `dup + fdopendir` as the likely mechanism.
MAC-2D-NATIVE corrects that at the implementation level: **`dup` shares
the open-file description; MAC-2D-NATIVE therefore required an
independently opened descriptor-bound enumeration handle**
(`openat(fd, ".")`), proven empirically (§4). The overall MAC-2A
conclusion — exactly one reader extension required — is unchanged.

## 16. Explicit non-integration

- `src/reader/fs.ts` and `src/reader/service.ts` are NOT modified;
  reader integration is **MAC-2D** and has NOT begun;
- `persist-artifact` remains not claimed product-E2E fixed;
- remaining slices: MAC-2D (reader integration), MAC-2E, MAC-2F,
  MAC-2G.

**Verdict: `MAC-2D-NATIVE — READY FOR SENIOR REVIEW`** — exactly one new
native capability; enumeration is descriptor-bound (kernel-dot open,
never a pathname); caller fd remains caller-owned and unconsumed
(probe + tests); enumeration is bounded (authoritative 10_000 cap
derived from `WP7_LIMITS.MAX_DIRECTORY_ENTRIES`); rename/replacement
cannot redirect it; the error vocabulary stays closed; the existing five
primitives are byte-identical; 53/53 native tests pass on real Intel;
x64 and arm64 candidates build correctly; no scope drift.
