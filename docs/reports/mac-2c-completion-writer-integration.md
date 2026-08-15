# MAC-2C — Completion Writer Integration (Gate Report)

**Verdict: `MAC-2C — ACCEPTED`** (final durable status, MAC-2C closure gate)
**Closure state: `MAC-2C — LOCALLY BASELINED`**

Closure record (gate chain, 2026-08-15): implementation completed →
`MAC-2C SENIOR REVIEW — ACCEPTED` (independent review; W1–W7 mapping
verified one-for-one, distinct `exists` → EEXIST recovery routing
intact, recovery observational only, FIFO/nonblocking protection real,
zero active `/proc`, 164/164 focused tests reproduced on real Intel)
→ this local baseline commit. One INFO-only documentation
**transcription** correction was applied at closure (INFO-1: per-file
test counts 25→22 and 1→4 in §12; grand total 164 unchanged; no
implementation or test change). No implementation correction was
required.

- MAC-2C is **locally baselined** in this repository only. No
  push/tag/publish/release/deploy occurred.
- **MAC-2D-NATIVE (reader descriptor-bound directory enumeration) has
  NOT started.** `src/reader/fs.ts` remains on the inherited Linux
  model.
- `persist-artifact` is NOT claimed product-E2E fixed (MAC-2F/MAC-2G).

**Original gate record (pre-closure) — historical, not superseded:**
**Date:** 2026-08-15 (host local time)
**Host:** macOS 12 (Darwin 21.6.0), x86_64 (Intel), Node v22.23.1.
**Starting SHA:** `47a4ec7dc7bebf540bad7e4385c527f9ee9b02f6` (verified;
tracked working tree clean; only the preserved rollback report
untracked and untouched; MAC-2B suites green at baseline; native seam
unchanged; export surface exactly five functions).
**Audit authority:** `docs/reports/mac-2a-production-integration-contract-audit.md`
(completion writer: `NATIVE SEAM SUFFICIENT`).

NOT committed. Nothing pushed/tagged/published. `src/reader/fs.ts`,
`src/reader/service.ts`, the native C addon, native exports, host lanes,
runtime composition, MCP registration, package/product identity,
schemas, and protocol identities are untouched.
`src/writing/executor.ts` is behaviorally unchanged (the shared
`adapter.ts` was not modified; only a sibling writer adapter was added).
`readDirectoryEntries` was NOT implemented; MAC-2D-NATIVE has NOT begun.

---

## 1. Files changed (exact)

| File | Change |
|---|---|
| `src/completion/writer.ts` | W1–W7 migration (see §2); `/proc` mechanism removed; comments updated where they described the old mechanism; unused create-flag constants and `RESULT_FILE_MODE` removed (mode is seam-owned 0600, identical value) |
| `src/internal/darwin-fs/writer.ts` | NEW — completion-specific seam wrapper (see §3) |
| `tests/unit/wp13b-completion.test.ts` | `newRoot()` roots realpath-canonical (MAC-2B lesson: F_GETPATH identity is vnode-canonical; production roots are symlink-resolved); +§15 vnode-canonical identity test |
| `tests/unit/wp13b-darwin-writer-adapter.test.ts` | NEW — writer-adapter suite incl. §17 recovery/create anchor probes and pure code-mapping tests |
| `tests/writing/static-guard.test.ts` | +writer-adapter static guard (pure seam wrapper: no node:fs, no generic authority, distinct `exists` routing preserved) |

## 2. W1–W7 mapping (as executed)

