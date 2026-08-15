# MAC-3A — Hostile Race Threat Matrix + Verification Contract

**Verdict: `MAC-3A — CLOSED / LOCALLY BASELINED`** (final durable
state; historical verdicts `MAC-3A — READY FOR SENIOR REVIEW` →
`MAC-3A SENIOR REVIEW — CORRECTIONS REQUIRED` → `MAC-3A — READY FOR
FOCUSED REREVIEW` → `MAC-3A FOCUSED REREVIEW — ACCEPTED` preserved —
see §24 gate chronology)
**Gate:** CONTRACT / COVERAGE AUDIT ONLY — zero production, native, test,
runner-manifest, or documentation-source changes. This report is the only
delta.
**Date:** host local time at gate execution
**Host:** macOS 12.6 (Darwin 21.6.0, xnu-8020.240.18.709.2), x86_64
(Intel), Node v22.23.1, Git 2.37.1 (Apple Git-137.1).
**Evidence boundary:** all runtime evidence in this gate is **Intel-only**.
No Apple Silicon hostile-race acceptance is claimed (see §18).

---

## 1. Freeze baseline (verified by `git rev-parse` / `git status` / `git tag`, not report text)

| Item | Value | Verified |
|---|---|---|
| HEAD | `1685bd7a748c267b623aae3ed48673c05d37ba83` | `git rev-parse HEAD` — exact match |
| HEAD subject | `docs: close macOS production integration` (MAC-2G closure commit) | `git show` |
| Parent of HEAD | `6dc92b70b8475d54f5613ffb720e024f6a64c49a` (MAC-2F `test: prove real Intel MCP persist`) | `git rev-parse HEAD^` |
| MAC-2 closure state | MAC-2 closure commit IS the frozen HEAD; MAC-3A therefore starts from exactly the accepted closure state | ancestry linear per MAC-2G §1 |
| Tracked working tree | CLEAN — `git status --porcelain` shows only `?? docs/reports/mac-2-aborted-gate-rollback.md` | `git status` |
| Preserved rollback report | `docs/reports/mac-2-aborted-gate-rollback.md` remains untracked, unmodified, unstaged | `git status` |
| MAC-3 begun? | NO — no mac-3 files anywhere (docs/reports, tests, src); no MAC-3B/C/D/E work packages touched | directory + content inspection |
| Tags | none (`git tag -l` empty) | `git tag` |
| Pushed / released | branch `main` is `ahead 10` of `upstream/main` — the entire MAC chain is local-only; no tags, no release artifacts, no publish evidence | `git branch -vv`, `git tag` |

Host/runtime fingerprint: `Darwin Serenes-MacBook-Pro.local 21.6.0
(root:xnu-8020.240.18.709.2~1/RELEASE_X86_64) x86_64`; Node v22.23.1;
Git 2.37.1 (Apple Git-137.1). Matches the MAC-2G closure fingerprint.

**All MAC-3A evidence on this host is Intel-only.** Do not claim Apple
Silicon hostile-race acceptance (§18).

---

## 2. Reconstructed accepted authority model (from current source; NOT redesigned)

Confirmed by reading the committed production source at the frozen HEAD.
The accepted model is the MAC-0/§4-§5 descriptor-anchored contract as
integrated by MAC-1/MAC-2B/2C/2D, with **zero active pathname-authority
fallback** in any macOS production path (MAC-2G §13 static audit green).

### 2.1 Writing executor (`src/writing/executor.ts` + `src/internal/darwin-fs/adapter.ts`)

1. Root anchor: `openSync(canonicalArtifactRoot, O_RDONLY|O_DIRECTORY|O_NOFOLLOW)`;
   fstat-verify (directory, service UID). Root fd retained for the whole
   operation. Test/host seam `hooks.afterRootOpen` runs here (accepted
   MAC-2B pattern).
2. Descent: `descentToParent(rootFd, ancestorRelativePath)` — one
   single-component `openDirectoryAt` (`openat(O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC)`)
   per component; intermediates closed after the full descent and on every
   failure path; root fd never closed by the adapter.
3. Parent verification: fstat (directory, service UID) + `verifyParentIdentity`
   (`fcntl(F_GETPATH)` equality against the accepted canonical ancestor —
   identity evidence only, never fed into an open/create/unlink). When the
   ancestor IS the root, the retained root fd is the verified parent.
4. Final create: `createExclusiveFileAt` — EXACTLY ONE final component,
   `O_CREAT|O_EXCL|O_WRONLY|O_NOFOLLOW|O_CLOEXEC`, mode fixed 0600 inside
   the native seam. Multi-component tails are rejected BEFORE any
   filesystem operation (`invalid-evidence` / `missing-parent`).
5. Created-object verification: `fchmod(0600)` + fstat (regular file,
   service UID, exact mode).
6. Bounded exact write: `writeLoop` over `writeSync(fd, …)`; short writes
   continue; zero/negative/non-integer/oversize → fail closed. Seams
   `hooks.beforeWrite` / `hooks.afterWrite` bracket the write.
7. Close; typed result. Cleanup (at most one attempt) through the SAME
   verified parent fd + SAME single component (`unlinkAt`, no
   AT_REMOVEDIR) on any post-create failure.

### 2.2 Completion writer (`src/completion/writer.ts` + `src/internal/darwin-fs/writer.ts`)

1. Root anchor: `openSync(root, O_RDONLY|O_DIRECTORY|O_NOFOLLOW)`; fstat
   (directory, service UID); F_GETPATH identity == the vnode-canonical
   root (fails closed against non-canonical lexical spellings — MAC-2C).
   Seam `hooks.afterRootOpen` runs here.
2. Anchored descent: `openVerifiedDirectory` per component
   (`openDirectoryAt` + fstat directory/UID + F_GETPATH == expected
   resolved path); each returned fd retained (never re-resolved lexically).
3. Final exclusive create (`createExclusiveFileAt`); `exists` routes to
   recovery, never overwrite.
4. EEXIST recovery (`readExistingForRecovery`): `openExistingFileAt`
   (`O_RDONLY|O_NOFOLLOW|O_NONBLOCK|O_CLOEXEC` — FIFO can never block) →
   fstat (ordinary regular file, service UID, size == expected, size ≤
   byte ceiling) → bounded read → exact byte comparison →
   `already-exact` (observational only) or `exclusive-create-conflict`.
   A native open success is NEVER acceptance by itself.
5. Created path: bounded exact write → fstat verify (regular, UID, exact
   size) → `created`. Post-create failure → `cleanupCreated` through the
   same verified parent fd + same component (at most one attempt).
6. All fds closed on every path (recovery fd inner-finally; parent/root
   outer-finally).

### 2.3 Reader (`src/reader/fs.ts` + `src/internal/darwin-fs/reader.ts` + `src/reader/service.ts`)

1. Workspace root: `bindWorkspaceRoot` — FileHandle `O_RDONLY|O_DIRECTORY`
   on the canonical root; fd cached per workspace (`getRoot` map); the
   root target borrows the cached fd (`ownsFd:false`).
2. Containment: point-of-use decision (realpath-canonical
   `resolvedAbsolutePath`; SYM-006 resolves in-workspace symlinks). The
   descent base is the containment-RESOLVED canonical relative (MAC-2D §4
   mapping clarification); the lexical relative stays the correlation path.
3. Descent + final open: per-component `openDirectoryAt`; final file via
   `openExistingFileAt` (fixed flags), final directory via
   `openDirectoryAt`; fstat classify; type gates (file→regular,
   directory→directory); intermediates closed on every path (F-1 fix).
4. S-07 binding: `bindDescriptor` — `statResolvedTarget(resolvedAbsolutePath)`
   (fresh trusted internal stat at bind time) vs `statIdentity(fstat(target.fd))`;
   dev/ino/type equality; mismatch → `ERR-CON-DENIED`, target closed.
   **Accepted timing semantics (MAC-2D §5):** the identity evidence is
   taken immediately AROUND descriptor acquisition — a swap between the
   containment decision and the open is not distinguishable from the
   decision-time state; S-07 detects post-open swaps and type/identity
   mismatches relative to bind time. This is byte-identical to the
   accepted Linux lane. Recorded, not redesigned (§6 RACE-I09).
5. Reads/enumeration: `readFileBytes` (one bounded `readSync` at offset 0)
   and `listDirectoryEntries` bound to the opened fd.

### 2.4 Directory enumeration (`native/src/gateway_fs.c` `readDirectoryEntries`)

Caller fd → PRIVATE descriptor `openat(fd, ".", O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC)`
→ `fdopendir`/`readdir`/`closedir`. Caller fd never closed, duplicated, or
consumed; the private descriptor is a NEW open-file description (plain
`dup` was rejected because it shares the stream offset — MAC-2G FINDING-1
documentation closure). Bounded single pass (cap 10 000, off-by-one
truncation flag), bounded allocation, raw `d_type` kind hints, `.`/`..`
skipped, deterministic JS sorting/truncation downstream.

### 2.5 Residual lexical surface (recorded, not a race finding)

