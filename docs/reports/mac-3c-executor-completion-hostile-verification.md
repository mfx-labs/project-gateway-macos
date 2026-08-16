# MAC-3C — Executor + Completion Hostile Verification (Gate Report)

**Verdict: `MAC-3C — CLOSED / LOCALLY BASELINED`** (final durable
state; historical verdicts `MAC-3C — READY FOR SENIOR REVIEW` →
`MAC-3C SENIOR REVIEW — CORRECTIONS REQUIRED` → `MAC-3C — READY FOR
FOCUSED REREVIEW` → `MAC-3C FOCUSED REREVIEW — ACCEPTED` preserved —
see §11 gate chronology)
**Starting SHA:** `a0e24f7f00b892aac387cabcab2171ab5174bba7` (verified by
`git rev-parse HEAD` — exact match; tracked working tree clean at freeze;
only `?? .DS_Store` untracked, the preserved environmental-hygiene event
from MAC-3B §13.1).
**Accepted contract:** `MAC-3A — CLOSED / LOCALLY BASELINED`
(`docs/reports/mac-3a-hostile-race-threat-matrix-and-verification-contract.md`).
**Accepted harness baseline:** `MAC-3B — CLOSED / LOCALLY BASELINED`
(`docs/reports/mac-3b-deterministic-harness-foundation-and-test-accounting.md`).
**Date:** host local time at gate execution
**Host:** macOS 12.6 (Darwin 21.6.0, xnu-8020.240.18.709.2), x86_64
(Intel), Node v22.23.1, Git 2.37.1 (Apple Git-137.1). All runtime
evidence is **Intel x86_64 only**; no Apple Silicon claim.

MAC-3C owns deterministic hostile verification of the writing executor
and the completion writer ONLY. It does NOT touch the reader
implementation/tests (MAC-3D), integrated fd-pressure or MCP concurrency
(MAC-3E), production authority semantics, native code, schemas, or the
MCP surface.

---

## 1. Exact delta

| File | Change | Scope |
|---|---|---|
| `tests/unit/mac3c-executor-hostile.test.ts` | 8 new deterministic hostile tests (writing executor) | TEST-ONLY (new) |
| `tests/unit/mac3c-completion-hostile.test.ts` | 14 new deterministic hostile tests (completion writer) | TEST-ONLY (new) |
| `docs/reports/mac-3c-executor-completion-hostile-verification.md` | this report | DOC |

Zero production/native/schema/MCP/script/reader changes. `git status`
delta = three untracked MAC-3C artifacts — the executor hostile test,
the completion hostile test, and this report — plus the pre-existing
`.DS_Store` hygiene event; none are tracked or committed. No commit, no
push, no tag, no release.

---

## 2. Tests added — exact inventory (22/22 green)

All evidence is A-type (deterministic boundary pause at an accepted seam)
or B-type (structural descriptor-first sequencing). Zero sleeps, zero
retries, zero scheduler-dependent assertions (MAC-3A §10 policy).

### 2.1 `tests/unit/mac3c-executor-hostile.test.ts` (8 tests)

| # | Test | Row(s) | Class | Assertions locked |
|---|---|---|---|---|
| E1 | W-W2: retained intermediate descriptor across rename AND replacement | W-W2 / RACE-I02 | B (direct native-primitive sequencing: `openDirectoryAt(root,'a')` → churn `a` → `openDirectoryAt(retained,'b')`) | next component opens in the MOVED original (`getPath` = `<root>/a-moved/b`); rename decoy empty; rm+recreate replacement → typed `not-found` fail closed, no fallback into the replacement decoy |
| E2 | W-W3: rename divergence fails closed; same-path replacement binds the accepted pathname | W-W3 / RACE-I05 / D7 | B (`descentToParent` → rename → `verifyParentIdentity`) | rename → exact `{ok:false, code:'parent-not-verified'}`; divergence evidence (`getPath` reports the NEW path); same-path replacement (no rename): fresh decision-time descent opens the object at the accepted pathname and the identity gate PASSES — **D7 semantics LOCKED, not redesigned** |
| E3 | W-W6: name swap before write — decoy never receives bytes | W-W6 | A (`beforeWrite`) | exact `created` + `persistedByteCount`; ORIGINAL renamed-away object receives the exact bytes; decoy at the name byte-identical |
| E4 | W-W6: parent renamed + replaced before write | W-W6 | A (`beforeWrite`) | exact `created`; bytes land in the ORIGINAL parent object; decoy parent receives nothing |
| E5 | W-W7: final-name swap before failure cleanup | W-W7 / RACE-I06 | A (`beforeWrite` throw) | exact `{ok:false, code:'write-failed', cleanup:'removed'}`; decoy at the created component unlinked; operation-created object (renamed away) survives with 0 bytes — **I06 name-bound boundary LOCKED** |
| E6 | dir-at-name cleanup | §14 / RACE-I06 | A (`beforeWrite` throw) | exact `{ok:false, code:'write-failed', cleanup:'failed'}` (truthful indeterminate); directory NEVER deleted (`unlinkat` without AT_REMOVEDIR); created object survives |
| E7 | RACE-I01: symlink-decoy root after anchoring | RACE-I01 (carry) | A (`afterRootOpen`) | exact `created`; file in the originally anchored root; symlink target empty; symlink untouched |
| E8 | RACE-I03: dangling symlink at the ancestor | RACE-I03 (carry) | B (pre-arranged) | fail closed through the accepted closed-vocabulary mapping (`parent-not-directory`/`symlink-loop`); on the reviewed Darwin host the deterministic observed mapping is ENOTDIR → `parent-not-directory`; the broader accepted test union remains contract-conformant; cleanup `not-needed`; symlink untouched; nothing created anywhere |

