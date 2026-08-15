# MAC-1 — Darwin Native Filesystem Primitive (Gate Report)

**Verdict: `MAC-1 — ACCEPTED`** (final durable status, MAC-1 closure gate)
**Closure state: `MAC-1 — LOCALLY BASELINED`**

Closure record (gate chain, 2026-08-15): `MAC-1 — READY FOR SENIOR
REVIEW` → `MAC-1 SENIOR REVIEW — CORRECTIONS REQUIRED` (finding
**F-1 — MODERATE — caller-controlled creation mode**) → `MAC-1
CORRECTION — READY FOR FOCUSED REREVIEW` (correction in §16) →
`MAC-1 FOCUSED REREVIEW — ACCEPTED` → this local baseline commit.

- F-1 is fully closed: `createExclusiveFileAt(parentFd, component)`
  (exact arity 2); the only creation mode reaching `openat` is the
  literal `0600`; no caller-controlled mode path remains.
- The native primitive is **accepted and locally baselined** in this
  repository only. No push/tag/publish/release/deploy occurred.
- **MAC-2 production integration has NOT started**:
  `src/writing/executor.ts`, `src/completion/writer.ts`,
  `src/reader/fs.ts`, runtime composition, and host-lane selection
  remain on the inherited Linux model; `persist-artifact` is NOT fixed.
- Apple Silicon runtime evidence remains **MAC-5**; the arm64 candidate
  is a cross-compiled build artifact only.
- INFO findings F-2..F-5 (Mach-O ad-hoc signature SHA
  non-reproducibility, cosmetic test-count documentation, lockfile
  normalization, `openExistingFileAt` directory fd rejected by
  downstream descriptor verification) remain non-blocking; F-2
  disposition belongs to MAC-7.

**Original gate record (pre-closure) — historical, not superseded:**
**Date:** 2026-08-15 (host local time)
**Host:** macOS 12 (Darwin 21.6.0), x86_64 (Intel), Node v22.23.1,
Apple clang 14.0.0, MacOSX.sdk (CommandLineTools), python3 3.13.1,
node-gyp 13.0.1 (devDependency, build-host only).
**Starting SHA:** `7e0ee2748bc9ba05da24f119264424ccd903e4a9` (verified
before this gate; working tree clean apart from removed Finder
`.DS_Store` noise).

No commit was created. No push/tag/publish/release/deploy. The upstream
Linux Gateway repository was not touched. Gateway production paths
(`src/writing/executor.ts`, `src/completion/writer.ts`,
`src/reader/fs.ts`, runtime MCP composition, host-lane selection) were
NOT integrated — see §14.

---

## 1. MAC-0 `/dev/fd` documentation erratum (corrected)

`docs/macos-product-contract.md` §5 previously characterized `/dev/fd/N`
as a usable symlink path whose child traversal merely re-resolves
lexically. Empirical check on this host (recorded here, not in the
escalation history):

```
open('/dev/fd/<fd>/child')      -> ENOENT (no directory-fd-relative traversal)
readlink('/dev/fd/<fd>')        -> EINVAL (no descriptor-path identity)
after renaming the directory:   -> readlink still EINVAL; child open still ENOENT
```

The contract wording was corrected to the empirical facts:
`/dev/fd/<fd>/<child>` did not provide directory-fd-relative traversal
on the tested macOS host, `readlink('/dev/fd/<fd>')` did not provide the
required descriptor-path identity, and therefore `/dev/fd` cannot
replace Linux `/proc/self/fd` for this security boundary. Recorded as a
**documentation erratum** — the decision itself (never use `/dev/fd` for
security-critical resolution) is unchanged. No architectural change; the
historical escalation report was not rewritten.

## 2. Native API surface (closed set; every export justified)

Exact exported symbols of `native/darwin-x64|arm64/gateway_fs.node`
(verified enumerable; static surface test enforces the list):

