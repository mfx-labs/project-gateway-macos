# MAC-2B — Writing Executor Integration (Gate Report)

**Verdict: `MAC-2B — ACCEPTED`** (final durable status, MAC-2B closure gate)
**Closure state: `MAC-2B — LOCALLY BASELINED`**

Closure record (gate chain, 2026-08-15): implementation completed →
`MAC-2B SENIOR REVIEW — ACCEPTED` (independent review; E1–E9 mapping
verified one-for-one, all sixteen inherited controlled-write invariants
intact, no active `/proc` dependency in the executor, adapter is a
narrow capability bridge with no path authority, 129/129 focused tests
reproduced on real Intel, no correction required) → this local baseline
commit. The senior-review verdict is authoritative; no correction gate
was needed.

- MAC-2B is **locally baselined** in this repository only. No
  push/tag/publish/release/deploy occurred.
- **MAC-2C (completion writer integration) has NOT started.**
  `src/completion/writer.ts` remains on the inherited Linux model.
- `persist-artifact` is NOT claimed product-E2E fixed (MAC-2F/MAC-2G).

**Original gate record (pre-closure) — historical, not superseded:**
**Date:** 2026-08-15 (host local time)
**Host:** macOS 12 (Darwin 21.6.0), x86_64 (Intel), Node v22.23.1.
**Starting SHA:** `82d742ef18467527f42be32b0bb92e1154073b05` (verified;
tracked working tree clean; MAC-1 native tests 42/42; native export
surface exactly five functions).
**Audit authority:** `docs/reports/mac-2a-production-integration-contract-audit.md`
(executor: `NATIVE SEAM SUFFICIENT`).

NOT committed. Nothing pushed/tagged/published. `src/completion/writer.ts`,
`src/reader/fs.ts`, the native C addon, native exports, host lanes,
runtime composition, package/product identity, schemas, protocol
identities, and the nine-tool MCP surface are untouched. The
pre-existing untracked rollback record
(`docs/reports/mac-2-aborted-gate-rollback.md`) was not included.

The ONLY production behavior changed in MAC-2B:
> Draft writing executor on Darwin uses the accepted native descriptor
> seam instead of Linux `/proc/self/fd`.

---

## 1. Files changed (exact)