`inspectLogicalEntry` (`src/reader/fs.ts`) performs a **lexical** `lstat`
of the joined path (read-only metadata classification, no follow, no
bytes, no authority transfer). This is the inherited Linux behavior,
unchanged by MAC-2D; it is NOT descriptor-bound and makes no
descriptor-authority claim. Recorded here so MAC-3 scope is explicit:
inspect-metadata reports the object at the lexical path at call time.
No mutation or byte read is reachable from it.

---

## 3. Frozen native capability surface — exactly SIX JS-visible exports

Verified in `native/src/gateway_fs.c` (`napi_define_properties(..., 6, ...)`
with the six `EXPORT` rows), asserted by `native/test/surface.test.mjs`,
`native/test/loader.test.mjs:114`, and `tests/runtime/mac2f-e2e.test.ts:373`
(exact six-key assertion). No seventh primitive exists. MAC-3 verifies
these capabilities; it must not enlarge them.

| # | Export | Exact flags (native-fixed) | Accepted input | fd ownership | Output / error vocabulary | Security role | Mutates? |
|---|---|---|---|---|---|---|---|
| 1 | `openDirectoryAt` | `O_RDONLY\|O_DIRECTORY\|O_NOFOLLOW\|O_CLOEXEC` | `(fd: int 0..INT32_MAX, component: 1..PATH_MAX-1 chars, no "/" "." ".." NUL)`; arity exactly 2 | caller fd never closed/duplicated; new fd caller-owned only on success; closed by native on internal failure | `{ok:true,fd}` or `{ok:false,code}` | descriptor-relative descent step (executor, completion, reader) | no |
| 2 | `createExclusiveFileAt` | `O_CREAT\|O_EXCL\|O_WRONLY\|O_NOFOLLOW\|O_CLOEXEC`, mode **0600 hardcoded** (caller cannot supply a mode; 3rd arg rejected) | same as #1 | same | `{ok:true,fd}` / `{ok:false,code}`; any existing object (file/dir/symlink/dangling) = `exists` | exclusive create-only final step; never overwrite/truncate/adopt | **yes** (create) |
| 3 | `openExistingFileAt` | `O_RDONLY\|O_NOFOLLOW\|O_NONBLOCK\|O_CLOEXEC` | same as #1 | same | `{ok:true,fd}` / `{ok:false,code}`; final symlink = `symlink-refused` | recovery type-inspection open; acceptance still gated by Node fstat/read/compare | no |
| 4 | `unlinkAt` | `unlinkat(fd, comp, 0)` — no `AT_REMOVEDIR`; directory unlink fails `permission-denied` | same as #1 | caller fd untouched | `{ok:true}` / `{ok:false,code}` | at-most-one cleanup of the operation-created object | **yes** (unlink) |
| 5 | `getPath` | `fcntl(F_GETPATH)` on bounded `PATH_MAX` stack buffer | `(fd)` arity exactly 1 | none (no fd created) | `{ok:true,path}` / `{ok:false,code}`; NUL-bounded; rename reports the NEW path (divergence property) | descriptor-bound parent identity evidence; never fed into open/create/unlink | no |
| 6 | `readDirectoryEntries` | private `openat(fd, ".", O_RDONLY\|O_DIRECTORY\|O_NOFOLLOW\|O_CLOEXEC)` + `fdopendir`/`readdir`/`closedir`; cap 10 000; bounded calloc | `(fd)` arity exactly 1 | caller fd never consumed/closed/duplicated; private fd owned by the stream, closed exactly once on every path | `{ok:true,entries:[{name,kindHint}],truncated}` / `{ok:false,code}` | descriptor-bound bounded enumeration; independent stream offset per call | no |

Closed native error vocabulary (never errno numbers, paths, or stacks):
`not-found`, `exists`, `not-directory`, `symlink-refused` (also EMLINK),
`permission-denied` (EACCES/EPERM), `read-only`, `no-space`, `quota`,
`unsupported` (EOPNOTSUPP/ENOTSUP), `invalid-fd`, `invalid-input`,
`io-failure` (default). `napi_throw` only on internal result-construction
failure AFTER any created fd is closed. Malformed input is a typed
failure, never a crash (randomized-input test green).

Native → consumer mappings (closed, position-aware): executor
(adapter.ts `mapParentOpen`/`mapCreate`), completion (writer.ts
`mapWriterDescent`/`mapWriterCreate`/`mapWriterRecovery`), reader
(reader.ts `mapReaderOpen`). Static guards assert no `/proc`, no
`/dev/fd`, no generic fs authority in the adapters (MAC-2G §13; guards
green in this gate).

---

## 4. Hostile actor model

**Attacker:** a concurrent actor able to mutate pathname-visible workspace
state during Gateway operations, subject to ordinary service-user
permissions. At minimum the attacker may, repeatedly and concurrently:

- rename directories; rename files;
- replace a pathname with another directory or another file;
- insert/remove symlinks (in-root and out-of-root targets);
- switch a pathname between directory/file/symlink;
- create the destination before Gateway does;
- delete/recreate pathname-visible parents;
- move the original object elsewhere; place decoy objects at the old
  lexical pathname.

**The attacker does NOT automatically have:** root; kernel compromise;
ability to forge an already-open fd; ability to mutate kernel descriptor
identity; arbitrary mount privileges.

**Privileged mount/filesystem attacks are OUT OF SCOPE.** No accepted
contract (MAC-0…MAC-2G, WP-7, ADR-042/043) includes mount creation,
bind-mount redirection, or other privileged filesystem topology attacks
in the attacker model; they are stated as out of scope here and remain so
unless a later contract says otherwise. (Operational note: service
workspace roots are service-user-owned directories; a same-UID attacker
is the strongest in-model actor, and the model does not exclude one.)

**An attacker with write authority on the verified parent directory is
the strongest in-model case for name-level races** (rename/swap at the
final component). Cleanup semantics for that case are recorded in §14
(name-bound cleanup within the verified parent — inherited Linux
semantics, see RACE-I06).

---

## 5. Verification invariants (stable IDs; preserve these properties)

| ID | Property | Accepted semantics (source-confirmed) | Current status (§9) |
|---|---|---|---|
| RACE-I01 | Root descriptor authority: once a trusted root descriptor is retained, lexical rename/replacement of the root pathname must not redirect authority to a decoy root | root fd retained for the whole operation; all descent/create/unlink is fd-relative | **PROVEN** |
| RACE-I02 | Intermediate descriptor authority: once an intermediate directory descriptor is opened, rename/replacement of its old pathname must not redirect subsequent descriptor-relative work | each step opens relative to the previously retained fd | **PARTIALLY PROVEN** |
| RACE-I03 | No symlink traversal: a hostile symlink in a future descent/final component must fail closed, never become authority | O_NOFOLLOW on every openat; ELOOP→`symlink-refused` at native, closed mapping downstream | **PROVEN** |
| RACE-I04 | Final create exclusivity: a hostile actor winning the final-name race must cause closed conflict, never overwrite/truncate/adopt an unverified object | O_EXCL; any existing object → `exists`; recovery adoption is separately gated (§2.2) | **PROVEN** |
| RACE-I05 | Parent identity: prospective destination authority must remain bound to the verified parent descriptor, not its later lexical pathname | F_GETPATH equality at verify time; create/unlink never re-resolve lexically. **Recorded boundary:** same-path DIRECTORY replacement (no rename) is not distinguishable by path identity — identical to the accepted Linux lane; the WP-6 decision + service-UID gates are the accepted defense. | **PARTIALLY PROVEN** |
| RACE-I06 | Cleanup provenance: failure cleanup is at most ONE best-effort unlink, through the SAME retained verified parent descriptor, against the SAME single final component; authority never leaves that verified parent and cleanup never performs lexical rediscovery. Create-exclusivity guarantees no pre-existing object existed at the component. If a same-UID attacker replaces the component AFTER creation, cleanup is name-bound and MAY remove the replacement object at that component — the frozen accepted boundary, not a MAC-3 redesign (the attacker already holds parent mutation authority; Gateway gains no authority outside the retained parent) | create-exclusivity guarantees no pre-existing object at the component; unlink is fd-anchored (never leaves the verified parent). **Recorded boundary (inherited Linux semantics):** cleanup is NAME-bound within the verified parent — a post-create attacker (with parent-write authority) swapping the created file for a decoy at the same name can make cleanup remove the swapped-in object. The removed object is attacker-placed, inside the verified parent, at exactly the created component; authority never widens. MAC-3B locks this semantics with a test, not a redesign. | **PARTIALLY PROVEN** |
| RACE-I07 | Completion recovery identity: EEXIST recovery must inspect only the descriptor-relative existing object; never follow a substituted symlink or pathname redirect | recovery open via `openExistingFileAt` on the verified parent fd; O_NOFOLLOW; all checks on the recovery fd | **PARTIALLY PROVEN** |
| RACE-I08 | Recovery observational-only: recovery must never mutate an existing target merely to make it acceptable | recovery = open + fstat + bounded read + byte compare; zero mutation primitives reachable | **PROVEN** |
| RACE-I09 | Reader pre-open revalidation: if accepted target identity changes before descriptor open/bind, fail closed or bind only the accepted object per the existing S-07 contract | S-07 evidence is taken immediately around descriptor acquisition (MAC-2D §5): post-open swap → dev/ino/type mismatch → `ERR-CON-DENIED`; pre-open symlink swap → O_NOFOLLOW `not-found`; pre-open same-type regular-file swap binds the bind-time resolved object (accepted contract, Linux-identical) | **PARTIALLY PROVEN** |
| RACE-I10 | Reader post-open stability: after open + binding, later lexical rename/replacement must not redirect bytes/listing | reads/enumeration on the owned fd only | **PROVEN** |
| RACE-I11 | Enumeration anchor: enumeration remains bound to the opened directory even if its lexical pathname is renamed/replaced during enumeration | private descriptor via `openat(fd, ".")`; no pathname use during the pass | **PROVEN** |
| RACE-I12 | Enumeration offset isolation: repeated enumerations from the same caller fd have independent stream offsets | private open-file description per call; `dup` rejected | **PROVEN** |
| RACE-I13 | Descriptor lifetime: all success/failure/race paths release operation-owned descriptors exactly once, preserving borrowed/root ownership | executor finally-block + adapter close-every-path; reader closeOpened + OpenedTarget.close; native single-owner rules; F-1 regression | **PARTIALLY PROVEN** (completion writer has no fd-count test) |
| RACE-I14 | Resource pressure fail-closed: descriptor exhaustion/resource pressure must not cause pathname fallback, authority widening, or cleanup of unrelated objects | no fallback exists by construction (static guards); typed failures only | **PARTIALLY PROVEN** |
| RACE-I15 | Concurrent same-destination writers: two concurrent valid creators for the same final destination produce at most one created object; the loser fails closed | O_EXCL + typed `exclusive-create-conflict`/recovery | **UNPROVEN** (sequential conflicts proven; no true concurrency test) |
| RACE-I16 | No cross-root redirect: no churn combination may cause read/write/cleanup outside the configured trusted root | descriptor anchoring + F_GETPATH + S-07; zero pathname opens | **PARTIALLY PROVEN** |