| Export | Signature | MAC-2 consumer (inherited contract) |
|---|---|---|
| `openDirectoryAt` | `(parentFd: number, component: string) -> {ok:true, fd} \| {ok:false, code}` | Anchored parent traversal — executor step 2, completion writer `openVerifiedDirectory` descent (`O_RDONLY\|O_DIRECTORY\|O_NOFOLLOW` on each component relative to the retained descriptor) |
| `createExclusiveFileAt` | `(parentFd, component) -> {ok:true, fd} \| {ok:false, code}` | Create-only final step — executor step 3, writer final create (`O_CREAT\|O_EXCL\|O_WRONLY\|O_NOFOLLOW`, exactly one final component). Creation mode is HARDCODED to `0600` inside the seam (F-1 correction); the caller cannot supply a mode |
| `openExistingFileAt` | `(parentFd, component) -> {ok:true, fd} \| {ok:false, code}` | EEXIST recovery read — completion writer `readExistingForRecovery` type-inspection open. **Fixed flags only** (`O_RDONLY\|O_NOFOLLOW\|O_NONBLOCK`); no caller-controlled flags, so it is not a generic open |
| `unlinkAt` | `(parentFd, component) -> {ok:true} \| {ok:false, code}` | At-most-one-attempt cleanup of the created object — executor step 6, writer cleanup (`unlinkat`, flags 0; **no** `AT_REMOVEDIR`, so no directory deletion capability) |
| `getPath` | `(fd) -> {ok:true, path} \| {ok:false, code}` | Descriptor-bound parent identity (`parent-not-verified` semantics) — executor SYM-009 check, writer resolution-path verification (`fcntl(fd, F_GETPATH)`) |

Every export has an inherited MAC-2 consumer; none was added speculatively.
Deliberately ABSENT (fails closed by absence): absolute-path open/unlink
(initial canonical root open stays in Node — the inherited code already
anchors the root with `openSync(root, O_RDONLY|O_DIRECTORY|O_NOFOLLOW)`),
mkdir, rename, chmod, chown, readdir, recursive deletion, symlink
creation, shell/exec/subprocess. No path normalization,
canonicalization, globbing, or multi-component traversal anywhere; every
path-bearing operation accepts EXACTLY ONE final component.

## 3. Node-API version choice

Pinned `NAPI_VERSION=8` (`native/binding.gyp` defines). Rationale: N-API
8 has been stable and ABI-stable since Node 12.17/14.x and is fully
supported by the Node 22.x generation required by the product lanes; the
addon needs nothing newer. No experimental Node-API features are used
(no `napi_add_finalizer`-adjacent experimental APIs, no
experimental async work). Deliberately conservative: a narrow sync
primitive needs the smallest stable surface. C surface only
(`<node_api.h>`); no V8, no Node internal C++, no libuv, no NAN, no
runtime FFI.

## 4. Syscall mapping

| Primitive | Syscall | Flags | Notes |
|---|---|---|---|
| `openDirectoryAt` | `openat` | `O_RDONLY\|O_DIRECTORY\|O_NOFOLLOW\|O_CLOEXEC` | Relative to supplied fd; never cwd/root; no final-symlink follow. `O_CLOEXEC` added as hygiene (no fd inheritance into Git children); does not alter Gateway semantics |
| `createExclusiveFileAt` | `openat` | `O_CREAT\|O_EXCL\|O_WRONLY\|O_NOFOLLOW\|O_CLOEXEC`, mode fixed to `0600` (F-1) | Caller supplies NO mode; the seam owns the mode completely. Existing object of ANY kind → `exists` |
| `openExistingFileAt` | `openat` | `O_RDONLY\|O_NOFOLLOW\|O_NONBLOCK\|O_CLOEXEC` | FIFO can never block the open; fstat/uid verification stays in Node (Gateway) |
| `unlinkAt` | `unlinkat` | flags `0` | No `AT_REMOVEDIR`: directories cannot be removed through this seam (Darwin `EPERM` → `permission-denied`). EINTR retried |
| `getPath` | `fcntl(fd, F_GETPATH)` | — | Bounded `PATH_MAX` (1024) stack buffer; no heap allocation; NUL-bounded conversion; missing terminator → typed `io-failure` |

