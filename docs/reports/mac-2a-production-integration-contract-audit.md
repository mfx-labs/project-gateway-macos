# MAC-2A — Production Integration Contract Audit (Gate Report)

**Verdict: `MAC-2A — INTEGRATION PLAN READY`**
**Native seam verdict: `NATIVE SEAM — READER EXTENSION REQUIRED`**
**Date:** 2026-08-15 (host local time)
**Host:** macOS 12 (Darwin 21.6.0), x86_64 (Intel), Node v22.23.1.
**Starting SHA:** `235af7f3c001590046699fd17158678e7c642b99` (verified:
`feat: establish Darwin native filesystem primitive` — the accepted,
F-1-corrected MAC-1 baseline; tracked working tree clean).

READ-ONLY gate: no production source was modified; the accepted MAC-1
native seam was not modified; no commit was created; nothing pushed.
This gate creates one audit report only.

**Pre-existing untracked evidence:** `docs/reports/mac-2-aborted-gate-rollback.md`
(intentionally uncommitted rollback record of a previously WITHDRAWN
MAC-2 attempt, restored to this baseline; left untouched). Its existence
does not affect this audit; this audit is derived from the current
source, not from that record.

**MAC-1 confirmation:** `MAC-1 — LOCALLY BASELINED` at `235af7f3…`.
Native exports at baseline (verified in `native/src/gateway_fs.c` +
surface test): exactly `openDirectoryAt`, `createExclusiveFileAt`
(arity 2, mode fixed `0600`), `openExistingFileAt` (fixed
`O_RDONLY|O_NOFOLLOW|O_NONBLOCK`), `unlinkAt` (flags 0), `getPath`
(`F_GETPATH`). 42/42 native tests green.

---

## 1. Writing executor audit (`src/writing/executor.ts`)

All `/proc/self/fd` uses and their native mapping (line refs at baseline):

| # | Current operation (line) | Current Linux mechanism | Required Darwin primitive | Inherited error mapping | Descriptor owner | Invariant preserved |
|---|---|---|---|---|---|---|
| E1 | Root anchor (261) | `openSync(canonicalArtifactRoot, O_RDONLY\|O_DIRECTORY\|O_NOFOLLOW)` — **no `/proc`** | stays in Node (unchanged) | `artifact-root-unavailable` / mapRootOpenError | executor; closed in `finally` | retained root descriptor (2) |
| E2 | Root fstat verify (262) | `fstatSync(rootFd)` | stays in Node (works on any fd) | — | executor | service-UID dir check (6) |
| E3 | Parent open (284) | `openSync('/proc/self/fd/<rootFd>/<ancestorRelative>', O_RDONLY\|O_DIRECTORY\|O_NOFOLLOW)` | JS descent: one `openDirectoryAt(prevFd, component)` per component of `canonicalAncestorRelativePath` (multi-component allowed by contract; single-component native calls; intermediate fds closed after descent) | `mapOpenError` (ENOENT→`missing-parent`, ENOTDIR→`parent-not-directory`, ELOOP→`symlink-loop`…) | parentFd caller-owned; closed in `finally` | descriptor-relative traversal (3), no intermediate symlink following (4) — O_NOFOLLOW per component, STRICTER than Linux single-path open |
| E4 | Parent fstat verify (285) | `fstatSync(parentFd)` | stays in Node | `parent-not-directory`, `permission-denied` | same | service-UID + directory (5,6) |
| E5 | Parent identity (297) | `readlinkSync('/proc/self/fd/<parentFd>')` | **`getPath(parentFd)`** — 1:1 | `parent-not-verified` (mismatch or failure) | same | descriptor-bound parent identity (5) |
| E6 | Create (319) | `openSync('/proc/self/fd/<parentFd>/<final>', O_CREAT\|O_EXCL\|O_WRONLY\|O_NOFOLLOW, 0o600)` | **`createExclusiveFileAt(parentFd, final)`** — mode fixed 0600 in seam, byte-identical to `DRAFT_FILE_MODE` | `mapOpenError` (EEXIST/EISDIR→`exclusive-create-conflict`, ENOENT→`missing-parent`…) | fd caller-owned; closed by executor | exactly one final component (7), O_EXCL (8), O_NOFOLLOW (9), fixed mode (10) |
| E7 | fchmod + fstat verify (329–330) | `fchmodSync`/`fstatSync` on fd | stays in Node (umask-independent fixed mode; inherited step preserved per F-1) | `verify-failed` | same | fixed mode (10), created-object verification (11) |
| E8 | Write (350) | `writeSync` loop on fd | stays in Node (works on native fds) | `write-failed` | same | bounded exact write (12) |
| E9 | Cleanup (186) | `unlinkSync('/proc/self/fd/<parentFd>/<final>')` | **`unlinkAt(parentFd, final)`** — 1:1 | cleanup outcome `removed`/`failed` (native `not-found` → `failed`, same as inherited throw) | same parent descriptor | cleanup of only created object through same verified parent (13,14) |