### 2.2 `tests/unit/mac3c-completion-hostile.test.ts` (14 tests)

| # | Test | Row(s) | Class | Assertions locked |
|---|---|---|---|---|
| C1 | W-C2: EEXIST target swapped to a decoy before recovery | W-C2 / RACE-I07 | A (`afterCreateConflict`) | exact `exclusive-create-conflict`; decoy byte-identical (never mutated) |
| C2 | W-C2: swapped to a directory | W-C2 / RACE-I07 | A | exact `exclusive-create-conflict`; directory intact, never adopted |
| C3 | W-C2: swapped to a FIFO | W-C2 / RACE-I07 | A | exact `exclusive-create-conflict`; never blocks (O_NONBLOCK; test completion is the determinism evidence); FIFO untouched |
| C4 | W-C3: swapped to a dangling symlink | W-C3 / RACE-I07 | A | exact `exclusive-create-conflict`; never `already-exact`; symlink untouched |
| C5 | W-C3: swapped to a symlink pointing at EXACT bytes | W-C3 / RACE-I03, I07 | A | exact `exclusive-create-conflict` — a symlink to the exact expected bytes NEVER yields `already-exact`; target untouched |
| C6 | W-C2 + RACE-I08: swapped to an exact-bytes file | W-C2 / RACE-I08 (carry) | A | exact `{ok:true, outcome:'already-exact'}` (observational adoption of the CURRENT name object); **mtime and ctime unchanged** (recovery never rewrote/mutated) |
| C7 | W-C7: reentrant same-destination — exact-bytes loser | W-C7 / RACE-I15 (ordering only) | A (reentrant `afterRootOpen` interleave + `makeInterleaveClock`) | B's outcome exact `created` inside A's pause; A resumes → EEXIST → exact `already-exact`; interleave order `['A-root-anchor','B-beforeWrite','A-resumes','A-conflict-boundary']` asserted exactly; exactly ONE `created`; destination = EXACT bytes |
| C8 | W-C7: reentrant same-destination — conflicting loser | W-C7 / RACE-I15 (ordering only) | A | same exact ordering; A → exact `exclusive-create-conflict`; destination = CONFLICT bytes; at most one `created`; no overwrite, no adoption |
| C9 | W-C8: final-name swap before failure | W-C8 / RACE-I06 | A (`beforeWrite` throw) | exact `{ok:false, code:'io-failure'}`; decoy at the created component unlinked; created object (renamed away) survives with 0 bytes; verified parent survives — I06 boundary locked for the completion lane |
| C10 | W-C8: parent churn before failure | W-C8 / RACE-I06, I16 | A | exact `io-failure`; cleanup unlinked the created file THROUGH the retained parent fd (moved original has no result file); decoy parent untouched; moved parent survives |
| C11 | W-C8: directory planted at the created name | W-C8 / RACE-I06 | A | exact `io-failure`; directory NEVER deleted; created object survives |
| C12 | RACE-I13: completion fd-lifetime stability | RACE-I13 | B (deterministic repetition; fd-count assertion) | 20× created, 20× recovery-conflict (target byte-identical after every cycle), 20× `beforeWrite`-throw cleanup (created object removed each time), 20× `afterCreateConflict`-throw (pre-existing target untouched) — `/dev/fd` count stable (`after ≤ before + 2`) |
| C13 | RACE-I01: symlink-decoy root after anchoring | RACE-I01 (carry) | A (`afterRootOpen`) | completion **rename divergence fails closed**: exact `{ok:false, code:'parent-not-verified'}` (D6; per-component F_GETPATH identity diverges at the first descent component BEFORE any create); nothing created in the moved original; symlink decoy empty and untouched |
| C14 | RACE-I03: dangling symlink at a descent component | RACE-I03 (carry) | B (pre-arranged) | exact `parent-not-verified` (Darwin ENOTDIR under O_DIRECTORY|O_NOFOLLOW — fail closed, never followed; recorded in the closed vocabulary); both the occurrence and results components; symlinks untouched |