All three `openat`/`unlinkat` paths retry on `EINTR` (one logical
operation). Observed Darwin nuance (recorded from real host tests):
`openat(O_RDONLY|O_DIRECTORY|O_NOFOLLOW)` on a symlink-to-directory
fails with `ENOTDIR` (not `ELOOP`) on this Darwin; a symlink final
component without `O_DIRECTORY` yields `ELOOP`. Both map to closed
fail-closed codes (`not-directory` / `symlink-refused`) — the refusal
property is what matters, and both codes are deterministic.

## 5. Native input validation (fail closed)

At the native boundary, a single component rejects: empty string; `.`;
`..`; any `/` (embedded separators and multi-component spellings);
embedded NUL; non-string values; wrong argument count; strings whose
byte length cannot be represented safely in the bounded `PATH_MAX`
stack buffer (rejected as `invalid-input` before any syscall).
Backslash is a legal POSIX filename character and is intentionally NOT
rejected natively (tested); the inherited Gateway lexical guard
(`validateComponent` in `src/writing/executor.ts`) continues to reject
it at the JS layer, unchanged.

fd arguments: JS number only (no coercion), integral, `0..INT32_MAX`;
NaN/±Infinity/negative/non-integral/oversized → `invalid-input`
(or `invalid-fd` for valid-number-but-bad-fd results from the syscall).
There is no mode argument (F-1): `createExclusiveFileAt` is arity 2 and
any third argument is rejected by the normal wrong-arity path.

Higher-level containment remains Gateway's responsibility (unchanged).

## 6. fd ownership and lifetime (explicit)

- **Incoming fds are caller-owned.** The addon never closes, duplicates,
  or retains them; no state survives across calls (the addon is
  stateless).
- **A newly opened fd becomes caller-owned ONLY on successful return.**
- **Internal fds:** none exist beyond the syscall result being returned;
  if result-object construction fails after a successful `openat`, the
  created fd is closed before the error is surfaced (see
  `result_ok_fd`).
- **On failure:** no fd is created or leaked.
- **On exception:** the only throwing path is internal
  result-construction failure (allocation-level), and it closes the
  created fd first; malformed inputs never throw (typed results).
- **Leak evidence:** the malformed test suite includes a 200-iteration
  fd-count stability check (no growth) and closes every fd returned by
  the 500-iteration randomized fuzz loop.

## 7. Error boundary (closed internal vocabulary)

`{ok:false, code}` with a closed enumeration, mapped deterministically
from errno; unknown errno → `io-failure` (generic fail-closed). No
errno numbers, absolute paths, stack traces, or native error strings are
ever exposed. Vocabulary: `not-found`, `exists`, `not-directory`,
`symlink-refused`, `permission-denied`, `read-only`, `no-space`,
`quota`, `unsupported`, `invalid-fd`, `invalid-input`, `io-failure`.
Mapping table: `ENOENT→not-found`, `EEXIST→exists`, `ENOTDIR→not-directory`,
`ELOOP/EMLINK→symlink-refused`, `EACCES/EPERM→permission-denied`,
`EROFS→read-only`, `ENOSPC→no-space`, `EDQUOT→quota`,
`EOPNOTSUPP/ENOTSUP→unsupported`, `EBADF→invalid-fd`,
`EINVAL/ENAMETOOLONG→invalid-input`, default→`io-failure`.
MAC-2 maps these into the inherited externally visible Gateway
vocabularies (e.g. `exclusive-create-conflict`, `parent-not-verified`,
`missing-parent`, …) without exposing internal codes.

## 8. Files changed (this gate; NOT committed)