`/proc` occurrences: lines 19/22/28/59 (doc comments, updated with code),
90 (`fdRelativePath`, replaced), 186/284/297/319 (call sites above).
Root-relative path `canonicalAncestorRelativePath` validation
(`validateRelativePath`, defensive) stays in JS unchanged.

**Executor verdict: `SUFFICIENT`.** Five-function seam covers every
`/proc` operation 1:1 or by single-component composition; no new native
authority required. One Darwin nuance (recorded, fail-closed both ways):
on this kernel, `openat(O_DIRECTORY|O_NOFOLLOW)` on a symlink yields
`ENOTDIR` (→ `parent-not-directory`) where Linux yields `ELOOP` (→
`symlink-loop`); both codes exist in the closed executor taxonomy.

## 2. Completion writer audit (`src/completion/writer.ts`)

| # | Operation (line) | Linux mechanism | Darwin primitive | Mapping / notes |
|---|---|---|---|---|
| W1 | Root anchor (265) | `openSync(root, O_RDONLY\|O_DIRECTORY\|O_NOFOLLOW)` — no `/proc` | stays in Node | `missing-parent`/`containment-denied`/`io-failure` |
| W2 | Root identity (269) | `readlinkSync('/proc/self/fd/<rootFd>')` vs `root` | **`getPath(rootFd)`** | `parent-not-verified`. **Canonical-path caveat (recorded):** `F_GETPATH` returns the vnode's canonical path (e.g. `/private/var/…` for `/var/…`); the inherited `root` must be realpath-canonical for the equality to hold. MAC-0 contract §4/ADR-042 decision 5 already require realpath-style canonical roots, so both sides are canonical — consistent. MAC-2C must verify this on real hosts and fail closed otherwise (which is the inherited semantic anyway) |
| W3 | Parent descent (151) | `openSync('/proc/self/fd/<parentFd>/<component>', O_RDONLY\|O_DIRECTORY\|O_NOFOLLOW)` | **`openDirectoryAt(parentFd, component)`** per component | `parent-not-verified`/`ownership-mismatch`/`missing-parent`/`containment-denied` via the same mapping as today |
| W4 | Parent identity (163) | `readlinkSync('/proc/self/fd/<fd>')` vs `expectedResolved` | **`getPath(fd)`** | `parent-not-verified`; same canonical-path caveat as W2 (expectedResolved built from canonical root — consistent) |
| W5 | Final create (311) | `openSync(fdRel, O_CREAT\|O_EXCL\|O_WRONLY\|O_NOFOLLOW, 0o600)` | **`createExclusiveFileAt(parentFd, finalComponent)`** | `RESULT_FILE_MODE` is `0o600` = seam's fixed `0600`. `exists`→`exclusive-create-conflict`; EISDIR branch unchanged |
| W6 | EEXIST recovery (193) | `openSync(fdRel, O_RDONLY\|O_NOFOLLOW\|O_NONBLOCK)` | **`openExistingFileAt(parentFd, finalComponent)`** — fixed flags EXACT match | `symlink-refused`→`exclusive-create-conflict` (inherited maps ELOOP/EMLINK→conflict); `not-found`→`io-failure`; fstat/uid/size checks + bounded read stay in Node (200–217) |
| W7 | Cleanup (after 330) | `unlinkSync(fdRel)` | **`unlinkAt(parentFd, finalComponent)`** | best-effort; conflict verdict stands |