| # | Operation | Linux mechanism (removed) | Darwin primitive (now) |
|---|---|---|---|
| W1 | Root anchor | `openSync(root, O_RDONLY\|O_DIRECTORY\|O_NOFOLLOW)` (no `/proc`) | **unchanged, stays Node** — fstat dir/UID verification unchanged; root-open errno mapping unchanged (inherited) |
| W2 | Root identity | `readlinkSync('/proc/self/fd/<rootFd>')` | `identityOf(rootFd, root)` (shared F_GETPATH equality); failure/mismatch → `parent-not-verified`; path used only for equality |
| W3 | Parent descent | `openSync('/proc/self/fd/<parentFd>/<component>', O_RDONLY\|O_DIRECTORY\|O_NOFOLLOW)` | `openDirectoryAtWriter(parentFd, component)` per component (single-component openat); per-component fstat dir/UID + expected-path identity checks retained in `openVerifiedDirectory` (unchanged semantics) |
| W4 | Parent identity | `readlinkSync('/proc/self/fd/<fd>')` vs `expectedResolved` | `identityOf(fd, expectedResolved)` |
| W5 | Final create | `openSync(fdRel, O_CREAT\|O_EXCL\|O_WRONLY\|O_NOFOLLOW, 0o600)` | `createExclusiveFileWriter(parentFd, finalComponent)` — seam-owned flags + fixed 0600; native `exists` is returned DISTINCTLY and routes to the inherited EEXIST recovery path (never a silent conflict) |
| W6 | EEXIST recovery | `openSync(fdRel, O_RDONLY\|O_NOFOLLOW\|O_NONBLOCK)` | `openExistingFileWriter(parentFd, finalComponent)` — fixed seam flags `O_RDONLY\|O_NOFOLLOW\|O_NONBLOCK\|O_CLOEXEC`; Node-side fstat (regular file, UID, size ≤ ceiling), bounded read loop, exact byte comparison — ALL retained unchanged. **A native open success is NEVER acceptance** (see §5) |
| W7 | Cleanup | `unlinkSync(fdRel)` | `cleanupCreated(parentFd, finalComponent)` (shared `unlinkAt`); best-effort, outcome unused (inherited), same verified parent fd + single component |

Remaining `/proc`/`readlinkSync` mentions in writer.ts and compiled
`dist/completion/writer.js` are documentation comments only (accurate
history). Zero active `/proc` mechanism; no path-based fallback.

## 3. Adapter surface (`src/internal/darwin-fs/writer.ts`)

Sibling of the executor adapter in the same private boundary. Pure seam
wrapper — **no `node:fs` surface at all** (the writer owns fstat/read/
close on raw fds, preserving its exact control flow):

- `openDirectoryAtWriter(parentFd, component)` → `{ok:true, fd}` |
  `{ok:false, code: 'missing-parent'|'parent-not-verified'|'containment-denied'|'io-failure'}`
- `identityOf(fd, expectedResolved)` — shared `verifyParentIdentity`
  (F_GETPATH equality; identity evidence only, never mutation authority)
- `createExclusiveFileWriter(parentFd, finalComponent)` → `{ok:true, fd}` |
  `{ok:false, code: 'exists'|'missing-parent'|'parent-not-verified'|'containment-denied'|'io-failure'}` —
  **`exists` is distinct** so the writer's inherited adoption/recovery
  decision runs
- `openExistingFileWriter(parentFd, finalComponent)` → `{ok:true, fd}` |
  `{ok:false, code: 'exclusive-create-conflict'|'io-failure'}`
- `cleanupCreated(parentFd, finalComponent)` → `'removed'|'failed'`
  (shared `unlinkCreated`)
- pure mappers `mapWriterDescent` / `mapWriterCreate` / `mapWriterRecovery`
  (exported for direct testing; no authority)

Reuse: `verifyParentIdentity` + `unlinkCreated` imported from the
executor adapter (`./adapter.js`) — both are position-independent. The
executor adapter itself was NOT modified.

## 4. Native → writer error mapping (writer-position-aware)

| Native code | Descent (W3/W4) | Create (W5) | Recovery open (W6) | Cleanup (W7) |
|---|---|---|---|---|
| `not-found` | `missing-parent` | `missing-parent` | `io-failure` (inherited) | `failed` |
| `exists` | `io-failure` (unreachable) | **`exists`** → recovery path | n/a | `failed` |
| `not-directory` | `parent-not-verified` | `parent-not-verified` | `io-failure` | `failed` |
| `symlink-refused` | `containment-denied` | `containment-denied` | `exclusive-create-conflict` | `failed` |
| `permission-denied` / `read-only` / `no-space` / `quota` / `unsupported` / `invalid-*` / unknown | `io-failure` (inherited collapse — MAC-2A §5, not "improved") | `io-failure` | `io-failure` | `failed` |

No native internal codes reach the public `ResultWriteOutcome`; the
inherited writer vocabulary is preserved exactly. Recorded Darwin nuance
(inherited root-open errno mapping, unchanged): a symlink at the ROOT
anchor yields `ENOTDIR` → `missing-parent` on this kernel where Linux
yields `ELOOP` → `containment-denied` — both inherited closed codes,
fail-closed either way (test asserts the set).

## 5. EEXIST recovery semantics (highest-value review)