**Mechanism-level notes recorded as accepted evidence, not defects:**

- The executor has no seam between parent descent and identity
  verification, so W-W3 is proven at the adapter level (the adapter IS
  the executor's seam consumer — the exact mechanism the contract's
  strategy prescribes). No new hook was added.
- The completion writer's root-rename outcome is `parent-not-verified`
  (rename divergence at the descent identity gate), NOT continuation in
  the moved root — this is the accepted completion-lane fail-closed
  semantics (MAC-3A §16 taxonomy: rename divergence → fail closed BEFORE
  create) and is strictly fail-closed; the executor lane keeps its
  accepted continuation semantics (fd-anchored root, no root F_GETPATH).
- Darwin maps a dangling symlink under `O_DIRECTORY|O_NOFOLLOW` to
  ENOTDIR (`parent-not-verified` completion / `parent-not-directory`
  executor) rather than ELOOP; both are inside the accepted closed
  vocabulary and never followed.

---

## 3. A/B evidence classification (all 22 tests)

| Class | Count | Tests |
|---|---|---|
| A — deterministic boundary pause at an accepted seam (`afterRootOpen` / `beforeWrite` / `afterCreateConflict`) | 17 | E3–E7, C1–C11, C13 |
| B — structural sequencing (descriptor retained FIRST, lexical state replaced, next descriptor-relative operation) | 5 | E1, E2, E8, C12, C14 |
| C — probabilistic (sleeps/retries) | **0** | none — policy preserved |

The only repetition in the suite (C12, 80 deterministic cycles) asserts a
stability property with an fd-count comparison, mirroring the accepted
`fd-stability.test.ts` precedent — it is NOT a race-win gamble.

---

## 4. Coverage recomputation — executor/completion rows only

Only rows with NEW MAC-3C evidence were recomputed. Reader rows and
integrated MAC-3E properties were NOT modified. Per-row changes against
MAC-3A §20:

| Row | Before | After | Basis |
|---|---|---|---|
| RACE-I02 | PARTIALLY PROVEN | **PROVEN** | E1 direct primitive sequencing (the planned MAC-3C test); retained-fd authority under rename AND replacement |
| RACE-I05 | PARTIALLY PROVEN | **PROVEN** | E2 rename divergence fail-closed + D7 same-path semantics lock |
| RACE-I06 | PARTIALLY PROVEN | **PROVEN** | E5, E6, C9, C10, C11 — name-bound cleanup, dir-at-name, completion cleanup matrix |
| RACE-I07 | PARTIALLY PROVEN | **PROVEN** | C1–C5 mid-window swap tests through `afterCreateConflict` |
| RACE-I08 | PROVEN | PROVEN (strengthened) | C6 mtime/ctime-unchanged assert added (the planned carry) |
| RACE-I13 | PARTIALLY PROVEN | **PROVEN** | C12 — the completion writer's missing fd-count evidence is now covered |
| W-W2 | PARTIALLY PROVEN | **PROVEN** | E1 |
| W-W3 | PARTIALLY PROVEN | **PROVEN** | E2 |
| W-W6 | PARTIALLY PROVEN | **PROVEN** | E3, E4 (churn-during-write via existing `beforeWrite`) |
| W-W7 | PARTIALLY PROVEN | **PROVEN** | E5 (final-name swap via existing hook) |
| W-C2 | PARTIALLY PROVEN | **PROVEN** | C1, C2, C3, C6 |
| W-C3 | PARTIALLY PROVEN | **PROVEN** | C4, C5 |
| W-C7 | UNPROVEN | **PARTIALLY PROVEN** | C7, C8 — deterministic reentrant ORDERING evidence only (see §6) |
| W-C8 | UNPROVEN | **PROVEN** | C9, C10, C11 (the planned MAC-3C `beforeWrite` matrix) |