**Writer verdict: `SUFFICIENT`.** Every inherited completion behavior
(parent traversal, parent identity, exclusive create, EEXIST recovery
read, cleanup) is preservable with the accepted seam; no native
authority added. `O_NONBLOCK` FIFO protection preserved (fixed flags).

## 3. Reader audit (`src/reader/fs.ts`) — the primary uncertainty

| # | Operation (line) | Linux mechanism | Darwin disposition | Verdict |
|---|---|---|---|---|
| R1 | Root bind (29) | `fsOpen(rootPath, O_RDONLY\|O_DIRECTORY)` — no `/proc` | stays in Node | works on Darwin unchanged |
| R2 | openForRead (116) | `fsOpen('/proc/self/fd/<rootFd>/<relative>', O_RDONLY\|O_NONBLOCK)` | JS descent per component + final **`openExistingFileAt(parentFd, final)`** | mappable; **strengthened**: seam adds O_NOFOLLOW on the final component; for containment-canonical paths (symlink-free, SYM-001..006) behavior is identical; a hostile post-revalidation symlink swap now fails at open (ELOOP→`symlink-refused`) instead of opening then failing the S-07 identity check — both fail closed; reader maps `symlink-refused`→`not-found` (inherited ELOOP→`not-found`) |
| R3 | openForListDirectory (161) | `fsOpen('/proc/self/fd/…', O_RDONLY\|O_DIRECTORY)` | descent + **`openDirectoryAt(parentFd, final)`** | mappable; same strengthening (intermediate + final O_NOFOLLOW) |
| R4 | inspectLogicalEntry (199–201) | `lstatSync(join(rootPath, relative))` — **lexical, no `/proc`** | stays in Node | works on Darwin unchanged (inherited lexical-lstat semantics; final-component logical inspection) |
| R5 | statResolvedTarget | `statSync(resolvedAbsolutePath)` — no `/proc` | stays in Node | unchanged (S-07 accepted-target evidence) |
| R6 | statIdentity / verifyDescriptorIdentity | `fstatSync` dev/ino compare | stays in Node | unchanged |
| R7 | readFileBytes | `handle.read(...)` FileHandle method | Node `readSync(fd, …)` on the raw native fd | Node-side adaptation (see below) |
| R8 | **listDirectoryEntries (236)** | **`opendirSync('/proc/self/fd/<fd>')`** | **NO equivalent in the accepted seam** | **GAP — see §4** |

**Reader verdict: `READER EXTENSION REQUIRED`** (exactly one gap: R8).

Additional Node-side adaptation (not a native gap): the reader's
`OpenedTarget` currently wraps a `FileHandle` (`fs/promises`). Native
opens return raw fds; on this Node version there is NO public way to
wrap a raw fd into a `FileHandle` (probed: `fs.FileHandle` is not
exported, `fsp.FileHandle` is not exported, `FileHandle.readdir()` does
not exist on Darwin). MAC-2D therefore switches the reader's
post-open byte paths to raw-fd Node calls (`readSync`, `closeSync`,
`fstatSync` — all POSIX, all work on native fds) and the root bind may
stay `fsOpen` (only `.fd` and `.close()` are used). This changes no
external contract; it is a consumer-side API adaptation.

### 3.1 The enumeration question, answered from the real host

Probed on this machine (Node v22.23.1 / macOS 12):

1. `fs.readdirSync(rawFd)` → `ERR_INVALID_ARG_TYPE` (path-only API).
2. `FileHandle.readdir()` → **method absent on Darwin** (Linux-only in
   Node; not present here at all).
3. `fs.FileHandle` / `fs.promises.FileHandle` → **not exported** in
   Node 22.23.1 (no public raw-fd wrapper).