---

## 6. Writing executor — attack windows

Trace of `executeDraftFileWrite` (all synchronous; windows are
kernel-operation boundaries inside one call, plus the accepted hook
boundaries).

| Window | State | Hostile mutation | Expected result | Invariant | Existing evidence | Missing evidence / strategy |
|---|---|---|---|---|---|---|
| W-W1 | after root fd retained, before first descent | rename root away + decoy dir/symlink at root path | create stays in the ORIGINAL root (fd authority); decoy untouched | RACE-I01 | **PROVEN** — `executor.test.ts` "root replaced AFTER anchoring" (A-type hook); `controlled-write.test.ts` "descriptor anchor … post-anchor root replacement" | — |
| W-W2 | after intermediate dir opened, before opening next component | rename/replace that intermediate; decoy at old path | next component opens through the RETAINED fd (original object) | RACE-I02 | PARTIAL — descent integrity (`darwin-fs-adapter.test.ts` 69/85/100/111); retained-fd authority proven at parent level (`adapter` 184, `wp13b-darwin-writer-adapter` 182) | direct primitive sequencing (B-type, no hook): `openDirectoryAt(root,'a')` → churn `a` → `openDirectoryAt(retained,'b')` → assert original. MAC-3C |
| W-W3 | after final parent fd acquired, before F_GETPATH identity | rename the parent (F_GETPATH now diverges); or same-path dir replacement | rename → `parent-not-verified` (fail closed); same-path replacement → binds the accepted pathname (recorded Linux-identical semantics, §5 I05) | RACE-I05 | PARTIAL — mechanism proven piecewise: `adapter` 124 (mismatch fails), `native primitives` 219 (rename updates F_GETPATH), `wp13b` 734 (root canonical identity) | combined sequence, B-type, no hook: descent → rename → `verifyParentIdentity` → `parent-not-verified`. Plus a semantics-locking test for same-path replacement. MAC-3C |
| W-W4 | after identity verification, before `createExclusiveFileAt` | rename/replace the verified parent | create lands in the verified ORIGINAL object (fd-bound); no pathname use in this window | RACE-I05, I02 | **PROVEN by construction + direct evidence** — create is fd-relative (`adapter` 184, `executor` 234, `wp13b-darwin-writer-adapter` 182) | — |
| W-W5 | after successful exclusive create, before created-fd verification | any lexical churn of the created name | verification (fchmod/fstat on own fd) unaffected; decoy can never be adopted (fd is the created object) | RACE-I04, I13 | **PROVEN by construction** — zero pathname use between create and verify | optional: churn inside a new hook is NOT required; skip (YAGNI) |
| W-W6 | after verification, during bounded write | rename/replace file or parent; decoy at old names | bytes go to the created fd (original object); decoy never receives bytes | RACE-I02, I10 | PARTIAL — write is fd-bound; injected write failure + chmod-during-write exist (`executor` 299/309, `controlled-write` 692/703) | rename-during-write via EXISTING `beforeWrite`/`afterWrite` hooks (A-type, no new seam): churn then write; assert original receives bytes. MAC-3C |
| W-W7 | after create/write, before failure cleanup | final name swapped: created file renamed away, decoy planted at the name; or parent churn | cleanup unlinks through the verified parent fd + same component (name-bound — see §5 I06); parent churn irrelevant (fd anchor) | RACE-I06, I02, I16 | PARTIAL — cleanup paths proven (`executor` 299/326, `controlled-write` 675, `adapter` 184-B); decoy-at-name pre-cleanup untested | EXISTING `beforeWrite` hook: rename created file, plant decoy, throw → assert name-bound outcome recorded (decoy removed / original kept per §14). MAC-3C |
| W-W8 | during descriptor-relative cleanup while the lexical parent pathname is replaced | old parent path now decoy dir or symlink | unlinkat through retained parent fd; decoy untouched | RACE-I02, I06 | **PROVEN** — `adapter` 184 (replacement B: symlink decoy at old path, retained-fd unlink, decoy untouched); `wp13b-darwin-writer-adapter` 145 (cleanup with lexical parent replaced) | — |

---

## 7. Completion recovery — attack windows