Rows deliberately NOT changed: RACE-I01 (already PROVEN; new
symlink-decoy variants on both lanes are additional carry evidence),
RACE-I03 (already PROVEN; dangling-symlink variants added), RACE-I04,
RACE-I09–I12, RACE-I14, **RACE-I15 (UNPROVEN — see §6)**, RACE-I16,
W-W1, W-W4, W-W5, W-W8, W-C1, W-C4, W-C5, W-C6, and all W-Rx (MAC-3D).

**Universe totals (42 rows):**

| | MAC-3A | MAC-3C (this gate) |
|---|---|---|
| PROVEN | 21 | **33** |
| PARTIALLY PROVEN | 18 | **8** |
| UNPROVEN | 3 | **1** |

Breakdown — invariants 12/3/1 · writing windows 8/0/0 · completion
windows 7/1/0 · reader windows 6/4/0 (reader unchanged) · total
33 + 8 + 1 = 42. The single UNPROVEN row is RACE-I15; the eight PARTIAL
rows are W-C7 + the seven reader/integrated rows owned by MAC-3D/3E
(RACE-I09, RACE-I14, RACE-I16, W-R1, W-R3, W-R4, W-R9).

---

## 5. Remaining executor/completion gaps

- **RACE-I15 final concurrent closure — UNPROVEN, owned by MAC-3E.**
  MAC-3C's W-C7 reentrant evidence is deterministic ordering evidence
  only (see §6).
- **RACE-I14 (EMFILE pressure against production consumers) and
  RACE-I16 (bounded churn storms) — MAC-3E.** The MAC-3B pressure and
  child-actor harnesses exist and are self-tested; no integrated
  consumer-under-pressure evidence is claimed here.
- **ENOSPC** remains explicitly out of scope (machine-wide destructive;
  MAC-3A §15).
- **Integrated executor W-W3** cannot be injected mid-call (no accepted
  seam exists between parent descent and identity verification); the
  mechanism is proven at the adapter level (E2), which is the layer the
  contract's strategy prescribes. No new hook was added.
- **W-C5 mode-not-verified in recovery** remains the accepted inherited
  contract (recorded MAC-3A §7), not a defect.

---

## 6. RACE-I15 final concurrency — explicitly NOT closed

C7/C8 reentrant-interleave evidence is **ordering evidence only**: writer
A is paused at its own accepted `afterRootOpen` seam and writer B runs to
completion synchronously inside that pause; A then resumes and loses the
exclusive create. This proves the exact deterministic sequence
(anchor → B-create → A-EEXIST → recovery) and the loser outcomes
(`already-exact` / `exclusive-create-conflict`), never via scheduler
timing. It does NOT constitute concurrent-execution proof.

**RACE-I15 remains UNPROVEN.** The final true-concurrency closure (two
independent sessions / child actors racing one destination, plus the
MCP layer-3 evidence) remains owned by MAC-3E, exactly as the MAC-3A
boundary requires.

---

## 7. Focused verification (all green)

| Suite | Result |
|---|---|
| NEW `mac3c-executor-hostile.test.ts` | 8/8 |
| NEW `mac3c-completion-hostile.test.ts` | 14/14 |
| Existing writing family (`executor`, `controlled-write`, `darwin-fs-adapter`, `static-guard`) | 63/63 |
| Existing completion family (`wp13b-completion` 22, `wp13b-darwin-writer-adapter` 8, `wp13b-completion-seams` 10) | 40/40 |
| MAC-3B seam/harness guards (`mac3b-harness` 11, `mac3b-hook-exposure` 7, `mac3b-accounting` 13) | 31/31 |
| Native surface guards (`surface`, `loader`) | 11/11 |
| Runtime static guard (nine MCP tools, zero stderr) | 6/6 |
| `mac2f-e2e` (real Intel persist; six native exports; nine tools) | 3/3 |
| `npm run typecheck` | exit 0 |
| `tsc -p tsconfig.tests.json` | exit 0 |
| `git diff --check` | clean |

The full default inventory was intentionally NOT rerun (no production,
native, reader, MCP, or schema change; no cross-cutting failure
appeared).

---

## 8. Surfaces unchanged

- **Native capability surface: exactly six JS-visible exports.**
  `native/src/gateway_fs.c` untouched (zero native delta this gate);
  `native/test/surface.test.mjs` + `loader.test.mjs` green; `mac2f-e2e`
  six-export assertion green.
- **MCP surface: exactly nine tools.** No schema/MCP/runner change;
  `tests/runtime/static-guard.test.ts` nine-tool guard green; e2e 3/3.
- **Production authority semantics unchanged.** The executor and
  completion writer source files are byte-identical to the frozen HEAD;
  only new test files exist.

---

## 9. Evidence boundary

