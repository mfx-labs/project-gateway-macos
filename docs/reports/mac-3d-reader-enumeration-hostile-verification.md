# MAC-3D — Reader + Enumeration Hostile Verification (Gate Report)

**Verdict: `MAC-3D — CLOSED / LOCALLY BASELINED`** (historical
verdicts `MAC-3D — READY FOR SENIOR REVIEW` → `MAC-3D SENIOR REVIEW —
CORRECTIONS REQUIRED` → `MAC-3D — READY FOR FOCUSED REREVIEW`
preserved — see §10/§11 gate chronology)
**Starting SHA:** `643405cad31fd3a95999cc9510e94030804deeff` (verified by
`git rev-parse HEAD` — exact match; tracked working tree clean at freeze;
only `?? .DS_Store` untracked, the preserved environmental-hygiene event
from MAC-3B §13.1).
**Accepted contract:** `MAC-3A — CLOSED / LOCALLY BASELINED`
(`docs/reports/mac-3a-hostile-race-threat-matrix-and-verification-contract.md`).
**Accepted prior gates:** `MAC-3B — CLOSED / LOCALLY BASELINED`,
`MAC-3C — CLOSED / LOCALLY BASELINED` (commit
`643405cad31fd3a95999cc9510e94030804deeff`).
**Date:** host local time at gate execution
**Host:** macOS 12.6 (Darwin 21.6.0, xnu-8020.240.18.709.2), x86_64
(Intel), Node v22.23.1, Git 2.37.1 (Apple Git-137.1). All runtime
evidence is **Intel x86_64 only**; no Apple Silicon claim.

MAC-3D owns deterministic hostile verification of the controlled reader
and descriptor-bound directory enumeration ONLY. It does NOT change
production authority semantics, add hooks, change native code or the
six-export surface, modify writer/executor behavior, or implement MAC-3E
concurrency/fd-pressure/MCP two-session work.

---

## 1. Exact delta

| File | Change | Scope |
|---|---|---|
| `tests/wp7/reader/mac3d-reader-hostile.test.ts` | 10 new deterministic hostile tests (reader fs layer) | TEST-ONLY (new) |
| `tests/wp7/reader/mac3d-service-hostile.test.ts` | 5 new deterministic hostile tests (reader service layer) | TEST-ONLY (new) |
| `scripts/run-wp7-tests.mjs` | WP-7 exact-accounting repair: `EXPECTED_COUNTS.reader` 68 → 83 (the 15 new MAC-3D reader tests) | TEST-INFRA |
| `tests/unit/mac3b-accounting.test.ts` | the durable accounting regression suite tracks the authorized actual (83) | TEST-INFRA |
| `docs/reports/mac-3d-reader-enumeration-hostile-verification.md` | this report | DOC |

Zero production/native/schema/MCP/script-behavior changes. The only
script change is the accepted WP-7 test-count manifest (MAC-3A §19
accounting-exactness obligation; the MAC-3B regression suite locks it).
No reader implementation, service, adapter, or native source changed.

---

## 2. Tests added — exact inventory (15/15 green)

Evidence class: **B — structural descriptor-first sequencing** for every
new test. The retained descriptor (or the decision evidence) is obtained
FIRST, the lexical state is replaced, then the next descriptor-relative
operation runs. There is NO accepted reader seam (the reader has no
hooks by accepted design — MAC-3A §8/§11), and no new production seam
was added merely to make a test possible. Zero sleeps, zero
retry-until-win, zero scheduler dependence.

### 2.1 `tests/wp7/reader/mac3d-reader-hostile.test.ts` (10 tests, fs layer)