| File | Change |
|---|---|
| `native/index.d.mts` | NEW — type declarations for the MAC-1 loader/addon (declaration-only; the seam implementation and its exports are untouched) |
| `package.json` | +`"imports": {"#gateway-native": "./native/index.mjs"}` — module-resolution plumbing so the adapter's loader import resolves identically from `src/`, `dist/`, and `dist-test/src/` (the two build layouts have different relative depths; a static relative import cannot work for both). Not identity; no other field touched |
| `src/internal/darwin-fs/adapter.ts` | NEW — the narrow Darwin integration adapter (see §3) |
| `src/writing/executor.ts` | Migration per MAC-2A §1 table (see §2); `/proc` mechanism removed; comments updated where they described the old mechanism |
| `tests/writing/darwin-fs-adapter.test.ts` | NEW — adapter-focused suite incl. anchor sanity (see §6) |
| `tests/writing/executor.test.ts` | One directly affected race assertion adjusted for the Darwin fail-closed code set; rest unchanged |
| `tests/writing/controlled-write.test.ts` | One directly affected race assertion adjusted (same Darwin difference) |
| `tests/writing/helpers.ts` | `makeFsWorkspace` roots now `realpathSync`-canonical (mirrors production `canonicalizeRoot`: "no lexical-only path can produce a validated canonical root"; the seam's F_GETPATH identity returns vnode-canonical paths) |
| `tests/writing/static-guard.test.ts` | Updated to the seam reality + extended to walk `src/internal/darwin-fs/`; comment-stripping (`codeOf`) added so accurate mechanism documentation never trips token checks (wp15 guard precedent) |
| `tests/security/security.test.ts` | `/internal/darwin-fs/` added to the dist-wide I/O-scan boundary exclusion with justification comment (covered by the writing guard + adapter suite) |

## 2. Linux mechanism → Darwin primitive mapping (as executed)

| # | Operation | Linux mechanism (removed) | Darwin primitive (now) |
|---|---|---|---|
| E1 | Root anchor | `openSync(root, O_RDONLY\|O_DIRECTORY\|O_NOFOLLOW)` (no `/proc`) | **unchanged, stays in Node** — seam begins only after the canonical root descriptor exists |
| E2 | Root fstat | `fstatSync(rootFd)` | unchanged (Node) |
| E3 | Parent open | `openSync('/proc/self/fd/<rootFd>/<ancestorRelative>', O_RDONLY\|O_DIRECTORY\|O_NOFOLLOW)` | `descentToParent(rootFd, ancestorRelativePath)` — one `openDirectoryAt(current, component)` per component, single-component only |
| E4 | Parent fstat | `fstatSync(parentFd)` | unchanged (Node), on the descended fd |
| E5 | Parent identity | `readlinkSync('/proc/self/fd/<parentFd>')` | `verifyParentIdentity(parentFd, canonicalExistingDirectoryAncestor)` → `getPath` (F_GETPATH); mismatch or native failure → `parent-not-verified` |
| E6 | Final create | `openSync('/proc/self/fd/<parentFd>/<final>', O_CREAT\|O_EXCL\|O_WRONLY\|O_NOFOLLOW, 0o600)` | `createExclusiveFile(parentFd, finalComponent)` → `createExclusiveFileAt` (seam-owned flags + fixed 0600) |
| E7 | fchmod/fstat verify | `fchmodSync(targetFd, DRAFT_FILE_MODE)` + fstat | **unchanged (Node, defense-in-depth retained)** — not simplified |
| E8 | Bounded write | `writeSync` loop on fd | unchanged (Node), raw fd from the seam |
| E9 | Cleanup | `unlinkSync('/proc/self/fd/<parentFd>/<final>')` | `unlinkCreated(parentFd, finalComponent)` → `unlinkAt` (same verified parent fd, same single component, at most one attempt) |

`fdRelativePath`, `readlinkSync`, `unlinkSync`, and the create-flags
literals are gone from the executor. Remaining `/proc`/`readlinkSync`/
`unlinkSync` occurrences in the file are documentation comments only
(verified in compiled `dist/writing/executor.js`).

## 3. Adapter API (`src/internal/darwin-fs/adapter.ts`)

Closed executor-specific surface (all results are typed discriminated
unions; nothing throws across the executor boundary):

- `descentToParent(rootFd, ancestorRelativePath)` →
  `{ok:true, parentFd}` | `{ok:false, code: ExecutorParentOpenCode}` —
  single-component descent; intermediates caller-owned, closed on every
  path; root fd never closed.
- `verifyParentIdentity(parentFd, expectedCanonicalAncestor)` →
  `{ok:true}` | `{ok:false, code:'parent-not-verified'}` — F_GETPATH
  equality; **the returned path is identity evidence only and is never
  fed into an open/create/unlink** (enforced structurally: the adapter
  has no path-accepting mutation and no path-returning mutation).
- `createExclusiveFile(parentFd, finalComponent)` →
  `{ok:true, fd}` | `{ok:false, code: ExecutorCreateCode}` — no mode
  argument; the seam owns mode 0600 and every flag.
- `unlinkCreated(parentFd, finalComponent)` → `'removed' | 'failed'` —
  at most one attempt, same verified parent fd + single component.
- `mapParentOpen(code)` / `mapCreate(code)` — pure position-aware
  native→executor code mapping (exported for direct testing; no
  authority).

The adapter has NO absolute-path operations, NO generic open/unlink, NO
arbitrary flags/modes, NO fallback (a missing/wrong-arch addon is a
typed `io-failure`, never a weaker path), NO `/proc`, NO `/dev/fd`, NO
shell/subprocess. Loader access is lazy (first use) via the sealed
`loadGatewayFs`; a load failure is caught and mapped to the inherited
`io-failure` code.

## 4. Native → executor error mapping (executor-position-aware)

| Native code | Parent descent (E3) | Final create (E6) | Cleanup (E9) |
|---|---|---|---|
| `not-found` | `missing-parent` | `missing-parent` | `failed` |
| `exists` | `io-failure` (unreachable: no O_CREAT) | `exclusive-create-conflict` | `failed` |
| `not-directory` | `parent-not-directory` | `parent-not-directory` | `failed` |
| `symlink-refused` | `symlink-loop` | `exclusive-create-conflict` (inherited final-target conflict semantics) | `failed` |
| `permission-denied` | `permission-denied` | `permission-denied` | `failed` |
| `read-only` | `readonly-filesystem` | `readonly-filesystem` | `failed` |
| `no-space` / `quota` | `io-failure` (unreachable for opens) | `no-space` / `quota-exceeded` | `failed` |
| `unsupported` | `unsupported-filesystem` | `unsupported-filesystem` | `failed` |
| `invalid-input` / `invalid-fd` / `io-failure` / unknown | `io-failure` | `io-failure` | `failed` |

No native internal code is exposed through the public executor result;
the inherited executor taxonomy is not "improved". Recorded Darwin
nuance (both closed, both fail-closed): a symlink-to-directory at a
descent component surfaces as `not-directory` → `parent-not-directory`
on this kernel (Linux: ELOOP → `symlink-loop`); a post-revalidation
intermediate swap therefore fails at open time on Darwin instead of at
the identity check — strictly stronger, same security property.

## 5. Descriptor ownership / lifetime analysis (traced path by path)

| Path | rootFd | intermediate fds | final parentFd | created fd |
|---|---|---|---|---|
| A. success | open, closed in `finally` | closed by adapter after descent | executor-owned, closed in `finally` | closed by executor after write/close |
| B. parent-open failure | closed in `finally` | closed by adapter on the failure path | n/a | n/a |
| C. parent-fstat failure | closed in `finally` | n/a (closed) | closed in `finally` (returned early) | n/a |
| D. parent-identity failure | closed in `finally` | n/a | closed in `finally` (returned early) | n/a |
| E. create failure | closed in `finally` | n/a | closed in `finally` | n/a (seam created nothing) |
| F. fchmod/fstat failure | closed in `finally` | n/a | remains open THROUGH cleanup (same verified parent), then `finally` | cleanup-unlinked or left, closed in `finally` |
| G. write failure | closed in `finally` | n/a | open through cleanup, then `finally` | cleanup-unlinked (or `failed`), closed |
| H. cleanup failure | closed in `finally` | n/a | open through cleanup, then `finally` | closed; target remains (truthful `failed`) |

- No fd leak (adapter closes intermediates on success and every failure
  path; executor `finally` closes fd/parentFd/rootFd on every path).
- No double close (each fd has exactly one owner; adapter never closes
  the root fd or a caller-provided fd; executor never closes adapter
  intermediates — they are already closed).
- No closing of native incoming fds (the addon never closes incoming
  fds; the adapter never closes `rootFd`; the executor's `finally`
  guards `parentFd !== rootFd`).
- Final parent remains valid through cleanup: cleanup runs inside the
  try, before the `finally` closes parentFd.
- Regression coverage: adapter 100-iteration fd-count stability test,
  missing-component leak check, and the executor's existing
  mid-write/close-failure cleanup tests (all green).

## 6. Focused tests — exact totals (real Intel hardware)

```
tests/writing/*                    62 pass / 0 fail   (executor 17, controlled-write
                                                       core 25, adapter 11, guards 7,
                                                       +2 race/static files… exact:
                                                       62 total in the writing suite)
tests/mcp/unit/persist.test.js     10 pass / 0 fail   (real executor + real seam:
                                                       persist-artifact unit surface)
tests/security/security.test.js    15 pass / 0 fail   (dist-wide I/O scan w/ new boundary)
npm run test:native                42 pass / 0 fail   (MAC-1 seam unchanged)
git diff --check                   clean
```

Total focused: **129 pass / 0 fail**. No completion/reader/runtime
E2E/historical suites were run (out of scope for this slice).

Real Intel executor evidence: successful create with exact bytes and
0600; umask-077 fixed-mode test; existing file/dir/live symlink/dangling
symlink → `exclusive-create-conflict` (no overwrite); missing parent →
`missing-parent` (no directory creation); symlink parent → fail closed,
never followed; intermediate-swap race → fail closed, nothing created
inside or outside; root-replacement-after-anchor → create pinned to the
anchored root; multi-component tail → rejected before any mutation;
partial-write failure → cleanup through the SAME retained parent fd
(`removed`), cleanup failure → truthful `failed` (indeterminate) with
the partial file remaining; close-failure → `close-failed` + cleanup.

## 7. Anchor sanity evidence (MAC-2B §15; MAC-3 owns the full suite)

`darwin-fs-adapter.test.ts` "anchor sanity": the verified parent
descriptor is retained; the lexical parent is renamed away; the old
pathname is replaced by (a) a decoy directory and (b) a symlink to a
decoy directory containing a same-named file; `createExclusiveFile` and
`unlinkCreated` through the retained fd land in the RETAINED original
(`parent-moved`), never in the decoy; `verifyParentIdentity` still
identifies the moved original. The executor's own root-replacement test
(`afterRootOpen` hook) pins the create to the originally anchored root.
Both green on real Intel.

## 8. Inherited executor invariants — one-by-one confirmation

1. descriptor-anchored mutation ✓ (descent/create/unlink all fd-relative)
2. retained root descriptor ✓ (Node `openSync`, unchanged, held through the operation)
3. descriptor-relative parent traversal ✓ (`openDirectoryAt` per component)
4. no intermediate symlink following ✓ (per-component O_NOFOLLOW — stronger than Linux single-path open)
5. descriptor-bound parent identity ✓ (`getPath` ≡ `parent-not-verified` semantics)
6. service-user ownership verification ✓ (root + parent fstat UID checks unchanged)
7. exactly one final create component ✓ (single-component tail invariant unchanged; multi-component tail → `missing-parent` before mutation)
8. `O_CREAT | O_EXCL` ✓ (seam-owned, `exists` → `exclusive-create-conflict`)
9. `O_NOFOLLOW` ✓ (seam-owned on every open)
10. fixed implementation-owned mode ✓ (seam 0600; Node `fchmodSync(fd, 0o600)` retained as defense-in-depth, umask-independent)
11. descriptor verification of created objects ✓ (Node fstat: file, UID, mode — retained)
12. bounded exact write ✓ (write loop untouched)
13. cleanup of only the object created by the operation ✓ (same final component)
14. cleanup through the same verified parent descriptor ✓ (`unlinkAt` on the retained parentFd)
15. no arbitrary caller absolute path becoming filesystem authority ✓ (evidence shape unchanged; adapter has no absolute-path API)
16. typed fail-closed errors ✓ (inherited vocabulary preserved; native codes never leak)

## 9. Static authority audit (§16)

Scanned the MAC-2B delta for `/proc`, `/dev/fd`, `realpath`+create/
unlink chaining, `getPath` followed by open/unlink, absolute-path
create/unlink, generic wrappers, arbitrary flags/modes, shell/exec/
subprocess. Result: no active authority tokens in code (remaining
matches are documentation comments and the inherited
`executeDraftFileWrite` name). The adapter structurally cannot chain
`getPath` output into a mutation (no mutation accepts a path). The
writing static guard now enforces this as a test: adapter forbidden
tokens, single create site, zero direct unlink, no `/proc`, no
`readlinkSync`.

## 10. Known remaining work (unchanged by this slice)

- Completion writer integration — **MAC-2C**
- Native reader extension (`readDirectoryEntries`) — **MAC-2D-NATIVE**
- Reader integration — **MAC-2D**
- Darwin-only scope + product identity — **MAC-2E**
- Runtime composition + real Intel MCP persist — **MAC-2F**
- Integrated MAC-2 closure (persist-artifact E2E claimed fixed only
  there) — **MAC-2G**

`persist-artifact` is NOT claimed E2E-fixed by this gate; the full
macOS Gateway is NOT claimed fixed.

**Verdict: `MAC-2B — READY FOR SENIOR REVIEW`** — no active `/proc`
dependency in the executor; the accepted five-function seam is used
correctly (MAC-2A mapping executed as audited); all sixteen inherited
write invariants intact; focused writing tests pass on real Intel;
descriptor/cleanup anchoring preserved (anchor sanity green); no
unrelated scope drift (delta limited to the authorized file set).