```
docs/macos-product-contract.md           erratum only (§1)
native/binding.gyp                       NAPI_VERSION=8, -std=c11 -Wall -Wextra
native/src/gateway_fs.c                  the primitive (single C file, ~430 lines)
native/index.mjs                         fail-closed loader (native seam packaging)
native/test/primitives.test.mjs          17 real-Intel primitive tests
native/test/anchors.test.mjs             3 race/anchor probes (rename + replacement)
native/test/loader.test.mjs              9 loader fail-closed tests
native/test/surface.test.mjs             3 static API-surface checks
native/test/malformed.test.mjs           6 malformed-input/fuzz/leak tests
scripts/build-native.mjs                 build + stage + digest (x64 | arm64)
package.json                             devDependency node-gyp 13.0.1; scripts
                                         build:native, build:native:arm64, test:native
package-lock.json                        node-gyp devDependency resolution
.gitignore                               native/build/, native/darwin-*/*.node
                                         (review diff stays source-only; distribution
                                         packaging of prebuilt binaries is MAC-7)
```

No Gateway production source was modified. No broad Gateway test suite
was run (production code unchanged; that is the MAC-2/MAC-3 surface).

## 9. Intel build evidence (real hardware)

- Host: macOS 12 (Darwin 21.6.0) x86_64, Apple clang 14.0.0, macOS 12
  SDK, Node v22.23.1.
- Command: `node scripts/build-native.mjs x64`
  (`node-gyp --directory native rebuild --arch x64`; headers resolved
  from the local Node install; zero compiler warnings under
  `-Wall -Wextra`).
- Artifact: `native/darwin-x64/gateway_fs.node` — `Mach-O 64-bit bundle
  x86_64`, 52,128 bytes, SHA-256
  `447eec6040df3c1fa14a4bb2e5937a9eab3e8f9545a14a756a867406de42daa2`.
- Loaded and exercised by 41/41 passing tests (below).

## 10. Intel real primitive tests (41/41 pass)

`npm run test:native` → 41 tests, 0 failures, 0 skipped, real syscalls,
no mocked filesystem semantics:

- **Descriptor-relative directory open** (§12): child opens relative to
  retained parent fd; `getPath` equals canonical child; missing child →
  `not-found`; symlink child refused; non-directory → `not-directory`.
- **Exclusive create** (§12): new target succeeds with exact mode
  (umask 0); umask-077 case documented (Gateway `fchmod` restores fixed
  mode); existing regular file / directory / live symlink / dangling
  symlink all refused as `exists`, original content untouched.
- **F_GETPATH** (§12): valid dir fd and file fd return expected
  canonical paths; rename updates the reported path (vnode identity,
  not lexical — the divergence property MAC-2 needs); closed/invalid fd
  → `invalid-fd`.
- **unlinkat** (§12): removes only the requested final component below
  the retained fd; directory cannot be deleted (typed failure, still
  exists); missing target → `not-found`.
- **Anchor probes** (§13): retained-fd create/open/unlink stay bound to
  the directory OBJECT across (B) lexical rename + (C) replacement of
  the old name by another directory or by a symlink to a decoy
  directory — operations land in the retained object, never in the
  replacement or decoy. This is the property that justifies the native
  seam.
- **Loader** (§15): unsupported lanes (linux, win32, ia32, ppc64, …)
  fail closed; missing binary → `missing-addon`; garbage binary →
  `invalid-addon`; **real arm64 Mach-O in the x64 slot → `invalid-addon`**
  (see §11); no fallback to pure-Node, `/proc`, or `/dev/fd` (code scan
  enforced).
- **Surface** (§10): exported API exactly the five primitives; no
  general filesystem authority, shell, exec, or subprocess exports; C
  source contains no forbidden syscalls and no `/proc`/`/dev/fd`
  references outside comments.
- **Malformed inputs** (§18): matrix of bad fd/component/mode/arity
  values → typed failures, never a throw/crash; 500 randomized garbage
  inputs survive with typed results and no fd leaks; 200-iteration fd
  stability check.

## 11. arm64 candidate build (BUILD ARTIFACT ONLY — not runtime evidence)