Preserved end-to-end, proven by the inherited writer-level matrix now
running against the real seam on Intel (all green):

- exact existing regular file → `already-exact` adoption (no rewrite);
- conflicting regular file → `exclusive-create-conflict`, never
  overwritten;
- live symlink to the EXACT bytes → `exclusive-create-conflict`
  (symlink never followed: create `exists` → recovery open
  `symlink-refused` → conflict);
- dangling symlink → `exclusive-create-conflict`;
- directory final component → `exclusive-create-conflict` (recovery open
  succeeds, fstat non-regular → conflict);
- FIFO → `exclusive-create-conflict`, process never blocks
  (fixed O_NONBLOCK; in-process + child-process-with-timeout tests).

The Node-side gates after the native open are untouched: fstat
regular-file requirement, service-UID check, `stat.size` vs expected +
ceiling check, bounded read loop (short-read continuation, EOF,
read-failure → `io-failure`), exact byte comparison. `already-exact`
never arises from a non-regular object or from open success alone.

## 6. FIFO/nonblocking behavior (§10)

- Seam `openExistingFileAt` carries fixed `O_NONBLOCK` (verified in the
  MAC-1 C source; unchanged).
- Adapter test: FIFO open through the seam returns promptly with a valid
  fd; fstat shows FIFO; the writer-side regular-file gate rejects it.
- Inherited child-process promptness test (8s hard timeout) passes:
  removal of O_NONBLOCK would hang the child and fail the test.
- The recovery read loop cannot wait indefinitely: it reads exactly
  `stat.size` bytes with the inherited bounded loop and rejects
  non-regular types before any read.

## 7. Descriptor lifetime audit (§14) — traced per path

| Path | rootFd | intermediate fds | parentFd | created fd | existingFd |
|---|---|---|---|---|---|
| A. root open failure | n/a | n/a | n/a | n/a | n/a |
| B. root identity failure | closed in outer `finally` | n/a | n/a | n/a | n/a |
| C. descent failure | closed in `finally` | closed by `openVerifiedDirectory` (closeFd on every fail) | n/a | n/a | n/a |
| D. parent identity failure | closed | closed | closed in outer `finally` | n/a | n/a |
| E. create success | closed | closed | closed after write | closed in inner `finally` | n/a |
| F. create `exists` → recovery | closed | closed | open through recovery | n/a | opened, closed in recovery `finally` (closeFd) |
| G. recovery verification failure | closed | closed | open | n/a | closed (all early returns inside recovery's try/finally) |
| H. recovery exact match | closed | closed | open | n/a | closed |
| I. recovery conflict | closed | closed | open | n/a | closed |
| J. write failure | closed | closed | open THROUGH cleanup | cleanup-unlinked, closed in inner finally | n/a |
| K. cleanup failure | closed | closed | open through cleanup | closed; target remains (truthful `io-failure`) | n/a |

- No leak: `openVerifiedDirectory` closes its fd on every failure path;
  recovery closes `existingFd` in its finally; the outer finally closes
  parentFd (guarded `!== rootFd`) and rootFd.
- No double close: each fd has one owner; the adapter never closes
  incoming fds; the addon never owns incoming descriptors.
- Parent survives through cleanup (cleanup inside the try, before the
  outer finally).
- Leak coverage: adapter tests exercise success/failure/descent/recovery
  flows; the inherited suite's failure-injection tests (write failure →
  cleanup, cleanup permission failure) pass.

## 8. Canonical identity evidence on real APFS (§15)

New test in `wp13b-completion.test.ts` (real Intel, `/var` ↔
`/private/var` — this host's tmpdir is `/var/folders/…`, F_GETPATH
reports `/private/var/folders/…`):

- canonical (realpath'd) root → `created` ✓;
- the SAME directory through the lexical `/var/…` spelling →
  `parent-not-verified` — deliberately noncanonical evidence fails
  closed; **no lexical normalization is used as a substitute for
  identity**;
- a symlink alias of the root → refused at the O_NOFOLLOW anchor
  (`containment-denied`/`missing-parent`, fail-closed set).

Production consistency: writer roots come from the trusted control
plane's canonicalizeRoot (symlink-resolved — `src/trusted/roots.ts`:
"no lexical-only path can produce a validated canonical root"; ADR-042
decision 5), so accepted production evidence matches the vnode-canonical
F_GETPATH form.

## 9. Anchor/race sanity (§17)

Two new adapter-level probes (real filesystem):