| Window | State | Hostile mutation | Expected result | Invariant | Existing evidence | Missing evidence / strategy |
|---|---|---|---|---|---|---|
| W-C1 | hostile target pre-created before exclusive create | exact-bytes regular file / conflicting file / dir / symlink / FIFO | create → `exists` → recovery gates: exact → `already-exact` (adopt, observational); conflicting → `exclusive-create-conflict`; symlink/FIFO/dir → conflict (never `already-exact`, never blocks) | RACE-I04, I07, I08 | **PROVEN** — `wp13b-completion.test.ts` 435/450/628/645/674; `wp13b-darwin-writer-adapter` 80 | — |
| W-C2 | EEXIST observed, target replaced before recovery open | decoy (different bytes) / symlink / dir at the name | recovery open is fd-relative → inspects the CURRENT name object, gated by fstat(regular,uid,size)+bytes: exact → adopt; else conflict; symlink → `symlink-refused`→conflict | RACE-I07 | PARTIAL — the recovery GATES are proven at W-C1 states (same states, earlier timing); the mid-window swap itself is unobserved (create→recovery is one synchronous call, no interleave point) | **TEST-ONLY hook required** for determinism: `afterCreateConflict` (design §11). MAC-3B implements, MAC-3C tests |
| W-C3 | target swapped to symlink before recovery open | symlink (dangling or exact-bytes) | refused at open (`symlink-refused` → `exclusive-create-conflict`); exact-bytes symlink NEVER `already-exact` | RACE-I03, I07 | PARTIAL — refusal proven at primitive (`native primitives` 154, `wp13b-darwin-writer-adapter` 101) and sequential states (W-C1); mid-window variant shares the W-C2 hook | same hook as W-C2 |
| W-C4 | target renamed/replaced AFTER recovery fd opens | any churn | all checks (fstat/size/read/compare) fd-bound; no pathname use after open; churn cannot redirect | RACE-I07, I10 | **PROVEN by construction** + direct evidence `wp13b-darwin-writer-adapter` 145 (recovery through retained fd with parent churned) | — |
| W-C5 | target bytes/type/mode/uid differ | conflicting bytes; wrong uid; FIFO; dir; socket | typed conflict / ownership-mismatch; never adoption | RACE-I07, I08 | **PROVEN** — `wp13b` 435 (bytes), 465 (ownership), 674 (FIFO); `wp13b-darwin-writer-adapter` 101. Note: mode is NOT verified in recovery (inherited contract) — record as accepted | — |
| W-C6 | lexical parent renamed/replaced while recovery fd valid | parent churn | recovery bound to verified parent fd; churn irrelevant | RACE-I02, I06 | **PROVEN by construction** + `wp13b-darwin-writer-adapter` 145 | — |
| W-C7 | concurrent exact-existing vs conflicting writer | two writers, same destination, interleaved | at most one `created`; loser: exact bytes → `already-exact`, else conflict | RACE-I15 | **UNPROVEN** — sequential conflicts proven (`wp13b` 311/435); no interleaved pair | deterministic reentrant interleave with EXISTING `afterRootOpen` hook (writer A's hook synchronously runs writer B; B creates; A resumes → EEXIST → recovery). No new seam. MAC-3C |
| W-C8 | cleanup after a create-path failure while a decoy sits at the old lexical path | post-create failure + name/parent churn | cleanup through verified parent fd + same component; decoy at OLD PATH untouched; decoy at the NAME per §5 I06 name-bound record | RACE-I06, I16 | **UNPROVEN** — no completion-writer created-path cleanup test exists at all; deterministic post-create failure induction is impossible without a seam (write to own 0600 fd fails only on ENOSPC/EIO, not injectable) | **TEST-ONLY write-stage hook required** in `src/completion/writer.ts` (design §11). MAC-3B implements, MAC-3C tests |

---

## 8. Reader — attack windows

| Window | State | Hostile mutation | Expected result (fail closed before open / retained-original authority after open) | Invariant | Existing evidence | Missing evidence / strategy |
|---|---|---|---|---|---|---|
| W-R1 | containment/stat evidence obtained, target replaced before descriptor open | final → symlink / dir / different regular file | symlink → O_NOFOLLOW `not-found` (decoy never read); dir → classify gate `unsupported-type`; different regular file → binds the bind-time resolved object per accepted S-07 (Linux-identical) | RACE-I09 | PARTIAL — symlink case **PROVEN** (`anchors.test.ts` pre-open symlink swap → `not-found`); dir-case gate untested directly; regular-file case = accepted semantics, not yet locked by a test | B-type fs-layer tests (no hooks): pre-arranged states + `openForRead`; plus an S-07 semantics-locking test using exported `statResolvedTarget`/`verifyDescriptorIdentity`. MAC-3D |
| W-R2 | intermediate component replaced by symlink before descent | `a/b/file` with `a` → symlink | `openDirectoryAt` refuses at that component → `not-found`; decoy never reached | RACE-I03 | **PROVEN** — `anchors.test.ts` test 5 (`sub` IS the intermediate); per-component O_NOFOLLOW by construction | — |
| W-R3 | final component replaced by symlink before open | final → symlink | `openExistingFileAt` refuses → `not-found` | RACE-I03 | PARTIAL — primitive-level proven (`native primitives` 154); integrated pre-open final swap untested | B-type fs-layer test, no hook. MAC-3D |
| W-R4 | descriptor opened, lexical target replaced before S-07 fstat | final file renamed away + decoy at path | `statResolvedTarget` (bind-time) vs `fstat(opened)` → dev/ino/type mismatch → `ERR-CON-DENIED`, target closed | RACE-I09 | PARTIAL — machinery in `service.ts` bindDescriptor; post-open churn proven at fs layer (`anchors` 1-4); the S-07 mismatch RESULT untested at service level | deterministic: `openForRead` → churn → compare exported `statResolvedTarget` vs `statIdentity(fstat(fd))` → mismatch; plus a service-level `ERR-CON-DENIED` test. MAC-3D |
| W-R5 | S-07 passes, lexical pathname replaced before read | parent renamed + decoy dir/symlink at old path | read returns ORIGINAL bytes; decoy never read | RACE-I10 | **PROVEN** — `anchors.test.ts` 1-2 (ORIGINAL-BYTES asserted, DECOY-BYTES never) | — |
| W-R6 | file renamed/replaced while bytes are read | churn during read | single bounded `readSync` on owned fd; no pathname use | RACE-I10 | **PROVEN by construction** + `anchors` 1 (churn before read) | — |
| W-R7 | directory renamed/replaced before enumeration | parent renamed + decoy dir/symlink | entries from the retained ORIGINAL | RACE-I11 | **PROVEN** — `anchors.test.ts` 3-4 | — |
| W-R8 | directory renamed/replaced DURING enumeration | churn mid-pass | private descriptor bound to the opened vnode; decoy at old path never consulted; kernel snapshot semantics only | RACE-I11 | **PROVEN by construction** — the native pass is a single `fdopendir`/`readdir` loop on the private fd with zero pathname use; mid-pass injection impossible without native hooks (correctly so) | — |
| W-R9 | root lexical pathname replaced while root fd cached | root renamed + decoy root planted | fs layer: reads/enumeration from the RETAINED original root; service layer: S-07 mismatch vs re-resolved decision → `ERR-CON-DENIED` (fail closed) | RACE-I01, I09 | PARTIAL — root fd caching exists (`service.ts` getRoot); the root-level anchor property untested (anchors tests are sub-level); service-level mismatch untested | deterministic B-type: bind root → churn root → openForRead (original bytes); service-level: decision under decoy root → containment/S-07 → closed code. MAC-3D |
| W-R10 | repeated failing descents under load → fd stability | N repeated failures | typed `not-found`/`unsupported-type`; fd count stable; service usable | RACE-I13, I14 | **PROVEN** — `fd-stability.test.ts` (160 failures, `fd count grew: before -> after` assert); `native malformed` 141 (fd-leak check) | — |

---

## 9. Existing coverage inventory (committed, frozen HEAD)

| Suite | File(s) | Content relevant to MAC-3 | Race-shaped evidence |
|---|---|---|---|
| MAC-1 native | `native/test/primitives.test.mjs`, `anchors.test.mjs`, `enumeration.test.mjs`, `malformed.test.mjs`, `loader.test.mjs`, `surface.test.mjs` (54/54 green) | every primitive: flags, exclusivity, symlink refusal, fixed mode, umask independence, malformed input, fd-leak checks, six-export surface, wrong-arch fail-closed, cap-drift guard | B-type anchors: create/open/unlink through retained fd after rename+replacement (31/58/81); enumeration anchors (85/104); repeated-call independence (70); F_GETPATH rename divergence (219) |
| MAC-2B writing | `tests/writing/executor.test.ts` (16), `controlled-write.test.ts` (31), `darwin-fs-adapter.test.ts` (12), `static-guard.test.ts` | executor evidence validation, single-component invariant, symlink-at-parent, swapped intermediate, root replacement, cleanup removed/failed, mode/umask, writeLoop | **A-type hooks** (`afterRootOpen`/`beforeWrite`/`afterWrite`): post-anchor root replacement (executor 234, controlled-write 367); injected mid-write failures (299/309/692/703); **B-type** anchor sanity (adapter 184), target-appears-between-eval-and-open (308), raced missing tail scenario A (395), swapped intermediate (330), tail symlink scenarios B/E (421/444) |
| MAC-2C completion | `tests/unit/wp13b-completion.test.ts` (24), `tests/unit/wp13b-darwin-writer-adapter.test.ts` (9) | adoption exact/conflict, symlink-never-already-exact, FIFO non-blocking, canonical root identity, byte ceiling | **A-type** parent swap after root anchoring (704, `afterRootOpen`); **B-type** anchors: recovery/create/cleanup through retained fd with lexical decoys (wp13b-adapter 145/182); F_GETPATH canonicality (734) |
| MAC-2D reader | `tests/wp7/reader/anchors.test.ts` (5), `fd-stability.test.ts` (1), `reader.test.ts` (23), `capture.test.ts` | descriptor-relative descent, FIFO non-block, in-workspace symlink follow, 23-code taxonomy, concurrency admission limit (4), cancellation | **B-type** anchors: post-open rename+decoy (dir/symlink) for read and enumeration (×4), pre-open symlink swap fail-closed (×1); F-1 fd-stability regression (80×2 failures, fd-count assert) |
| MAC-2D-NATIVE | `native/test/enumeration.test.mjs` | kind hints, hard cap off-by-one, socket→other | caller-fd non-consumption (70), fd-leak stability (183), anchors (85/104) |
| MAC-2F E2E | `tests/runtime/mac2f-e2e.test.ts` (3/3 green) | real Intel stdio MCP persist; six-export assert; conflict `write-denied` no overwrite; unknown workspace `write-denied`; server healthy after rejections; clean EOF | sequential conflict evidence at MCP level (no concurrency) |
| MCP persist | `tests/mcp/unit/persist.test.ts` (11) | kind gate, canonical-byte continuity, substitution mismatch, create-only conflict, containment lanes | sequential pre-existing-target conflict (232); no concurrent tests |
| WP-7 security | `tests/wp7/security/security.test.ts` (40 on Darwin; 37 pass + 3 documented `/proc` skips), `tests/security/security.test.ts` | static audits, mutation tripwires (workspace/.git/HOME unchanged), failure-path tripwires, FIFO rejection, child-process ownership evidence | no race-shaped filesystem tests; tripwires assert post-state, not mid-flight |
| Static guards | `tests/writing/static-guard.test.ts`, `tests/runtime/static-guard.test.ts` | no `/proc`/`/dev/fd`/generic fs authority; executor create-only; adapter surface; nine tools; zero stderr | guards are compile-time vocabulary checks — counted as construction evidence only, never as runtime race proof (§10) |

**Classification rule applied:** ordinary happy-path tests are NOT race
evidence; a static source guard is NOT runtime race proof. Only the
A-type / B-type tests listed above count as race evidence. Under that
rule the classification totals are: **PROVEN 21 · PARTIALLY PROVEN 18 ·
UNPROVEN 3** (**TOTAL 42**) across the exact 42-row universe
RACE-I01…I16 (16) + W-W1…W-W8 (8) + W-C1…W-C8 (8) + W-R1…W-R10 (10).
Verified breakdown — invariants 7 / 8 / 1; writing windows 4 / 4 / 0;
completion windows 4 / 2 / 2; reader windows 6 / 4 / 0; and
**21 + 18 + 3 = 42**. See §20 for the full row-by-row mapping; NO
per-row status was changed to fit the totals.

---

## 10. Deterministic evidence vs timing luck

Synchronization classification of every race-like test in the inventory:

| Class | Definition | Tests in this class |
|---|---|---|
| **A — deterministic boundary pause** | operation deliberately paused at an exact accepted seam; attacker mutation occurs; operation resumes | `executor` 234 (afterRootOpen), `controlled-write` 367, `wp13b` 704 (afterRootOpen); injected-failure hooks 299/309/326/333, `controlled-write` 692/703 |
| **B — structural sequencing** | retained descriptor opened FIRST, then lexical state deliberately replaced, then the next descriptor operation | native anchors 31/58/81, native enumeration 85/104/70, `adapter` 184, `wp13b-adapter` 145/182, `anchors` 1-5, `controlled-write` 308/330/395/421/444, native 219 |
| **C — probabilistic (loops/sleeps hoping to hit a race)** | **NONE found** in any security-critical suite | — |

`fd-stability.test.ts` repeats failures 160×, but it is NOT a race-win
gamble: it asserts a deterministic stability property (fd counts and
typed codes), which is legitimate repetition. The `security.test.ts`
leak-detection control child (752) is deterministic child-lifecycle
evidence, not a race.

**Acceptance rule for MAC-3:** security-critical properties must be
verified with A-type or B-type synchronization. C-type evidence is
insufficient for any RACE-Ixx/W-xx property. No sleep-based race tests
will be added.

---

## 11. Test-hook decisions

Preferred order applied: (1) natural structural sequencing with existing
APIs; (2) child-process/concurrent actors; (3) test-only dependency seam
already present; (4) narrowly scoped TEST-ONLY synchronization hook.
A production behavior-changing hook is forbidden. **Nothing is
implemented in MAC-3A.**

**Already present (rung 3, accepted MAC-2B/2C precedent):**
- `src/writing/executor.ts` — `input.hooks.afterRootOpen / beforeWrite / afterWrite`
  (optional bag members; absent in production callers; throwing hook =
  typed failure; documented as "test/host seam (the WP-11 race-coverage
  pattern)").
- `src/completion/writer.ts` — `input.hooks.afterRootOpen`.

**Deterministic coverage achievable with existing seams + B-type
sequencing (NO new hooks):** W-W1, W-W2, W-W3, W-W4, W-W6, W-W7, W-W8,
W-C1, W-C4, W-C5, W-C6, W-C7 (reentrant `afterRootOpen` interleave),
W-R1…W-R10 (fs-layer sequencing + exported `statResolvedTarget`/
`verifyDescriptorIdentity`), RACE-I01…I06, I08…I13.

**Required NEW test-only hooks — exactly two, both in
`src/completion/writer.ts` (rung 4):**

1. **`hooks.afterCreateConflict`** (name suggestion; MAC-3B owns the
   final name).
   - Exact boundary: after `createExclusiveFileWriter` returns
     `{ok:false, code:'exists'}`, immediately before
     `readExistingForRecovery` is invoked (writer.ts, created-path
     branch).
   - Why existing interfaces cannot expose the race deterministically:
     the create→recovery transition is synchronous inside one call; no
     interleave point exists; a child-process actor would reduce W-C2/
     W-C3 to class-C (probabilistic), which §10 forbids for
     security-critical windows.
   - Exclusion from production behavior: same pattern as the accepted
     `afterRootOpen` — optional member of the existing `hooks` bag,
     invoked only when present, absent in every production caller,
     zero behavior change otherwise. No new import, no new dependency.
   - Cleanup/failure semantics: hook throw → typed `io-failure` fail
     closed (no fd exists at that boundary; nothing to close; no
     mutation performed).
2. **A write-stage hook for the created path** (e.g., `hooks.beforeWrite`,
   matching the executor's name).
   - Exact boundary: after the exclusive create succeeds and `fd` is
     owned, immediately before the bounded write loop (writer.ts,
     created branch, step 4).
   - Why needed: W-C8 — deterministic induction of a post-create failure
     is otherwise impossible (write to an own 0600 fd fails only on
     ENOSPC/EIO; fstat-after-write failure is uninjectable; no other
     seam exists in the writer). This is the recorded gap of §14.
   - Exclusion/cleanup: identical pattern to (1); hook throw routes
     through the existing `created` cleanup path (the same code the
     write-failure catch already runs) — `cleanupCreated(parentFd,
     finalComponent)` then typed `io-failure`.
   - Note: the throwing-hook cleanup path itself then becomes
     deterministically testable (W-C8/C-W7/W-W7-analog).

No hook is required for: W-W5 (window contains zero pathname use —
proven by construction), W-R8 (single kernel pass on a private fd —
not injectable and correctly so), W-R4/W-R9 (exported S-07 functions
allow B-type sequencing).

**Source-shape statement (MAC-3B):** MAC-3B will modify
`src/completion/writer.ts` source shape by adding optional test-only hook
members, while production runtime behavior remains unchanged when the
hooks are absent. The hooks are not in MCP/public schemas; hook functions
cannot arrive through JSON; production callers pass no hooks; the hooks
add no new native/fs authority; no serialization path transports them.
They are NOT implemented in this gate.

---

## 12. Concurrent actor design

- **Primary mechanism: separate Node child process** (`spawn` of a small
  dedicated actor script under `tests/…/helpers`), used where true
  concurrency is the property under test (RACE-I15 integrated, RACE-I14
  fd-pressure, MAC-3E integrated churn). Child-process actor contract:
  - receives a fixture directory + iteration budget + mutation script via
    argv/env;
  - performs bounded pathname churn (rename/replace/symlink/decoy loops
    per §4) against a fixture that is a COPY of the workspace layout, or
    against a dedicated churn region when the operation under test
    targets a shared name;
  - exits 0 on budget completion; parent `await`s with a timeout and
    SIGKILLs on expiry; parent `finally` removes the fixture
    (child cannot outlive the fixture).
- **Deterministic in-process interleave** (preferred where it suffices,
  §11): reentrant hook choreography — the paused operation's hook
  synchronously runs the second operation, producing exact interleavings
  (W-C7, and paired same-destination executor tests via `beforeWrite`).
  No child process needed; no scheduler luck. **MAC-3C's reentrant
  interleave is deterministic ordering evidence, not literal parallel
  execution. It does not finally close RACE-I15; final
  concurrent-property closure remains owned by MAC-3E's true concurrent
  child/two-session evidence.**
- **fd-pressure isolation** (RACE-I14): a child process with a reduced
  descriptor limit (spawned under `ulimit -n`, or pre-opening N fds in
  the child before invoking the operation under test) — never
  machine-wide destructive exhaustion; the parent process is untouched.
- **Attacker lifecycle bounding:** spawn → bounded budget → awaited exit
  with timeout → kill → fixture removal in `finally`; assertion failure
  in the parent cleans the child up before propagating (mirrors the
  established child-process ownership evidence in `security.test.ts`).
- **Forbidden:** no MCP tool, no native debug capability, no worker-thread
  fd-sharing tricks for the security properties (a worker shares the fd
  table, so it cannot provide the descriptor-pressure isolation a child
  provides; pathname churn does not need a thread).

---

## 13. Cross-root decoy matrix

Trusted: `<root>/a/b` (b = destination or parent of destination).
`<root>` itself is the accepted canonical workspace/artifact root.

| # | When the descriptor was obtained | Churn performed | Operation | Expected behavior |
|---|---|---|---|---|
| D1 | BEFORE churn: fd for `<root>/a` retained (or `<root>` retained) | rename `<root>/a` → elsewhere; old path = **new directory** | create/descend/unlink through retained fd | continues against the ORIGINAL (moved) object; decoy untouched — authority acquired, churn irrelevant (RACE-I01/I02) |
| D2 | same | old path = **symlink to another in-root directory** | same | same as D1 (fd authority; symlink never followed) |
| D3 | same | old path = **symlink outside root** | same | same as D1 — the symlink is never even resolved (no pathname use) |
| D4 | same | old path = **regular file** | descend/create/unlink through retained fd | fd-relative ops unaffected by the file at the old name; a descend THROUGH the retained fd only touches the original tree |
| D5 | same | old path = **nested decoy hierarchy** | same | same as D1 |
| D6 | BEFORE churn: no descriptor yet | `<root>/a` renamed; decoy at old path (any kind D1-D5) | fresh descent `openDirectoryAt(root,'a')` + F_GETPATH identity | rename divergence → F_GETPATH ≠ accepted canonical ancestor → **`parent-not-verified` (executor/completion) — fail closed BEFORE create**; reader: containment re-evaluation decides (S-07 bind-time) |
| D7 | same | **same-path replacement** (decoy directory at `<root>/a` WITHOUT rename) | fresh descent + identity | path identity indistinguishable (F_GETPATH = same string) → descent proceeds into the decoy, gated by WP-6 decision + service-UID checks — **accepted Linux-identical semantics** (§5 I05); must be locked by a MAC-3C test documenting the boundary |
| D8 | BEFORE churn: no descriptor; `<root>` itself renamed | decoy root at `<root>` | executor/completion anchor | root `openSync` O_NOFOLLOW opens the DECOY (it is a fresh operation) → fstat/UID/F_GETPATH gates decide; if decoy is service-owned dir at the canonical path, operation proceeds against the accepted pathname object (decision-time semantics, Linux-identical). Root REPLACEMENT AFTER the anchor is impossible to redirect (RACE-I01, proven) |
| D9 | reader: root fd cached | `<root>` renamed + decoy root | `openForRead`/`listDirectoryEntries` | fs layer: retained original root authority (D1 semantics); service layer: S-07 vs re-resolved decision → `ERR-CON-DENIED` (fail closed) |

**Distinction (the one the matrix is built to make):** descriptor
obtained BEFORE churn ⇒ operation continues against the original object
(D1-D5, D9-fs); descriptor NOT yet obtained ⇒ fail closed at identity/
containment gates for rename/symlink churn (D6), or bind the accepted
pathname object under decision-time semantics for same-path replacement
(D7, D8). MAC-3C/3D/3E turn D1-D9 into tests.

---

## 14. Cleanup-race matrix

Post-create failure points and the races around each:

| Failure point (executor) | Induction | Deterministic? | Cleanup race | Expected cleanup result |
|---|---|---|---|---|
| fchmod/fstat verify failure (`verify-failed`) | chmod 0500 of root (existing test 703) or uid/mode mismatch | A-type via existing hooks (beforeWrite-side churn) or pre-arranged B-type | parent renamed/replaced; decoy at old path | `cleanupCreated(parentFd, comp)` — fd-anchored; at most one attempt; `removed` or `failed` typed |
| `beforeWrite` hook throw (`write-failed`) | existing seam (299/692) | A-type — EXISTING | **final name swapped**: created file renamed away + decoy planted at the name | name-bound within verified parent (§5 I06): the object at the created name is unlinked; record expected outcome per accepted semantics (decoy removed / original kept) — NEW MAC-3C test using existing hook |
| writeLoop failure (`write-failed`) | injected via hook; ENOSPC unreachable safely | A-type (hook) | parent churn | fd-anchored; parent churn irrelevant (proven 184-B) |
| `afterWrite` throw / close failure (`close-failed`) | existing seam (326/333) | A-type — EXISTING | created name replaced by a DIRECTORY | `unlinkat` no AT_REMOVEDIR → `permission-denied` → `failed` (indeterminate); directory NEVER deleted — NEW MAC-3C test |
| Completion writer: write failure / post-write fstat failure | **NOT deterministically injectable today** (no writer write-stage seam; ENOSPC/EIO only) | requires TEST-ONLY hook (design §11.2) | parent renamed/replaced; decoy at old path; decoy at name | `cleanupCreated` fd-anchored, same semantics; gap recorded — MAC-3B hook, MAC-3C tests |
| **Executor/completion shared:** lexical parent pathname replaced by symlink before cleanup | pre-arranged B-type (184-B pattern) | B-type — EXISTING evidence | old parent path = symlink decoy | unlink through retained fd; symlink decoy untouched — **PROVEN** |

Required property: cleanup reaches only the operation-created object
through retained descriptor authority, never outside the verified parent
(RACE-I06/I16); the name-bound boundary in the strongest same-UID case is
accepted inherited semantics and will be locked, not redesigned.

---

## 15. Resource exhaustion / fd-pressure audit

| Scenario | Existing evidence | Status | MAC-3 verification plan (bounded, isolated) |
|---|---|---|---|
| Repeated failed descent (reader) | `fd-stability.test.ts` (160 failures, fd-count stable) | PROVEN | carry forward; extend to enumeration-open failures |
| Repeated failed recovery | none | UNPROVEN | child/loop: N× EEXIST→conflict recovery cycles; assert fd stability + typed codes (RACE-I13/I14) |
| Repeated enumeration | `native enumeration` 183 (fd-leak), `malformed` 141 | PROVEN at native; extend at reader layer | loop `listDirectoryEntries` N× on one target fd; assert fd stability and full independence |
| EMFILE / descriptor pressure | none | UNPROVEN | isolated child with reduced `ulimit -n` (or pre-opened fds): drive descent/create/recovery/enumeration to EMFILE; assert typed `io-failure`/`permission-denied` mapping, NO pathname fallback (guards + behavior), no fd corruption, process still usable after fds released |
| ENOSPC | none (destructive) | NOT PLANNED | explicitly out of scope for MAC-3 (machine-wide destructive); the fail-closed path is structurally identical to EMFILE typing and covered by the pressure test |
| Child cleanup under assertion failure | `security.test.ts` 752 (leak-detection control child reaped) | PROVEN pattern | MAC-3B harness reuses the pattern; assert no orphaned churn children after a forced parent failure |
| Loader fail-closed under pressure | `loader.test.mjs` (missing/invalid/wrong-arch) | PROVEN | carry forward |

Security requirement (not merely "no leaks"): resource failure must never
activate a weaker path or broader authority — by construction there is no
fallback path; the pressure tests make that behavioral, not just textual.

---

## 16. Error taxonomy preservation

For every planned hostile case the expected result must stay inside the
accepted closed vocabulary; a race test that merely produced "an error"
is not accepted. No native errno/internal code may leak through public
MCP results (native returns mapped codes only; adapters map to closed
consumer vocabularies; MCP maps to the 23-code public model —
`reader.test.ts` "has exactly 23 closed codes"; guards assert no raw
stderr/path disclosure).

| Planned hostile case | Native | Executor | Completion | Reader | Public MCP |
|---|---|---|---|---|---|
| symlink at descent component | `symlink-refused` | `symlink-loop` | `containment-denied` | `not-found` | ERR-CON-DENIED / ERR-NOT-FOUND |
| symlink at final create | `symlink-refused`/`exists` | `exclusive-create-conflict` | `exclusive-create-conflict` | — | write-denied |
| rename divergence (F_GETPATH) | `path` differs | `parent-not-verified` | `parent-not-verified` | n/a (S-07) | ERR-CON-DENIED |
| target missing | `not-found` | `missing-parent` | `missing-parent` / `io-failure` (recovery) | `not-found` | ERR-NOT-FOUND |
| write denied (EACCES/EPERM) | `permission-denied` | `permission-denied` | `io-failure` (inherited collapse) | `permission-denied` | ERR-CON-DENIED / write-denied |
| FIFO at destination | opens (O_NONBLOCK) | n/a | fstat rejects → `exclusive-create-conflict` | `unsupported-type` | ERR-FTYPE-UNSUPPORTED |
| unsupported type | `unsupported`/`not-directory` | mapped | `io-failure` | `unsupported-type` | ERR-FTYPE-UNSUPPORTED |
| EMFILE | `io-failure` (default map) | `io-failure` | `io-failure` | `error` | ERR-INTERNAL-INVARIANT (closed) |
| unknown workspace — **reader lane** | n/a | n/a | n/a | n/a | ERR-WS-UNKNOWN |
| unknown workspace — **persist lane** | n/a | n/a | n/a | n/a | write-denied |
| pre-existing target **at decision time** | `exists` | `exclusive-create-conflict` | `exists`→recovery | n/a | write-denied |
| **raced target** (appears after prospective evaluation / point-of-use race) | `exists` | `exclusive-create-conflict` | `exists`→recovery | n/a | write-conflict (public canonical code `ERR-WRITE-TARGET-CONFLICT` where the applicable surface exposes the canonical error) |

MAC-3C/3D/3E assert the exact code at each layer (the adapter pure-code
mapping tests already lock the mapping tables; hostile tests lock the
runtime routing).

---

## 17. MCP-level hostile coverage boundary

Evidence layering (do not duplicate lower layers):

1. **Layer 1 — deterministic native/fs-level suite (MAC-3C/3D):** the
   mechanism proofs (§6-§8). This is where hostile races are actually
   won and lost deterministically.
2. **Layer 2 — accepted composition trace (already green, carried):**
   `tests/mcp/unit/persist.test.ts` (kind gate → canonical bytes →
   executor, create-only conflict, containment lanes) + `mac2f-e2e`
   (real persist; conflict `write-denied` with no overwrite; unknown
   workspace `write-denied`; server healthy after rejections; clean
   EOF). This proves the MCP→executor→native path carries the typed
   failures without translation loss.
3. **Layer 3 — NEW bounded MCP-level hostile evidence (MAC-3E), exactly
   four items:**
   - concurrent same-destination `persist-artifact` (two client sessions
     racing one destination → at most one `created`, loser `write-denied`);
   - conflict/no-overwrite observed through the public schema under
     churn (target appearing mid-request);
   - workspace authority rejection (`ERR-WS-UNKNOWN`) unaffected by
     churn;
   - server continuity after race-induced write denial (subsequent
     request succeeds; zero stderr; process alive).

Layer 3 exists because the MCP surface is the product boundary and
concurrency across two sessions is not expressible at Layer 1; it does
not re-prove every native race.

---

## 18. Apple Silicon boundary

- MAC-3A/B/C/D/E run on the real Intel host (this gate: Intel x86_64).
- `native/darwin-arm64/gateway_fs.node` exists as a build artifact;
  loader tests prove wrong-arch/missing-addon fail-closed; **no arm64
  runtime hostile-race evidence exists or is claimed.**
- **Recorded requirement: `MAC-5 must rerun the architecture-relevant
  MAC-3 accepted suite on real arm64 hardware`** (per
  `docs/macos-port-work-packages.md` MAC-5 acceptance). The
  architecture-relevant subset = the full MAC-3B/C/D/E hostile suite
  (all primitives are arch-agnostic C, but race behavior is physical
  filesystem evidence and is lane-bound).
- Architecture-independent build checks (loader, surface, cap-drift
  guard) remain runnable on Intel.

---

## 19. Carried test-infra debt (non-blocking INFO; NOT hostile findings)

| Item | Detail | Disposition |
|---|---|---|
| WP-7 runner manifest staleness | `scripts/run-wp7-tests.mjs` `EXPECTED_COUNTS`: reader expects **62**, suite executes **68** (MAC-2D +5 anchors +1 fd-stability without manifest update); security is **Linux-shaped** (expects 39 zero-skip; Darwin executes 40 with 3 documented `/proc` platform-skips → 37 pass/0 fail) | **Owned by MAC-3B preparation** (test-only manifest correction) — the accepted MAC-2G FINDING-3. MAC-3A does NOT fix it; exact accounting must be restored before MAC-3C/D add further security counts |
| `/var` vs `/private/var` fixture debt | 82 durability-suite failures, class 1 of MAC-2G §11 — non-canonical test-fixture spelling rejected by the accepted descriptor-identity contract; production roots canonical | preserved, separated; NOT a hostile finding; fix ownership remains MAC-2G-documented (test fixture only) |
| Linux-only Git-path debt | 11 changes-suite + 3 fail/12 cancelled git wp7 tests (hard-coded `/home/chef/.../git`); Linux-only `GIT_BIN` class | preserved, separated |
| Pi environment mismatch | expected Pi 0.83.0 layout vs installed 0.84.1 (`F8` failure) | pure environment mismatch; preserved, separated |

None of the above is security-relevant; none is corrected in MAC-3A.

---

## 20. Required coverage table

Every RACE-Ixx and W-xx appears. Evidence keys: NT=native/test, EX=
`tests/writing/executor.test.ts`, CW=`controlled-write.test.ts`,
AD=`darwin-fs-adapter.test.ts`, W13=`wp13b-completion.test.ts`,
WA=`wp13b-darwin-writer-adapter.test.ts`, AN=`tests/wp7/reader/anchors.test.ts`,
FD=`fd-stability.test.ts`, RD=`reader.test.ts`, MP=`mcp/unit/persist.test.ts`,
E2E=`mac2f-e2e.test.ts`, SEC=`wp7/security/security.test.ts`, SG=static guards.

| ID | Consumer | Attack window | Hostile action | Required outcome | Existing evidence | Status | Planned test |
|---|---|---|---|---|---|---|---|
| RACE-I01 | executor/completion | root churn post-anchor | rename+decoy root | original-root authority | EX 234, CW 367 — exact A-type executor root-churn evidence (post-anchor rename + replacement via the accepted hook). Completion-writer post-root-anchor authority is additionally construction-complete: subsequent descent is descriptor-relative through the retained `rootFd` with zero root-path reopen. (W13 704 is an A-type INTERMEDIATE/attempt-directory swap, NOT root churn — see §7 W-C6 evidence.) | PROVEN | carry; add symlink-decoy root variant (MAC-3C) |
| RACE-I02 | all | intermediate churn post-open | rename+decoy intermediate | retained-fd authority | AD 184, WA 145/182, AD 69/85 | PARTIALLY PROVEN | B-type primitive sequencing W-W2 (MAC-3C) |
| RACE-I03 | all | symlink in descent/final | symlink insert | fail closed, never followed | NT 49/130/154, EX 179/200, W13 628/645, AN 5, WA 40 | PROVEN | carry (MAC-3C/3D add dangling-symlink descent variants) |
| RACE-I04 | executor/completion | final-name race | pre-created any kind | closed conflict | NT 113/122/130, EX 42/62, CW 308, MP 232, W13 435 | PROVEN | carry |
| RACE-I05 | executor/completion | parent identity | rename / same-path replacement | rename→parent-not-verified; same-path→accepted pathname binding (recorded) | AD 124, NT 219, W13 734 | PARTIALLY PROVEN | B-type verify-after-rename sequence + semantics lock (MAC-3C) |
| RACE-I06 | executor/completion | cleanup provenance | parent churn / name swap / dir-at-name | fd-anchored single unlink; name-bound boundary recorded | EX 299/326, CW 675, AD 184-B, WA 145/130 | PARTIALLY PROVEN | name-swap+decoy via existing hook; dir-at-name→`failed`; writer cleanup via new hook (MAC-3C) |
| RACE-I07 | completion | recovery identity | mid-window swap to decoy/symlink | descriptor-relative inspection only | W13 450/435/628, WA 101/145 | PARTIALLY PROVEN | `afterCreateConflict` hook test (MAC-3B/C) |
| RACE-I08 | completion | recovery mutation | any | observational-only | W13 450 ("without rewrite"), source audit, WA 80 | PROVEN | carry; add mtime/ctime-unchanged assert (MAC-3C) |
| RACE-I09 | reader | pre-open revalidation | symlink / dir / regular-file swap | symlink→not-found; dir→unsupported-type; regular-file→S-07 bind-time binding (recorded) | AN 5 | PARTIALLY PROVEN | B-type state tests + S-07 semantics lock (MAC-3D) |
| RACE-I10 | reader | post-open stability | rename+decoy | original bytes | AN 1-2 | PROVEN | carry |
| RACE-I11 | reader | enumeration anchor | rename+decoy dir/symlink | original entries | AN 3-4, NT enum 85/104 | PROVEN | carry |
| RACE-I12 | reader | enumeration offsets | repeated calls | independent streams | NT enum 70/183, MAC-2G FINDING-1 | PROVEN | carry; add interleaved readdir churn variant (MAC-3D) |
| RACE-I13 | all | descriptor lifetime | all failure paths | exactly-once release | FD 1, NT malformed 141, AD 69/85, EX finally | PARTIALLY PROVEN | completion-writer fd-count loop (MAC-3C) |
| RACE-I14 | all | resource pressure | EMFILE/repeated failure | typed fail-closed, no fallback | FD 1, NT loader/malformed, SG | PARTIALLY PROVEN | isolated child fd-pressure suite (MAC-3B harness, MAC-3E) |
| RACE-I15 | executor/completion | concurrent same-destination | two writers | ≤1 created, loser closed | EX 42/62, CW 308, MP 232 (sequential only) | UNPROVEN | reentrant-hook interleave = deterministic ORDERING evidence only (MAC-3C, does not close the invariant); true concurrent child / two-session closure in MAC-3E |
| RACE-I16 | all | cross-root redirect | churn storms | confinement preserved | CW 330/395/421/444, EX 200, W13 704 | PARTIALLY PROVEN | bounded child churn storm + confinement asserts (MAC-3E) |
| W-W1 | executor | root open→descent | root churn | original root | EX 234, CW 367 | PROVEN | — |
| W-W2 | executor | inter-open→next-open | intermediate churn | retained-fd descent | AD 69/85/100/111, AD 184 | PARTIALLY PROVEN | B-type sequencing (MAC-3C) |
| W-W3 | executor | parent open→identity | rename/same-path replace | parent-not-verified / recorded binding | AD 124, NT 219 | PARTIALLY PROVEN | B-type sequence (MAC-3C) |
| W-W4 | executor | verify→create | parent churn | original-object create | AD 184, EX 234, WA 182 | PROVEN | — |
| W-W5 | executor | create→verify | any churn | fd-bound verify | by construction | PROVEN | — |
| W-W6 | executor | verify→write | churn during write | original-object bytes | EX 299/309, CW 692/703 | PARTIALLY PROVEN | beforeWrite churn test (MAC-3C) |
| W-W7 | executor | write→cleanup | name swap+decoy | name-bound cleanup per §14 | EX 299/326, CW 675 | PARTIALLY PROVEN | beforeWrite hook test (MAC-3C) |
| W-W8 | executor | cleanup under parent replacement | parent→decoy | retained-fd unlink | AD 184-B, WA 145 | PROVEN | — |
| W-C1 | completion | pre-created target | all kinds | gated recovery/conflict | W13 435/450/628/674, WA 80 | PROVEN | — |
| W-C2 | completion | EEXIST→recovery open | mid-window swap | descriptor-relative gated | W13 states, WA 145 | PARTIALLY PROVEN | afterCreateConflict hook (MAC-3B/C) |
| W-C3 | completion | target→symlink pre-recovery | symlink swap | conflict, never already-exact | NT 154, W13 628, WA 101 | PARTIALLY PROVEN | same hook (MAC-3C) |
| W-C4 | completion | post-recovery-open churn | rename/replace | fd-bound checks | by construction, WA 145 | PROVEN | — |
| W-C5 | completion | bytes/type/uid differ | conflicting states | typed conflict | W13 435/465/674, WA 101 | PROVEN | — |
| W-C6 | completion | parent churn w/ recovery fd | parent churn | fd-bound recovery | WA 145 | PROVEN | — |
| W-C7 | completion | concurrent writers | interleaved pair | ≤1 created | none (sequential W13 311/435) | UNPROVEN | reentrant afterRootOpen interleave (MAC-3C) |
| W-C8 | completion | cleanup + decoy | post-create failure + churn | fd-anchored cleanup | none | UNPROVEN | writer write-stage hook (MAC-3B/C) |
| W-R1 | reader | containment→open | final swap | not-found / unsupported-type / S-07 binding | AN 5 | PARTIALLY PROVEN | B-type states (MAC-3D) |
| W-R2 | reader | intermediate→symlink | pre-descent swap | not-found | AN 5 | PROVEN | — |
| W-R3 | reader | final→symlink | pre-open swap | not-found | NT 154 | PARTIALLY PROVEN | B-type fs-layer (MAC-3D) |
| W-R4 | reader | open→S-07 | post-open churn | ERR-CON-DENIED | service 318-324, AN 1-4 (fs layer) | PARTIALLY PROVEN | exported-function mismatch test + service test (MAC-3D) |
| W-R5 | reader | S-07→read | post-bind churn | original bytes | AN 1-2 | PROVEN | — |
| W-R6 | reader | during read | churn | fd-bound read | by construction, AN 1 | PROVEN | — |
| W-R7 | reader | pre-enumeration churn | rename+decoy | original entries | AN 3-4 | PROVEN | — |
| W-R8 | reader | during enumeration | churn | private-fd bound | by construction, NT enum | PROVEN | — |
| W-R9 | reader | root churn w/ cached fd | root rename+decoy | original authority / CON-DENIED | getRoot cache (source) | PARTIALLY PROVEN | fs + service B-type (MAC-3D) |
| W-R10 | reader | repeated failures | N failures | fd stability + codes | FD 1, NT malformed 141 | PROVEN | — |

No broad "covered by security tests" claims above: every PROVEN row cites
named tests; every PARTIAL/UNPROVEN row names the deterministic strategy.

---

## 21. Severity model

| Severity | Definition |
|---|---|
| CRITICAL | race permits arbitrary authority outside trusted roots, or attacker-selected write/delete/read |
| HIGH | race permits overwrite/delete/read of an unapproved object inside a trusted root, or materially bypasses verification |
| MODERATE | resource/lifetime/race defect enables persistent DoS, incorrect adoption, or substantial fail-open behavior without arbitrary authority |
| MINOR | bounded security-test/diagnostic weakness with no production authority violation |
| INFO | coverage/accounting/documentation debt only |

Applied to MAC-3A findings: **zero findings.** The recorded boundaries
(same-path directory replacement binding RACE-I05/I09/D7, name-bound
cleanup RACE-I06, inspect-metadata lexical lstat §2.5) are accepted
contract semantics inherited from the Linux lane — they are documentation
and coverage obligations for MAC-3B/C/D, not production defects, and are
classified INFO until a MAC-3 test demonstrates otherwise (any test that
fails will be root-caused to the seam per the MAC-3 work-package gate,
never papered over).

---

## 22. Proposed MAC-3 decomposition (dependency-ordered; unchanged shape)

| Slice | Content | Depends on |
|---|---|---|
| **MAC-3B** — harness foundation + accounting repair | concurrent child-actor helper (§12) with bounded lifecycle; fd-pressure child harness; the two TEST-ONLY writer hooks (§11, pending senior approval); reentrant-interleave helper; **WP-7 manifest accounting repair** (reader 62→68, security Darwin-shape, §19); documentation of the §5 recorded boundaries (I05/I06/I09) as locked semantics | MAC-3A |
| **MAC-3C** — writing executor + completion writer hostile verification | W-W2…W-W8, W-C1…W-C8, RACE-I01…I08, I13/I15 (executor/completion side), cleanup-race matrix §14, error-taxonomy asserts §16 (layers 1-2) | MAC-3B |
| **MAC-3D** — reader + directory enumeration hostile verification | W-R1…W-R10, RACE-I09…I12, S-07 binding/semantics tests, root-cache churn, enumeration isolation under churn | MAC-3B |
| **MAC-3E** — integrated hostile security closure | RACE-I14/I15/I16 integrated, cross-root decoy matrix §13 integration, MCP layer-3 evidence (§17: concurrent persist, conflict under churn, authority rejection, server continuity), final taxonomy + evidence bundle | MAC-3C, MAC-3D |

No change to the shape is warranted: the audit confirms MAC-3B must
precede C/D (hooks + harness + accounting), C and D are independent once
B exists, and E is the integrator. Deliberately NOT merged into one
mega-slice.

---

## 23. Report artifact

This file: `docs/reports/mac-3a-hostile-race-threat-matrix-and-verification-contract.md`.
Contains: baseline SHA (§1); accepted authority model (§2); native
six-function boundary (§3); hostile actor model (§4); RACE-Ixx invariants
(§5); W-Wx/W-Cx/W-Rx windows (§6-§8); existing coverage inventory (§9);
deterministic synchronization requirements (§10); test-only hook designs
(§11); concurrency actor design (§12); cleanup-race matrix (§14);
fd/resource-pressure matrix (§15); error-taxonomy expectations (§16);
MCP evidence layering (§17); Intel/arm64 evidence boundary (§18); carried
test-infra debt (§19); severity model (§21); exact slice decomposition
(§22); coverage table (§20).

No implementation changes were made: `git status` delta = this file only
(untracked), plus the preserved rollback report. At closure this file is
the single artifact of the local baseline commit; the rollback report
remains untracked and untouched.

---

## 24. End-state decision

**Gate chronology:**

1. **initial:** `MAC-3A — READY FOR SENIOR REVIEW`;
2. **independent senior review:** `MAC-3A SENIOR REVIEW — CORRECTIONS
   REQUIRED`;
3. **focused report correction** (report-only):
   - F-1 — CLOSED: coverage totals corrected to 21/18/3 = 42;
   - F-2 — CLOSED: error-taxonomy/lane precision corrected;
   - F-3 — CLOSED: RACE-I01 evidence citation corrected;
   - F-4 — APPLIED: reentrant I15 evidence explicitly ordering-only;
   - F-5 — APPLIED: RACE-I06 wording aligned to frozen name-bound
     semantics;
   - F-6 — APPLIED: MAC-3B source-shape/runtime-behavior distinction
     explicit;
4. **focused rereview:** `MAC-3A FOCUSED REREVIEW — ACCEPTED` —
   F-1/F-2/F-3 CLOSED; F-4/F-5/F-6 applied; no stale contradiction;
   no contract conclusion changed; zero implementation/test work;
   `MAC-3A — READY FOR LOCAL BASELINE CLOSURE`;
5. **closure (this gate):** **`MAC-3A — CLOSED / LOCALLY BASELINED`**
   — exactly one local baseline commit `docs: establish MAC-3
   hostile-race verification contract` (parent
   `1685bd7a748c267b623aae3ed48673c05d37ba83`); SHA recorded in the
   closure gate summary (a commit cannot contain its own SHA).

**Correction disposition:** F-1/F-2/F-3 CLOSED · F-4/F-5/F-6 applied.
No CONTRACT / IMPLEMENTATION / COVERAGE / TEST-SEAM finding remains.
(No new review verdict is invented; the dispositions above are the
recorded finding states.)

**Closure record:** contract escalation NONE; production/native/test/
script changes ZERO; native capability surface unchanged (six
primitives); exactly two future completion-writer test seams approved
but NOT implemented; WP-7 accounting untouched; MAC-3B NOT started;
nothing pushed, tagged, or released.

Basis, checked against every criterion:

- every material attack window is enumerated (W-W1…8, W-C1…8, W-R1…10,
  cross-root D1…9, cleanup and pressure matrices);
- accepted authority semantics are unambiguous (reconstructed from
  source, §2; recorded boundaries I05/I06/I09 are inherited Linux
  semantics, not redesigns);
- existing coverage is mapped precisely (named-test citations, §9/§20;
  no "covered by security tests" statements);
- missing coverage has a deterministic verification strategy — all
  UNPROVEN/PARTIAL windows are reachable via existing hooks, B-type
  sequencing, reentrant interleaving, or bounded child actors; exactly
  two narrowly scoped TEST-ONLY hooks are proposed for the completion
  writer (the only windows with no other deterministic interleave),
  following the accepted `afterRootOpen` precedent;
- no production/native capability expansion is required (six primitives
  and the accepted authority model are sufficient);
- MAC-3 can proceed through bounded test-only/security-verification
  slices (MAC-3B→3C/3D→3E).

Not escalated: no required hostile-race property needs a change to an
already accepted production authority contract. No
implementation/native/test/script correction was made. The senior-review
findings were corrected in this report only. This gate's single
local documentation commit baselines the accepted report; nothing was
pushed, tagged, or released; MAC-3B has not begun.