4. `opendirSync('/dev/fd/N')` → broken on this host (MAC-1 erratum:
   ENOENT/EINVAL; no fd-relative traversal).

Therefore: **Node cannot enumerate an already-retained Darwin directory
fd without reopening it through a pathname.** A pathname reopen
(`opendirSync(rootPath + relative)`) would break descriptor binding —
the exact TOCTOU the inherited model eliminates — and is explicitly
rejected by this gate ("do not invent a path-based fallback"). A native
extension is required.

## 4. Required native API gap — one bounded primitive

**`readDirectoryEntries(fd)`** (implementation name may vary; MAC-2D
gate finalizes it). Minimum capability, recovered from the actual reader
requirements (`listDirectoryEntries(target, maxEntries)` — R8):

- input: ONE directory fd (validation identical to existing primitives:
  number, integral, 0..INT32_MAX);
- output: `{ok:true, entries:[{name, kindHint}], truncated:boolean}` or
  `{ok:false, code}` with the EXISTING closed vocabulary
  (`invalid-fd`, `not-directory`, `permission-denied`, `io-failure`, …);
- `kindHint` exactly the reader's four values — `file`, `directory`,
  `symlink`, `other` — from `d_type` (APFS provides it);
- skips `.` and `..`;
- bounded: a single-pass enumeration with a fixed internal entry cap
  (implementation-owned; the reader's `maxEntries` truncation and its
  deterministic UTF-8 byte-order sort stay in JS, preserving current
  deterministic output byte-for-byte);
- fd ownership: incoming fd remains caller-owned; internally `dup` +
  `fdopendir`/`readdir`, stream and dup closed on every path — the
  caller's fd is never closed, never advanced, never consumed;
- NUL-safe, bounded-length names (NAME_MAX), same conversion semantics
  as today's `opendirSync` (invalid UTF-8 → replacement, matching Node);
- no absolute paths, no recursion, no globbing, no stat-per-entry
  (kind hints only — the reader fstats separately where it needs
  identity).

`fdopendir` is NOT assumed: the implementation is MAC-2D-native's to
choose (dup+`fdopendir` is the obvious Darwin mechanism; the requirement
here is the descriptor-bound bounded enumeration contract above).
This extension is the ONLY additional native authority; it adds no
path, no traversal, no mutation.

## 5. Native error mapping by consumer

MAC-1 internal codes → inherited consumer vocabularies (no code created;
ambiguities noted):

| Native code | Executor (`DraftWriteExecutorFailureCode`) | Writer (`ResultWriteCode`) | Reader |
|---|---|---|---|
| `invalid-input` | `invalid-evidence` (defensive; JS validates first) | `invalid-operand` | `error` (internal) |
| `invalid-fd` | `io-failure` (internal fd; unreachable) | `io-failure` | `error` |
| `not-found` | `missing-parent` (open); cleanup → `failed` | `missing-parent`; recovery open → `io-failure` | `not-found` |
| `exists` | `exclusive-create-conflict` | `exclusive-create-conflict` (recovery → `already-exact` via EEXIST branch — unchanged) | n/a (no create) |
| `not-directory` | `parent-not-directory` | `parent-not-verified` | `not-found` (openForRead), `unsupported-type` (list) |
| `symlink-refused` | `symlink-loop` (parent open); `exclusive-create-conflict` (create) — **NOTE:** on Darwin a symlink parent can surface as `not-directory` instead (see §1); both codes exist and fail closed | `containment-denied` (descent); `exclusive-create-conflict` (recovery) | `not-found` |
| `permission-denied` | `permission-denied` | `io-failure` (writer has no permission code; inherited EACCES→io-failure — preserve) | `permission-denied` |
| `read-only` | `readonly-filesystem` | `io-failure` (writer has no EROFS branch; preserve inherited mapping) | `error` |
| `no-space` / `quota` | `no-space` / `quota-exceeded` | `io-failure` | `error` |
| `unsupported` | `unsupported-filesystem` | `io-failure` | `error` |
| `io-failure` | `io-failure` | `io-failure` | `error` |