1. **Recovery anchor:** the attempt-dir fd is retained; the lexical
   parent is renamed away and replaced by a decoy directory holding
   CONFLICTING bytes; create → `exists`; recovery through the RETAINED
   fd reads the retained original's exact bytes (never the decoy);
   cleanup removes the original's file while the decoy is untouched.
2. **Create anchor:** retained empty parent fd; rename + decoy
   replacement; create lands in the retained original (verified by path
   + `identityOf` on the moved object), never in the decoy.

MAC-3 owns the complete hostile race suite.

## 10. Guard updates (§19)

- `tests/writing/static-guard.test.ts`: new test for the writer adapter
  — the ONLY import is `#gateway-native` + the sibling `./adapter.js`;
  zero `node:fs`; forbidden tokens (incl. `/proc`, `/dev/fd`, generic
  path authority, arbitrary flags/modes, shell/subprocess); the
  DISTINCT `exists` recovery routing and the fixed-flag recovery open
  are asserted. No broad scan was weakened: the `security.test.ts`
  boundary exclusion (`/internal/darwin-fs/`) was established in MAC-2B
  and covers the new sibling module; the wp13b completion guard still
  proves writer.ts is the only `node:fs` module in the completion
  family (unchanged, green).

## 11. `/proc` audit (§18)

`src/completion/writer.ts` + `src/internal/darwin-fs/writer.ts`: zero
active `/proc/self/fd`, zero `/dev/fd`, zero `readlinkSync`, zero
lexical fd-path builders, zero path-derived create/unlink, zero
`getPath`-feeding-mutation (structurally impossible: identity helpers
return booleans/typed results, never paths into mutations), zero
arbitrary flags/modes. Verified in source AND in compiled
`dist/completion/writer.js`.

## 12. Focused verification — exact totals (real Intel)

```
tests/unit/wp13b-completion.test.js        22 pass / 0 fail  (flow + §15 + FIFO
                                                              child-process; 22 tests in
                                                              file — INFO-1 transcription
                                                              correction, senior review)
tests/unit/wp13b-darwin-writer-adapter.test.js  8 pass / 0 fail (adapter + §17 anchors)
tests/unit/wp13b-static-guard.test.js       4 pass / 0 fail  (completion guard; 4 tests
                                                              in file — INFO-1 transcription
                                                              correction, senior review)
tests/writing/*                             63 pass / 0 fail  (neighbor regression:
                                                              guard extension; executor
                                                              adapter unchanged)
tests/mcp/unit/persist.test.js              10 pass / 0 fail
tests/security/security.test.js             15 pass / 0 fail
npm run test:native                         42 pass / 0 fail  (seam unchanged)
git diff --check                            clean
```

Total focused: **164 pass / 0 fail**. No reader suites, no
readDirectoryEntries work, no host-lane tests, no runtime MCP E2E, no
full historical regression.

## 13. Scope containment (§21)

Changed: `src/completion/writer.ts`, `src/internal/darwin-fs/writer.ts`
(new), `tests/unit/wp13b-completion.test.ts`,
`tests/unit/wp13b-darwin-writer-adapter.test.ts` (new),
`tests/writing/static-guard.test.ts`. Zero changes to
`src/reader/fs.ts`, `src/reader/service.ts`, the native C implementation,
native exports, host lanes, runtime composition, package/product
identity, schemas, MCP tool surface. `src/writing/executor.ts` and the
executor adapter are behaviorally unchanged.

## 14. Explicit non-claims

- `persist-artifact` is still NOT claimed product-E2E fixed
  (MAC-2F/MAC-2G);
- the reader remains blocked on its native enumeration extension —
  `readDirectoryEntries` has NOT been implemented;
- MAC-2D-NATIVE has NOT begun;
- remaining slices: **MAC-2D-NATIVE** (reader extension), **MAC-2D**
  (reader integration), **MAC-2E** (darwin-only scope + product
  identity), **MAC-2F** (runtime composition + real Intel MCP persist),
  **MAC-2G** (integrated closure).

**Verdict: `MAC-2C — READY FOR SENIOR REVIEW`** — W1–W7 mapping
implemented; zero active `/proc` dependency; create/recovery/cleanup
semantics intact; `already-exact` adoption preserved (real-seam matrix
green); canonical identity proven on real Intel/APFS including the
`/var` ↔ `/private/var` case; 164 focused tests pass; no unrelated
scope drift.