- Command: `node scripts/build-native.mjs arm64`
  (`node-gyp --directory native rebuild --arch arm64`, same SDK).
- Artifact: `native/darwin-arm64/gateway_fs.node` — `Mach-O 64-bit
  bundle arm64`, 52,668 bytes, SHA-256
  `5b602eb150b2250e77768f1c3640a88aa63e75f16fcdd8466f273cf4c7b17fb2`.
- Verified NOT executable on this Intel host:
  `dlopen … (mach-o file, but is an incompatible architecture (have
  (arm64), need (x86_64h)))` — which is itself the wrong-arch
  fail-closed proof, exercised by the loader test with the REAL arm64
  binary.
- Cross-build produced a valid candidate without changing the contract
  or build system (N-API addons are self-contained; no link against
  libnode).
- **This is NOT arm64 runtime evidence.** MAC-5 requires real Apple
  Silicon execution; mocked `process.arch` and cross-compilation alone
  are never release verification (MAC-0 contract §8).

## 12. Native binary inspection (§16)

| | darwin-x64 | darwin-arm64 |
|---|---|---|
| file | Mach-O 64-bit bundle x86_64 | Mach-O 64-bit bundle arm64 |
| SHA-256 | `447eec60…42daa2` | `5b602eb1…7fb2` |
| size | 52,128 B | 52,668 B |
| linked dylibs | `/usr/lib/libc++.1.dylib`, `/usr/lib/libSystem.B.dylib` | same |
| exported native symbols | `_napi_register_module_v1`, `_node_api_module_get_api_version_v1` | same |

Only normal system runtime libraries (libSystem core; libc++ is
node-gyp's default macOS link even for pure C — present on every macOS,
not a dependency of concern). No network, crypto, shell, scripting, or
unrelated filesystem libraries. No unexpected dependencies. The
JS-visible five functions are N-API properties, not native symbols; the
static surface test enforces them.

## 13. Security review (§18)

Walkthrough of the C boundary against the checklist:

- **Integer/fd validation:** typeof-number first; NaN/±Infinity/
  negatives rejected before any cast; `> INT32_MAX` rejected before the
  integrality cast (no UB on out-of-range doubles); mode bounded to
  `0o7777`. Exact argument count enforced (no ignored extras).
- **String length/buffer bounds:** two-phase `napi_get_value_string_utf8`
  (length probe → bounded 1024-byte stack copy with copy-length
  equality check); component length `>= PATH_MAX` rejected before copy;
  no heap allocation at all in the addon.
- **NUL handling:** embedded NUL in components rejected; `getPath`
  scans at most `PATH_MAX` bytes for the terminator and passes the
  explicit bounded length to the string constructor; missing terminator
  is a typed `io-failure`.
- **Resource leaks / double-close / use-after-close:** stateless addon;
  the only fd created is the one returned; closed exactly once on
  construction failure; incoming fds never closed or duplicated; no
  retained state → no use-after-close. Leak tests in §10.
- **fd ownership ambiguity:** explicit rules (§6), enforced by review +
  tests.
- **errno mapping:** deterministic closed table; `EINTR` retried where
  the syscall can return it; unknown → `io-failure`.
- **Accidental absolute-path APIs:** none — the only `open`-family call
  is `openat` with a validated single component; plain `open(` is
  asserted absent from the source; root anchoring stays in Node.
- **Path traversal:** `.`, `..`, `/`, multi-component, NUL, oversized
  rejected before syscall; no normalization/globbing/recursion exists.
- **Unexpected directory deletion:** `unlinkat` flags are always `0`;
  `AT_REMOVEDIR` never used; directory unlink fails typed and is tested.
- **N-API exception handling:** malformed input never throws (typed
  results); the single throw path (result-construction failure) closes
  the created fd first; every napi status is checked; no pending
  exceptions are left behind; no user JS code runs during argument
  parsing (`napi_typeof` is trap-free), so hostile proxies cannot inject
  code into the boundary.