| # | Test | Row(s) | Assertions locked |
|---|---|---|---|
| R1 | W-R1: a different regular file at the accepted pathname is bound at decision time | W-R1 / RACE-I09 | the pre-open residual race is NOT claimed atomic (accepted boundary): the descent binds the bind-time object at the accepted pathname; exactly the BIND-TIME bytes are read — **bind-time semantics LOCKED** |
| R2 | W-R1: a directory at the target before open fails the type gate | W-R1 | exact `{ok:false, code:'unsupported-type'}`; directory untouched, never read |
| R3 | W-R3: final-component symlink swap before open | W-R3 / RACE-I03 | exact `{ok:false, code:'not-found'}` (O_NOFOLLOW refusal); decoy byte-identical (never read); symlink untouched |
| R4 | W-R3: dangling-symlink final component before open | W-R3 / RACE-I03 | exact `not-found`; symlink untouched, never followed |
| R5 | W-R4: post-open replacement exposes the S-07 mismatch | W-R4 / RACE-I09 | exported `statResolvedTarget` vs `statIdentity(fstat(fd))`: `verifyDescriptorIdentity` === false (bind-time stat sees the decoy, the retained fd holds the original); the retained fd still reads ORIGINAL bytes (no path rediscovery after binding); decoy byte-identical |
| R6 | W-R9 fs: reads continue from the retained ORIGINAL root after rename + decoy-root replacement | W-R9 / RACE-I01 | descent continues through the retained root descriptor; ORIGINAL-ROOT bytes returned; decoy root byte-identical, never read |
| R7 | W-R9 fs: enumeration continues from the retained ORIGINAL root | W-R9 / RACE-I01, I11 | exact original entries; the decoy root's entries never appear |
| R8 | RACE-I12: repeated enumeration from one caller fd re-anchors to the opened vnode across rename + replacement churn | RACE-I12 (carry) | three passes on the SAME caller fd: passes 2–3 after churn return the exact original entry set (seam's private `openat(fd, ".")` per call — independent stream offsets, caller fd never consumed/repositioned); decoy directory never enumerated |
| R9 | RACE-I13 / MAC-3A §15: repeated enumeration passes are independent and leak-free | RACE-I13 (carry) | 100 passes on one target fd: every pass is a complete independent enumeration with the exact entry set; `/dev/fd` count stable |
| R10 | RACE-I13 / MAC-3A §15: repeated enumeration-open failures are leak-free | RACE-I13 (carry) | 60× `openForListDirectory` on a missing chain: exact `not-found` every time; `/dev/fd` count stable |

### 2.2 `tests/wp7/reader/mac3d-service-hostile.test.ts` (5 tests, service layer)

| # | Test | Row(s) | Assertions locked |
|---|---|---|---|
| S1 | W-R9 service: cached root fd keeps the original tree; the re-resolved decision sees the decoy root | W-R9 / W-R4 / RACE-I09 | warm the root cache (successful read) → rename root + decoy root with the same layout → the containment decision re-resolves the pathname into the DECOY while the descent runs through the RETAINED original root fd → S-07 dev/ino divergence → exact service failure code **`ERR-CON-DENIED`**; original and decoy byte-identical (neither mutated, decoy never adopted) |
| S2 | W-R9 service: root-cache divergence for directory listing | W-R9 / W-R4 / RACE-I09 | same mechanism for `listDirectory` → exact **`ERR-CON-DENIED`**; decoy directory never enumerated; original directory intact |
| S3 | W-R3 service: symlink planted between the containment decision and the open | W-R3 / RACE-I03 | single-shot churn INSIDE the host-owned existing-path resolver (decision evidence taken FIRST, then the substitution) → the final-component symlink is refused at the descriptor-relative open → exact **`ERR-NOT-FOUND`**; symlink untouched; decoy never read |
| S4 | W-R1 service: a different regular file bound at decision time reads the bind-time object | W-R1 / RACE-I09 | resolver-side same-path regular-file replacement → service read succeeds with exactly the BIND-TIME content — **accepted bind-time semantics LOCKED at the service surface** (the pre-open residual race is not claimed atomic) |
| S5 | W-R1 service: a directory at the target between decision and open | W-R1 | resolver-side replacement by a directory → exact **`ERR-FTYPE-UNSUPPORTED`**; directory untouched |

### 2.3 Mechanism notes (recorded, not defects)

- **Service-level W-R4:** no seam exists between the descriptor open and
  `bindDescriptor` at target level (accepted design — the reader has no
  hooks). The exported-function mismatch test (R5) proves the mechanism;
  the service-level `ERR-CON-DENIED` mapping is exercised through the
  root-cache divergence (S1/S2), which drives the IDENTICAL
  `bindDescriptor` code path and mapping. The accepted boundary is
  preserved: the pre-open residual race is not claimed atomic; post-open
  mismatch is the fail-closed boundary.
- **W-R9 service mechanism:** the cached root fd pins the original vnode
  while containment re-resolves the pathname — the only deterministic
  service-level dev/ino divergence (same-pathname replacements bind the
  pathname object per the accepted D7/RACE-I05 semantics, locked by
  MAC-3C and S4 here).
- **Enumeration churn mid-pass (W-R8)** remains proven by construction
  only: the native pass is a single `fdopendir`/`readdir` loop on a
  private fd with zero pathname use and no injection point — correctly
  so (MAC-3A §8).

---

## 3. A/B evidence classification (all 15 tests)

| Class | Count | Tests |
|---|---|---|
| A — deterministic boundary pause at an accepted seam | **0** | none — the reader has no accepted seam by design; none was added |
| B — structural descriptor-first sequencing | **15** | R1–R10, S1–S5 |
| C — probabilistic (sleeps/retries) | **0** | none — policy preserved |

The only repetition in the suite (R9/R10, 160 deterministic cycles)
asserts stability properties with fd-count and exact-entry comparisons,
mirroring the accepted `fd-stability.test.ts` precedent — NOT a
race-win gamble.

---

## 4. Coverage recomputation — reader rows only

Only rows with NEW MAC-3D evidence were recomputed. MAC-3C rows and
integrated MAC-3E properties were NOT modified.

| Row | Before | After | Basis |
|---|---|---|---|
| RACE-I09 | PARTIALLY PROVEN | **PROVEN** | S-07 semantics locked at both layers (R1, S4); type-gate and symlink refusal states (R2, R3, R4, S3, S5); post-open mismatch fail-closed mechanism + service mapping (R5, S1, S2) — the planned MAC-3D tests |
| W-R1 | PARTIALLY PROVEN | **PROVEN** | R1, R2 (fs states + semantics lock), S4, S5 (service surface) |
| W-R3 | PARTIALLY PROVEN | **PROVEN** | R3, R4 (fs), S3 (service `ERR-NOT-FOUND`) |
| W-R4 | PARTIALLY PROVEN | **PROVEN** | R5 (exported-function mismatch), S1/S2 (service-level `ERR-CON-DENIED` via the identical bindDescriptor path) |
| W-R9 | PARTIALLY PROVEN | **PROVEN** | R6, R7 (fs retained-root authority), S1, S2 (service identity revalidation) |
| RACE-I12 | PROVEN | PROVEN (strengthened) | R8 — the planned interleaved readdir churn variant (carry) |
| RACE-I13 | PROVEN | PROVEN (strengthened) | R9, R10 — reader-layer enumeration fd-stability (MAC-3A §15 carry) |

Rows deliberately NOT changed: RACE-I01/I03/I10/I11 (already PROVEN; the
new root-level and enumeration-churn tests are additional carry
evidence), W-R2/W-R5/W-R6/W-R7/W-R8/W-R10 (PROVEN), RACE-I14,
RACE-I16 (PARTIALLY PROVEN — MAC-3E), **RACE-I15 (UNPROVEN — MAC-3E
owns final concurrency; unchanged)**, and every MAC-3C row
(RACE-I02/I04/I05/I06/I07/I08, W-Wx, W-Cx — MAC-3C verdicts preserved).

**Universe totals (42 rows):**

| | MAC-3A | MAC-3C closure | MAC-3D (this gate) |
|---|---|---|---|
| PROVEN | 21 | 33 | **38** |
| PARTIALLY PROVEN | 18 | 8 | **3** |
| UNPROVEN | 3 | 1 | **1** |

Breakdown — invariants 13/2/1 · writing windows 8/0/0 · completion
windows 7/1/0 · reader windows **10/0/0** (reader gaps fully closed) ·
total 38 + 3 + 1 = 42. The single UNPROVEN row is RACE-I15; the three
PARTIAL rows are W-C7 (deterministic ordering evidence only) plus
RACE-I14 and RACE-I16 (integrated MAC-3E work).

---

## 5. Remaining reader/enumeration gaps

- **W-R8 mid-pass enumeration churn:** proven by construction only (a
  single kernel pass on a private fd; no injection point exists and none
  will be added — MAC-3A records this as correctly so).
- **`inspectLogicalEntry` lexical lstat** remains the recorded
  call-time-metadata surface (MAC-3A §2.5) — no descriptor-authority
  claim, no mutation, unchanged.
- **RACE-I14 / RACE-I16 / RACE-I15 integrated closure — MAC-3E.** No
  integrated EMFILE pressure was performed in this gate (owned by
  MAC-3E; the MAC-3B pressure harness remains self-tested only).
- Apple Silicon: no arm64 runtime evidence exists or is claimed; MAC-5
  must rerun the architecture-relevant MAC-3 accepted suite on real
  arm64 hardware (MAC-3A §18).

---

## 6. Focused verification (all green)

| Suite | Result |
|---|---|
| NEW `mac3d-reader-hostile.test.ts` | 10/10 |
| NEW `mac3d-service-hostile.test.ts` | 5/5 |
| WP-7 reader suite (existing 68 + new 15; accounting-exact) | 83/83 |
| WP-7 security suite | 37/40 pass + 3 name-exact platform-permitted skips (exit 0) |
| WP-7 fff suite | 26/26 |
| WP-7 git suite | pre-existing Linux-only `GIT_BIN` debt unchanged (3 fail / 12 cancelled; MAC-3B §2 disposition, not owned here) |
| MAC-3B accounting/harness/exposure regression suites | 31/31 (accounting updated to the authorized actual 83) |
| Native enumeration + surface + malformed | 22/22 (six-export surface guard green) |
| Runtime static guard (nine MCP tools, zero stderr) | 6/6 (surface-preservation check only) |
| `node scripts/wp7-discovery-guard.mjs` | OK (source↔compiled correspondence incl. the new reader tests) |
| `npm run typecheck` | exit 0 |
| `tsc -p tsconfig.tests.json` | exit 0 |
| `git diff --check` | clean |

The full default inventory was intentionally NOT rerun (no production,
native, writer, completion, MCP, or schema change; no cross-cutting
failure appeared).

---

## 7. Surfaces unchanged

- **Production/native changes = ZERO.** No `src/**`, `native/**`,
  `schemas/**` file changed; the two modified files are test-infra
  accounting only.
- **Native capability surface = exactly six JS-visible exports**
  (`native/test/surface.test.mjs` green; no native delta).
- **MCP surface = exactly nine tools** (`tests/runtime/static-guard.test.ts`
  green; no schema/MCP/runner-surface change).
- **Writer/executor behavior untouched** (MAC-3C verdicts preserved;
  no MAC-3C file changed).

---

## 8. Evidence boundary

All runtime evidence in this gate is **Intel x86_64** (host fingerprint
unchanged from MAC-3A/3B/3C). No Apple Silicon hostile-race acceptance
is claimed.

---

## 9. Non-claims

- MAC-3E (integrated pressure/MCP concurrency closure) — **NOT STARTED**;
  **RACE-I15 remains UNPROVEN**; RACE-I14/I16 integrated statuses
  unchanged.
- No coverage-status change outside the §4 table; MAC-3C rows untouched.
- No commit, push, tag, or release. Starting SHA verified
  `643405cad31fd3a95999cc9510e94030804deeff`; the working tree carries
  the MAC-3D delta as: two NEW untracked test files
  (`tests/wp7/reader/mac3d-reader-hostile.test.ts`,
  `tests/wp7/reader/mac3d-service-hostile.test.ts`), two TRACKED but
  uncommitted test-infra modifications (`scripts/run-wp7-tests.mjs`,
  `tests/unit/mac3b-accounting.test.ts`), the untracked MAC-3D report
  (this file), and the pre-existing untracked `.DS_Store` hygiene
  event. None of the MAC-3D delta is committed yet.

No deterministic evidence exposed any implementation defect inside the
accepted reader contract; no contract escalation is required.

---

## 10. Correction Addendum — focused report correction (D-1)

**Gate chronology:**

1. **initial:** `MAC-3D — READY FOR SENIOR REVIEW`;
2. **independent senior review:** `MAC-3D SENIOR REVIEW — CORRECTIONS
   REQUIRED` — one report-only wording finding (D-1), zero evidence,
   coverage, accounting, or implementation defects;
3. **focused correction (this delta — report ONLY; no test,
   accounting-logic, production, native, schema, or MCP change):**
   - **D-1 = CLOSED (INFO, documentation):** §9 working-tree wording
     now distinguishes the MAC-3D delta accurately — two NEW untracked
     test files, two TRACKED but uncommitted test-infra modifications
     (`scripts/run-wp7-tests.mjs`, `tests/unit/mac3b-accounting.test.ts`),
     the untracked MAC-3D report, and the pre-existing untracked
     `.DS_Store`. None of the MAC-3D delta is committed yet.

**Preserved unchanged:** 15/15 hostile tests; evidence classification
B15 / A0 / C0; coverage 38 PROVEN / 3 PARTIAL / 1 UNPROVEN; reader
windows 10/0/0; RACE-I15 = UNPROVEN; W-C7 + RACE-I14 + RACE-I16 =
PARTIALLY PROVEN; native surface = six; MCP surface = nine; contract
escalation = NONE; MAC-3E = NOT STARTED. No commit, no push, no tag,
no release.

**Verification (this correction):** corrected §9 inspected;
`git diff --check` clean. No test rerun required (code-under-test
unchanged).

**MAC-3D — READY FOR FOCUSED REREVIEW** (historical)

---

## 11. Closure Addendum — local baseline commit

**Gate chronology (continued):**

4. **focused rereview:** `MAC-3D FOCUSED REREVIEW — ACCEPTED` — D-1
   confirmed CLOSED (INFO, documentation); §9 working-tree wording
   accurate; stale claim absent; `git diff --check` clean; no test
   rerun required (code-under-test unchanged);
5. **closure (this addendum):** `MAC-3D — CLOSED / LOCALLY BASELINED`
   — exactly one local baseline commit `test: establish MAC-3D hostile
   reader verification`, parent
   `643405cad31fd3a95999cc9510e94030804deeff`, containing exactly the
   five accepted MAC-3D delta paths: the two NEW untracked test files
   (`tests/wp7/reader/mac3d-reader-hostile.test.ts`,
   `tests/wp7/reader/mac3d-service-hostile.test.ts`), the two
   TRACKED-but-uncommitted test-infra modifications
   (`scripts/run-wp7-tests.mjs`, `tests/unit/mac3b-accounting.test.ts`),
   and this report. The pre-existing `.DS_Store` remains outside the
   commit (untracked). Nothing pushed, tagged, or released.

**Closure state (unchanged from rereview):** hostile tests = 15/15;
evidence classification = A0 / B15 / C0; WP-7 reader accounting = 83;
coverage = 38 PROVEN / 3 PARTIAL / 1 UNPROVEN; reader windows =
10/0/0; RACE-I15 = UNPROVEN; W-C7 + RACE-I14 + RACE-I16 = PARTIALLY
PROVEN; production/native/schema/MCP changes = ZERO; native surface =
six; MCP surface = nine; contract escalation = NONE; runtime evidence
Intel x86_64 only; MAC-3E = NOT STARTED.

**Verification (this closure):** `git diff --check` clean;
`git diff --cached --check` clean; staged name-status/stat verified
(only the five MAC-3D paths); post-commit parent/subject/file-set
verified; `.DS_Store` outside the commit; no production/native/schema/
MCP drift; no tag/push/release; MAC-3E not started.

**MAC-3D — CLOSED / LOCALLY BASELINED**