**Ambiguities (same Darwin failure, different consumer code — all
pre-existing in the inherited errno mappings, preserved as-is):**
- `not-found` → `missing-parent` (executor/writer) vs `not-found`
  (reader) vs cleanup `failed` (executor) — consumer-position-dependent,
  identical to today's errno handling;
- `permission-denied`/`read-only`/`no-space`/`quota`/`unsupported` →
  mapped in executor, collapsed to `io-failure` in writer — inherited
  writer behavior, do NOT "improve" it;
- `symlink-refused` → three different codes by consumer position —
  inherited ELOOP handling, preserved.

Externally visible vocabularies are preserved in full; only the
errno→code boundary changes (the accepted Darwin-specific internal
mapping allowance, MAC-0 contract §4).

## 6. Descriptor ownership audit

| Consumer | Incoming fd owner | Newly returned fd owner | Close point | Early-return close obligations | Likely mistake points |
|---|---|---|---|---|---|
| Executor | rootFd: Node-opened, executor-owned | parentFd (native): caller/executor-owned; create fd: executor-owned | `finally` block already closes fd/parentFd/rootFd on ALL paths | none new — `finally` covers every typed early return; cleanup runs before the `finally` | MAC-2B descent loop: intermediate component fds must be closed on every error path (writer's `openVerifiedDirectory` pattern: close previous parent after next open; close opened fd on failure) |
| Writer | rootFd: writer-owned | descent fds; create/recovery fd | `finally` closes parentFd/rootFd; fd closed in inner finally; `closeFd` helper | same pattern exists; recovery path closes `existingFd` in its own finally | same descent-loop discipline; recovery `existingFd` close preserved |
| Reader | root: Node FileHandle (`.close()` used) | native fds wrapped in `OpenedTarget` | `target.handle.close()` must become `closeSync(target.handle.fd)`-equivalent | every `close().catch(() => {})` site (openForRead/list open failure paths, unsupported-type closes) must become sync close | R7 adaptation: any missed `handle.close()` → fd leak; MAC-2D must audit every `OpenedTarget` close site in `src/reader/service.ts` |

Native seam rules (MAC-1 §6) are unchanged: incoming fds never closed/
duplicated by the addon; created fds caller-owned only on success; no
leaks on exception (result-construction failure closes first).

## 7. Host/product identity coupling audit

| Identity | Location | Kind | Rename impact |
|---|---|---|---|
| Package name `@project-gateway/artifact-core` | package.json | branding | MCP server identity name (informational — `server.ts` header: "never trust/authorization/cursor material"), npm identity. No protocol coupling |
| Bin `project-gateway-mcp` | package.json `bin` | branding | CLI invocation name; usage text (cli.ts `USAGE`), diagnostics prefix. No protocol coupling |
| Server identity (initialize) | `src/runtime/mcp/cli.ts` `packageIdentity()` → `createMcpServer(..., identity)` | branding | derived from package.json; informational only |
| `project-gateway-mcp-bootstrap` | `src/runtime/mcp/compose.ts` `BOOTSTRAP_ACTION_IDENTITY` | **recorded label (safe to rename)** | minted into `createStorageBootstrapActionProvenance` (compose.ts:113) — the action label field of NEW storage-bootstrap provenance records. **Does NOT** feed `TRUSTED_CONFIG_DIGEST` (identity.ts: digest = `PGAP-TRUSTED-CONFIG-v1\0` + canonical projection of the validated config: config version, capability vocab version, **host lane**, provenance, ceilings, workspace records, extension set — no action label), does NOT appear in store metadata identity (store-metadata.ts binds namespaceIdentity/parentIdentity/configurationIdentity), does NOT appear in any fixture or test (grepped), existing stores replay-verify unchanged. Purely recorded provenance label |
| `project-gateway-operator-bootstrap` | `src/control-plane/storage-bootstrap-action.ts` | **protocol-adjacent — DO NOT rename** | same recorded-label property, but zero branding value; leave untouched |
| Host-lane strings (`darwin-x86_64-posix-utf8-node22`, `darwin-arm64-posix-utf8-node22`, `linux-…`) | `src/trusted/host-lane.ts` | **trusted protocol operands** | feed `TRUSTED_CONFIG_DIGEST` and configuration projection; cross-lane replay identity (ADR-042 decision 9). **NEVER rename.** Darwin lanes already exist and are unchanged; MAC-2E only REMOVES the linux lane from the accepted set/mapping (a scope change with config-identity consequences — stores created under the linux lane remain foreign/fail-closed, which is the intended product behavior) |
| Schemas, `pgw:` ids, store layout, error vocabularies | schemas/, src/… | protocol | NOT renamed (MAC-0 contract §7) |

**Conclusion:** the entire MAC-0 §7 identity proposal is safe except the
control-plane constant (kept) and the lane strings (never). The only
non-obvious one — `project-gateway-mcp-bootstrap` — is a recorded
provenance label with zero identity/digest/fixture coupling; renaming it
to `project-gateway-macos-mcp-bootstrap` in MAC-2E is cosmetic and safe,
with the caveat that provenance records already persisted in existing
stores keep the old label (nothing verifies it).

## 8. Recommended MAC-2 slice plan (dependency-ordered)

The audit confirms the preferred shape with ONE insertion: a native
seam extension slice must precede reader integration (R8 gap, §4).

### MAC-2B — Writing executor integration
- **Files allowed:** `src/writing/executor.ts`, new shared adapter
  `src/internal/darwin-fs/adapter.ts` (single-component descent helper,
  native-code → executor-vocabulary mapping, `getPath` identity check;
  owns NO authority itself — wraps only the accepted five primitives),
  `src/internal/darwin-fs/adapter.test.mjs`, `tests/writing/*`.
- **Prerequisites:** MAC-2A accepted.
- **Acceptance:** every `/proc` operation replaced per §1 table;
  typed codes byte-identical to inherited; descent-loop fd hygiene
  (§6); `tests/writing/executor.test.ts` + static guards green on real
  Intel with the native seam.
- **Focused tests:** full `tests/writing/` suite, executor race tests
  (MAC-3 owns the hostile suite; slice keeps existing coverage green).
- **Review gate:** human invariant checklist (MAC-0 contract §4) ticked
  one-for-one.
- **Local baseline commit:** YES (after review gate; never pushed).

### MAC-2C — Completion writer integration
- **Files allowed:** `src/completion/writer.ts`, shared adapter reuse,
  `tests/` completion suites (`tests/unit/wp13b-*`, writing static
  guards).
- **Prerequisites:** MAC-2B.
- **Acceptance:** §2 table implemented; recovery read, adoption path,
  cleanup identical; canonical-path caveat (W2/W4) verified on real
  APFS (`/var` vs `/private/var` behavior asserted).
- **Focused tests:** completion writer unit/security tests on Intel.
- **Review gate:** human diff review vs §2 mapping.
- **Local baseline commit:** YES.

### MAC-2D-NATIVE — Reader seam extension (readDirectoryEntries)
- **Files allowed:** `native/src/gateway_fs.c` (+ binding.gyp if
  needed), `native/index.mjs` (no signature change — same binary),
  `native/test/*` (new primitive tests), `docs/reports/mac-2d-native-*`.
- **Prerequisites:** MAC-2A accepted (this audit).
- **Acceptance:** §4 contract implemented: bounded single-pass
  enumeration, kind hints, `.`/`..` skipped, fd never consumed/closed,
  closed vocabulary, real-Intel tests incl. rename-bound enumeration
  and malformed-input coverage; x64 + arm64 rebuild records; 42+N
  native tests green.
- **Focused tests:** enumeration primitive tests (content, truncation
  cap, kind hints, symlink entries, fd ownership, fuzz).
- **Review gate:** human API-surface review (must remain the 6th and
  final export).
- **Local baseline commit:** YES.

### MAC-2D — Reader integration
- **Files allowed:** `src/reader/fs.ts`, `src/reader/service.ts`
  (close-site audit), `src/fff/provider.ts` (no change expected — uses
  the reader service), `tests/` reader/fff suites.
- **Prerequisites:** MAC-2D-NATIVE, MAC-2B (adapter).
- **Acceptance:** §3 table implemented; `readFileBytes` on raw fds;
  every `OpenedTarget` close site sync-closed; listDirectoryEntries via
  `readDirectoryEntries` with JS-side maxEntries/truncation/sort
  preserved; S-07 identity checks unchanged; reader vocabulary
  preserved per §5.
- **Focused tests:** `tests/unit/storage` reader surface,
  `tests/pointofuse-v2/` (reader-backed), FFF discovery tests.
- **Review gate:** human close-site audit sign-off.
- **Local baseline commit:** YES.

### MAC-2E — Darwin-only scope + product identity
- **Files allowed:** `src/trusted/host-lane.ts` (remove linux lane from
  accepted set + mapping; darwin lanes untouched), `src/runtime/mcp/cli.ts`
  (exit-2 message), package.json (name/bin per MAC-0 §7),
  `src/runtime/mcp/compose.ts` (bootstrap provenance label),
  `src/runtime/mcp/server.ts` if identity plumbing needs it, docs,
  affected tests/fixtures ONLY where identity strings appear.
- **Prerequisites:** MAC-2B..2D (or parallel after 2B).
- **Acceptance:** Linux/Windows/unknown hosts fail closed at CLI (exit
  2); darwin lanes unchanged; package/server identity unambiguous;
  control-plane constant and lane strings untouched; config-identity
  consequences documented (linux-lane stores → foreign/fail-closed).
- **Focused tests:** `tests/trusted/host-lane.test.ts` (updated closed
  set), CLI exit-code tests, identity tests.
- **Review gate:** human sign-off on identity-diff scope.
- **Local baseline commit:** YES.

### MAC-2F — Runtime composition + real Intel MCP persist
- **Files allowed:** `src/runtime/mcp/compose.ts` (load seam via
  `native/index.mjs` at composition), `src/runtime/mcp/config.ts` if
  needed, docs, E2E evidence.
- **Prerequisites:** MAC-2B..2E.
- **Acceptance:** real Intel stdio MCP session: bootstrap → store
  provision → `persist-artifact` on a real workspace → `verify-record`
  → audit; nine-tool surface intact; loader fail-closed proven at
  composition (missing/wrong-arch addon → typed startup failure).
- **Focused tests:** `tests/runtime/`, live MCP session evidence.
- **Review gate:** human E2E acceptance (MAC-4-style evidence subset).
- **Local baseline commit:** YES.

### MAC-2G — Integrated MAC-2 closure
- **Files allowed:** integration fixes, closure docs
  (`docs/reports/mac-2-*`).
- **Prerequisites:** MAC-2B..2F.
- **Acceptance:** contract §3 checklist item-by-item; error taxonomy
  exercised end to end; `persist-artifact` claimed fixed ONLY here;
  rollback record superseded.
- **Focused tests:** full focused regression set on Intel.
- **Review gate:** senior review of the whole MAC-2 delta.
- **Local baseline commit:** YES (MAC-2 baselined; MAC-3 next).

Slices are NOT merged; the MAC-2D-NATIVE insertion is required by the
R8 gap and is not negotiable away.

## 9. Summary of verdicts

| Consumer | Seam sufficiency |
|---|---|
| `src/writing/executor.ts` | **SUFFICIENT** (1:1 + single-component descent) |
| `src/completion/writer.ts` | **SUFFICIENT** (incl. exact fixed-flag recovery match) |
| `src/reader/fs.ts` | **READER EXTENSION REQUIRED** — one gap: descriptor-bound directory enumeration (R8); Node has no fd-based readdir on Darwin (probed) |

**Verdict: `MAC-2A — INTEGRATION PLAN READY`** · **`NATIVE SEAM —
READER EXTENSION REQUIRED`**

The extension (`readDirectoryEntries(fd)`, §4) is NOT implemented here.
No production code was modified; MAC-2B has not begun. Next eligible
slice: **MAC-2B — Writing executor integration**.