All runtime evidence in this gate is **Intel x86_64** (host fingerprint
unchanged from MAC-3A/3B). No Apple Silicon hostile-race acceptance is
claimed; per MAC-3A §18, MAC-5 must rerun the architecture-relevant
MAC-3 accepted suite on real arm64 hardware.

---

## 10. Non-claims

- MAC-3D (reader/enumeration hostile verification) — **NOT STARTED**;
  reader rows unchanged.
- MAC-3E (integrated pressure/MCP concurrency closure) — **NOT STARTED**;
  RACE-I14/I15/I16 integrated statuses unchanged (I15 UNPROVEN).
- No coverage-status change outside the §4 table.
- No commit, push, tag, or release. Starting SHA verified
  `a0e24f7f00b892aac387cabcab2171ab5174bba7`; the working tree carries
  the three untracked MAC-3C artifacts (executor hostile test,
  completion hostile test, this report) plus the preserved `.DS_Store`
  hygiene event — none tracked or committed.

No deterministic evidence exposed any implementation defect inside the
accepted contract; no contract escalation is required.

---

## 11. Correction Addendum — focused report correction (F-1 / F-2 / F-3)

**Gate chronology:**

1. **initial:** `MAC-3C — READY FOR SENIOR REVIEW`;
2. **independent senior review:** `MAC-3C SENIOR REVIEW — CORRECTIONS
   REQUIRED` — three report-only findings, zero evidence or
   implementation defects;
3. **focused correction (this delta — report ONLY; no test, source,
   native, or script change):**
   - **F-1 = CLOSED (MINOR, accounting):** §3 A/B classification
     counts corrected to the exact membership — A-type = 17 (E3–E7,
     C1–C11, C13), B-type = 5 (E1, E2, E8, C12, C14), C-type = 0,
     total 22. No test classification membership and no coverage
     status changed.
   - **F-2 = CLOSED (INFO, documentation):** §1 (and the matching §10
     non-claim) working-tree/delta wording now names every untracked
     MAC-3C artifact — the executor hostile test, the completion
     hostile test, and this report — plus the pre-existing `.DS_Store`
     hygiene event. The report is untracked, not committed.
   - **F-3 = CLOSED (INFO, wording):** §2.1 E8 row no longer claims an
     exact single Darwin error code. The accepted result is the
     closed-vocabulary mapping (`parent-not-directory`/`symlink-loop`);
     on the reviewed Darwin host the deterministic observed mapping is
     ENOTDIR → `parent-not-directory`; the broader accepted test union
     remains contract-conformant.

**Preserved unchanged:** all 22 tests and their behavior; coverage
33 PROVEN / 8 PARTIAL / 1 UNPROVEN; RACE-I15 = UNPROVEN; W-C7 =
PARTIALLY PROVEN; reader rows unchanged; production delta = ZERO;
native surface = six; MCP surface = nine; contract escalation = NONE;
MAC-3D/E = NOT STARTED. No commit, no push, no tag, no release.

**Verification (this correction):** corrected report inspected;
`git diff --check` clean. No test rerun required (code-under-test
unchanged).

4. **final focused rereview:** `MAC-3C FOCUSED REREVIEW — ACCEPTED` —
   F-1/F-2/F-3 CLOSED; no stale contradiction; no contract or coverage
   conclusion changed; zero test/source change;
   `MAC-3C — READY FOR LOCAL BASELINE CLOSURE`;
5. **closure (this gate):** **`MAC-3C — CLOSED / LOCALLY BASELINED`**
   — exactly one local baseline commit `test: establish MAC-3C hostile
   write verification` (parent
   `a0e24f7f00b892aac387cabcab2171ab5174bba7`); SHA recorded in the
   closure gate summary (a commit cannot contain its own SHA). The
   candidate artifacts named in §1 are committed to the repository by
   this closure commit; `.DS_Store` remains outside the commit.

**Closure record:** F-1 = CLOSED; F-2 = CLOSED; F-3 = CLOSED; hostile
tests = 22/22; evidence classification = A17 / B5 / C0; coverage =
33 PROVEN / 8 PARTIAL / 1 UNPROVEN (42 rows); RACE-I15 = UNPROVEN
(final concurrency owned by MAC-3E); W-C7 = PARTIALLY PROVEN (ordering
evidence only); reader rows unchanged; production/native/script changes
= ZERO; native surface = six exports; MCP surface = nine tools;
contract escalation = NONE; Intel-only runtime evidence (no Apple
Silicon claim); MAC-3D/E = NOT STARTED; nothing pushed, tagged, or
released.

**MAC-3C — CLOSED / LOCALLY BASELINED**