- **Native crashes on malformed JS inputs:** 500-case randomized fuzz +
  systematic malformed matrix all return typed failures; process
  survives every case (§10).
- **Race semantics of retained directory descriptors:** rename +
  replacement + symlink probes prove operations bind to the retained
  directory object (§10 anchors).

## 14. Known limitations / explicit non-integration

- Gateway production paths are NOT integrated: `persist-artifact` is
  NOT fixed by this gate. `src/writing/executor.ts`,
  `src/completion/writer.ts`, `src/reader/fs.ts`, runtime MCP
  composition, and host-lane selection still run on the inherited
  Linux `/proc/self/fd` model and remain non-functional on macOS until
  MAC-2.
- The complete hostile race suite is MAC-3; MAC-1 proves only the
  primitive's anchor property.
- The arm64 candidate is a build artifact, not runtime evidence
  (MAC-5).
- `openat`/`unlinkat`/`F_GETPATH` semantics were observed on macOS 12
  (Darwin 21.6.0); macOS 13+ behavior is expected identical (stable
  POSIX/Darwin interfaces) and is covered by MAC-4/MAC-6 acceptance on
  the same physical lane.
- Loader packaging (arch selection, prebuilt layout, release naming) is
  distribution work — MAC-7 finalizes it; this gate proves the
  fail-closed behavior only.
- `.gitignore` excludes staged `.node` binaries so the review diff is
  source-only; committing prebuilt binaries is a MAC-7 distribution
  decision.

## 15. End state

- Working tree: source changes visible for independent review; NOT
  committed; nothing pushed/tagged/published.
- Test evidence: 42/42 native tests green on real Intel hardware
  (41 reviewed + 1 deliberate F-1 regression test, §16);
  `git diff --check` clean (below).
- arm64 candidate: built, inspected, wrong-arch fail-closed proven;
  execution deferred to MAC-5.

```
$ git diff --check        # clean
$ npm run test:native     # 42 pass, 0 fail
```

**Verdict: `MAC-1 — READY FOR SENIOR REVIEW`** — Intel native primitive
works on real hardware; security surface is narrow (five closed
primitives, no general authority); required syscall semantics
(descriptor-relative open/create/unlink, F_GETPATH identity) are
demonstrated by real tests; no contract weakening occurred; arm64
candidate build status is truthfully recorded as build-only evidence.

Next eligible work package: **MAC-2 — Gateway controlled-write
integration** (route executor/writer/reader onto this seam; darwin-only
host-lane scope; product identity rename).

---

## 16. Focused correction F-1 (MAC-1 senior review, 2026-08-15)

**Finding F-1 — MODERATE — `createExclusiveFileAt` exposed
caller-controlled mode.** Corrected; scope limited to F-1 and directly
required tests/report text. INFO findings F-2..F-5 remain non-blocking
and are intentionally NOT touched (F-2: Mach-O ad-hoc signature SHA
non-reproducibility; F-3: cosmetic primitive-test-count discrepancy;
F-4: lockfile normalization; F-5: directory fd returned by
`openExistingFileAt`, rejected downstream by required descriptor
verification). Binary signing/reproducibility disposition remains
MAC-7's responsibility.

### Correction

- `native/src/gateway_fs.c`: `createExclusiveFileAt` signature changed
  from `(parentFd, component, mode)` to exactly `(parentFd, component)`
  (arity 2). The creation mode is now a literal `0600` constant in the
  native seam:

  ```c
  openat(a.fd, a.component, O_CREAT | O_EXCL | O_WRONLY | O_NOFOLLOW | O_CLOEXEC, 0600);
  ```

- All caller-mode parsing/validation removed: no mode argument, no mode
  parser, no mode range validator, no setuid/setgid/sticky-bit
  handling, no optional third argument, no default-mode branch. The
  only remaining `argv[2]` in the file is the fixed two-slot array of
  the shared two-argument parser. Supplying a third argument now fails
  through the seam's normal wrong-arity path (`invalid-input`), never
  silently ignored.
- EINTR handling, fd ownership/lifetime, result-construction cleanup,
  closed errno mapping, and no-overwrite semantics are unchanged
  (verified: descriptor-relative semantics, O_NOFOLLOW, O_EXCL,
  O_CLOEXEC, loader selection, supported lane set, export count, and
  absence of generic filesystem authority all re-verified in the §12
  security sanity pass).
- The inherited Node/Gateway `fchmod` step is NOT moved into this gate;
  MAC-2 may keep it for umask-independent verification.

### Focused tests

- `native/test/primitives.test.mjs`: mode arguments removed from all
  valid calls; fixed-mode assertions preserved (0600 under umask 0;
  0600 under umask 077 — umask can only remove bits, never broaden);
  refusal assertions preserved (existing regular file / directory /
  live symlink / dangling symlink → `exists`, original content
  untouched). New regression test: caller cannot request a broader
  mode — third arguments `0o777`, `0o7777`, `0o4755` (setuid),
  `0o6755` (setgid), `0o1777` (sticky) are all rejected as
  `invalid-input` with nothing created.
- `native/test/malformed.test.mjs`: mode-argument matrix test removed
  (no mode argument exists); arity coverage updated (zero / one /
  three / four args → `invalid-input`; mode-like third arguments
  `0o600`, `0o777`, `'600'`, `null`, `undefined`, `{}` →
  `invalid-input`); backslash, fuzz, and fd-leak coverage preserved
  with two-argument calls.
- `native/test/anchors.test.mjs`: directly affected valid calls updated
  to arity 2 (rename/replacement anchor probes unchanged in substance).
- Surface and loader tests unchanged: export list still exactly
  `openDirectoryAt`, `createExclusiveFileAt`, `openExistingFileAt`,
  `unlinkAt`, `getPath`.

### Direct F-1 closure evidence (§9)

1. two-argument create succeeds on real hardware; 2. created file mode
   is exactly `0600`; 3. umask cannot broaden it (0600 has no
   group/other bits; umask-077 case asserted); 4. third mode argument
   rejected (`invalid-input`); 5. no code path accepts caller-controlled
   mode (source scan: no `mode_t`, no `07777`, no `S_ISUID`/`S_ISGID`/
   `S_ISVTX` anywhere); 6. the only create mode reaching `openat` is the
   literal `0600` constant.

### Rebuild records (one-off)

| Artifact | Architecture | SHA-256 (corrected build) |
|---|---|---|
| `native/darwin-x64/gateway_fs.node` | Mach-O 64-bit bundle x86_64 | `d7b1720964f6763a68f4964524195777373bdbc8135f2651dfa60b35758afced` |
| `native/darwin-arm64/gateway_fs.node` | Mach-O 64-bit bundle arm64 | `64264cd46c704f2e4de234082da08fdc03f17a1db38fa4dc9da34b882ba72669` |

Both: bundle type verified; linked dylibs `libSystem.B` + `libc++` only;
exported native symbols exactly `_napi_register_module_v1` and
`_node_api_module_get_api_version_v1`; no new exports. The arm64
candidate remains a BUILD artifact only — the loader/wrong-arch test on
Intel still fails closed with the real arm64 binary placed in the x64
slot; no arm64 runtime evidence is claimed (MAC-5). Byte-for-byte
comparison with the reviewed build is not required (F-2 ad-hoc
signature non-determinism).

### Focused verification result

```
$ npm run test:native     # 42 pass, 0 fail (was 41; +1 deliberate
                          # F-1 regression test — count change explained)
$ git diff --check        # clean
```

Static export-surface check and loader fail-closed checks pass within
the suite. No broad Gateway suites were run; production Gateway source
remains unchanged; `persist-artifact` is still NOT claimed fixed;
Gateway production integration is still NOT performed (MAC-2).

**Verdict: `MAC-1 CORRECTION — READY FOR FOCUSED REREVIEW`**
